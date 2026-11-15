/**
 * The settings of the page: which models read and group the evidence.
 *
 * They stand in `konfiguration.json` next to the page, so that an installation can name other
 * models without a build. The file is optional — without it the defaults of `ionos/modelle.ts`
 * apply, which look the models up by a few words of their name.
 */
import { mitStandard } from '../engine/ionos/modelle.ts'
import type { KiKonfiguration } from '../engine/ionos/modelle.ts'

/** The part of a `Response` that reading the file needs; the real one fits. */
export interface KonfigurationsAntwort {
  ok: boolean
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
}

/** The part of `fetch` that reading the file needs; the real `fetch` fits. */
export type KonfigurationsHolen = (adresse: string, optionen: { cache: 'no-cache' }) => Promise<KonfigurationsAntwort>

/** What {@link ladeKonfiguration} can be told; all of it may be left out. */
export interface KonfigurationOptionen {
  /** Replaces the network, for tests. */
  holen?: KonfigurationsHolen
  /** Where the page is served from, with a trailing slash. */
  basis?: string
  warnen?: (...argumente: unknown[]) => void
}

export async function ladeKonfiguration({
  holen = (adresse, optionen) => globalThis.fetch(adresse, optionen),
  basis = '/',
  warnen = (...argumente) => console.warn(...argumente),
}: KonfigurationOptionen = {}): Promise<KiKonfiguration> {
  let eingelesen: unknown = {}

  try {
    const antwort = await holen(`${basis}konfiguration.json`, { cache: 'no-cache' })
    // A server that answers a missing file with its start page must not be taken for the file.
    if (antwort.ok && /json/i.test(antwort.headers.get('content-type') ?? '')) {
      eingelesen = await antwort.json()
    }
  } catch (fehler) {
    warnen('konfiguration.json konnte nicht gelesen werden, es gelten die Standardwerte.', fehler)
  }

  return mitStandard(eingelesen)
}
