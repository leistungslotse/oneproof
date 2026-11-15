import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { after, describe, it } from 'node:test'
import { erzeugeIonosVermittler, MAX_KOERPER } from '../../vite/ionos-proxy.ts'
import type { IonosAnfrage, IonosVermittlerOptionen } from '../../vite/ionos-proxy.ts'

/** What the proxy sent on to IONOS, with the body as text. */
interface Aufruf extends Omit<IonosAnfrage, 'body'> {
  url: string
  body: string | undefined
}

/** The body of an answer that says what went wrong. */
interface FehlerKoerper {
  error: { message: string }
}

/** The message in the body of an error answer. */
async function fehlermeldung(antwort: Response): Promise<string> {
  const koerper: FehlerKoerper = await antwort.json()
  return koerper.error.message
}

/** The way the proxy is set up for a test, and what IONOS answers. */
interface StarteOptionen extends Omit<IonosVermittlerOptionen, 'holen'> {
  antwort: (url: string) => Response
}

/** A server with the proxy handler mounted the way connect mounts it: the prefix is gone. */
async function starte(optionen: StarteOptionen) {
  const aufrufe: Aufruf[] = []
  const holen = async (url: string, einstellungen: IonosAnfrage): Promise<Response> => {
    aufrufe.push({ url, ...einstellungen, body: einstellungen.body?.toString('utf8') })
    return optionen.antwort(url)
  }
  const vermittler = erzeugeIonosVermittler({ ziel: 'https://ionos.example/', token: 'geheim', holen, ...optionen })
  const server = createServer((anfrage, antwort) =>
    vermittler(anfrage, antwort, () => {
      antwort.statusCode = 404
      antwort.end()
    }),
  )
  await new Promise<void>((fertig) => server.listen(0, '127.0.0.1', fertig))
  const bindung = server.address()
  assert.ok(bindung && typeof bindung === 'object')
  const adresse = `http://127.0.0.1:${bindung.port}`
  after(() => server.close())
  return { adresse, aufrufe }
}

const JSON_KOPF = { 'content-type': 'application/json' }

const json = (koerper: unknown, status = 200, kopf: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(koerper), { status, headers: { 'content-type': 'application/json', ...kopf } })

describe('Vermittler zum KI-Dienst', () => {
  it('passes the model list on with the token', async () => {
    const { adresse, aufrufe } = await starte({ antwort: () => json({ data: [{ id: 'm' }] }) })

    const antwort = await fetch(`${adresse}/v1/models`)

    assert.equal(antwort.status, 200)
    assert.deepEqual(await antwort.json(), { data: [{ id: 'm' }] })
    assert.equal(aufrufe[0]?.url, 'https://ionos.example/v1/models')
    assert.equal(aufrufe[0]?.headers.Authorization, 'Bearer geheim')
  })

  it('passes a chat request on unchanged', async () => {
    const { adresse, aufrufe } = await starte({ modelle: () => [{ modell: 'm' }], antwort: () => json({ choices: [] }) })
    const anfrage = JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'Grüße ✓' }], max_tokens: 100 })

    const antwort = await fetch(`${adresse}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: anfrage,
    })

    assert.equal(antwort.status, 200)
    assert.equal(aufrufe[0]?.url, 'https://ionos.example/v1/chat/completions')
    assert.equal(aufrufe[0]?.method, 'POST')
    assert.equal(aufrufe[0]?.body, anfrage)
  })

  it('uses its own token and not one the browser sent, and drops the query', async () => {
    const { adresse, aufrufe } = await starte({ antwort: () => json({}) })

    await fetch(`${adresse}/v1/models?x=1`, { headers: { Authorization: 'Bearer fremd', Cookie: 'a=b' } })

    assert.equal(aufrufe[0]?.url, 'https://ionos.example/v1/models')
    assert.equal(aufrufe[0]?.headers.Authorization, 'Bearer geheim')
    assert.equal(aufrufe[0]?.headers.Cookie, undefined)
  })

  it('does not leak the token to the browser', async () => {
    const { adresse } = await starte({ antwort: () => json({}) })
    const antwort = await fetch(`${adresse}/v1/models`)
    assert.ok(![...antwort.headers.values()].some((wert) => wert.includes('geheim')))
  })

  it('answers with 401 and a clear message if there is no token, without asking IONOS', async () => {
    const { adresse, aufrufe } = await starte({ token: '', antwort: () => json({}) })

    const antwort = await fetch(`${adresse}/v1/models`)

    assert.equal(antwort.status, 401)
    assert.match(await fehlermeldung(antwort), /IONOS_API_TOKEN ist nicht gesetzt/)
    assert.equal(aufrufe.length, 0)
  })

  it('is no open relay: only the two calls of the check are passed on', async () => {
    const { adresse, aufrufe } = await starte({ antwort: () => json({}) })

    for (const pfad of ['/', '/v1', '/v1/images/generations', '/v1/embeddings', '/v2/models', '/v1/models/x', '/v1/models/../chat', '/v1/chat/completions/x']) {
      const antwort = await fetch(`${adresse}${pfad}`, { method: 'POST', body: '{}' })
      assert.equal(antwort.status, 404, pfad)
    }
    assert.equal(aufrufe.length, 0)
  })

  it('allows each call only its one method', async () => {
    const { adresse, aufrufe } = await starte({ antwort: () => json({}) })

    assert.equal((await fetch(`${adresse}/v1/models`, { method: 'POST', body: '{}' })).status, 405)
    assert.equal((await fetch(`${adresse}/v1/chat/completions`)).status, 405)
    assert.equal((await fetch(`${adresse}/v1/chat/completions`, { method: 'DELETE' })).status, 405)
    assert.equal(aufrufe.length, 0)
  })

  it('refuses a request body above the limit', async () => {
    const { adresse, aufrufe } = await starte({ antwort: () => json({}) })

    const antwort = await fetch(`${adresse}/v1/chat/completions`, { method: 'POST', headers: JSON_KOPF, body: 'x'.repeat(MAX_KOERPER + 1) })

    assert.equal(antwort.status, 413)
    assert.equal(aufrufe.length, 0)
  })

  it('passes on only JSON: a plain-text body, as a page of another origin sends it without asking first, is refused', async () => {
    const { adresse, aufrufe } = await starte({ antwort: () => json({ choices: [] }) })
    const koerper = JSON.stringify({ model: 'lightonai/LightOnOCR-2-1B', messages: [], max_tokens: 10 })
    const sende = (kopf: Record<string, string>) => fetch(`${adresse}/v1/chat/completions`, { method: 'POST', headers: kopf, body: koerper })

    // `fetch` names a string body text/plain by itself, exactly what `no-cors` is allowed to send.
    assert.equal((await sende({})).status, 415)
    assert.equal((await sende({ 'content-type': 'text/plain' })).status, 415)
    assert.equal((await sende({ 'content-type': 'application/x-www-form-urlencoded' })).status, 415)
    assert.equal((await sende({ 'content-type': 'application/jsonp' })).status, 415)
    assert.equal(aufrufe.length, 0)
    assert.equal((await sende({ 'content-type': 'application/json' })).status, 200)
    assert.equal((await sende({ 'content-type': 'Application/JSON; charset=utf-8' })).status, 200)
    assert.equal(aufrufe.length, 2)
  })

  it('survives a sender that gives up in the middle of the body', async () => {
    const { adresse, aufrufe } = await starte({ antwort: () => json({ choices: [] }) })
    const { port } = new URL(adresse)

    // Headers and half a body, then the connection drops: as a reload of the page does it.
    await new Promise<void>((fertig) => {
      const steckdose = connect(Number(port), '127.0.0.1', () => {
        steckdose.write('POST /v1/chat/completions HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{"model":')
        setTimeout(() => steckdose.destroy(), 50)
      })
      steckdose.on('error', () => {})
      steckdose.on('close', () => fertig())
    })
    await new Promise((fertig) => setTimeout(fertig, 100))

    // The server still answers, and IONOS was not asked for the broken request.
    assert.equal((await fetch(`${adresse}/v1/models`)).status, 200)
    assert.equal(aufrufe.length, 1)
  })

  it('passes on the status and the waiting time of a rate limit', async () => {
    const { adresse } = await starte({ antwort: () => json({ error: { message: 'slow down' } }, 429, { 'retry-after': '7' }) })

    const antwort = await fetch(`${adresse}/v1/models`)

    assert.equal(antwort.status, 429)
    assert.equal(antwort.headers.get('retry-after'), '7')
    assert.equal(await fehlermeldung(antwort), 'slow down')
  })

  it('answers with 502 if IONOS cannot be reached', async () => {
    const { adresse } = await starte({
      antwort: () => {
        throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } })
      },
    })

    const antwort = await fetch(`${adresse}/v1/models`)

    assert.equal(antwort.status, 502)
    assert.match(await fehlermeldung(antwort), /ECONNREFUSED/)
  })

  it('passes on chat requests only for the models of the configuration', async () => {
    const { adresse, aufrufe } = await starte({ antwort: () => json({ choices: [] }) })
    const chat = (model: string) =>
      fetch(`${adresse}/v1/chat/completions`, { method: 'POST', headers: JSON_KOPF, body: JSON.stringify({ model, messages: [], max_tokens: 10 }) })

    // The default configuration: LightOnOCR 2 and Qwen3.8 27B, found by the words of their names.
    assert.equal((await chat('lightonai/LightOnOCR-2-1B')).status, 200)
    assert.equal((await chat('Qwen/Qwen3.8-27B')).status, 200)
    const fremd = await chat('meta-llama/Llama-3.3-70B-Instruct')
    assert.equal(fremd.status, 400)
    assert.match(await fehlermeldung(fremd), /nicht freigegeben/)
    assert.equal((await chat('Qwen/Qwen3.8-235B-A27B')).status, 400, 'a part of a name is no name')
    assert.equal(aufrufe.length, 2)
  })

  it('refuses streams, several answers, an unbounded answer and anything that is no JSON', async () => {
    const { adresse, aufrufe } = await starte({ modelle: () => [{ modell: 'm' }], antwort: () => json({}) })
    const chat = (koerper: string) => fetch(`${adresse}/v1/chat/completions`, { method: 'POST', headers: JSON_KOPF, body: koerper })
    const mit = (weiteres: Record<string, unknown>) => JSON.stringify({ model: 'm', messages: [], max_tokens: 10, ...weiteres })

    for (const koerper of [
      mit({ stream: true }),
      mit({ n: 3 }),
      mit({ max_tokens: undefined }),
      mit({ max_tokens: 100_000 }),
      mit({ max_tokens: 10, max_completion_tokens: 20 }),
      'kein json',
      '[1, 2]',
    ]) {
      assert.equal((await chat(koerper)).status, 400, koerper)
    }
    assert.equal((await chat(mit({ stream: false, n: 1, max_tokens: 32_768 }))).status, 200)
    assert.equal(aufrufe.length, 1)
  })

  it('never lets the answer be cached', async () => {
    const { adresse } = await starte({ antwort: () => json({}) })
    assert.equal((await fetch(`${adresse}/v1/models`)).headers.get('cache-control'), 'no-store')
    assert.equal((await fetch(`${adresse}/v1/nope`)).headers.get('cache-control'), 'no-store')
  })
})
