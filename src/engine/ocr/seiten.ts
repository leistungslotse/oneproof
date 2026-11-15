/**
 * The pages of a file as one text and back.
 *
 * Port of `OcrPageSplitter` and the assembling in `FinalizeMediaOcrText`. A PDF is read page by
 * page; the text of the whole file is the pages joined by `# Seite N` markers, and text without a
 * marker counts as the single page 1 (images, one-page PDFs). Grouping and extraction have to use
 * exactly this page identity, which is why it lives in one place.
 */

/** `# Seite 3` on a line of its own. */
const MARKER = /^#[ \t]*Seite[ \t]+(\d+)[ \t]*$/gm

/** @returns page number -> text of the page */
export function teileInSeiten(text: string | null | undefined): Map<number, string> {
  const ganz = String(text ?? '')
  const marken = [...ganz.matchAll(MARKER)]

  if (marken.length === 0) return new Map([[1, ganz.trim()]])

  const seiten = new Map<number, string>()
  marken.forEach((marke, index) => {
    const start = marke.index + marke[0].length
    const naechste = marken[index + 1]
    const ende = naechste ? naechste.index : ganz.length
    seiten.set(Number(marke[1]), ganz.slice(start, ende).trim())
  })
  return seiten
}

/**
 * @param seiten     page number -> text
 * @param mitMarken  `false` for a single image: the text stands alone
 */
export function fuegeSeitenZusammen(seiten: Iterable<[number, string]>, mitMarken = true): string {
  const sortiert = [...seiten].sort(([a], [b]) => a - b)

  if (!mitMarken) return sortiert[0]?.[1] ?? ''

  return sortiert.map(([nummer, text]) => `# Seite ${nummer}\n\n${text}`).join('\n\n')
}
