/**
 * Cleaning of what the OCR model returns.
 *
 * Port of the post-processing in `OcrMediaPage`. Three things go wrong with a language model that
 * reads a page, and each has a counter-measure that does not need a second model call:
 *
 *  1. It echoes the instruction ("… Ankreuzkästchen …") as a line of its own → drop those lines.
 *  2. It falls into a repetition loop and writes the same line or block hundreds of times until the
 *     token limit → remove the repetitions ("DeRep", arXiv 2504.12608, algorithms 3 and 4, with
 *     exact matching instead of TF-IDF).
 *  3. It stops at the token limit mid-page → the caller learns that from `finish_reason`, and from
 *     this module whether the cut-off was only a loop (the text before it is complete) or real.
 */

/** The model sometimes appends the checkbox instruction as a line of its own (seen 17 Jul 2026). */
export function ohnePromptEcho(text: string | null | undefined): string {
  return String(text ?? '')
    .split('\n')
    .filter((zeile) => !zeile.includes('Ankreuzkästchen'))
    .join('\n')
}

/** The search for block repetitions is cubic; a model in a loop produces thousands of lines. */
const MAX_SCAN_LINES = 800
/** Real repetitions are short blocks (a form line, a paragraph). */
const MAX_BLOCK_LINES = 60

/**
 * Removes repeated lines and repeated blocks of lines.
 *
 * @param maxLineRepeats  how often the same line may follow itself
 * @param minBlockUnits   from how many repetitions of a block on it is cut
 */
export function entdopple(text: string, maxLineRepeats = 2, minBlockUnits = 3): string {
  return entferneBlockWiederholungen(entferneZeilenWiederholungen(String(text ?? ''), maxLineRepeats), minBlockUnits)
}

/** Blank lines between non-empty lines do not break the chain of repeats. */
function entferneZeilenWiederholungen(text: string, hoechstens: number): string {
  const ergebnis: string[] = []
  let vorherige = ''
  let anzahl = 0
  let leere: string[] = []

  for (const zeile of text.split('\n')) {
    if (zeile.trim() === '') {
      leere.push(zeile)
      continue
    }

    anzahl = zeile.trim() === vorherige.trim() ? anzahl + 1 : 1

    if (anzahl <= hoechstens) {
      ergebnis.push(...leere, zeile)
    }

    leere = []
    vorherige = zeile
  }

  ergebnis.push(...leere)
  return ergebnis.join('\n')
}

function entferneBlockWiederholungen(text: string, mindestens: number): string {
  const zeilen = text.split('\n')

  for (;;) {
    const fund = findeBlockWiederholung(zeilen, mindestens)
    if (fund === null) break

    const { start, laenge, einheiten } = fund
    zeilen.splice(start + laenge, (einheiten - 1) * laenge)
  }

  return zeilen.join('\n')
}

/** A block of `laenge` lines at `start` that stands `einheiten` times in a row. */
interface BlockWiederholung {
  start: number
  laenge: number
  einheiten: number
}

function findeBlockWiederholung(zeilen: string[], mindestens: number): BlockWiederholung | null {
  const n = Math.min(zeilen.length, MAX_SCAN_LINES)
  const maximaleLaenge = Math.min(Math.floor((2 * n) / 3), MAX_BLOCK_LINES)

  let bester: BlockWiederholung | null = null
  let besteEinheiten = 0

  for (let laenge = 2; laenge <= maximaleLaenge; laenge++) {
    for (let i = 0; i <= n - 2 * laenge; i++) {
      if (!aehnlich(zeilen, i, i + laenge, laenge)) continue

      const einheiten = zaehleWiederholungen(zeilen, i, laenge, n)
      if (einheiten > besteEinheiten) {
        besteEinheiten = einheiten
        bester = { start: i, laenge, einheiten }
      }
    }
  }

  return bester !== null && bester.einheiten >= mindestens ? bester : null
}

function zaehleWiederholungen(zeilen: string[], start: number, laenge: number, gesamt: number): number {
  let einheiten = 1
  let j = start + laenge

  while (j + laenge <= gesamt && aehnlich(zeilen, start, j, laenge)) {
    einheiten++
    j += laenge
  }

  return einheiten
}

function aehnlich(zeilen: string[], a: number, b: number, groesse: number): boolean {
  for (let k = 0; k < groesse; k++) {
    const links = zeilen[a + k]
    const rechts = zeilen[b + k]
    // The callers keep both blocks inside the lines; a line missing here is a bug, not an input.
    if (links === undefined || rechts === undefined) throw new Error('Block repetition search left the lines')
    if (links.trim() !== rechts.trim()) return false
  }
  return true
}

/**
 * From how many removed characters an answer that ends at the token limit counts as a REPETITION
 * LOOP and not as a page that is simply too full. Both values must hold: at least this many
 * characters AND at least this share of the answer. A loop that fills the limit repeats a short
 * block a hundred times; the cleaning then takes out the clear majority of the text. A page that
 * reaches the limit with REAL content loses almost nothing — there the rest is truly missing.
 */
const SCHLEIFE_MIN_ZEICHEN = 300
const SCHLEIFE_MIN_ANTEIL = 0.3

/**
 * Did the answer end in a repetition loop — is the text before the loop complete?
 *
 * @param roh        the answer without the echo of the instruction
 * @param bereinigt  the same answer after {@link entdopple}
 */
export function endeteInWiederholung(roh: string, bereinigt: string): boolean {
  const entfernt = roh.length - bereinigt.length
  if (entfernt < SCHLEIFE_MIN_ZEICHEN || roh.length === 0) return false
  return entfernt / roh.length >= SCHLEIFE_MIN_ANTEIL
}
