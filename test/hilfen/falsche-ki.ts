// A stand-in for IONOS and for the browser's PDF reader, so the whole check runs in Node.
//
// The "page image" is a data URL that carries the text of the page; the fake OCR model reads it
// back. The fake language model groups the pages by keyword rules and answers the way the real
// one is asked to: a json block with `documents`.
import { IonosFehler } from '../../src/engine/ionos/client.ts'
import type { BildTeil, ChatAntwort, KiClient, Nachricht } from '../../src/engine/ionos/client.ts'
import { mitStandard } from '../../src/engine/ionos/modelle.ts'
import type { KiKonfiguration } from '../../src/engine/ionos/modelle.ts'
import type { Quelle } from '../../src/engine/pipeline.ts'

export const FEHLERSEITE = '__SEITE_NICHT_LESBAR__'

/** What stands in for an uploaded file in the tests: a name and the text of each page. */
export interface Testdatei {
  name: string
  texte: string[]
  mime: string
  /** `undefined`: derived from the name; `null`: the browser cannot compute one. */
  hash?: string | null
  /** The file cannot be opened. */
  kaputt?: boolean
  /** Letting go of the file fails. */
  schliessenWirft?: boolean
}

/** A file as the page hands it over: a name and the text of each page. */
export const datei = (name: string, texte: string[], extra: Partial<Testdatei> = {}): Testdatei => ({
  name,
  texte,
  mime: 'application/pdf',
  ...extra,
})

/** What opens a {@link Testdatei}; it also keeps the names of the files it was told to let go of. */
export interface Oeffner {
  (eingabe: Testdatei): Promise<Quelle>
  /** The names of the files let go of, in order. Created by the first file opened; the tests reset it. */
  geschlossen?: string[]
}

/** Opens such a file like `src/pdf/quelle.ts` opens a real one. */
export const oeffne: Oeffner = async (eingabe) => {
  if (eingabe.kaputt) throw new Error('Die Datei ist beschädigt.')
  const geschlossen = (oeffne.geschlossen ??= [])

  return {
    name: eingabe.name,
    mime: eingabe.mime,
    groesse: eingabe.texte.join('').length,
    seiten: eingabe.texte.length,
    hash: eingabe.hash === undefined ? `hash-${eingabe.name}` : eingabe.hash,
    bild: async (seite) => {
      const text = eingabe.texte[seite - 1]
      if (text === undefined) throw new Error(`Die Datei ${eingabe.name} hat keine Seite ${seite}.`)
      return `data:text/plain;base64,${Buffer.from(text, 'utf8').toString('base64')}`
    },
    schliessen: () => {
      if (eingabe.schliessenWirft) throw new Error('Schließen ist fehlgeschlagen.')
      geschlossen.push(eingabe.name)
    },
  }
}

/** The first rule whose pattern a page matches decides its document type. */
export interface Regel {
  muster: RegExp
  typ: string
  person?: string
}

export interface FalscheKiOptionen {
  /** First match decides a page's document type. */
  regeln?: Regel[]
  /** What the model list of IONOS contains. */
  modelle?: string[]
  /** Fixed answers of the grouping model, one per call. */
  gruppierungsAntworten?: string[]
}

/** What the fake remembers of the calls it got. */
export interface Protokoll {
  /** How often the model list was fetched. */
  modellListen: number
  /** The text of every page image the OCR model was shown. */
  ocr: string[]
  /** The messages of every call of the grouping model. */
  gruppierungen: Nachricht[][]
}

export interface FalscheKi {
  client: KiClient
  konfiguration: KiKonfiguration
  protokoll: Protokoll
}

export function falscheKi({
  regeln = [],
  gruppierungsAntworten = [],
  modelle = ['Qwen/Qwen3.8-27B', 'lightonai/LightOnOCR-2-1B'],
}: FalscheKiOptionen = {}): FalscheKi {
  const protokoll: Protokoll = { modellListen: 0, ocr: [], gruppierungen: [] }

  let gemerkt: string[] | null = null
  const client = {
    /** Like the real client, the list is fetched once and then remembered. */
    async modelle() {
      if (gemerkt === null) {
        protokoll.modellListen++
        gemerkt = modelle
      }
      return gemerkt
    },

    async chat({ modell, nachrichten, signal }) {
      if (signal?.aborted) throw new IonosFehler('abgebrochen', 'Die Prüfung wurde abgebrochen.')
      if (/lighton/i.test(modell)) return leseBild(nachrichten, protokoll)

      protokoll.gruppierungen.push(nachrichten)
      const feste = gruppierungsAntworten[protokoll.gruppierungen.length - 1]
      const text = feste ?? gruppiereNachRegeln(inhaltDerLetzten(nachrichten), regeln)
      return { text, roh: text, begruendung: '', finishReason: 'stop', abgeschnitten: false, usage: { total_tokens: 1 }, modell }
    },
  } satisfies KiClient

  return { client, konfiguration: mitStandard({}), protokoll }
}

const istBild = (teil: { type: string }): teil is BildTeil => teil.type === 'image_url'

async function leseBild(nachrichten: Nachricht[], protokoll: Protokoll): Promise<ChatAntwort> {
  const inhalt = nachrichten[0]?.content
  const bild = Array.isArray(inhalt) ? inhalt.find(istBild) : undefined
  const daten = bild?.image_url.url.split(',')[1]
  // The fake is only ever asked for page images; anything else is a mistake of the test.
  if (daten === undefined) throw new Error('Keine Bildseite in der Anfrage an die falsche KI.')

  const text = Buffer.from(daten, 'base64').toString('utf8')
  protokoll.ocr.push(text)

  if (text === FEHLERSEITE) throw new IonosFehler('server', 'Der KI-Dienst meldet einen Fehler (HTTP 500).', { status: 500 })
  return { text, roh: text, begruendung: '', finishReason: 'stop', abgeschnitten: false, usage: null, modell: 'ocr' }
}

/** The text of the last message; the grouping model is asked in plain text. */
function inhaltDerLetzten(nachrichten: Nachricht[]): string {
  const inhalt = nachrichten.at(-1)?.content
  if (typeof inhalt !== 'string') throw new Error('Die letzte Nachricht an die falsche KI ist kein Text.')
  return inhalt
}

/** One document of the answer of the grouping model. */
interface FalschesDokument {
  evidence_type: string
  person: string
  pages: { media_id: string; page: number }[]
  confidence: number
}

/** Consecutive pages of one file that follow the same rule become one document. */
function gruppiereNachRegeln(eingabe: string, regeln: Regel[]): string {
  const seiten = [...eingabe.matchAll(/--- media_id: (\S+), datei: .*?, page: (\d+) ---\n([\s\S]*?)(?=\n\n--- media_id:|$)/g)]
  const dokumente: FalschesDokument[] = []
  let aktuell: { fileId: string; regel: number; dokument: FalschesDokument } | null = null

  for (const [, fileId, seite, text] of seiten) {
    // All three groups are part of every match.
    if (fileId === undefined || seite === undefined || text === undefined) throw new Error('Seitenkopf ohne Angaben')
    const regel = regeln.findIndex(({ muster }) => muster.test(text))
    const gewaehlt = regeln[regel] // no rule fits: `findIndex` says -1, and there is nothing at -1
    if (gewaehlt === undefined) {
      aktuell = null
      continue
    }
    if (aktuell !== null && aktuell.fileId === fileId && aktuell.regel === regel) {
      aktuell.dokument.pages.push({ media_id: fileId, page: Number(seite) })
      continue
    }
    const dokument: FalschesDokument = {
      evidence_type: gewaehlt.typ,
      person: gewaehlt.person ?? '',
      pages: [{ media_id: fileId, page: Number(seite) }],
      confidence: 90,
    }
    dokumente.push(dokument)
    aktuell = { fileId, regel, dokument }
  }

  return `\`\`\`json\n${JSON.stringify({ documents: dokumente })}\n\`\`\``
}
