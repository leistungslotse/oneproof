/**
 * A photo or scan as a page of a PDF — so that every document of a package is a PDF, however its
 * pages came in.
 *
 * One A4 page, upright or across as the image is, with the image as large as fits inside a margin
 * of one centimetre. The image is a JPEG and goes into the PDF as it is (`DCTDecode`): a PDF reader
 * shows a JPEG without decoding it into anything else. Pure byte arithmetic, no browser needed.
 */

/** A4 in PDF points (1/72 inch). */
const A4 = Object.freeze({ breite: 595.28, hoehe: 841.89 })
const RAND = 28.35

const zahl = (wert: number): string => (Math.round(wert * 100) / 100).toString()

/** A baseline or progressive JPEG in RGB, and its size in pixels. */
export interface JpegBild {
  jpeg: Uint8Array
  breite: number
  hoehe: number
}

/** @returns a PDF with one page */
export function pdfMitBild({ jpeg, breite, hoehe }: JpegBild): Uint8Array<ArrayBuffer> {
  if (!(breite > 0 && hoehe > 0)) throw new Error('Das Bild hat keine Größe.')
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('Das Bild ist kein JPEG.')

  const seite = breite > hoehe ? { breite: A4.hoehe, hoehe: A4.breite } : A4
  const skala = Math.min((seite.breite - 2 * RAND) / breite, (seite.hoehe - 2 * RAND) / hoehe)
  const [b, h] = [breite * skala, hoehe * skala]
  const inhalt = `q ${zahl(b)} 0 0 ${zahl(h)} ${zahl((seite.breite - b) / 2)} ${zahl((seite.hoehe - h) / 2)} cm /Bild Do Q`

  const objekte = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${zahl(seite.breite)} ${zahl(seite.hoehe)}] /Resources << /XObject << /Bild 4 0 R >> >> /Contents 5 0 R >>`,
    [
      `<< /Type /XObject /Subtype /Image /Width ${breite} /Height ${hoehe} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      jpeg,
      '\nendstream',
    ],
    `<< /Length ${inhalt.length} >>\nstream\n${inhalt}\nendstream`,
  ]

  const kodierer = new TextEncoder()
  const teile: Uint8Array[] = []
  let laenge = 0
  const schreibe = (teil: string | Uint8Array): void => {
    const bytes = typeof teil === 'string' ? kodierer.encode(teil) : teil
    teile.push(bytes)
    laenge += bytes.length
  }

  // The comment of four bytes above 127 tells transfer programs that the file is not text.
  schreibe('%PDF-1.4\n')
  schreibe(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))
  const orte: number[] = []
  objekte.forEach((objekt, index) => {
    orte.push(laenge)
    schreibe(`${index + 1} 0 obj\n`)
    for (const teil of [objekt].flat()) schreibe(teil)
    schreibe('\nendobj\n')
  })

  const verzeichnis = laenge
  schreibe(`xref\n0 ${objekte.length + 1}\n0000000000 65535 f \n`)
  for (const ort of orte) schreibe(`${String(ort).padStart(10, '0')} 00000 n \n`)
  schreibe(`trailer\n<< /Size ${objekte.length + 1} /Root 1 0 R >>\nstartxref\n${verzeichnis}\n%%EOF\n`)

  const pdf = new Uint8Array(laenge)
  let position = 0
  for (const teil of teile) {
    pdf.set(teil, position)
    position += teil.length
  }
  return pdf
}
