/**
 * Which model does which job, and how it is found at IONOS.
 *
 * The exact model ids of the Model Hub are not fixed in the code. An operator can name them in
 * `konfiguration.json`; as long as they do not, the id is looked up in the list of models the
 * access offers, by the words it must contain. "Qwen3.8 27B" may be published as
 * `Qwen/Qwen3.8-27B` or `qwen3.8-27b-instruct` — what counts is that the id contains `qwen38` and
 * `27b` as whole parts of its name: the parts between slashes, dashes and dots, alone or joined
 * with their neighbours (`Qwen3` + `8` gives `qwen38`). A part never matches inside another one,
 * so `27b` does not find `Qwen3.8-235B-A27B`, and `lightonocr2` does not find `LightOnOCR-20B`.
 */
import { istObjekt } from '../json.ts'
import { IonosFehler } from './client.ts'
import type { ModellClient } from './client.ts'

/** What a model is needed for: reading the page images, or grouping the pages into documents. */
export type ModellArt = 'ocr' | 'text'

/** Which model does one job: a fixed id, or the words its id must contain. */
export interface Modelleinstellung {
  /** The model id as IONOS names it; `null` or empty to search by `suche`. */
  modell?: string | null
  /** Words the id must contain as whole parts of its name. */
  suche?: readonly string[]
  /** The context window in tokens, for a model whose list entry does not state it. */
  kontextfenster?: number
}

/** The configuration of the AI access with the defaults filled in. */
export interface KiKonfiguration {
  /** Where the AI proxy of the web server lies. */
  basis: string
  /** The model that reads the page images. */
  ocr: Modelleinstellung
  /** The model that groups the pages. */
  text: Modelleinstellung
  /** How many pages are read at the same time. */
  parallel: number
}

/** The default configuration of the AI access. A `konfiguration.json` overrides it per key. */
export const STANDARD_KI = Object.freeze({
  basis: '/ionos/v1',
  /** LightOnOCR 2: reads a page image and returns its text. */
  ocr: Object.freeze({ modell: null, suche: Object.freeze(['lightonocr2']) }),
  /** Qwen3.8 27B with its default reasoning: groups the pages into documents. */
  text: Object.freeze({ modell: null, suche: Object.freeze(['qwen38', '27b']) }),
})

const BEZEICHNUNG: Record<ModellArt, string> = { ocr: 'Texterkennung (LightOnOCR 2)', text: 'Gruppierung (Qwen3.8 27B)' }

/** Lower case, letters and digits only: `Qwen3.8` → `qwen38`. */
const kompakt = (text: string): string => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '')

/** The parts of a model id: `Qwen/Qwen3.8-27B` → `qwen`, `qwen3`, `8`, `27b`. */
const teileVon = (id: string): string[] =>
  String(id)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((teil) => teil !== '')

/** Does the id contain the word as one part, or as several neighbouring parts joined? */
export function enthaeltWort(id: string, wort: string): boolean {
  const teile = teileVon(id)
  for (let anfang = 0; anfang < teile.length; anfang++) {
    let zusammen = ''
    for (let ende = anfang; ende < teile.length && zusammen.length < wort.length; ende++) {
      zusammen += teile[ende]
      if (zusammen === wort) return true
    }
  }
  return false
}

/** Does a model id fit the setting of a job (its fixed id, otherwise all its search words)? */
export function passtZu(id: string, einstellung?: Modelleinstellung): boolean {
  const festgelegt = String(einstellung?.modell ?? '').trim()
  if (festgelegt !== '') return id === festgelegt
  const woerter = (einstellung?.suche ?? []).map(kompakt).filter((wort) => wort !== '')
  return woerter.length > 0 && woerter.every((wort) => enthaeltWort(id, wort))
}

/** What {@link loeseModellAuf} needs to know. */
export interface LoeseModellAufOptionen {
  client: ModellClient
  art: ModellArt
  /** Default: the standard setting of the job. */
  einstellung?: Modelleinstellung
  signal?: AbortSignal
}

/** The model id to use for one job. */
export async function loeseModellAuf({ client, art, einstellung = STANDARD_KI[art], signal }: LoeseModellAufOptionen): Promise<string> {
  const festgelegt = String(einstellung?.modell ?? '').trim()
  if (festgelegt !== '') return festgelegt

  const woerter = (einstellung?.suche ?? []).map(kompakt).filter((wort) => wort !== '')
  if (woerter.length === 0) {
    throw new IonosFehler('modell', `Für die ${BEZEICHNUNG[art] ?? art} ist weder ein Modell noch ein Suchbegriff festgelegt.`)
  }

  const ids = await client.modelle(signal)
  const treffer = ids.filter((id) => woerter.every((wort) => enthaeltWort(id, wort)))

  // The plain name before its variants: `Qwen3.8-27B` before `Qwen3.8-27B-FP8-Instruct`.
  const [bester] = [...treffer].sort((a, b) => a.length - b.length || a.localeCompare(b))

  if (bester === undefined) {
    const vorhanden = ids.length === 0 ? 'keine' : ids.slice(0, 15).join(', ')
    throw new IonosFehler(
      'modell',
      `Bei IONOS wurde kein Modell für die ${BEZEICHNUNG[art] ?? art} gefunden. ` +
        `Verfügbar sind: ${vorhanden}. Die Modell-ID lässt sich in konfiguration.json festlegen.`,
    )
  }

  return bester
}

/** The configuration with the defaults filled in where `konfiguration.json` says nothing. */
export function mitStandard(eingelesen: unknown): KiKonfiguration {
  // `eingelesen` is the parsed file, nothing is known of it: what is no object has no members.
  const datei: Record<string, unknown> = istObjekt(eingelesen) ? eingelesen : {}
  const ki: Record<string, unknown> = istObjekt(datei.ionos) ? datei.ionos : {}
  const ocr: Record<string, unknown> = istObjekt(datei.ocr) ? datei.ocr : {}
  const zusammen = (art: ModellArt): Modelleinstellung => {
    const eigene = ki[art]
    // Passed on as it stands: `loeseModellAuf` reads `modell` and `suche` defensively, whatever they hold.
    return { ...STANDARD_KI[art], ...(istObjekt(eigene) ? eigene : {}) }
  }

  return {
    basis: typeof ki.basis === 'string' && ki.basis !== '' ? ki.basis : STANDARD_KI.basis,
    ocr: zusammen('ocr'),
    text: zusammen('text'),
    /** How many pages are read at the same time. */
    parallel: typeof ocr.parallel === 'number' && Number.isInteger(ocr.parallel) && ocr.parallel > 0 ? ocr.parallel : 3,
  }
}
