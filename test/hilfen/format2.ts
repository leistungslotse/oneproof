// The Wohngeld profile in format 2, as the department's page works with it.
import type { Schema } from '../../src/engine/fim/schema.ts'
import type { ProfilFormat2 } from '../../src/engine/profil/bedingungen.ts'
import { ladeProfil } from '../../src/engine/profil/laden.ts'
import type { Profil, ProfilFormat1, Typ } from '../../src/engine/profil/laden.ts'
import { ausFormat1 } from '../../src/engine/profil/umstellung.ts'
import { lies, WOHNGELD } from './dateien.ts'

/** What `wohngeldFormat2` gives. */
export interface WohngeldFormat2 {
  /** The released profile as the engine loads it (format 1). */
  format1: Profil
  /** Its `profil.json`. */
  roh1: ProfilFormat1
  /** The same profile in format 2. */
  roh: ProfilFormat2
  /** The compact schemas of its application types, by their id. */
  schemas: Map<string, Schema>
  /** Its catalogue of document types. */
  typen: Map<string, Typ>
}

/** The released profile (format 1), its catalogue and schemas, and the same profile in format 2. */
export async function wohngeldFormat2(): Promise<WohngeldFormat2> {
  const format1 = await ladeProfil(lies, WOHNGELD)
  const roh1 = await lies<ProfilFormat1>(`${WOHNGELD}profil.json`)
  const schemas = new Map(
    await Promise.all(
      roh1.antragsarten.map(async (art): Promise<[string, Schema]> => [art.schema, await lies<Schema>(`${WOHNGELD}${art.datei}`)]),
    ),
  )
  const roh = ausFormat1(roh1, { schemas, typen: format1.typen })
  return { format1, roh1, roh, schemas, typen: format1.typen }
}

/** The part of `localStorage` the drafts use. */
export interface Speicherattrappe extends Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'> {
  /** What it holds, by key. */
  inhalt: Map<string, string>
}

/** A stand-in for `localStorage` that keeps what it is given in a map. */
export function speicher(): Speicherattrappe {
  const inhalt = new Map<string, string>()
  return {
    inhalt,
    get length() {
      return inhalt.size
    },
    key: (nummer) => [...inhalt.keys()][nummer] ?? null,
    getItem: (schluessel) => inhalt.get(schluessel) ?? null,
    setItem: (schluessel, wert) => inhalt.set(schluessel, String(wert)),
    removeItem: (schluessel) => inhalt.delete(schluessel),
  }
}

export const MIETZUSCHUSS = 'S01000000123'
export const LASTENZUSCHUSS = 'S01000000126'
