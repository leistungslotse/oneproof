/**
 * Corrects a mix-up of two similar document types by what the document SAYS.
 *
 * Port of EvidenceTypeDisambiguator.php. The case it was built for: a registration certificate
 * ("Meldebescheinigung") that arrives classified as an ID document. The type hangs on everything
 * downstream (card, fulfilled requirement, value comparison, evidence type of the package), and a language
 * model rolls dice, so where the text itself answers the question, a fixed rule decides.
 *
 * The rule is in the catalog, not here. Every type may list `confusions`:
 *
 *   { type: 'registration_certificate', requires: [...], unless: [...] }
 *
 * Read: if a document of this type mentions a keyword from `requires` and NONE from `unless`, it
 * really is `type`. `unless` holds the hard features of the other side. Where both sides speak,
 * the model's proposal stays, because a wrong correction costs more than a missed one. The first
 * matching rule wins.
 *
 * Must run BEFORE manual corrections are applied: a human who set the type keeps it, and this
 * step does not know `source`. The classification confidence is the model's statement about its
 * proposal and stays as it is.
 *
 * PHP logs a correction; here the corrected document carries `correctedFrom: '<old type>'`.
 */
import { pageText } from './dokument.ts'
import type { Document, PageTexts } from './dokument.ts'
import { katalogEintrag } from './typ-bezeichnung.ts'
import type { Katalog } from './typ-bezeichnung.ts'

const UMLAUTS: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }

/**
 * Lower case with resolved umlauts, applied to text AND keywords. OCR delivers "Meldebehörde"
 * once with the umlaut, once as "Meldebehoerde"; the catalog writes the resolved form and hits both.
 * Two more things that look alike to a reader are alike here: a letter with a combining accent
 * (decomposed, NFD) is the composed letter, and a run of white space — a line break in the middle
 * of "Hilfe zur Erziehung" — is one space, so that a keyword of several words hits across it.
 */
function normalise(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[äöüß]/g, (letter) => UMLAUTS[letter] ?? letter)
    .replace(/\s+/g, ' ')
}

/**
 * The text of ALL pages of the document: the deciding word is not always on the first page, a
 * registration certificate may name its authority only above the official seal at the end.
 */
function textOf(document: Document, pageTexts: PageTexts | undefined): string {
  const pages = Array.isArray(document.pages) ? document.pages : []

  return pages
    .filter((page) => page !== null && typeof page === 'object')
    .map((page) => pageText(pageTexts, page))
    .join('\n')
    .trim()
}

/**
 * Does the text mention one of the keywords? As a SUBSTRING, not as a whole word: in German the
 * keyword sits inside compounds ("Meldebescheinigungsformular"), and a word boundary would let
 * exactly the cases through that this is about. A keyword that must not hit inside a name or a
 * longer word starts with a space (" kita" hits "Kita-Beitrag", not "Nikita"); the text is read
 * with a space before it, so that the first word counts as well.
 */
function mentions(text: string, keywords: string[] | undefined): boolean {
  if (!Array.isArray(keywords)) return false

  return keywords.some((keyword) => {
    const needle = normalise(String(keyword))
    return needle !== '' && text.includes(needle)
  })
}

function correct(document: Document, pageTexts: PageTexts | undefined, katalog: Katalog): Document {
  const type = String(document.type ?? '')
  const rules = katalogEintrag(type, katalog)?.confusions

  if (!Array.isArray(rules) || rules.length === 0) return document

  const gelesen = normalise(textOf(document, pageTexts))

  if (gelesen === '') return document

  const text = ` ${gelesen}`

  for (const rule of rules) {
    if (rule === null || typeof rule !== 'object') continue

    const target = String(rule.type ?? '')
    const entry = katalogEintrag(target, katalog)

    if (target === '' || entry === null) continue
    if (!mentions(text, rule.requires) || mentions(text, rule.unless)) continue

    // The display name belongs to the type and moves with it. As a copy of the old one the card
    // would still say "Ausweisdokument" above a registration certificate.
    return { ...document, type: target, label: String(entry.label ?? target), correctedFrom: type }
  }

  return document
}

/**
 * @param documents  Documents from the grouping
 * @param pageTexts  fileId -> page number -> OCR text
 * @param katalog    Parsed dokumenttypen.json
 * @returns          New list; documents without a correction are the same objects
 */
export function korrigiereTypen(documents: Document[], pageTexts: PageTexts | undefined, katalog: Katalog | null | undefined): Document[] {
  if (katalog === null || typeof katalog !== 'object') return [...documents]

  return documents.map((document) => correct(document, pageTexts, katalog))
}
