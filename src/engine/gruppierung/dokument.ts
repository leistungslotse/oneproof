/**
 * The shared document shape of the grouping engine and its part ("Teilbeleg") logic.
 *
 * Port of app/Support/Evidence/EvidenceDocumentPart.php, reduced to what the other grouping
 * steps and a later evaluation need: part numbering, the parts of a document and its identity.
 * Everything that reads VALUES per part (aggregate, valuesOf, label, read state) belongs to the
 * extraction side and is not ported.
 *
 * Key names against the PHP engine: media_id -> fileId, teil -> part, evidence_type -> type,
 * type_label -> typeLabel, classification_confidence -> confidence. Every function here is pure
 * and never mutates its input.
 */

export interface PageRef {
  fileId: string
  page: number
  part?: number | null
}

export interface Document {
  /** Catalog key (PHP evidence_type) */
  type: string
  /** Own name for an invented type (PHP type_label) */
  typeLabel?: string | null
  /** Display name (PHP label) */
  label: string
  /** Display name of the person or '' (PHP person) */
  person: string
  /** Pages in reading order */
  pages: PageRef[]
  /** Catch-all document "Nicht zugeordnet" */
  unassigned?: boolean
  /** 0-100 (PHP classification_confidence) */
  confidence?: number | null
  source?: 'ai' | 'manual' | 'fallback'
  /** Set by korrigiereTypen: the type before the correction */
  correctedFrom?: string
}

/** fileId -> page number -> OCR text */
export type PageTexts = Record<string, Record<number, string>>

export interface Part {
  part: number | null
  pages: PageRef[]
}

/** A page with its EFFECTIVE part number, see {@link numberedPages}. */
export interface NumberedPage {
  fileId: string
  page: number
  part: number | null
}

/** The page as one string, e.g. for sets and identities. */
export function pageKey(page: PageRef): string {
  return `${page.fileId}:${page.page}`
}

/** The OCR text of one page (`pageTexts[fileId][page]`), '' when file or page is unknown. */
export function pageText(pageTexts: PageTexts | undefined, page: PageRef): string {
  const ofFile = pageTexts?.[page?.fileId ?? '']
  const text = ofFile !== null && typeof ofFile === 'object' ? ofFile[page?.page ?? 0] : undefined

  return text === undefined || text === null ? '' : String(text)
}

/** PHP is_numeric(): finite numbers and numeric strings, nothing else (not true, not ''). */
export function isNumeric(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  return typeof value === 'string' && /^\s*[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i.test(value)
}

/** PHP (int) cast: truncates, reads the numeric prefix of a string, anything else is 0. */
export function toInt(value: unknown): number {
  const number = typeof value === 'string' ? Number.parseFloat(value) : Number(value)
  // `|| 0` also turns -0 into 0, which PHP integers do not have.
  return Number.isFinite(number) ? Math.trunc(number) || 0 : 0
}

/**
 * The pages of a document with their EFFECTIVE part number (PHP EvidenceDocumentPart::numbered).
 *
 * The one place where the rule lives: a page without a number of its own belongs to the
 * preceding part. After a cut at the billing month the follow-up page of a payslip carries no
 * month, but it belongs to it. Such a page BEFORE the first numbered one keeps `part: null`
 * instead of disappearing (invariant I1, no page is lost). Entries without a fileId are skipped.
 *
 * Needed in three places: building the parts, merging a series and the identity of a document.
 */
export function numberedPages(pages: PageRef[] | null | undefined): NumberedPage[] {
  const result: NumberedPage[] = []
  let running: number | null = null

  for (const page of Array.isArray(pages) ? pages : []) {
    if (page === null || typeof page !== 'object' || page.fileId === undefined || page.fileId === null) {
      continue
    }

    const part: number | null = isNumeric(page.part) ? toInt(page.part) : running
    running = part
    result.push({ fileId: String(page.fileId), page: toInt(page.page ?? 1), part })
  }

  return result
}

/**
 * The parts of a document, grouped like PHP EvidenceDocumentPart::allOf.
 *
 * A document without parts is a document with exactly one part (`part: null`), so every caller
 * can run the same loop. The pages of a part are plain `{ fileId, page }` references.
 *
 * - Pages without a number before the first numbered part open a part of their own (`part: null`).
 * - EXACTLY ONE GROUP IS NO SERIES, whether its pages carry a number or not. A series that
 *   shrinks to a single part through a correction keeps the old number in its pages, and must
 *   still read as one whole document (`part: null`), or hasParts() would contradict it.
 * - The parts come in the order in which they first appear in the page list, as in PHP. For the
 *   numbers the segmenter and the merger write (ascending along the pages) that is ascending
 *   part order.
 * - Never empty: a document without usable pages still yields one part with no pages.
 */
export function partsOf(document: Document): Part[] {
  const groups = new Map<number | null, PageRef[]>()

  for (const { fileId, page, part } of numberedPages(document?.pages)) {
    let group = groups.get(part)
    if (group === undefined) {
      group = []
      groups.set(part, group)
    }
    group.push({ fileId, page })
  }

  if (groups.size === 0) return [{ part: null, pages: [] }]
  if (groups.size === 1) return [{ part: null, pages: [...groups.values()][0] ?? [] }]

  return [...groups].map(([part, pages]) => ({ part, pages }))
}

/** Does this document carry more than one part? */
export function hasParts(document: Document): boolean {
  return partsOf(document).length > 1
}

/**
 * Identity of a document across runs: type, person and the SORTED set of its pages, each with
 * its part (`file:page#part`). A different reading order makes no other document, a different
 * page set does, and so does a different cut: the same twelve pages split into payslips in
 * another way are another document (PHP GroupEvidenceDocuments::documentIdentity).
 */
export function documentIdentity(document: Document): string {
  const refs = numberedPages(document?.pages).map(
    (page) => pageKey(page) + (page.part === null ? '' : `#${page.part}`),
  )

  // Plain string order (UTF-16 code units), like PHP sort() on non-numeric strings.
  refs.sort()

  return `${document?.type ?? ''}|${document?.person ?? ''}|${refs.join(',')}`
}
