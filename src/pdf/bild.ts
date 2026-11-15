/**
 * Canvas → the image the OCR model receives.
 *
 * The model takes a page as a data URL. The provider refuses payloads above a limit, so an image
 * that is too large is shrunk, step by step, as in the original:
 * first as it is (quality 85 %), and only if that exceeds 5 MB at most 2000 px on the longer side,
 * at 85, 60 and 40 % in turn until it fits.
 */
import { einpassen, MAX_BYTES, MAX_KANTE, QUALITAETEN } from './masse.ts'

/**
 * A white canvas: PDF pages and PNGs may be transparent, and JPEG turns transparency black.
 * A browser that has no memory left for it returns no drawing context; that is said in words.
 */
export function neueLeinwand(breite: number, hoehe: number): HTMLCanvasElement {
  const leinwand = document.createElement('canvas')
  leinwand.width = Math.max(1, Math.round(breite))
  leinwand.height = Math.max(1, Math.round(hoehe))

  const kontext = leinwand.getContext('2d', { alpha: false })
  if (!kontext) {
    gibFrei(leinwand)
    throw new Error('Für das Bild dieser Seite hat der Browser nicht genug Speicher. Schließen Sie andere Tabs und versuchen Sie es erneut.')
  }
  kontext.fillStyle = '#ffffff'
  kontext.fillRect(0, 0, leinwand.width, leinwand.height)

  return leinwand
}

/**
 * The drawing context of a canvas that {@link neueLeinwand} made: it has checked that there is one.
 */
export function kontextVon(leinwand: HTMLCanvasElement): CanvasRenderingContext2D {
  const kontext = leinwand.getContext('2d')
  if (!kontext) throw new Error('Die Leinwand hat keinen Zeichenkontext.')
  return kontext
}

/** A canvas keeps its pixel memory until it is made empty; Safari in particular does not let go. */
export function gibFrei(leinwand: HTMLCanvasElement): void {
  leinwand.width = 0
  leinwand.height = 0
}

const alsJpeg = (leinwand: HTMLCanvasElement, qualitaet: number) =>
  new Promise<Blob>((erfuellt, abgelehnt) => {
    leinwand.toBlob(
      (blob) => (blob ? erfuellt(blob) : abgelehnt(new Error('Aus der Seite konnte kein Bild erzeugt werden.'))),
      'image/jpeg',
      qualitaet,
    )
  })

export function blobAlsDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((erfuellt, abgelehnt) => {
    const leser = new FileReader()
    leser.onload = () => {
      // `readAsDataURL` always ends in a string.
      if (typeof leser.result === 'string') erfuellt(leser.result)
      else abgelehnt(new Error('Das Bild konnte nicht gelesen werden.'))
    }
    leser.onerror = () => abgelehnt(leser.error ?? new Error('Das Bild konnte nicht gelesen werden.'))
    leser.readAsDataURL(blob)
  })
}

/**
 * @param leinwand  stays untouched; the caller frees it
 * @returns `data:image/jpeg;base64,…`
 */
export async function leinwandAlsDataUrl(leinwand: HTMLCanvasElement): Promise<string> {
  let blob = await alsJpeg(leinwand, QUALITAETEN[0])
  if (blob.size <= MAX_BYTES) return blobAlsDataUrl(blob)

  const { breite, hoehe } = einpassen(leinwand.width, leinwand.height, MAX_KANTE)
  const klein = neueLeinwand(breite, hoehe)
  try {
    kontextVon(klein).drawImage(leinwand, 0, 0, breite, hoehe)
    for (const qualitaet of QUALITAETEN) {
      blob = await alsJpeg(klein, qualitaet)
      if (blob.size <= MAX_BYTES) break
    }
  } finally {
    gibFrei(klein)
  }
  return blobAlsDataUrl(blob)
}
