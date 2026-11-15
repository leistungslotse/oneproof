/**
 * An uploaded file as a source of page images — the form in which the check takes evidence.
 *
 * A PDF is opened with pdf.js and rendered page by page when it is asked for; a photo or scan is
 * one page. Everything runs in the browser: the file leaves the machine only as the image of a
 * page, on its way to the OCR model.
 *
 * pdf.js is loaded on first use, so the page itself stays small. Its helper files (decoders for
 * scanned images, the standard fonts, the character maps of Asian fonts) are served from `/pdfjs/`,
 * see `vite.config.ts`. All PDFs share ONE worker: a worker per file holds its own copy of the
 * decoders, and twenty files would hold twenty.
 *
 * Memory is what limits a check on a phone, so nothing is kept longer than needed: a closed PDF
 * opens again when one of its pages is asked for, and a photo is decoded only while its page is
 * drawn.
 */
import type * as PdfjsModul from 'pdfjs-dist'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFWorker } from 'pdfjs-dist'
import type { Quelle } from '../engine/pipeline.ts'
import { istObjekt } from '../engine/json.ts'
import { gibFrei, kontextVon, leinwandAlsDataUrl, neueLeinwand } from './bild.ts'
import { dateiArt } from './art.ts'
import { sha512Hex } from './hash.ts'
import { einpassen, MAX_RASTER_KANTE, rasterSkala } from './masse.ts'

/** The pdf.js module as `import('pdfjs-dist/legacy/build/pdf.mjs')` yields it: the same types as the modern build. */
type Pdfjs = typeof PdfjsModul

/** Where `vite.config.ts` puts the pdf.js helper files. */
const PDFJS_ORDNER = `${import.meta.env.BASE_URL}pdfjs/`

let pdfjsGeladen: Promise<Pdfjs> | null = null
let gemeinsamerArbeiter: PDFWorker | null = null

/**
 * pdf.js with its worker, loaded once. The legacy build, which is for every browser of the last
 * years: the modern one takes `Math.sumPrecise`, `Map.getOrInsertComputed` and `Promise.try` from the
 * browser, and only the newest browsers have them (Chrome 147, Safari 26.2); the legacy build brings
 * them along.
 */
function ladePdfjs(): Promise<Pdfjs> {
  pdfjsGeladen ??= Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')])
    .then(([pdfjs, arbeiter]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = arbeiter.default
      return pdfjs
    })
    .catch((fehler: unknown) => {
      pdfjsGeladen = null
      throw fehler
    })
  return pdfjsGeladen
}

/** The one worker of all PDFs; a new one if the last has gone. */
function arbeiterVon(pdfjs: Pdfjs): PDFWorker {
  if (!gemeinsamerArbeiter || gemeinsamerArbeiter.destroyed) gemeinsamerArbeiter = pdfjs.PDFWorker.create({ name: 'nachweise' })
  return gemeinsamerArbeiter
}

/** What a person needs to know about a PDF that cannot be opened. */
function pdfFehler(fehler: unknown): Error {
  switch (istObjekt(fehler) ? fehler.name : undefined) {
    case 'PasswordException':
      return new Error('Das PDF ist passwortgeschützt.')
    case 'InvalidPDFException':
    case 'FormatError':
      return new Error('Die Datei ist kein lesbares PDF.')
    default:
      return new Error('Die Datei ist beschädigt, oder das PDF lässt sich in diesem Browser nicht öffnen.')
  }
}

/** An opened PDF: the loading task ends the work on it, the document gives access to the pages. */
export interface GeoeffnetesPdf {
  aufgabe: PDFDocumentLoadingTask
  dokument: PDFDocumentProxy
}

/**
 * Opens a PDF in the shared worker. The loading task, not the document, ends the work on it.
 * pdf.js takes over the buffer of `daten` and hands it to its worker: pass a copy of bytes that
 * are still needed.
 */
export async function oeffnePdfDaten(daten: Uint8Array): Promise<GeoeffnetesPdf> {
  return ladeDokument(await ladePdfjs(), daten)
}

async function ladeDokument(pdfjs: Pdfjs, daten: Uint8Array): Promise<GeoeffnetesPdf> {
  const aufgabe = pdfjs.getDocument({
    data: daten,
    worker: arbeiterVon(pdfjs),
    wasmUrl: `${PDFJS_ORDNER}wasm/`,
    standardFontDataUrl: `${PDFJS_ORDNER}standard_fonts/`,
    iccUrl: `${PDFJS_ORDNER}iccs/`,
    cMapUrl: `${PDFJS_ORDNER}cmaps/`,
    cMapPacked: true,
    // Evidence is foreign input: no script from the file may run.
    enableXfa: false,
  })
  try {
    return { aufgabe, dokument: await aufgabe.promise }
  } catch (fehler) {
    void aufgabe.destroy().catch(() => {})
    throw pdfFehler(fehler)
  }
}

const bytesVon = async (datei: Blob): Promise<Uint8Array<ArrayBuffer>> => new Uint8Array(await datei.arrayBuffer())

async function oeffnePdf(datei: File, hash: string | null): Promise<Quelle> {
  const pdfjs = await ladePdfjs()

  let offen: Promise<GeoeffnetesPdf> | null = Promise.resolve(await ladeDokument(pdfjs, await bytesVon(datei)))
  const seiten = (await offen).dokument.numPages

  return {
    name: datei.name,
    mime: 'application/pdf',
    groesse: datei.size,
    geaendert: datei.lastModified ?? null,
    seiten,
    hash,

    async bild(seite, signal) {
      offen ??= bytesVon(datei).then((daten) => ladeDokument(pdfjs, daten)).catch((fehler: unknown) => {
        offen = null
        throw fehler
      })
      const { dokument } = await offen
      const pdfSeite = await dokument.getPage(seite)
      let leinwand: HTMLCanvasElement | undefined
      try {
        // The viewport already has the rotation of the page applied.
        const mass = pdfSeite.getViewport({ scale: 1 })
        const ansicht = pdfSeite.getViewport({ scale: rasterSkala(mass.width, mass.height) })

        leinwand = neueLeinwand(ansicht.width, ansicht.height)
        const aufgabe = pdfSeite.render({ canvas: leinwand, viewport: ansicht, background: '#ffffff' })
        const abbrechen = () => aufgabe.cancel()
        signal?.addEventListener('abort', abbrechen, { once: true })
        try {
          await aufgabe.promise
        } finally {
          signal?.removeEventListener('abort', abbrechen)
        }

        return await leinwandAlsDataUrl(leinwand)
      } finally {
        if (leinwand) gibFrei(leinwand)
        pdfSeite.cleanup()
      }
    },

    /** Lets go of the document; a later page opens it again. */
    schliessen() {
      const zuSchliessen = offen
      offen = null
      void zuSchliessen?.then(({ aufgabe }) => aufgabe.destroy()).catch(() => {})
    },
  }
}

/** The pixels of a photo or scan, with the orientation of the camera applied. */
export async function dekodiere(datei: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(datei, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('Das Bild konnte nicht gelesen werden.')
  }
}

/**
 * A photo or scan. It is drawn through a canvas on purpose: a phone photo carries its orientation
 * as a tag, which the OCR model does not read, so a portrait photo would arrive on its side.
 * Drawing applies the orientation; a PNG gets a white background. A photo larger than
 * {@link MAX_RASTER_KANTE} on its longer side is drawn smaller — more pixels add nothing for the
 * OCR, and a phone browser refuses a canvas that large.
 */
async function oeffneBild(datei: File, hash: string | null): Promise<Quelle> {
  // Decoded once to know that it is an image at all; the pixels are not kept until its turn.
  const probe = await dekodiere(datei)
  probe.close()

  return {
    name: datei.name,
    mime: datei.type || 'image/jpeg',
    groesse: datei.size,
    geaendert: datei.lastModified ?? null,
    seiten: 1,
    hash,

    async bild() {
      const bitmap = await dekodiere(datei)
      let leinwand: HTMLCanvasElement | undefined
      try {
        const { breite, hoehe } = einpassen(bitmap.width, bitmap.height, MAX_RASTER_KANTE)
        leinwand = neueLeinwand(breite, hoehe)
        kontextVon(leinwand).drawImage(bitmap, 0, 0, breite, hoehe)
        return await leinwandAlsDataUrl(leinwand)
      } finally {
        bitmap.close()
        if (leinwand) gibFrei(leinwand)
      }
    },

    schliessen() {},
  }
}

/** Opens an uploaded file. */
export async function oeffneNachweis(datei: File): Promise<Quelle> {
  const art = dateiArt(datei)
  if (art === null) throw new Error('Nur PDF-, JPEG- und PNG-Dateien werden gelesen.')
  if (datei.size === 0) throw new Error('Die Datei ist leer.')

  const hash = await sha512Hex(new Uint8Array(await datei.arrayBuffer()))

  return art === 'pdf' ? oeffnePdf(datei, hash) : oeffneBild(datei, hash)
}
