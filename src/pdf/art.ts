/**
 * What kind of evidence file this is.
 *
 * Read from the media type the browser reports. Some systems report none, or only the generic
 * `application/octet-stream`; then the ending of the name decides.
 */

/** The kinds of evidence file the upload accepts. */
export type DateiArt = 'pdf' | 'bild'

const TYPEN: Readonly<Record<string, DateiArt>> = { 'application/pdf': 'pdf', 'image/jpeg': 'bild', 'image/png': 'bild' }
const ENDUNGEN: Readonly<Record<string, DateiArt>> = { pdf: 'pdf', jpg: 'bild', jpeg: 'bild', png: 'bild' }

/** The file types the evidence upload accepts, for the `accept` attribute of the file input. */
export const ANGENOMMEN = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'

export function dateiArt(datei: Pick<File, 'name' | 'type'>): DateiArt | null {
  const nachTyp = Object.hasOwn(TYPEN, datei.type) ? TYPEN[datei.type] : undefined
  if (nachTyp !== undefined) return nachTyp

  if (datei.type === '' || datei.type === 'application/octet-stream') {
    // `split` always yields at least one part, so `pop` is never `undefined`.
    const endung = datei.name.toLowerCase().split('.').pop() ?? ''
    return Object.hasOwn(ENDUNGEN, endung) ? (ENDUNGEN[endung] ?? null) : null
  }
  return null
}
