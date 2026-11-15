/**
 * Merges evidence of the same kind of the SAME person into ONE series ("Nachweisreihe").
 *
 * Port of EvidenceSeriesMerger.php. Twelve payslips of one person came out of the grouping as
 * twelve documents: twelve identical cards, twelve entries in the package. For the caseworker
 * that is ONE piece of evidence, the wage history of this person. What tells them apart is the
 * billing month, and that is read per part.
 *
 * The merge costs no sharpness because it does not remove the separation, it moves it: every
 * source document becomes a PART of the series, keeps its pages and is still read, counted and
 * compared on its own. Parts a source document already carries (a file cut by the month
 * segmenter) stay parts of their own and do not collapse into one lump part.
 *
 * Only what is the same series professionally is merged: same type AND same person. Not merged,
 * each stands for itself and keeps its place in the list:
 * - evidence WITHOUT a person: several of them need not belong together (two rent contracts can
 *   be one flat in two versions or two flats), merging would claim a link nobody checked,
 * - "Nicht zugeordnet" (`unassigned`) and corrections by the caseworker (`source: 'manual'`): the
 *   first is a non-answer of the model, the second a human decision, both must stay addressable,
 * - the catch-all type (not a genus, merging would put two unrelated papers under one card),
 * - types without fields in the catalog: nothing is read per part there, a series would invent
 *   parts that show up as "not read" for ever. The bank statement is read page by page and has
 *   no fields either.
 *
 * Runs behind manual corrections and behind the month segmenter. No page is lost and none added.
 */
import { isNumeric, numberedPages, toInt } from './dokument.ts'
import type { Document, PageRef } from './dokument.ts'
import { AUFFANGTYP, katalogEintrag } from './typ-bezeichnung.ts'
import type { Katalog, Katalogeintrag } from './typ-bezeichnung.ts'

function hasEntries(fields: Katalogeintrag['fields']): boolean {
  if (Array.isArray(fields)) return fields.length > 0

  return fields !== null && typeof fields === 'object' && Object.keys(fields).length > 0
}

/** PHP trim(): ASCII whitespace and NUL only. "Anna" plus a no-break space stays a different person than "Anna". */
function trimPhp(text: string): string {
  return text.replace(/^[ \t\n\r\0\v]+|[ \t\n\r\0\v]+$/g, '')
}

/** The series key, or null when this document stands for itself. */
function seriesKey(document: Document, katalog: Katalog | null | undefined): string | null {
  if (document.unassigned === true) return null
  if (document.source === 'manual') return null

  const person = trimPhp(String(document.person ?? ''))

  if (person === '') return null

  const type = String(document.type ?? '')

  if (type === AUFFANGTYP) return null

  if (!hasEntries(katalogEintrag(type, katalog)?.fields)) return null

  return `${type}|${person}`
}

/** @param documents At least one, all with the same series key */
function merge(documents: Document[]): Document {
  const [erstes] = documents
  // Unreachable: a series is only started by its first document.
  if (erstes === undefined) throw new Error('Eine Nachweisreihe braucht mindestens ein Dokument.')

  // A series of one document is no series. Returned unchanged: rebuilt, the document would lose
  // its identity and with it its PDF and the values read in an earlier run.
  if (documents.length === 1) return erstes

  const pages: PageRef[] = []
  const confidences: number[] = []
  let part = 0

  for (const document of documents) {
    const own = numberedPages(document.pages)

    if (own.length === 0) continue

    let first = true
    let before: number | null = null

    for (const page of own) {
      // Every source document opens a new part; inside it, so does every change of its own number.
      if (first || page.part !== before) part++

      first = false
      before = page.part
      pages.push({ fileId: page.fileId, page: page.page, part })
    }

    if (isNumeric(document.confidence)) confidences.push(toInt(document.confidence))
  }

  return {
    ...erstes,
    pages,
    // The most cautious statement of the series holds for the series. An average would smooth
    // away exactly the one payslip the model was unsure about.
    confidence: confidences.length === 0 ? null : Math.min(...confidences),
  }
}

/**
 * @param documents  Documents from the grouping (after corrections and the cut)
 * @param katalog    Parsed dokumenttypen.json: a type needs `fields` to form a series
 * @returns          New list; a series stands where its first document stood, documents
 *                   that are no series are the same objects
 */
export function fuehreReihenZusammen(documents: Document[], katalog: Katalog | null | undefined): Document[] {
  const series = new Map<string, Document[]>()
  /** A document, or the key of a series as placeholder for the place of its first document. */
  const slots: (Document | string)[] = []

  for (const document of documents) {
    const key = seriesKey(document, katalog)

    if (key === null) {
      slots.push(document)
      continue
    }

    let own = series.get(key)
    if (own === undefined) {
      own = []
      series.set(key, own)
      slots.push(key)
    }

    own.push(document)
  }

  return slots.map((slot) => (typeof slot === 'string' ? merge(series.get(slot) ?? []) : slot))
}
