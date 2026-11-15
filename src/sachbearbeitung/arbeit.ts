/**
 * The state a department works in: the released version a draft starts from, and the draft.
 *
 * Pure, like everything the page decides: which version to open, and how an edit turns the
 * released profile into a draft. The page only wires this to the browser.
 */

import type { ProfilFormat2 } from '../engine/profil/bedingungen.ts'
import { neuerEntwurf } from '../engine/profil/entwurf.ts'
import type { EntwurfInhalt } from '../engine/profil/entwurf.ts'
import { ProfilError } from '../engine/profil/laden.ts'
import type { ProfilIndexEintrag } from '../engine/profil/laden.ts'
import { dateienDerVersion } from './version.ts'
import type { Dateien } from './version.ts'

/** The draft the page works with: its profile is always in format 2. */
export interface ArbeitsEntwurf extends Omit<EntwurfInhalt, 'profil' | 'dateien'> {
  profil: ProfilFormat2
  /** Files of its own, by their path in the folder of a version. */
  dateien: Dateien
}

/** What the page works on: the released version a draft starts from (in format 2), and the draft. */
export interface Arbeitsstand {
  /** The `profil.json` of the released version; `null` for a new profile. */
  basisRoh: ProfilFormat2 | null
  entwurf: ArbeitsEntwurf | null
}

/** The released version a draft is made from. */
export interface Basis {
  version: string
  /** Where the version is served. */
  ordner: string
  /** The format of its `profil.json` as released; the page works in format 2. */
  format: 1 | 2
}

/** An edit of `bearbeiten.ts`, applied to the profile of the draft. */
export type Bearbeitung = (roh: ProfilFormat2) => ProfilFormat2

/** What `eintrag` and the draft make of the version to open. */
export interface Basiswahl {
  version: string
  /** A newer current version than the draft's: the draft is out of date. */
  neuere: string | null
  /** The draft was made from a version this profile does not list any more. */
  verwaist: boolean
}

/** What decides which version to open. */
export interface BasiswahlEingabe {
  /** The profile in `index.json`. */
  eintrag: Pick<ProfilIndexEintrag, 'aktuell' | 'versionen'>
  /** From the address. */
  gewuenscht?: string | null
  /** The draft kept in the browser. */
  entwurf: Pick<EntwurfInhalt, 'basis'> | null
}

/**
 * Which version of a profile to open.
 *
 * A draft is a change to the version it was made from, so it is opened on that version — also when
 * the profile has a newer one since. Without a draft: the version asked for, else the current one.
 */
export function waehleBasis({ eintrag, gewuenscht = null, entwurf }: BasiswahlEingabe): Basiswahl {
  const bekannt = (version: string | null | undefined): version is string => version != null && eintrag.versionen.includes(version)

  if (entwurf && bekannt(entwurf.basis)) {
    return { version: entwurf.basis, neuere: eintrag.aktuell > entwurf.basis ? eintrag.aktuell : null, verwaist: false }
  }
  return { version: bekannt(gewuenscht) ? gewuenscht : eintrag.aktuell, neuere: null, verwaist: entwurf != null }
}

/**
 * Applies an edit. The first edit that changes something makes the draft; an edit that changes
 * nothing (the same choice picked again) makes none. Files an edit brings along (the schema of an
 * application type read from its XDF file) are kept with the draft as long as the profile uses them.
 *
 * @param aenderung   an edit of `bearbeiten.ts`, applied to the profile
 * @param dateien   files to add, by their path in the folder of a version
 * @returns the same `stand` if nothing changed
 */
export function bearbeite(stand: Arbeitsstand, aenderung: Bearbeitung, dateien: Dateien | null = null): Arbeitsstand {
  const vorlage = stand.entwurf ?? (stand.basisRoh ? neuerEntwurf(stand.basisRoh) : null)
  if (!vorlage) throw new ProfilError('Es gibt weder einen Entwurf noch eine Version, die sich ändern ließe.')
  const profil = aenderung(vorlage.profil)
  const neueDateien = Object.keys(dateien ?? {}).length > 0
  if (profil === vorlage.profil && !neueDateien) return stand

  const alle = { ...(vorlage.dateien ?? {}), ...(dateien ?? {}) }
  const benutzt = new Set(dateienDerVersion(profil, alle))
  return { ...stand, entwurf: { ...vorlage, profil, dateien: Object.fromEntries(Object.entries(alle).filter(([pfad]) => benutzt.has(pfad))) } }
}

/** The profile the page shows and checks: the draft if there is one, else the released version. */
export const arbeitsprofil = ({ basisRoh, entwurf }: Arbeitsstand): ProfilFormat2 | null => entwurf?.profil ?? basisRoh
