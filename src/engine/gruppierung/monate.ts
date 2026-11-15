/**
 * Cuts ONE file with several payslips into one part ("Teilbeleg") per billing month.
 *
 * Port of PayslipMonthSegmenter.php. The common case in practice is not the single payslip but
 * one PDF with twelve months, one page each. For the model that is ONE document, and everything
 * downstream would see one month and one gross amount. So the cut is made deterministically at
 * the text of each page ("Abrechnung der Brutto/Netto-Bezüge für Januar 2025", "Abrechnungsmonat
 * Januar 2026"), not by the model.
 *
 * It cuts into PARTS, not into documents: twelve payslips of one person are ONE piece of
 * evidence for filing and twelve for checking. The pages carry their part number (`part`).
 *
 * The rule is conservative on purpose, because a wrong cut costs more than a missed one:
 * - Only a month named behind a heading counts. A date anywhere else on the page does not: the
 *   print date of a December payslip lies in January.
 * - A page without a recognisable month (second page of a payslip, cover sheet) stays with the
 *   preceding part.
 * - The first month found never cuts, so a leading cover sheet does not become a part of its own.
 * - Without a second, different month the document comes back UNCHANGED (same object), so it
 *   keeps its identity.
 *
 * No page is lost and none is added: the union of the parts is the page set of the input.
 */
import { pageText } from './dokument.ts'
import type { Document, PageRef, PageTexts } from './dokument.ts'

/**
 * Only the payslip. The income certificate ("Verdienstbescheinigung") looks similar and must NOT
 * be cut: it is ONE document that certifies several months, and cutting it would invent eleven
 * certificates nobody issued.
 */
const TYPES = ['payslip']

/**
 * How far behind a heading a month still belongs to it, in characters. Wide enough for
 * "Abrechnung der Brutto/Netto-Bezüge für Januar 2025", narrow enough that the next heading or
 * an amount table does not reach in. PHP counted BYTES here (substr), so umlauts made its window
 * a few characters shorter; here it counts characters (code points, an emoji is one).
 */
const ANCHOR_WINDOW = 60

/**
 * The headings behind which a month is the BILLING month. From the specific to the general, so
 * the window starts behind the complete word.
 */
const ANCHORS =
  'abrechnungsmonat|abrechnungszeitraum|lohnzahlungszeitraum|entgeltabrechnung|verdienstabrechnung|gehaltsabrechnung|lohnabrechnung|bezügemitteilung|abrechnung'

const MONTHS: Record<string, number> = {
  januar: 1,
  februar: 2,
  märz: 3,
  marz: 3,
  maerz: 3,
  april: 4,
  mai: 5,
  juni: 6,
  juli: 7,
  august: 8,
  september: 9,
  oktober: 10,
  november: 11,
  dezember: 12,
}

// A month by name: "Januar 2025", "März. 2025".
const NAMED_MONTH = new RegExp(`(${Object.keys(MONTHS).join('|')})\\s*\\.?\\s*((?:19|20)\\d{2})`, 'iu')

// A month by number, "01.2025" or "11/2024". Not behind a digit and not behind a dot or slash,
// so "01.2025" is a month and the "01.2025" inside "31.01.2025" is not. PHP uses lookbehinds for
// that. The consuming prefix is the same condition without them: Safari before 16.4 (older iPads
// and iPhones) cannot parse a lookbehind and would fail to load the whole module.
const NUMERIC_MONTH = /(?:^|[^\d./])(0[1-9]|1[0-2])\s*[./]\s*((?:19|20)\d{2})/u

// A full date, "01.01.2025". Only used behind a heading that names a PERIOD.
const FULL_DATE = /(?:^|\D)\d{1,2}\.\s*(0?[1-9]|1[0-2])\.\s*((?:19|20)\d{2})/u

function format(month: number, year: string): string {
  return `${String(month).padStart(2, '0')}.${year}`
}

/** The ANCHOR_WINDOW characters (code points) from `start` on. */
function windowFrom(text: string, start: number): string {
  let end = start

  for (let count = 0; count < ANCHOR_WINDOW && end < text.length; count++) {
    end += (text.codePointAt(end) ?? 0) > 0xffff ? 2 : 1
  }

  return text.slice(start, end)
}

/** @param allowFullDate Whether a full date counts as a month ("Abrechnungszeitraum 01.01.2025 - 31.01.2025") */
function monthIn(excerpt: string, allowFullDate: boolean): string | null {
  const named = NAMED_MONTH.exec(excerpt)

  if (named !== null) {
    const [, name = '', year = ''] = named
    const month = MONTHS[name.toLowerCase()]
    // Case folding can let exotic letters match ("auguſt"); such a hit has no month number.
    if (month !== undefined) return format(month, year)
  }

  const numeric = NUMERIC_MONTH.exec(excerpt)

  if (numeric !== null) {
    const [, month = '', year = ''] = numeric
    return format(Number(month), year)
  }

  if (allowFullDate) {
    const date = FULL_DATE.exec(excerpt)

    if (date !== null) {
      const [, month = '', year = ''] = date
      return format(Number(month), year)
    }
  }

  return null
}

/**
 * The billing month of a page as `MM.JJJJ`, or null when none is named expressly.
 *
 * It looks only BEHIND a heading and only for an entry that MEANS a month: "Januar 2025" or
 * "01.2025". A full date does not count: "erstellt am 09.01.2026" names the day of printing, not
 * the billed month. The one exception is a PERIOD ("Abrechnungszeitraum 01.01.2025 bis
 * 31.01.2025"), where the day date is the entry itself and its month is the one sought.
 *
 * @param text OCR text of one page
 */
export function monatDerSeite(text: string | null | undefined): string | null {
  const source = String(text ?? '')

  for (const anchor of source.matchAll(new RegExp(ANCHORS, 'giu'))) {
    const excerpt = windowFrom(source, anchor.index + anchor[0].length)
    const month = monthIn(excerpt, anchor[0].toLowerCase().endsWith('zeitraum'))

    if (month !== null) return month
  }

  return null
}

function segment(document: Document, pageTexts: PageTexts | undefined): Document {
  if (!TYPES.includes(String(document.type ?? ''))) return document

  const pages = Array.isArray(document.pages) ? document.pages : []

  if (pages.length < 2) return document

  let cuts = 0
  let running: string | null = null
  const segmented: PageRef[] = []

  for (const page of pages) {
    const month = monatDerSeite(pageText(pageTexts, page))

    // Cut only at a month that REPLACES another. The first month of a document never cuts: if a
    // leading page carried no month, it would otherwise stand there as a monthless part.
    if (month !== null && running !== null && month !== running) cuts++

    if (month !== null) running = month

    segmented.push({ ...page, part: cuts + 1 })
  }

  // Returned as is, not rebuilt: a document without part numbers keeps its identity and with it
  // its assembled PDF and the values read in an earlier run.
  if (cuts === 0) return document

  return { ...document, pages: segmented }
}

/**
 * @param documents  Documents from the grouping
 * @param pageTexts  fileId -> page number -> OCR text
 * @returns          New list; documents that were not cut are the same objects
 */
export function schneideAbrechnungsmonate(documents: Document[], pageTexts: PageTexts | undefined): Document[] {
  return documents.map((document) => segment(document, pageTexts))
}
