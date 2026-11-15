/**
 * What comes back from the grouping model, made trustworthy.
 *
 * Port of `parseManifest`, `validateDocuments`, `validatePages` and `appendUnassignedDocuments` from
 * `GroupEvidenceDocuments`. A language model hallucinates ids and page numbers, hands out a page
 * twice and invents document types; none of that may pull a foreign page into a document or make a
 * page vanish. The invariant after these steps: every page that was sent stands in exactly one
 * document.
 *
 * The original bound the model with a response schema (closed lists for `evidence_type` and
 * `person`). Here the model answers in free text — it reasons first — so this module also accepts
 * what such a model writes instead of the exact form: the answer after a draft, a label instead of
 * a key, a name copied together with its role, a placeholder for "nobody", `seite` for `page`.
 * What it cannot read it still does not guess.
 */
import { istObjekt } from '../json.ts'
import type { PersonDirectory } from '../zuordnung/personen.ts'
import { isNumeric, toInt } from './dokument.ts'
import type { Document, PageRef } from './dokument.ts'
import { AUFFANGTYP, bezeichnungFuer, katalogEintrag } from './typ-bezeichnung.ts'
import type { Katalog } from './typ-bezeichnung.ts'

/** The JSON object the model answered with; its list of documents is `documents`. */
export type Manifest = Record<string, unknown>

/** Name of the catch-all for pages nothing could be made of. */
export const NICHT_ZUGEORDNET = 'Nicht zugeordnet'

/** The `{ … }` that begins at `anfang`, up to its matching brace; braces inside strings do not count. */
function objektAb(text: string, anfang: number): string | null {
  let tiefe = 0
  let inZeichenkette = false

  for (let stelle = anfang; stelle < text.length; stelle++) {
    const zeichen = text[stelle]
    if (inZeichenkette) {
      if (zeichen === '\\') stelle++
      else if (zeichen === '"') inZeichenkette = false
    } else if (zeichen === '"') {
      inZeichenkette = true
    } else if (zeichen === '{') {
      tiefe++
    } else if (zeichen === '}' && --tiefe === 0) {
      return text.slice(anfang, stelle + 1)
    }
  }
  return null
}

/** A JSON object out of a candidate text; a single trailing comma is forgiven. */
function alsObjekt(kandidat: string): Manifest | null {
  for (const fassung of [kandidat, kandidat.replace(/,(\s*[}\]])/g, '$1')]) {
    try {
      const wert: unknown = JSON.parse(fassung)
      if (istObjekt(wert)) return wert
    } catch {
      // the next form
    }
  }
  return null
}

/**
 * JSON out of a free-text answer. Candidates are every ```json block and every object that begins
 * with `"documents"`, tried from the END of the answer backwards: what the model wrote last is its
 * answer, whatever stands before it may be a draft or the schema of the instruction quoted back.
 * The first candidate with a `documents` list wins; the outermost `{ … }` is the last resort.
 *
 * @returns an object with `documents` if there is one, otherwise any object found
 *   (the caller then asks again), `null` if there is none
 */
export function liesManifest(roh: string | null | undefined): Manifest | null {
  const text = String(roh ?? '').trim()
  if (text === '') return null

  const kandidaten: { ab: number; json: string }[] = []
  for (const treffer of text.matchAll(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/g)) {
    const [, json] = treffer
    // Unreachable: the group takes part in every match.
    if (json === undefined) continue
    kandidaten.push({ ab: treffer.index, json })
  }
  for (const treffer of text.matchAll(/\{\s*"documents"\s*:/g)) {
    const json = objektAb(text, treffer.index)
    if (json !== null) kandidaten.push({ ab: treffer.index, json })
  }
  kandidaten.sort((a, b) => b.ab - a.ab)

  const anfang = text.indexOf('{')
  const ende = text.lastIndexOf('}')
  if (anfang !== -1 && ende > anfang) kandidaten.push({ ab: anfang, json: text.slice(anfang, ende + 1) })

  let ersatz: Manifest | null = null
  for (const { json } of kandidaten) {
    const wert = alsObjekt(json)
    if (wert === null) continue
    if (Array.isArray(wert.documents)) return wert
    ersatz ??= wert
  }
  return ersatz
}

const istSkalar = (wert: unknown): wert is string | number | boolean => ['string', 'number', 'boolean'].includes(typeof wert)

/** The model's certainty as 0–100; anything not numeric is "unknown" (`null`), not 0. */
function begrenzeSicherheit(wert: unknown): number | null {
  return isNumeric(wert) ? Math.max(0, Math.min(100, toInt(wert))) : null
}

/**
 * A name the page may show for a document type the catalogue does not know. It comes from the
 * model, and through it possibly from the text of a document: letters, digits and a little
 * punctuation, and short — never a sentence that could pass for a message of the authority.
 */
export function alsTypname(text: string | null | undefined, grenze = 80): string {
  const sauber = String(text ?? '')
    .replace(/[^\p{L}\p{N} .,/&()+-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return sauber.length > grenze ? `${sauber.slice(0, grenze - 1).trimEnd()}…` : sauber
}

/**
 * Keys of the catalogue by the spellings a model uses instead of the key: the key in another case
 * or with spaces, and the label the catalogue block shows next to it.
 */
function typSchluesselVon(katalog: Katalog | null | undefined): Map<string, string> {
  const schluessel = new Map<string, string>()
  for (const [key, eintrag] of Object.entries(katalog ?? {})) {
    schluessel.set(key.toLowerCase(), key)
    const label = String(eintrag?.label ?? '').trim().toLowerCase()
    if (label !== '' && !schluessel.has(label)) schluessel.set(label, key)
  }
  return schluessel
}

/** The catalogue key the model meant, or the type as it wrote it (then it is invented). */
function loeseTyp(roh: string | number | boolean, katalog: Katalog | null | undefined, schluessel: Map<string, string>): string {
  const typ = String(roh).trim()
  if (katalogEintrag(typ, katalog) !== null) return typ
  const klein = typ.toLowerCase()
  return schluessel.get(klein) ?? schluessel.get(klein.replace(/[\s-]+/g, '_')) ?? typ
}

/** What {@link pruefeSeiten} needs to know besides the pages of one document. */
interface SeitenKontext {
  /** file id → page numbers that were sent */
  erlaubt: ReadonlyMap<string, ReadonlySet<number>>
  /** pages already taken; updated */
  vergeben: Set<string>
  /** file name → file id */
  dateiIds: ReadonlyMap<string, string>
  /** the file id the document itself names */
  dateiDesDokuments?: unknown
}

/** The fields a model may put the page number in. */
const SEITENFELDER = ['page', 'page_number', 'pageNumber', 'seite', 'seitenzahl', 'page_no']
/** The fields a model may put the file id in. */
const DATEIFELDER = ['media_id', 'mediaId', 'file_id', 'datei']

const ersterWert = (objekt: unknown, felder: string[]): unknown =>
  felder.map((feld) => (istObjekt(objekt) ? objekt[feld] : undefined)).find((wert) => wert !== undefined && wert !== null)

/**
 * Each page at most once — the first mention wins. Pages the model was never given are dropped,
 * and so is every page number it made up. A page may be given as `{media_id, page}`, as a bare
 * number when the document names its file, and with the file name instead of its id. Without a
 * page number it is page 1 only where the file has a single page; otherwise it is not guessed.
 *
 */
function pruefeSeiten(seiten: unknown, { erlaubt, vergeben, dateiIds, dateiDesDokuments }: SeitenKontext): PageRef[] {
  if (!Array.isArray(seiten)) return []
  const eintraege: unknown[] = seiten

  const alsId = (wert: unknown): string | null => {
    if (!istSkalar(wert)) return null
    const text = String(wert).trim()
    return erlaubt.has(text) ? text : (dateiIds.get(text) ?? null)
  }

  // A file name the model gave can name a file that has no page among those sent.
  const gesendetVon = (fileId: string): ReadonlySet<number> => {
    const gesendet = erlaubt.get(fileId)
    if (gesendet === undefined) throw new Error(`Zur Datei ${fileId} wurden keine Seiten gesendet.`)
    return gesendet
  }

  const ergebnis: PageRef[] = []
  for (const seite of eintraege) {
    const nurZahl = istSkalar(seite) && isNumeric(seite)
    if (!nurZahl && (seite === null || typeof seite !== 'object')) continue

    const fileId = alsId(nurZahl ? dateiDesDokuments : (ersterWert(seite, DATEIFELDER) ?? dateiDesDokuments))
    if (fileId === null) continue

    let nummer: unknown = nurZahl ? seite : ersterWert(seite, SEITENFELDER)
    if (nummer === undefined) {
      const gesendet = gesendetVon(fileId)
      if (gesendet.size === 1) nummer = [...gesendet][0]
    }
    if (!istSkalar(nummer) || !isNumeric(nummer)) continue

    const page = toInt(nummer)
    const schluessel = `${fileId}:${page}`
    if (page < 1 || !gesendetVon(fileId).has(page) || vergeben.has(schluessel)) continue

    vergeben.add(schluessel)
    ergebnis.push({ fileId, page })
  }
  return ergebnis
}

/** What a model writes for "no person" when it does not leave the field empty. */
const PLATZHALTER = /^(?:-+|–|—|\.{3}|…|leer|keine?|niemand|unbekannt|ohne|n\/?a|null|none|nil)$/i

/**
 * The name as the model meant it: without a list bullet, without a role or note in brackets that
 * it copied from the list of persons ("Albert Einstein (Haushaltsmitglied)"), and empty for a
 * placeholder ("leer", "keine", "-").
 */
export function bereinigterName(name: unknown): string {
  const text = (istSkalar(name) ? String(name) : '')
    .trim()
    .replace(/^[-–•*]\s+/, '')
    .replace(/\s*\([^()]*\)\s*$/, '')
    .replace(/^["„“'‚‘]+|["“”'‘’]+$/g, '')
    .trim()
  return PLATZHALTER.test(text) ? '' : text
}

/**
 * The person as the application spells it — a member of the household or a person the application
 * names outside it. What matches nobody, or several persons equally, stays as the model read it:
 * that name is the only hint whose document it is.
 */
function loesePerson(name: unknown, verzeichnis: PersonDirectory, personen: readonly string[]): string {
  const gelesen = bereinigterName(name)
  if (gelesen === '') return ''
  const treffer = verzeichnis.match(gelesen)
  const ausDemAntrag = treffer.index === null ? treffer.anzeige : (personen[treffer.index] ?? treffer.anzeige)
  return (ausDemAntrag ?? gelesen).slice(0, 120)
}

/** What {@link pruefeDokumente} is given. */
export interface PruefEingabe {
  manifest: Manifest | null
  /** file id → page numbers that were sent */
  erlaubt: ReadonlyMap<string, ReadonlySet<number>>
  katalog: Katalog
  verzeichnis: PersonDirectory
  /** display names by person index */
  personen: readonly string[]
  /** file name → file id, for a model that names the file */
  dateiIds?: ReadonlyMap<string, string>
}

/** What {@link pruefeDokumente} keeps of the manifest. */
export interface PruefErgebnis {
  dokumente: Document[]
  /** the names the model gave to types the catalogue does not know */
  erfundeneTypen: string[]
}

/**
 * Keeps what is valid in the manifest of the model.
 *
 * Two passes, and the order is the point: first the documents with a type of the catalogue, then
 * the ones with an invented type, which are caught as `other_document`. An invented type must not
 * take a page from a correctly recognised document. What the model called the invented type is
 * kept as the name of the document, because that is the information searched for.
 *
 */
export function pruefeDokumente({ manifest, erlaubt, katalog, verzeichnis, personen, dateiIds = new Map() }: PruefEingabe): PruefErgebnis {
  const rohe: unknown = manifest?.documents
  if (!Array.isArray(rohe)) return { dokumente: [], erfundeneTypen: [] }
  const eintraege: unknown[] = rohe

  const schluessel = typSchluesselVon(katalog)
  const dokumente: Document[] = []
  const vergeben = new Set<string>()
  const erfunden = new Set<string>()

  for (const nurBekannte of [true, false]) {
    for (const roh of eintraege) {
      if (!istObjekt(roh) || !istSkalar(roh.evidence_type)) continue

      const typ = loeseTyp(roh.evidence_type, katalog, schluessel)
      const bekannt = katalogEintrag(typ, katalog) !== null
      if (bekannt !== nurBekannte) continue
      if (!bekannt && alsTypname(typ) === '') continue

      const seiten = pruefeSeiten(roh.pages, { erlaubt, vergeben, dateiIds, dateiDesDokuments: ersterWert(roh, DATEIFELDER) })
      if (seiten.length === 0) continue

      const label = bekannt ? bezeichnungFuer(typ, katalog).slice(0, 120) : alsTypname(bezeichnungFuer(typ, katalog))
      if (!bekannt) erfunden.add(label)

      dokumente.push({
        type: bekannt ? typ : AUFFANGTYP,
        typeLabel: bekannt ? null : label,
        label,
        person: loesePerson(roh.person, verzeichnis, personen),
        pages: seiten,
        confidence: begrenzeSicherheit(roh.confidence),
        source: 'ai',
      })
    }
  }

  return { dokumente, erfundeneTypen: [...erfunden] }
}

/**
 * Completeness: every page that was sent and not placed lands, per file, in a document "Nicht
 * zugeordnet", so that no page disappears unnoticed. The pages of all documents then equal the
 * pages that were sent.
 *
 */
export function haengeRestAn(dokumente: Document[], alleSeiten: PageRef[]): Document[] {
  const vergeben = new Set(dokumente.flatMap((dokument) => dokument.pages.map(({ fileId, page }) => `${fileId}:${page}`)))

  const rest = new Map<string, PageRef[]>()
  for (const seite of alleSeiten) {
    if (vergeben.has(`${seite.fileId}:${seite.page}`)) continue
    rest.set(seite.fileId, [...(rest.get(seite.fileId) ?? []), { fileId: seite.fileId, page: seite.page }])
  }

  const aufgefangen: Document[] = [...rest.values()].map((seiten) => ({
    type: AUFFANGTYP,
    label: NICHT_ZUGEORDNET,
    person: '',
    pages: seiten.sort((a, b) => a.page - b.page),
    unassigned: true,
  }))

  return [...dokumente, ...aufgefangen]
}
