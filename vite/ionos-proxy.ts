/**
 * Passes the calls of the page to the AI service of IONOS on and adds the access token.
 *
 * The token must never reach the browser, so the page talks to its own server (`/ionos/v1/…`)
 * and this server talks to IONOS. This is the stand-in for the reverse proxy of a production
 * installation, used by the Vite development server and by `vite preview`.
 *
 * It is deliberately not an open relay: only the two calls the check needs are passed on, with
 * their one method each, and the request body is limited. A chat request must name one of the
 * models the configuration allows, ask for one answer, not as a stream, and for at most
 * {@link MAX_ANTWORT_TOKEN} tokens — whoever reaches the server cannot spend the token on anything
 * else. Everything else is answered here.
 */
import { Buffer } from 'node:buffer'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { istObjekt } from '../src/engine/json.ts'
import { passtZu, STANDARD_KI } from '../src/engine/ionos/modelle.ts'
import type { Modelleinstellung } from '../src/engine/ionos/modelle.ts'

export const STANDARD_ZIEL = 'https://openai.inference.de-txl.ionos.com'

/** The most a request may ask the model to write. The check itself asks for at most this. */
export const MAX_ANTWORT_TOKEN = 32768

/**
 * Why a chat request is not passed on, or `null` if it may be.
 *
 * @param modelle  the models allowed (as in `konfiguration.json`)
 */
export function pruefeChatAnfrage(koerper: Buffer, modelle: readonly Modelleinstellung[]): string | null {
  let anfrage: unknown
  try {
    anfrage = JSON.parse(koerper.toString('utf8'))
  } catch {
    return 'Die Anfrage ist kein gültiges JSON.'
  }
  if (!istObjekt(anfrage)) return 'Die Anfrage ist kein JSON-Objekt.'

  const modell = anfrage.model
  if (typeof modell !== 'string' || !modelle.some((einstellung) => passtZu(modell, einstellung))) {
    return `Das Modell „${String(modell ?? '').slice(0, 80)}“ ist für diese Anwendung nicht freigegeben.`
  }
  if (anfrage.stream !== undefined && anfrage.stream !== false) return 'Gestreamte Antworten werden nicht weitergeleitet.'
  if (anfrage.n !== undefined && anfrage.n !== 1) return 'Es wird nur eine Antwort je Anfrage weitergeleitet.'

  const grenze = anfrage.max_tokens ?? anfrage.max_completion_tokens
  if (typeof grenze !== 'number' || !Number.isInteger(grenze) || grenze < 1 || grenze > MAX_ANTWORT_TOKEN) {
    return `Die Anfrage muss „max_tokens“ zwischen 1 und ${MAX_ANTWORT_TOKEN} nennen.`
  }
  if (anfrage.max_tokens !== undefined && anfrage.max_completion_tokens !== undefined && anfrage.max_tokens !== anfrage.max_completion_tokens) {
    return '„max_tokens“ und „max_completion_tokens“ widersprechen sich.'
  }
  return null
}

/** The calls that are passed on, with the one method each allows. */
const ERLAUBT = new Map([
  ['/v1/chat/completions', 'POST'],
  ['/v1/models', 'GET'],
])

/** A page image is at most 5 MB; as base64 in a request that is about 7 MB. */
export const MAX_KOERPER = 16 * 1024 * 1024

/** A reasoning model may think for minutes before it answers. */
const ZEITLIMIT_MS = 10 * 60 * 1000

function sende(antwort: ServerResponse, status: number, meldung: string): void {
  antwort.statusCode = status
  antwort.setHeader('Content-Type', 'application/json; charset=utf-8')
  antwort.setHeader('Cache-Control', 'no-store')
  antwort.end(JSON.stringify({ error: { message: meldung } }))
}

/** The whole request body, or `null` if it is larger than the limit. */
async function leseKoerper(anfrage: IncomingMessage): Promise<Buffer<ArrayBuffer> | null> {
  const teile: Buffer[] = []
  let groesse = 0
  // Node hands out `Buffer` chunks, as long as nobody sets an encoding on the request.
  const stuecke: AsyncIterable<Buffer> = anfrage
  for await (const teil of stuecke) {
    groesse += teil.length
    if (groesse > MAX_KOERPER) return null
    teile.push(teil)
  }
  return Buffer.concat(teile)
}

/** The models of the default configuration: LightOnOCR 2 and Qwen3.8 27B. */
const standardModelle = (): Modelleinstellung[] => [STANDARD_KI.ocr, STANDARD_KI.text]

/** The call to the AI service as the proxy makes it. */
export interface IonosAnfrage {
  method: string
  headers: Record<string, string>
  body: Buffer<ArrayBuffer> | undefined
  signal: AbortSignal
}

/** `fetch`, or a stand-in for it. */
export type IonosHolen = (adresse: string, anfrage: IonosAnfrage) => Promise<Response>

export interface IonosVermittlerOptionen {
  ziel?: string
  token?: string
  holen?: IonosHolen
  /** The models allowed, asked per request. */
  modelle?: () => Modelleinstellung[]
}

/** A connect-style handler for the requests below `/ionos`. */
export type IonosVermittler = (anfrage: IncomingMessage, antwort: ServerResponse, weiter: () => void) => Promise<void>

export function erzeugeIonosVermittler({
  ziel = STANDARD_ZIEL,
  token,
  holen = (adresse, anfrage) => fetch(adresse, anfrage),
  modelle = standardModelle,
}: IonosVermittlerOptionen = {}): IonosVermittler {
  const basis = ziel.replace(/\/+$/, '')

  return async (anfrage, antwort) => {
    // `split` always yields at least one part.
    const pfad = (anfrage.url ?? '').split('?')[0] ?? ''
    const methode = ERLAUBT.get(pfad)

    if (methode === undefined) return sende(antwort, 404, 'Diese Adresse leitet der Server nicht weiter.')
    if (anfrage.method !== methode) return sende(antwort, 405, `Hier ist nur ${methode} erlaubt.`)
    if (!token) {
      return sende(antwort, 401, 'IONOS_API_TOKEN ist nicht gesetzt. Das Zugangstoken gehört in die Datei .env.')
    }

    // Only JSON is passed on. A page of another origin can send text without asking first
    // (`fetch` with `mode: 'no-cors'` and a plain-text body), and would then use the token.
    if (methode === 'POST' && !/^application\/json\s*(;|$)/i.test(anfrage.headers['content-type'] ?? '')) {
      return sende(antwort, 415, 'Erwartet wird eine Anfrage mit dem Inhaltstyp application/json.')
    }

    let koerper: Buffer<ArrayBuffer> | null | undefined
    try {
      koerper = methode === 'POST' ? await leseKoerper(anfrage) : undefined
    } catch {
      // The sender gave up in the middle of the body (a reload, a dropped connection): nobody waits
      // for an answer. Unhandled, the rejection would end the development server.
      return
    }
    if (koerper === null) return sende(antwort, 413, 'Die Anfrage ist zu groß.')
    if (koerper !== undefined) {
      const grund = pruefeChatAnfrage(koerper, modelle())
      if (grund !== null) return sende(antwort, 400, grund)
    }

    const abbruch = new AbortController()
    const zeitlimit = setTimeout(() => abbruch.abort(), ZEITLIMIT_MS)
    // The browser gave up: there is no need to keep IONOS busy.
    antwort.on('close', () => {
      if (!antwort.writableEnded) abbruch.abort()
    })

    try {
      const ionos = await holen(`${basis}${pfad}`, {
        method: methode,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: koerper,
        signal: abbruch.signal,
      })
      const inhalt = Buffer.from(await ionos.arrayBuffer())

      antwort.statusCode = ionos.status
      for (const kopf of ['content-type', 'retry-after']) {
        const wert = ionos.headers.get(kopf)
        if (wert) antwort.setHeader(kopf, wert)
      }
      antwort.setHeader('Cache-Control', 'no-store')
      antwort.end(inhalt)
    } catch (fehler) {
      if (antwort.writableEnded || antwort.destroyed) return
      const ursache = istObjekt(fehler) ? fehler.cause : undefined
      const grund = (istObjekt(ursache) ? ursache.code : undefined) ?? (istObjekt(fehler) ? fehler.name : undefined) ?? 'unbekannt'
      sende(antwort, abbruch.signal.aborted ? 504 : 502, `Der KI-Dienst ist nicht erreichbar (${grund}).`)
    } finally {
      clearTimeout(zeitlimit)
    }
  }
}

export interface IonosProxyOptionen {
  ziel?: string
  token?: string
  /** The models allowed, asked per request. */
  modelle?: () => Modelleinstellung[]
}

/**
 * The plugin for Vite: the development server and `vite preview` both get the route `/ionos`.
 * `modelle` reads the allowed models; by default those of the standard configuration.
 */
export function ionosProxy({ ziel, token, modelle }: IonosProxyOptionen = {}): Plugin {
  const vermittler = erzeugeIonosVermittler({ ziel: ziel || STANDARD_ZIEL, token, ...(modelle ? { modelle } : {}) })
  return {
    name: 'ionos-proxy',
    configureServer: (server) => void server.middlewares.use('/ionos', vermittler),
    configurePreviewServer: (server) => void server.middlewares.use('/ionos', vermittler),
  }
}
