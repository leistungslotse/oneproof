/**
 * A profile may bring invented example cases: an application and evidence each, to try the check
 * with. They lie next to the page under `beispiele/<profil>/`, described by its `index.json`:
 *
 *   {"beispiele": [{"id", "titel", "beschreibung", "antrag", "nachweise": ["…", …]}, …]}
 *
 * The paths are relative to the folder of the profile and may lead into a subfolder
 * (`berger/scan.pdf`); the file the person sees is named after the last part. The older form with
 * one case (`{"beschreibung", "antrag", "nachweise"}`) is read as a catalogue of one.
 */
import { istObjekt } from '../engine/json.ts'

/** One example case: an application and the evidence to try the check with, as paths in the folder of the profile. */
export interface Beispielfall {
  id: string
  titel: string
  beschreibung: string
  antrag: string
  nachweise: string[]
}

/** The example cases of a profile, as its `index.json` describes them. */
export interface Beispielkatalog {
  beispiele: Beispielfall[]
}

/** What the paths of a case lead to, as the page needs them: the files as if the person had chosen them. */
export interface BeispielDateien {
  antrag: File
  nachweise: File[]
}

/** Fetches a file of the site; the real `fetch` fits. */
export type BeispielHolen = (adresse: string) => Promise<Response>

/** Where the examples are fetched from, and how. */
export interface BeispielOptionen {
  /** Replaces the network, for tests. */
  holen?: BeispielHolen
  /** The folder of all examples, with a trailing slash. */
  ordner?: string
}

const TYPEN: Readonly<Record<string, string>> = { xml: 'application/xml', json: 'application/json', pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' }

const standardHolen: BeispielHolen = (adresse) => globalThis.fetch(adresse)
const standardOrdner = (): string => `${import.meta.env.BASE_URL}beispiele/`

/** A path inside the folder of the profile: no way up, no empty part. */
const istPfad = (pfad: unknown): pfad is string => typeof pfad === 'string' && pfad.split('/').every((teil) => teil !== '' && teil !== '.' && teil !== '..')

const text = (wert: unknown, ersatz: string): string => (typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : ersatz)

function alsBeispiel(eintrag: unknown, index: number): Beispielfall | null {
  if (!istObjekt(eintrag) || !istPfad(eintrag.antrag) || !Array.isArray(eintrag.nachweise) || !eintrag.nachweise.every(istPfad)) return null
  return {
    id: text(eintrag.id, `beispiel-${index + 1}`),
    titel: text(eintrag.titel, 'Beispielfall'),
    beschreibung: text(eintrag.beschreibung, ''),
    antrag: eintrag.antrag,
    nachweise: eintrag.nachweise,
  }
}

/**
 * The example cases of a profile, or `null` if it has none.
 */
export async function ladeBeispielBeschreibung(
  profilId: string,
  { holen = standardHolen, ordner = standardOrdner() }: BeispielOptionen = {},
): Promise<Beispielkatalog | null> {
  try {
    const antwort = await holen(`${ordner}${profilId}/index.json`)
    if (!antwort.ok || !/json/i.test(antwort.headers.get('content-type') ?? '')) return null
    const roh: unknown = await antwort.json()
    const eintraege: unknown[] = istObjekt(roh) && Array.isArray(roh.beispiele) ? roh.beispiele : [roh]
    const beispiele = eintraege.map(alsBeispiel).filter((beispiel) => beispiel !== null)
    return beispiele.length > 0 ? { beispiele } : null
  } catch {
    return null
  }
}

/** The files of an example case, as if the person had chosen them. */
export async function ladeBeispielDateien(
  profilId: string,
  beispiel: Pick<Beispielfall, 'antrag' | 'nachweise'>,
  { holen = standardHolen, ordner = standardOrdner() }: BeispielOptionen = {},
): Promise<BeispielDateien> {
  const hole = async (pfad: string): Promise<File> => {
    // `split` always yields at least one part, so `pop` is never `undefined`.
    const name = pfad.split('/').pop() ?? pfad
    const antwort = await holen(`${ordner}${profilId}/${pfad.split('/').map(encodeURIComponent).join('/')}`)
    if (!antwort.ok) throw new Error(`Die Beispieldatei „${name}“ konnte nicht geladen werden.`)
    return new File([await antwort.blob()], name, { type: TYPEN[(name.split('.').pop() ?? '').toLowerCase()] ?? '' })
  }

  const [antrag, ...nachweise] = await Promise.all([beispiel.antrag, ...beispiel.nachweise].map(hole))
  // The list always starts with the application.
  if (!antrag) throw new Error('Der Beispielfall hat keinen Antrag.')
  return { antrag, nachweise }
}
