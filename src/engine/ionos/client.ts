/**
 * Client for the IONOS AI Model Hub (OpenAI-compatible chat completions).
 *
 * The browser never sees the access token. It talks to `/ionos/v1/…` on its own origin, and the
 * web server (the Vite proxy in development, nginx in production) forwards the call to IONOS and
 * adds the `Authorization` header. What this client does on top of a bare `fetch`:
 *
 *  - retries what is worth retrying (rate limit, server errors, a dropped connection, a timeout)
 *    with a growing, jittered pause that honours a short `Retry-After`; everything else, and a
 *    server that asks for a long pause, fails at once,
 *  - turns every failure into an {@link IonosFehler} whose message tells a person what to do,
 *  - strips the reasoning of a thinking model from the answer and reports `finish_reason`, because
 *    an answer cut off at the token limit is incomplete and the callers must know.
 *
 * `fetch` and the clock are injected so that everything here runs in tests without a network.
 */
import { istObjekt } from '../json.ts'
import type { JsonObjekt } from '../json.ts'

export const STANDARD_BASIS = '/ionos/v1'

/** The kinds of {@link IonosFehler}. */
export type IonosFehlerArt =
  | 'auth'
  | 'nicht-eingerichtet'
  | 'ratenlimit'
  | 'server'
  | 'netz'
  | 'zeitlimit'
  | 'anfrage'
  | 'kontext'
  | 'modell'
  | 'antwort'
  | 'abgebrochen'

/** What an {@link IonosFehler} may carry besides its kind and message. */
export interface IonosFehlerOptionen {
  /** The HTTP status of the answer, where there was one. */
  status?: number | null
  /** What was thrown originally, kept as the `cause`. */
  ursache?: unknown
  /** The pause in seconds the server asked for (`Retry-After`), where it did. */
  warteSekunden?: number | null
}

/**
 * What can go wrong, as a kind the caller can branch on:
 *
 *   auth                 the token is missing, wrong or expired
 *   nicht-eingerichtet   no AI access is set up under this address
 *   ratenlimit           too many requests
 *   server               IONOS failed
 *   netz                 no connection
 *   zeitlimit            no answer within the time limit
 *   anfrage              IONOS refused the request itself (too large, malformed)
 *   kontext              the request does not fit the context window of the model
 *   modell               the model does not exist at IONOS
 *   antwort              an answer arrived but not in the expected form
 *   abgebrochen          the user cancelled
 */
export class IonosFehler extends Error {
  readonly art: IonosFehlerArt
  readonly status: number | null
  readonly warteSekunden: number | null

  /** @param nachricht  German, for display */
  constructor(art: IonosFehlerArt, nachricht: string, { status = null, ursache, warteSekunden = null }: IonosFehlerOptionen = {}) {
    super(nachricht, ursache === undefined ? undefined : { cause: ursache })
    this.name = 'IonosFehler'
    this.art = art
    this.status = status
    this.warteSekunden = warteSekunden
  }
}

const WIEDERHOLBAR: ReadonlySet<IonosFehlerArt> = new Set<IonosFehlerArt>(['ratenlimit', 'server', 'netz', 'zeitlimit'])

/** Is another attempt worth it? */
export function istWiederholbar(fehler: unknown): boolean {
  return fehler instanceof IonosFehler && WIEDERHOLBAR.has(fehler.art)
}

/**
 * A service that asks for a longer pause than this is busy for longer than a check should wait
 * per call. The call then fails at once, and the caller decides (see the circuit breaker of the
 * page reading in `pipeline.ts`) — instead of every page sitting out the full pause on its own.
 */
export const LAENGSTE_PAUSE_SEKUNDEN = 60

/**
 * The reasoning some models put in front of the answer (`<think>…</think>`) is no part of it.
 *
 * Everything up to the LAST closing tag is reasoning — also when the opening tag is missing, which
 * is what a chat template that opens the reasoning in the prompt itself leaves in the answer. A
 * draft of the answer inside the reasoning must not win over the answer. An opening tag without
 * its end means the answer was cut off inside the reasoning: nothing usable follows.
 */
export function ohneDenkschritte(text: string | null | undefined): string {
  let rest = String(text ?? '')
  const ende = rest.toLowerCase().lastIndexOf('</think>')
  if (ende !== -1) rest = rest.slice(ende + '</think>'.length)
  const offen = rest.search(/<think>/i)
  return (offen === -1 ? rest : rest.slice(0, offen)).trim()
}

/** What a server says when the prompt and the answer do not fit the context window of the model. */
const ZU_LANG = /context.{0,20}(length|window)|max(imum)?[_ ]?(model[_ ])?(context|len)|too many tokens|prompt is too long|input.{0,30}too long|reduce the length/i

const warte = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise<void>((erfuellt, abgelehnt) => {
    if (signal?.aborted) return abgelehnt(abbruch())
    const uhr = setTimeout(() => {
      signal?.removeEventListener('abort', bei)
      erfuellt()
    }, ms)
    const bei = () => {
      clearTimeout(uhr)
      abgelehnt(abbruch())
    }
    signal?.addEventListener('abort', bei, { once: true })
  })

const abbruch = (ursache?: unknown): IonosFehler => new IonosFehler('abgebrochen', 'Die Prüfung wurde abgebrochen.', { ursache })

/** What {@link neuerLauf} hands out. */
interface Lauf {
  signal: AbortSignal
  /** Did the time limit end it (and not the caller)? */
  abgelaufen(): boolean
  /** Stops the timer and lets go of the signal of the caller. */
  aufraeumen(): void
}

/** One abort signal for "the caller cancelled" and "took too long", and which of the two it was. */
function neuerLauf(aussen: AbortSignal | undefined, zeitlimitMs: number): Lauf {
  const steuerung = new AbortController()
  let abgelaufen = false

  const beiAbbruch = () => steuerung.abort()
  if (aussen?.aborted) steuerung.abort()
  else aussen?.addEventListener('abort', beiAbbruch, { once: true })

  const uhr =
    zeitlimitMs > 0
      ? setTimeout(() => {
          abgelaufen = true
          steuerung.abort()
        }, zeitlimitMs)
      : undefined

  return {
    signal: steuerung.signal,
    abgelaufen: () => abgelaufen,
    aufraeumen() {
      clearTimeout(uhr)
      aussen?.removeEventListener('abort', beiAbbruch)
    },
  }
}

function alsJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** The message IONOS (or a proxy in front of it) put into an error body, shortened. */
function meldungAus(daten: unknown, text: string): string {
  const felder: Record<string, unknown> = istObjekt(daten) ? daten : {}
  const meldung = (istObjekt(felder.error) ? felder.error.message : undefined) ?? felder.message ?? felder.detail ?? felder.error
  const roh = typeof meldung === 'string' ? meldung : text
  return String(roh ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
}

/** An answer that is a web page: the address is served by something else than the AI proxy. */
const istWebseite = (typ: string, text: string): boolean => /text\/html/i.test(typ) || /^\s*<(!doctype|html)/i.test(text)

/** One HTTP exchange as it was read: the status, the whole body, its type and the pause the server asked for. */
interface Rohantwort {
  status: number
  text: string
  typ: string
  warteSekunden: number | null
}

/** @returns `null` for a successful answer */
function fehlerAus({ status, text, typ, warteSekunden }: Rohantwort): IonosFehler | null {
  if (status >= 200 && status < 300) {
    return istWebseite(typ, text)
      ? new IonosFehler(
          'nicht-eingerichtet',
          'Unter /ionos ist kein KI-Zugang eingerichtet: Der Server liefert eine Webseite statt der KI-Schnittstelle.',
          { status },
        )
      : null
  }

  const daten = alsJson(text)
  // The error page of a proxy in front of the service (nginx: "502 Bad Gateway") is no message.
  const meldung = istWebseite(typ, text) ? '' : meldungAus(daten, text)
  const zusatz = meldung === '' ? '' : ` (${meldung})`
  // Inside the brackets that already name the status: "(HTTP 500: Modell nicht geladen)".
  const einzelheit = meldung === '' ? '' : `: ${meldung}`

  if (status === 401 || status === 403) {
    return new IonosFehler(
      'auth',
      `Der KI-Zugang wurde abgelehnt (HTTP ${status}). Das Zugangstoken fehlt oder ist abgelaufen.`,
      { status },
    )
  }
  if (status === 404) {
    return istWebseite(typ, text) || daten === null
      ? new IonosFehler('nicht-eingerichtet', 'Unter /ionos ist kein KI-Zugang eingerichtet (HTTP 404).', { status })
      : new IonosFehler('modell', `Das Modell oder die Schnittstelle gibt es bei IONOS nicht${zusatz}.`, { status })
  }
  if (status === 429) {
    const spaeter =
      warteSekunden !== null && warteSekunden > LAENGSTE_PAUSE_SEKUNDEN
        ? ` Er bittet, es in etwa ${Math.ceil(warteSekunden / 60)} Minuten erneut zu versuchen.`
        : ''
    return new IonosFehler('ratenlimit', `Der KI-Dienst ist gerade ausgelastet (HTTP 429).${spaeter}`, { status, warteSekunden })
  }
  if (status === 408 || status === 425 || status >= 500) {
    return new IonosFehler('server', `Der KI-Dienst meldet einen Fehler (HTTP ${status}${einzelheit}).`, {
      status,
      warteSekunden,
    })
  }
  if (ZU_LANG.test(meldung)) {
    return new IonosFehler(
      'kontext',
      `Die Anfrage ist zu lang für das KI-Modell: Text und Antwort passen nicht in sein Kontextfenster (HTTP ${status}${einzelheit}).`,
      { status },
    )
  }
  if (status === 413) {
    return new IonosFehler('anfrage', 'Die Anfrage an die KI war zu groß (HTTP 413). Das Bild der Seite ist zu umfangreich.', {
      status,
    })
  }
  return new IonosFehler('anfrage', `Die KI hat die Anfrage abgelehnt (HTTP ${status}${einzelheit}).`, { status })
}

/** The context window a model list states for a model (vLLM: `max_model_len`), or `null`. */
function fensterAus(eintrag: unknown): number | null {
  const felder: Record<string, unknown> = istObjekt(eintrag) ? eintrag : {}
  const wert = felder.max_model_len ?? felder.context_length ?? felder.context_window ?? felder.max_context_length
  return typeof wert === 'number' && Number.isInteger(wert) && wert > 0 ? wert : null
}

/** `content` is a string, or a list of parts with a `text` each. */
function inhaltAlsText(inhalt: unknown): string {
  if (typeof inhalt === 'string') return inhalt
  if (Array.isArray(inhalt)) {
    const teile: unknown[] = inhalt
    return teile.map((teil) => (typeof teil === 'string' ? teil : ((istObjekt(teil) ? teil.text : undefined) ?? ''))).join('')
  }
  return ''
}

/** A text part of a message. */
export interface TextTeil {
  type: 'text'
  text: string
}

/** An image part of a message: the image as URL, here a data URL. */
export interface BildTeil {
  type: 'image_url'
  image_url: { url: string }
}

/** One part of a message that consists of several (text and images). */
export type NachrichtenTeil = TextTeil | BildTeil

/** One message of a chat: `content` is a plain text, or a list of parts for a request with images. */
export interface Nachricht {
  role: 'system' | 'user' | 'assistant'
  content: string | NachrichtenTeil[]
}

/** The token count of a call as the service reports it (OpenAI form); passed on as it came. */
export interface Verbrauch {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  [weiteres: string]: unknown
}

/** What one chat completion is asked. */
export interface ChatEingabe {
  modell: string
  nachrichten: Nachricht[]
  maxTokens?: number
  temperatur?: number
  /** `response_format` of the request, e.g. `{ type: 'json_object' }`. */
  antwortFormat?: JsonObjekt
  /** Further members of the request body, passed on as they are. */
  zusatz?: JsonObjekt
  signal?: AbortSignal
  /** Per attempt in ms, 0 = none; without it the limit of the client applies. */
  zeitlimitMs?: number
  /** Which failures get another attempt (default {@link istWiederholbar}). */
  wiederholen?: (fehler: unknown) => boolean
}

/** What one chat completion returns. */
export interface ChatAntwort {
  /** The answer without reasoning. */
  text: string
  /** The content as it came. */
  roh: string
  /** The reasoning of a thinking model, if the service reports it apart from the content. */
  begruendung: string
  finishReason: string | null
  /** The answer hit the token limit. */
  abgeschnitten: boolean
  usage: Verbrauch | null
  modell: string
}

/** What a caller needs of the client to ask the model something. */
export interface ChatClient {
  /** One chat completion. */
  chat(eingabe: ChatEingabe): Promise<ChatAntwort>
}

/** What a caller needs of the client to find a model. */
export interface ModellClient {
  /** The ids of the models this access can use. Asked once, then remembered. */
  modelle(signal?: AbortSignal): Promise<string[]>
}

/** The client for the IONOS AI Model Hub, as {@link erzeugeIonosClient} builds it. */
export interface IonosClient extends ChatClient, ModellClient {
  /**
   * The context window (prompt and answer together, in tokens) the model list states for a
   * model, or `null` where it says nothing. Known only after {@link modelle} was asked.
   */
  kontextfenster(modell: string): number | null
}

/**
 * The client as a check uses it. A stand-in that knows no model list may leave out
 * `kontextfenster`; the check then asks the configuration.
 */
export interface KiClient extends ChatClient, ModellClient {
  kontextfenster?(modell: string): number | null
}

/** The request as the client hands it to `fetch`. */
export interface HolenOptionen {
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body: string | undefined
  signal: AbortSignal
}

/** The part of a `Response` this client reads. */
export interface HolenAntwort {
  status: number
  text(): Promise<string>
  headers?: { get(name: string): string | null }
}

/** The part of `fetch` this client uses; the real `fetch` fits. */
export type HolenFunktion = (url: string, optionen: HolenOptionen) => Promise<HolenAntwort>

/** Waits `ms` milliseconds, or ends with an {@link IonosFehler} of kind `abgebrochen` if the signal fires first. */
export type SchlafenFunktion = (ms: number, signal?: AbortSignal) => Promise<void>

/** Everything {@link erzeugeIonosClient} can be told; all of it may be left out. */
export interface IonosClientOptionen {
  basis?: string
  fetch?: HolenFunktion
  /** Attempts per call including the first one. */
  versuche?: number
  /** Per attempt, 0 = none. */
  zeitlimitMs?: number
  schlafen?: SchlafenFunktion
  zufall?: () => number
}

/** What one HTTP exchange is told, without the retry policy. */
interface Einzelanfrage {
  methode: 'GET' | 'POST'
  koerper?: Record<string, unknown>
  signal?: AbortSignal
  zeitlimitMs: number
}

/** A call with its retries. */
interface Anfrage extends Einzelanfrage {
  /** Which failures get another attempt (default {@link istWiederholbar}). */
  wiederholen?: (fehler: unknown) => boolean
}

export function erzeugeIonosClient({
  basis = STANDARD_BASIS,
  fetch: holen = (...argumente) => globalThis.fetch(...argumente),
  versuche = 3,
  zeitlimitMs: vorgabeZeitlimit = 240_000,
  schlafen = warte,
  zufall = Math.random,
}: IonosClientOptionen = {}): IonosClient {
  /** One HTTP exchange: the status and the whole body, read within the time limit. */
  async function einmal(pfad: string, { methode, koerper, signal, zeitlimitMs }: Einzelanfrage): Promise<Rohantwort> {
    const lauf = neuerLauf(signal, zeitlimitMs)

    const alsFehler = (ursache: unknown): IonosFehler => {
      if (signal?.aborted) return abbruch(ursache)
      if (lauf.abgelaufen()) {
        return new IonosFehler(
          'zeitlimit',
          `Die KI hat nicht innerhalb von ${Math.round(zeitlimitMs / 1000)} Sekunden geantwortet.`,
          { ursache },
        )
      }
      return new IonosFehler('netz', 'Der KI-Dienst ist nicht erreichbar. Bitte die Verbindung prüfen.', { ursache })
    }

    try {
      const antwort = await holen(`${basis}${pfad}`, {
        method: methode,
        headers: { Accept: 'application/json', ...(koerper ? { 'Content-Type': 'application/json' } : {}) },
        body: koerper ? JSON.stringify(koerper) : undefined,
        signal: lauf.signal,
      })
      const text = await antwort.text()
      const warten = Number(antwort.headers?.get?.('retry-after'))

      return {
        status: antwort.status,
        text,
        typ: antwort.headers?.get?.('content-type') ?? '',
        warteSekunden: Number.isFinite(warten) && warten > 0 ? warten : null,
      }
    } catch (ursache) {
      throw alsFehler(ursache)
    } finally {
      lauf.aufraeumen()
    }
  }

  /** Pause before attempt `n + 1`: what the server asked for, otherwise doubling, with jitter. */
  const pause = (n: number, warteSekunden: number | null): number =>
    warteSekunden === null
      ? Math.min(20_000, 1_500 * 2 ** (n - 1)) * (0.7 + 0.6 * zufall())
      : Math.min(warteSekunden, LAENGSTE_PAUSE_SEKUNDEN) * 1000

  /**
   * One call with its retries. `wiederholen` decides which failures get another attempt; a pause
   * longer than {@link LAENGSTE_PAUSE_SEKUNDEN} that the server asks for is not sat out.
   */
  async function anfrage(pfad: string, { wiederholen = istWiederholbar, ...optionen }: Anfrage): Promise<Rohantwort> {
    for (let versuch = 1; ; versuch++) {
      try {
        const antwort = await einmal(pfad, optionen)
        const fehler = fehlerAus(antwort)
        if (fehler) throw fehler
        return antwort
      } catch (fehler) {
        // Everything thrown in the `try` is an IonosFehler: `einmal` and `fehlerAus` see to that.
        const warteSekunden = fehler instanceof IonosFehler ? fehler.warteSekunden : null
        const zuLang = (warteSekunden ?? 0) > LAENGSTE_PAUSE_SEKUNDEN
        if (!wiederholen(fehler) || versuch >= versuche || zuLang) throw fehler
        await schlafen(pause(versuch, warteSekunden), optionen.signal)
      }
    }
  }

  let modellListe: Promise<string[]> | null = null
  const fenster = new Map<string, number>()

  return {
    modelle(signal) {
      modellListe ??= anfrage('/models', { methode: 'GET', signal, zeitlimitMs: 30_000 })
        .then(({ text }) => {
          const daten = alsJson(text)
          const eintraege: unknown[] | null =
            istObjekt(daten) && Array.isArray(daten.data) ? daten.data : Array.isArray(daten) ? daten : null
          if (eintraege === null) throw new IonosFehler('antwort', 'Die Modellliste der KI hat kein erwartetes Format.')

          const ids: string[] = []
          for (const eintrag of eintraege) {
            const id = String((istObjekt(eintrag) ? eintrag.id : undefined) ?? eintrag)
            if (id === '') continue
            ids.push(id)
            const groesse = fensterAus(eintrag)
            if (groesse !== null) fenster.set(id, groesse)
          }
          return ids
        })
        .catch((fehler: unknown) => {
          modellListe = null
          throw fehler
        })
      return modellListe
    },

    kontextfenster(modell) {
      return fenster.get(modell) ?? null
    },

    /**
     * One chat completion. `text` is the answer without reasoning, `roh` the content as it came;
     * `abgeschnitten` means it hit the token limit.
     */
    async chat({ modell, nachrichten, maxTokens, temperatur, antwortFormat, zusatz = {}, signal, zeitlimitMs, wiederholen }) {
      const koerper = {
        model: modell,
        messages: nachrichten,
        ...(maxTokens === undefined ? {} : { max_tokens: maxTokens }),
        ...(temperatur === undefined ? {} : { temperature: temperatur }),
        ...(antwortFormat === undefined ? {} : { response_format: antwortFormat }),
        ...zusatz,
      }

      const { text } = await anfrage('/chat/completions', {
        methode: 'POST',
        koerper,
        signal,
        zeitlimitMs: zeitlimitMs ?? vorgabeZeitlimit,
        ...(wiederholen ? { wiederholen } : {}),
      })

      const daten = alsJson(text)
      const wahlen = istObjekt(daten) ? daten.choices : undefined
      const wahl: unknown = Array.isArray(wahlen) ? wahlen[0] : undefined
      if (!istObjekt(daten) || !istObjekt(wahl) || !wahl.message) {
        throw new IonosFehler('antwort', 'Die Antwort der KI hatte nicht das erwartete Format.')
      }

      const nachricht: Record<string, unknown> = istObjekt(wahl.message) ? wahl.message : {}
      const roh = inhaltAlsText(nachricht.content)
      const grund = typeof wahl.finish_reason === 'string' ? wahl.finish_reason : null

      return {
        text: ohneDenkschritte(roh),
        roh,
        begruendung: String(nachricht.reasoning_content ?? nachricht.reasoning ?? ''),
        finishReason: grund,
        abgeschnitten: grund === 'length',
        usage: istObjekt(daten.usage) ? daten.usage : null,
        modell: typeof daten.model === 'string' ? daten.model : modell,
      }
    },
  }
}
