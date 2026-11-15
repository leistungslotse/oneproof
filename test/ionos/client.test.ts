import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { erzeugeIonosClient, IonosFehler, istWiederholbar, ohneDenkschritte } from '../../src/engine/ionos/client.ts'
import type { ChatEingabe, HolenAntwort, HolenOptionen } from '../../src/engine/ionos/client.ts'
import { loeseModellAuf, mitStandard, STANDARD_KI } from '../../src/engine/ionos/modelle.ts'

/** A response as `fetch` hands it out. */
function antwort(
  status: number,
  koerper: unknown,
  { typ = 'application/json', kopf = {} }: { typ?: string; kopf?: Record<string, string> } = {},
): HolenAntwort {
  const text = typeof koerper === 'string' ? koerper : JSON.stringify(koerper)
  return { status, text: async () => text, headers: new Headers({ 'content-type': typ, ...kopf }) }
}

const erfolg = (inhalt: string, extra: Record<string, unknown> = {}): HolenAntwort =>
  antwort(200, { model: 'm', choices: [{ message: { content: inhalt }, finish_reason: 'stop' }], ...extra })

/** What the fake `fetch` answers next: a response, an error to throw, or a function that decides. */
type Vorgesehen = HolenAntwort | Error | ((optionen: HolenOptionen) => Promise<HolenAntwort>)

/** A call the fake `fetch` got: what was asked, and the body of the request as the client wrote it. */
interface Aufruf {
  url: string
  optionen: HolenOptionen
  body: Record<string, unknown> | null
}

/** A `fetch` that remembers what it was asked. */
interface FalscherHolen {
  (url: string, optionen: HolenOptionen): Promise<HolenAntwort>
  aufrufe: Aufruf[]
}

/** A `fetch` that answers from a queue and remembers what it was asked. */
function falscherHolen(...antworten: Vorgesehen[]): FalscherHolen {
  const aufrufe: Aufruf[] = []
  const holen = async (url: string, optionen: HolenOptionen): Promise<HolenAntwort> => {
    const body: Record<string, unknown> | null = optionen.body ? JSON.parse(optionen.body) : null
    aufrufe.push({ url, optionen, body })
    const naechste = antworten.length > 1 ? antworten.shift() : antworten[0]
    if (naechste === undefined) throw new Error('falscherHolen: no answer was prepared')
    if (typeof naechste === 'function') return naechste(optionen)
    if (naechste instanceof Error) throw naechste
    return naechste
  }
  holen.aufrufe = aufrufe
  return holen
}

/** A `schlafen` that does not wait and remembers how long it was asked to. */
interface OhnePause {
  (ms: number): Promise<void>
  pausen: number[]
}

const ohnePause = (): OhnePause => {
  const pausen: number[] = []
  const schlafen = async (ms: number): Promise<void> => void pausen.push(ms)
  schlafen.pausen = pausen
  return schlafen
}

const frage: ChatEingabe = { modell: 'm', nachrichten: [{ role: 'user', content: 'Hallo' }] }

describe('Chat', () => {
  it('sends the request in the OpenAI form to the proxy and returns the answer', async () => {
    const holen = falscherHolen(erfolg('Hallo zurück', { usage: { total_tokens: 7 } }))
    const client = erzeugeIonosClient({ fetch: holen })

    const ergebnis = await client.chat({ ...frage, maxTokens: 100, temperatur: 0.2 })

    assert.equal(holen.aufrufe[0]?.url, '/ionos/v1/chat/completions')
    assert.equal(holen.aufrufe[0]?.optionen.method, 'POST')
    assert.deepEqual(holen.aufrufe[0]?.body, {
      model: 'm',
      messages: frage.nachrichten,
      max_tokens: 100,
      temperature: 0.2,
    })
    assert.equal(ergebnis.text, 'Hallo zurück')
    assert.equal(ergebnis.abgeschnitten, false)
    assert.deepEqual(ergebnis.usage, { total_tokens: 7 })
  })

  it('leaves out what was not asked for, so that the model keeps its defaults', async () => {
    const holen = falscherHolen(erfolg('x'))
    await erzeugeIonosClient({ fetch: holen }).chat(frage)
    assert.deepEqual(Object.keys(holen.aufrufe[0]?.body ?? {}), ['model', 'messages'])
  })

  it('passes a response format and extra parameters on', async () => {
    const holen = falscherHolen(erfolg('{}'))
    await erzeugeIonosClient({ fetch: holen }).chat({
      ...frage,
      antwortFormat: { type: 'json_object' },
      zusatz: { seed: 1 },
    })
    assert.deepEqual(holen.aufrufe[0]?.body?.response_format, { type: 'json_object' })
    assert.equal(holen.aufrufe[0]?.body?.seed, 1)
  })

  it('strips the reasoning from the answer and keeps it apart', async () => {
    const holen = falscherHolen(
      antwort(200, {
        choices: [{ message: { content: '<think>erst überlegen</think>Antwort', reasoning_content: 'Gedanken' }, finish_reason: 'stop' }],
      }),
    )
    const ergebnis = await erzeugeIonosClient({ fetch: holen }).chat(frage)
    assert.equal(ergebnis.text, 'Antwort')
    assert.equal(ergebnis.roh, '<think>erst überlegen</think>Antwort')
    assert.equal(ergebnis.begruendung, 'Gedanken')
  })

  it('reports an answer that hit the token limit as cut off', async () => {
    const holen = falscherHolen(antwort(200, { choices: [{ message: { content: 'halber Sa' }, finish_reason: 'length' }] }))
    const ergebnis = await erzeugeIonosClient({ fetch: holen }).chat(frage)
    assert.equal(ergebnis.abgeschnitten, true)
    assert.equal(ergebnis.finishReason, 'length')
  })

  it('reads content that comes as a list of parts, and tolerates null', async () => {
    const teile = falscherHolen(antwort(200, { choices: [{ message: { content: [{ type: 'text', text: 'a' }, { text: 'b' }] } }] }))
    assert.equal((await erzeugeIonosClient({ fetch: teile }).chat(frage)).text, 'ab')

    const leer = falscherHolen(antwort(200, { choices: [{ message: { content: null }, finish_reason: 'length' }] }))
    assert.equal((await erzeugeIonosClient({ fetch: leer }).chat(frage)).text, '')
  })

  it('rejects an answer without the expected structure', async () => {
    for (const koerper of [{ choices: [] }, { nope: 1 }, 'kein json']) {
      const holen = falscherHolen(antwort(200, koerper))
      await assert.rejects(erzeugeIonosClient({ fetch: holen }).chat(frage), { art: 'antwort' })
    }
  })
})

describe('Fehler', () => {
  it('names a missing or wrong token and does not retry', async () => {
    const holen = falscherHolen(antwort(401, { error: { message: 'invalid token' } }))
    await assert.rejects(erzeugeIonosClient({ fetch: holen, schlafen: ohnePause() }).chat(frage), (fehler) => {
      assert.ok(fehler instanceof IonosFehler)
      assert.equal(fehler.art, 'auth')
      assert.match(fehler.message, /Zugangstoken/)
      return true
    })
    assert.equal(holen.aufrufe.length, 1)
  })

  it('recognises a web page where the AI interface should be', async () => {
    const seite = antwort(200, '<!doctype html><title>App</title>', { typ: 'text/html' })
    await assert.rejects(erzeugeIonosClient({ fetch: falscherHolen(seite) }).chat(frage), { art: 'nicht-eingerichtet' })

    const nicht = antwort(404, 'Not Found', { typ: 'text/plain' })
    await assert.rejects(erzeugeIonosClient({ fetch: falscherHolen(nicht) }).chat(frage), { art: 'nicht-eingerichtet' })
  })

  it('tells an unknown model from a missing proxy', async () => {
    const holen = falscherHolen(antwort(404, { error: { message: 'model not found' } }))
    await assert.rejects(erzeugeIonosClient({ fetch: holen }).chat(frage), (fehler) => {
      assert.ok(fehler instanceof IonosFehler)
      assert.equal(fehler.art, 'modell')
      assert.match(fehler.message, /model not found/)
      return true
    })
  })

  it('does not retry a request IONOS refused, and passes on its reason', async () => {
    const holen = falscherHolen(antwort(400, { error: { message: 'max_tokens too large' } }))
    await assert.rejects(erzeugeIonosClient({ fetch: holen, schlafen: ohnePause() }).chat(frage), (fehler) => {
      assert.ok(fehler instanceof IonosFehler)
      assert.equal(fehler.art, 'anfrage')
      assert.equal(fehler.message, 'Die KI hat die Anfrage abgelehnt (HTTP 400: max_tokens too large).')
      return true
    })
    assert.equal(holen.aufrufe.length, 1)
  })

  it('explains a request that was too large', async () => {
    const holen = falscherHolen(antwort(413, 'Request Entity Too Large', { typ: 'text/html' }))
    await assert.rejects(erzeugeIonosClient({ fetch: holen }).chat(frage), (fehler) => {
      assert.ok(fehler instanceof IonosFehler)
      assert.equal(fehler.art, 'anfrage')
      assert.match(fehler.message, /zu groß/)
      return true
    })
  })

  it('knows which kinds are worth another attempt', () => {
    for (const art of ['ratenlimit', 'server', 'netz', 'zeitlimit'] as const) assert.equal(istWiederholbar(new IonosFehler(art, 'x')), true)
    for (const art of ['auth', 'anfrage', 'modell', 'antwort', 'abgebrochen', 'nicht-eingerichtet'] as const) {
      assert.equal(istWiederholbar(new IonosFehler(art, 'x')), false)
    }
    assert.equal(istWiederholbar(new Error('x')), false)
  })
})

describe('Wiederholung', () => {
  it('waits as long as the server asks after a rate limit and then succeeds', async () => {
    const holen = falscherHolen(antwort(429, {}, { kopf: { 'retry-after': '2' } }), erfolg('ok'))
    const schlafen = ohnePause()

    const ergebnis = await erzeugeIonosClient({ fetch: holen, schlafen }).chat(frage)

    assert.equal(ergebnis.text, 'ok')
    assert.deepEqual(schlafen.pausen, [2000])
    assert.equal(holen.aufrufe.length, 2)
  })

  it('sits out a pause of up to a minute', async () => {
    const holen = falscherHolen(antwort(429, {}, { kopf: { 'retry-after': '60' } }), erfolg('ok'))
    const schlafen = ohnePause()
    await erzeugeIonosClient({ fetch: holen, schlafen }).chat(frage)
    assert.deepEqual(schlafen.pausen, [60_000])
  })

  it('does not sit out a longer pause, but says when to try again', async () => {
    const holen = falscherHolen(antwort(429, {}, { kopf: { 'retry-after': '600' } }), erfolg('ok'))
    const schlafen = ohnePause()
    await assert.rejects(erzeugeIonosClient({ fetch: holen, schlafen }).chat(frage), (fehler) => {
      assert.ok(fehler instanceof IonosFehler)
      assert.equal(fehler.art, 'ratenlimit')
      assert.equal(fehler.warteSekunden, 600)
      assert.match(fehler.message, /in etwa 10 Minuten erneut/)
      return true
    })
    assert.equal(holen.aufrufe.length, 1)
    assert.deepEqual(schlafen.pausen, [])
  })

  it('retries only what the caller wants retried', async () => {
    const holen = falscherHolen(antwort(503, {}), erfolg('ok'))
    const schlafen = ohnePause()
    const client = erzeugeIonosClient({ fetch: holen, schlafen })
    await assert.rejects(client.chat({ ...frage, wiederholen: () => false }), { art: 'server' })
    assert.equal(holen.aufrufe.length, 1)
  })

  it('pauses longer each time without a hint, with jitter around 1.5 s, 3 s', async () => {
    const holen = falscherHolen(antwort(503, {}), antwort(503, {}), erfolg('ok'))
    const schlafen = ohnePause()
    await erzeugeIonosClient({ fetch: holen, schlafen, versuche: 3, zufall: () => 0.5 }).chat(frage)
    assert.deepEqual(schlafen.pausen, [1500, 3000])
  })

  it('gives up after the last attempt and reports the last error', async () => {
    const holen = falscherHolen(antwort(500, { error: { message: 'kaputt' } }))
    const schlafen = ohnePause()
    await assert.rejects(erzeugeIonosClient({ fetch: holen, schlafen, versuche: 3 }).chat(frage), (fehler) => {
      assert.ok(fehler instanceof IonosFehler)
      assert.equal(fehler.art, 'server')
      assert.equal(fehler.message, 'Der KI-Dienst meldet einen Fehler (HTTP 500: kaputt).')
      return true
    })
    assert.equal(holen.aufrufe.length, 3)
    assert.equal(schlafen.pausen.length, 2)
  })

  it('does not put the error page of a proxy into the message', async () => {
    const seite = '<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body><center><h1>502 Bad Gateway</h1></center><hr><center>nginx</center></body>\r\n</html>'
    const holen = falscherHolen(antwort(502, seite, { typ: 'text/html' }))
    await assert.rejects(erzeugeIonosClient({ fetch: holen, schlafen: ohnePause(), versuche: 1 }).chat(frage), (fehler) => {
      assert.ok(fehler instanceof IonosFehler)
      assert.equal(fehler.art, 'server')
      assert.equal(fehler.message, 'Der KI-Dienst meldet einen Fehler (HTTP 502).')
      return true
    })
  })

  it('retries a dropped connection', async () => {
    const holen = falscherHolen(new TypeError('fetch failed'), erfolg('ok'))
    const ergebnis = await erzeugeIonosClient({ fetch: holen, schlafen: ohnePause() }).chat(frage)
    assert.equal(ergebnis.text, 'ok')

    const dauerhaft = falscherHolen(new TypeError('fetch failed'))
    await assert.rejects(erzeugeIonosClient({ fetch: dauerhaft, schlafen: ohnePause(), versuche: 2 }).chat(frage), {
      art: 'netz',
    })
  })

  it('does not wait when only one attempt is allowed', async () => {
    const schlafen = ohnePause()
    await assert.rejects(erzeugeIonosClient({ fetch: falscherHolen(antwort(500, {})), schlafen, versuche: 1 }).chat(frage))
    assert.deepEqual(schlafen.pausen, [])
  })
})

describe('Zeitlimit und Abbruch', () => {
  /** A `fetch` that never answers by itself and ends when it is aborted — also if it already is. */
  const haengt = (optionen: HolenOptionen): Promise<HolenAntwort> =>
    new Promise<HolenAntwort>((_erfuellt, abgelehnt) => {
      const abbrechen = () => abgelehnt(new DOMException('aborted', 'AbortError'))
      if (optionen.signal.aborted) return abbrechen()
      optionen.signal.addEventListener('abort', abbrechen)
    })

  it('gives up on an answer that takes too long', async () => {
    const client = erzeugeIonosClient({ fetch: falscherHolen(haengt), versuche: 1, zeitlimitMs: 15 })
    await assert.rejects(client.chat(frage), (fehler) => {
      assert.ok(fehler instanceof IonosFehler)
      assert.equal(fehler.art, 'zeitlimit')
      assert.match(fehler.message, /nicht innerhalb von/)
      return true
    })
  })

  it('stops at once when the user cancels, and does not retry', async () => {
    const steuerung = new AbortController()
    const holen = falscherHolen(haengt)
    const schlafen = ohnePause()
    const lauf = erzeugeIonosClient({ fetch: holen, schlafen, zeitlimitMs: 0 }).chat({ ...frage, signal: steuerung.signal })

    setTimeout(() => steuerung.abort(), 10)

    await assert.rejects(lauf, { art: 'abgebrochen' })
    assert.equal(holen.aufrufe.length, 1)
    assert.deepEqual(schlafen.pausen, [])
  })

  it('does not even start when the user has cancelled already', async () => {
    const steuerung = new AbortController()
    steuerung.abort()
    const holen = falscherHolen(haengt)
    await assert.rejects(erzeugeIonosClient({ fetch: holen }).chat({ ...frage, signal: steuerung.signal }), {
      art: 'abgebrochen',
    })
  })
})

describe('Modellliste', () => {
  it('lists the ids and asks only once', async () => {
    const holen = falscherHolen(antwort(200, { data: [{ id: 'a/B' }, { id: 'c' }] }))
    const client = erzeugeIonosClient({ fetch: holen })

    assert.deepEqual(await client.modelle(), ['a/B', 'c'])
    assert.deepEqual(await client.modelle(), ['a/B', 'c'])
    assert.equal(holen.aufrufe.length, 1)
    assert.equal(holen.aufrufe[0]?.url, '/ionos/v1/models')
    assert.equal(holen.aufrufe[0]?.optionen.method, 'GET')
  })

  it('does not remember a failure', async () => {
    const holen = falscherHolen(antwort(401, {}), antwort(200, { data: [{ id: 'x' }] }))
    const client = erzeugeIonosClient({ fetch: holen })
    await assert.rejects(client.modelle(), { art: 'auth' })
    assert.deepEqual(await client.modelle(), ['x'])
  })

  it('rejects a list in an unexpected form', async () => {
    const client = erzeugeIonosClient({ fetch: falscherHolen(antwort(200, { foo: 1 })) })
    await assert.rejects(client.modelle(), { art: 'antwort' })
  })

  it('remembers the context window the list states for a model', async () => {
    const liste = { data: [{ id: 'a', max_model_len: 32768 }, { id: 'b', context_length: 8192 }, { id: 'c' }] }
    const client = erzeugeIonosClient({ fetch: falscherHolen(antwort(200, liste)) })
    await client.modelle()
    assert.equal(client.kontextfenster('a'), 32768)
    assert.equal(client.kontextfenster('b'), 8192)
    assert.equal(client.kontextfenster('c'), null)
    assert.equal(client.kontextfenster('unbekannt'), null)
  })
})

describe('Kontextfenster', () => {
  it('names a request that does not fit the model as such, and does not retry it', async () => {
    const meldung = "This model's maximum context length is 32768 tokens. However, you requested 40000 tokens."
    const holen = falscherHolen(antwort(400, { error: { message: meldung } }))
    await assert.rejects(erzeugeIonosClient({ fetch: holen, schlafen: ohnePause() }).chat(frage), (fehler) => {
      assert.ok(fehler instanceof IonosFehler)
      assert.equal(fehler.art, 'kontext')
      assert.match(fehler.message, /Kontextfenster/)
      return true
    })
    assert.equal(holen.aufrufe.length, 1)
  })

  it('keeps an ordinary refusal an ordinary refusal', async () => {
    const holen = falscherHolen(antwort(400, { error: { message: 'temperature must be at most 2' } }))
    await assert.rejects(erzeugeIonosClient({ fetch: holen }).chat(frage), { art: 'anfrage' })
  })
})

describe('Denkschritte', () => {
  it('removes a closed reasoning block', () => {
    assert.equal(ohneDenkschritte('<think>erst überlegen</think>\n{"documents": []}'), '{"documents": []}')
  })

  it('removes everything after an unclosed reasoning block', () => {
    assert.equal(ohneDenkschritte('Antwort <think>noch am Überlegen'), 'Antwort')
  })

  it('leaves an answer without reasoning untouched, apart from the outer blanks', () => {
    assert.equal(ohneDenkschritte('  text  '), 'text')
    assert.equal(ohneDenkschritte(null), '')
  })

  it('takes everything up to a closing tag as reasoning, also without the opening one', () => {
    // A chat template that opens the reasoning in the prompt leaves only the closing tag.
    assert.equal(ohneDenkschritte('erst überlegen\n</think>\n\n{"documents": []}'), '{"documents": []}')
  })

  it('does not let a draft inside the reasoning win over the answer', () => {
    const roh = '<think>Entwurf: {"documents": [1]}</think> noch ein Gedanke </think>{"documents": [2]}'
    assert.equal(ohneDenkschritte(roh), '{"documents": [2]}')
  })
})

describe('Modellwahl', () => {
  const client = (...ids: string[]) => ({ modelle: async () => ids })

  it('uses a model id from the configuration as it is, without asking IONOS', async () => {
    const nie = { modelle: async () => assert.fail('must not be asked') }
    assert.equal(await loeseModellAuf({ client: nie, art: 'text', einstellung: { modell: ' meine/id ' } }), 'meine/id')
  })

  it('finds the models by the words in their ids, ignoring case and punctuation', async () => {
    const ids = ['meta-llama/Llama-3.3-70B', 'Qwen/Qwen3.8-27B', 'lightonai/LightOnOCR-2-1B', 'BAAI/bge-m3']
    assert.equal(await loeseModellAuf({ client: client(...ids), art: 'text' }), 'Qwen/Qwen3.8-27B')
    assert.equal(await loeseModellAuf({ client: client(...ids), art: 'ocr' }), 'lightonai/LightOnOCR-2-1B')
  })

  it('does not take a model of the wrong size or generation', async () => {
    const ids = ['Qwen/Qwen3.8-8B', 'Qwen/Qwen3-27B', 'lightonai/LightOnOCR-1B']
    await assert.rejects(loeseModellAuf({ client: client(...ids), art: 'text' }), { art: 'modell' })
    await assert.rejects(loeseModellAuf({ client: client(...ids), art: 'ocr' }), { art: 'modell' })
  })

  it('matches whole parts of a name only, never a part inside another one', async () => {
    // 27B inside A27B is the active size of a mixture-of-experts model, not the model asked for.
    const moe = ['Qwen/Qwen3.8-235B-A27B']
    await assert.rejects(loeseModellAuf({ client: client(...moe), art: 'text' }), { art: 'modell' })
    assert.equal(await loeseModellAuf({ client: client(...moe, 'Qwen/Qwen3.8-27B'), art: 'text' }), 'Qwen/Qwen3.8-27B')

    await assert.rejects(loeseModellAuf({ client: client('lightonai/LightOnOCR-20B'), art: 'ocr' }), { art: 'modell' })
    assert.equal(await loeseModellAuf({ client: client('lightonocr2-1b'), art: 'ocr' }), 'lightonocr2-1b')
    assert.equal(await loeseModellAuf({ client: client('qwen3.8-27b-instruct'), art: 'text' }), 'qwen3.8-27b-instruct')
  })

  it('prefers the plain name over its variants', async () => {
    const ids = ['Qwen/Qwen3.8-27B-FP8-Instruct', 'Qwen/Qwen3.8-27B']
    assert.equal(await loeseModellAuf({ client: client(...ids), art: 'text' }), 'Qwen/Qwen3.8-27B')
  })

  it('lists what is available when nothing fits, and points to the configuration', async () => {
    await assert.rejects(loeseModellAuf({ client: client('a', 'b'), art: 'text' }), (fehler) => {
      assert.ok(fehler instanceof IonosFehler)
      assert.equal(fehler.art, 'modell')
      assert.match(fehler.message, /Verfügbar sind: a, b/)
      assert.match(fehler.message, /konfiguration\.json/)
      return true
    })
  })

  it('fails clearly if there is neither a model nor a search', async () => {
    await assert.rejects(loeseModellAuf({ client: client(), art: 'ocr', einstellung: { modell: null, suche: [] } }), {
      art: 'modell',
    })
  })

  it('fills the defaults in where the configuration says nothing', () => {
    assert.deepEqual(mitStandard(undefined).ocr, STANDARD_KI.ocr)
    assert.equal(mitStandard({}).basis, '/ionos/v1')
    assert.equal(mitStandard({}).parallel, 3)

    const eigen = mitStandard({ ionos: { text: { modell: 'x/y' } }, ocr: { parallel: 5 } })
    assert.equal(eigen.text.modell, 'x/y')
    assert.deepEqual(eigen.text.suche, STANDARD_KI.text.suche)
    assert.equal(eigen.parallel, 5)

    assert.equal(mitStandard({ ocr: { parallel: 0 } }).parallel, 3)
    assert.equal(mitStandard({ ionos: { basis: '' } }).basis, '/ionos/v1')
  })
})
