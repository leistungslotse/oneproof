import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'
import type { ProxyOptions } from 'vite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mitStandard } from './src/engine/ionos/modelle.ts'
import type { Modelleinstellung } from './src/engine/ionos/modelle.ts'
import { ionosProxy } from './vite/ionos-proxy.ts'
import { pdfjsRessourcen } from './vite/pdfjs-ressourcen.ts'

/**
 * The models the proxy passes requests on for: those `public/konfiguration.json` names, read per
 * request, so that a change applies without a restart. Without a readable file: the defaults.
 */
function erlaubteModelle(): Modelleinstellung[] {
  let eingelesen: unknown = null
  try {
    eingelesen = JSON.parse(readFileSync(resolve(import.meta.dirname, 'public/konfiguration.json'), 'utf8'))
  } catch {
    // the defaults
  }
  const { ocr, text } = mitStandard(eingelesen)
  return [ocr, text]
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // The access to the AI service comes from `.env` or the environment, never from the page.
  const env = loadEnv(mode, import.meta.dirname, '')

  // The page asks the registries under /noots/… on its own origin; the server passes the call on to the NOOTS mock in `backend/`.
  const nootsProxy: Record<string, ProxyOptions> = {
    '/noots': { target: env.NOOTS_URL || 'http://127.0.0.1:8787', changeOrigin: true, rewrite: (path) => path.replace(/^\/noots/, '') },
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
      ionosProxy({ ziel: env.IONOS_ENDPOINT || env.IONOS_OCR_ENDPOINT, token: env.IONOS_API_TOKEN, modelle: erlaubteModelle }),
      pdfjsRessourcen(),
    ],
    build: {
      rollupOptions: {
        input: {
          // The dummy, the evidence check, the department's page and the API reference are
          // separate pages, not separate apps.
          main: resolve(import.meta.dirname, 'index.html'),
          pruefen: resolve(import.meta.dirname, 'pruefen.html'),
          sachbearbeitung: resolve(import.meta.dirname, 'sachbearbeitung.html'),
          api: resolve(import.meta.dirname, 'api.html'),
        },
        output: {
          // A module worker only starts if the server calls its file JavaScript, and some nginx
          // installations send `.mjs` as application/octet-stream. So the worker of PDF.js gets the
          // ending `.js`, which every server knows, and no server needs a rule of its own for it.
          assetFileNames: (asset) =>
            (asset.names ?? [asset.name]).some((name) => name?.endsWith('.mjs')) ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]',
        },
      },
    },
    server: {
      host: true,
      // The dev server sits behind a TLS-terminating proxy that does not forward
      // X-Forwarded-Proto, so any host it is reached under has to be accepted.
      allowedHosts: true,
      proxy: nootsProxy,
    },
    preview: { proxy: nootsProxy },
  }
})
