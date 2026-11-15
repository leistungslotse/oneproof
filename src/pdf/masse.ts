/**
 * The sizes the page images are made in. Pure arithmetic, no browser needed.
 *
 * The numbers are those of the original (`OcrMediaPage`): rendered at 200 dpi — at 130 dpi
 * handwriting and checkboxes were lost on weak scans —, and an image above 5 MB is shrunk to at
 * most 2000 px on its longer side, because larger payloads are refused by the provider.
 */

/** A PDF point is 1/72 inch. */
export const PUNKTE_PRO_ZOLL = 72

export const RASTER_DPI = 200

/** Pages far larger than paper (a poster) get a lower resolution, or the canvas would not fit. */
export const MAX_RASTER_KANTE = 4000

export const MAX_BYTES = 5 * 1024 * 1024

export const MAX_KANTE = 2000

/** The qualities tried one after another until the image fits into {@link MAX_BYTES}. */
export const QUALITAETEN: readonly [number, ...number[]] = Object.freeze([0.85, 0.6, 0.4] as const)

/**
 * The scale at which a PDF page is rendered.
 *
 * @param breitePt  page width in points
 * @param hoehePt   page height in points
 */
export function rasterSkala(breitePt: number, hoehePt: number, dpi = RASTER_DPI): number {
  const laengste = Math.max(breitePt, hoehePt)
  if (!(laengste > 0)) return dpi / PUNKTE_PRO_ZOLL
  return Math.min(dpi / PUNKTE_PRO_ZOLL, MAX_RASTER_KANTE / laengste)
}

/** A size in pixels. */
export interface Groesse {
  breite: number
  hoehe: number
}

/**
 * The size at which an image fits into a square of `kante` pixels, with its proportions kept and
 * never enlarged.
 */
export function einpassen(breite: number, hoehe: number, kante = MAX_KANTE): Groesse {
  const faktor = Math.min(1, kante / Math.max(breite, hoehe))
  return { breite: Math.max(1, Math.round(breite * faktor)), hoehe: Math.max(1, Math.round(hoehe * faktor)) }
}
