/**
 * The helper files pdf.js loads at run time: decoders for scanned images (JPEG 2000, JBIG2), the
 * colour profile, the standard fonts that a PDF may refer to without embedding them, and the
 * character maps of Chinese, Japanese and Korean fonts (a certificate from abroad). Without them a
 * scanned PDF renders blank or with wrong glyphs, and the OCR then reads that.
 *
 * pdf.js wants them in a folder under fixed file names, so they cannot be imported as assets.
 * This plugin serves them from the installed package in development and copies them next to the
 * build as `pdfjs/…`. One source of truth: the version in `node_modules`.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import type { Plugin } from 'vite'

const PAKET = resolve(import.meta.dirname, '../node_modules/pdfjs-dist')
const ORDNER = ['wasm', 'standard_fonts', 'iccs', 'cmaps']
const TYPEN: Record<string, string> = {
  '.wasm': 'application/wasm',
  '.js': 'text/javascript',
  '.icc': 'application/vnd.iccprofile',
  '.bcmap': 'application/octet-stream',
}

const dateien = (): string[] =>
  ORDNER.flatMap((ordner) => readdirSync(join(PAKET, ordner)).map((datei) => `${ordner}/${datei}`))

export function pdfjsRessourcen(): Plugin {
  return {
    name: 'pdfjs-ressourcen',

    configureServer(server) {
      server.middlewares.use('/pdfjs', (anfrage, antwort, weiter) => {
        const pfad = decodeURIComponent((anfrage.url ?? '').split('?')[0] ?? '').replace(/^\//, '')
        // Only what is on the list: no path out of the folders.
        if (!dateien().includes(pfad)) return weiter()

        antwort.setHeader('Content-Type', TYPEN[extname(pfad)] ?? 'application/octet-stream')
        antwort.end(readFileSync(join(PAKET, pfad)))
      })
    },

    generateBundle() {
      for (const pfad of dateien()) {
        this.emitFile({ type: 'asset', fileName: `pdfjs/${pfad}`, source: readFileSync(join(PAKET, pfad)) })
      }
    },
  }
}
