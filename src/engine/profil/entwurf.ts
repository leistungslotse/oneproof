/**
 * The draft of a profile that a department is working on.
 *
 * A draft is a `profil.json` that is not released yet. There is one per profile, and it remembers
 * the version it was made from. It lives in the browser of the person who makes it; the storage is
 * handed in (`localStorage` in the page, a stand-in in the tests), as everything outside the engine
 * is. The evidence check can run against a draft, so that a change can be tried before it goes out.
 *
 * Nothing here reaches other people: a draft is released by turning it into a new version of the
 * profile (see `sachbearbeitung/version.ts`), not by saving it.
 *
 * A draft may bring files of its own (`dateien`, by their path in the folder of a version): the
 * schema of an application type read from its XDF file, and — for a new profile, which has no
 * version to start from (`basis: null`) — the catalogue.
 */

import { ladeProfil, ProfilError } from './laden.ts'
import type { JsonLeser, Profil, ProfilRoh } from './laden.ts'

const PRAEFIX = 'oneproof.entwurf.'
/** The form a draft is kept in; drafts of form 1 (without files) are still read. */
const FORMAT = 2

/** What a draft consists of: the version it was made from, its `profil.json` and the files of its own. */
export interface EntwurfInhalt {
  /** The version it was made from, e.g. `2026-11-07`; `null` for a new profile. */
  basis: string | null
  /** Its `profil.json`. */
  profil: ProfilRoh
  /** Files of its own, by their path in the folder. */
  dateien?: Record<string, unknown>
}

/** The draft of a profile as it is kept. */
export interface Entwurf extends EntwurfInhalt {
  dateien: Record<string, unknown>
  /** ISO time. */
  gespeichertAm: string
}

/** The draft of a profile as a loaded profile, with the draft it comes from. */
export interface GeladenerEntwurf {
  profil: Profil
  entwurf: Entwurf
}

/** What the storage may hold under the key of a draft: parsed JSON, checked field by field before it is taken (`ladeEntwurf`). */
interface Gespeichert {
  format?: number
  basis?: string | null
  gespeichertAm?: string
  profil?: ProfilRoh
  dateien?: Record<string, unknown> | null
}

/** The version label a draft carries until it is released, so that no result passes for a released one. */
export const entwurfsVersion = (basis: string | null): string => (basis ? `${basis}-entwurf` : 'entwurf')

/** The folder a draft is read from: that of the version it was made from, a folder of its own for a new profile. */
export const ordnerDesEntwurfs = (id: string, basis: string | null, profile = '/profile/'): string =>
  `${profile}${id}/${basis ?? 'entwurf'}/`

/**
 * The reader of a profile, with the `profil.json` of one folder replaced by `roh` and the files of
 * a draft served in place of those of the folder.
 *
 * @param roh   the `profil.json` to serve in place of the one of the folder
 */
export const liesMitProfil =
  (lies: JsonLeser, ordner: string, roh: unknown, dateien: Record<string, unknown> = {}): JsonLeser =>
  (adresse) => {
    if (adresse === `${ordner}profil.json`) return Promise.resolve(roh)
    const pfad = adresse.startsWith(ordner) ? adresse.slice(ordner.length) : null
    if (pfad !== null && Object.hasOwn(dateien, pfad)) return Promise.resolve(dateien[pfad])
    return lies(adresse)
  }

/**
 * A draft made from the `profil.json` of a released version; of the same format as that.
 */
export const neuerEntwurf = <P extends ProfilRoh>(basisRoh: P): { basis: string; profil: P; dateien: Record<string, unknown> } => ({
  basis: basisRoh.version,
  profil: { ...structuredClone(basisRoh), version: entwurfsVersion(basisRoh.version) },
  dateien: {},
})

/**
 * The draft of a profile, or `null` if there is none or the storage holds something else.
 */
export function ladeEntwurf(speicher: Pick<Storage, 'getItem'> | null, id: string): Entwurf | null {
  try {
    const eintrag: Gespeichert | null = JSON.parse(speicher?.getItem(PRAEFIX + id) ?? 'null')
    if (!eintrag) return null
    const { format, basis, gespeichertAm, profil, dateien: mitgebracht } = eintrag
    const brauchbar =
      (format === 1 || format === FORMAT) &&
      (typeof basis === 'string' || (format === FORMAT && basis === null)) &&
      typeof gespeichertAm === 'string' &&
      profil?.id === id &&
      (profil.format === 2 ? Array.isArray(profil.antragsarten) : typeof profil.nachweisarten === 'object')
    if (!brauchbar) return null
    const dateien = mitgebracht && typeof mitgebracht === 'object' ? mitgebracht : {}
    return { basis, profil, gespeichertAm, dateien }
  } catch {
    return null
  }
}

/**
 * Keeps a draft. Says whether it worked: a browser may refuse (private window, full storage), and
 * the person has to know that the draft is then only in the page.
 */
export function speichereEntwurf(
  speicher: Pick<Storage, 'setItem'> | null,
  id: string,
  { basis, profil, dateien = {} }: EntwurfInhalt,
  jetzt = new Date(),
): boolean {
  if (speicher === null) return false
  try {
    speicher.setItem(PRAEFIX + id, JSON.stringify({ format: FORMAT, basis, gespeichertAm: jetzt.toISOString(), profil, dateien }))
    return true
  } catch {
    return false
  }
}

export function verwerfeEntwurf(speicher: Pick<Storage, 'removeItem'> | null, id: string): void {
  try {
    speicher?.removeItem(PRAEFIX + id)
  } catch {
    // Nothing to remove from a storage that cannot be reached.
  }
}

/**
 * The profiles that exist only as a draft in this browser: new ones, not yet released.
 */
export function neueProfileIm(speicher: Pick<Storage, 'getItem' | 'key' | 'length'> | null): { id: string; name: string }[] {
  const liste: { id: string; name: string }[] = []
  try {
    for (let nummer = 0; speicher !== null && nummer < speicher.length; nummer++) {
      const schluessel = speicher.key(nummer)
      if (!schluessel?.startsWith(PRAEFIX)) continue
      const entwurf = ladeEntwurf(speicher, schluessel.slice(PRAEFIX.length))
      if (entwurf && entwurf.basis === null) liste.push({ id: entwurf.profil.id, name: entwurf.profil.name ?? entwurf.profil.id })
    }
  } catch {
    // A storage that cannot be read has no drafts.
  }
  return liste
}

/**
 * The draft of a profile as a loaded profile, for the evidence check: its own `profil.json` and
 * files in place of those of the version it was made from, everything else from there.
 *
 * @param basis   where the profiles are served from
 * @throws {ProfilError} if there is no draft
 */
export async function ladeEntwurfAlsProfil(
  lies: JsonLeser,
  speicher: Pick<Storage, 'getItem'> | null,
  id: string,
  basis = '/profile/',
): Promise<GeladenerEntwurf> {
  const entwurf = ladeEntwurf(speicher, id)
  if (!entwurf) throw new ProfilError(`Für „${id}“ liegt in diesem Browser kein Entwurf der Fachabteilung vor.`)

  const ordner = ordnerDesEntwurfs(id, entwurf.basis, basis)
  const profil = await ladeProfil(liesMitProfil(lies, ordner, entwurf.profil, entwurf.dateien), ordner)
  return { profil, entwurf }
}
