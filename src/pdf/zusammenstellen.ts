/**
 * The pages of one document as one PDF — for the package that "Antrag einreichen" hands over.
 *
 * A document of the check may be spread over several uploads and stand between other documents:
 * pages 1, 4 and 10 of a scan, or a contract in a PDF with its last page as a photo. pdf.js puts
 * such pages together (`extractPages`), as they are: text stays text, a scan stays the scanned
 * image, nothing is rendered anew. A photo becomes a PDF page first (`bildseite.ts`), drawn
 * through a canvas so that the orientation the camera recorded is applied.
 *
 * A document that is a whole upload, page by page, is that upload — unchanged, byte for byte.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { dateiArt } from './art.ts'
import { gibFrei, kontextVon, neueLeinwand } from './bild.ts'
import { pdfMitBild } from './bildseite.ts'
import { einpassen } from './masse.ts'
import { dekodiere, oeffnePdfDaten } from './quelle.ts'

/** Longest side of a photo in the package: sharp on paper, and a package stays small enough to send. */
const BILD_KANTE = 2400
const BILD_QUALITAET = 0.85

const bytesVon = async (datei: Blob): Promise<Uint8Array<ArrayBuffer>> => new Uint8Array(await datei.arrayBuffer())

const alsJpeg = (leinwand: HTMLCanvasElement) =>
  new Promise<Uint8Array<ArrayBuffer>>((erfuellt, abgelehnt) => {
    leinwand.toBlob(
      (blob) => (blob ? blob.arrayBuffer().then((puffer) => erfuellt(new Uint8Array(puffer)), abgelehnt) : abgelehnt(new Error('Aus dem Bild konnte kein JPEG erzeugt werden.'))),
      'image/jpeg',
      BILD_QUALITAET,
    )
  })

/** A photo as a PDF of one page. */
async function bildAlsPdf(datei: File): Promise<Uint8Array<ArrayBuffer>> {
  const bitmap = await dekodiere(datei)
  let leinwand: HTMLCanvasElement | undefined
  try {
    const { breite, hoehe } = einpassen(bitmap.width, bitmap.height, BILD_KANTE)
    leinwand = neueLeinwand(breite, hoehe)
    kontextVon(leinwand).drawImage(bitmap, 0, 0, breite, hoehe)
    return pdfMitBild({ jpeg: await alsJpeg(leinwand), breite: leinwand.width, hoehe: leinwand.height })
  } finally {
    bitmap.close()
    if (leinwand) gibFrei(leinwand)
  }
}

/** A page of an upload: which upload, and which page of it (counted from 1). */
export interface SeitenBezug {
  fileId: string
  page: number
}

/** What the package needs of the uploads: the pages of one document as one PDF, and an upload as it came in. */
export interface Zusammensteller {
  setzeZusammen: (seiten: readonly SeitenBezug[]) => Promise<Uint8Array>
  original: (fileId: string) => Promise<Uint8Array>
}

/**
 * @param dateien  the uploads of the check, in their order: the check calls the first `f1`
 */
export function zusammensteller(dateien: readonly File[]): Zusammensteller {
  const dateiVon = (fileId: string): File => {
    const datei = /^f\d+$/.test(fileId) ? dateien[Number(fileId.slice(1)) - 1] : undefined
    if (!datei) throw new Error(`Die hochgeladene Datei ${fileId} ist nicht mehr vorhanden. Bitte prüfen Sie erneut.`)
    return datei
  }

  /** Every upload as PDF bytes, made once: a scan with ten documents is read once, not ten times. */
  const quellen = new Map<string, Promise<Uint8Array>>()
  const quelle = (fileId: string): Promise<Uint8Array> => {
    let daten = quellen.get(fileId)
    if (!daten) {
      const datei = dateiVon(fileId)
      const eigene = dateiArt(datei) === 'bild' ? bildAlsPdf(datei) : bytesVon(datei)
      daten = eigene.catch((fehler: unknown) => {
        quellen.delete(fileId)
        throw fehler
      })
      quellen.set(fileId, daten)
    }
    return daten
  }

  return {
    original: async (fileId) => bytesVon(dateiVon(fileId)),

    async setzeZusammen(seiten) {
      /** The pages of each upload, with the place each takes in the document. */
      const jeQuelle = new Map<string, { page: number; position: number }[]>()
      const gesehen = new Set<string>()
      for (const { fileId, page } of seiten) {
        if (gesehen.has(`${fileId}:${page}`)) continue
        gesehen.add(`${fileId}:${page}`)
        jeQuelle.set(fileId, [...(jeQuelle.get(fileId) ?? []), { page, position: gesehen.size - 1 }])
      }

      // The document is opened on the first upload; the others are handed to it as bytes.
      const [erste] = jeQuelle
      if (!erste) throw new Error('Das Dokument hat keine Seiten.')
      const [traegerId, eigene] = erste
      const traeger = await quelle(traegerId)
      const { aufgabe, dokument } = await oeffnePdfDaten(traeger.slice())
      try {
        if (jeQuelle.size === 1 && eigene.length === dokument.numPages && eigene.every(({ page }, index) => page === index + 1)) {
          return traeger
        }

        const eintraege: Parameters<PDFDocumentProxy['extractPages']>[0] = []
        for (const [fileId, liste] of jeQuelle) {
          // pdf.js takes the pages of an entry in the order of the upload; `pageIndices` places them.
          const sortiert = [...liste].sort((a, b) => a.page - b.page)
          eintraege.push({
            document: fileId === traegerId ? null : (await quelle(fileId)).slice(),
            includePages: sortiert.map(({ page }) => page - 1),
            pageIndices: sortiert.map(({ position }) => position),
          })
        }

        const pdf = await dokument.extractPages(eintraege)
        if (!pdf) throw new Error('Die Seiten konnten nicht zu einem PDF zusammengesetzt werden.')
        return pdf
      } finally {
        void aufgabe.destroy().catch(() => {})
      }
    },
  }
}
