/**
 * From a draft to a new version of the profile.
 *
 * A profile is released as a folder `profile/<id>/<version>/` and an entry in `profile/index.json`
 * (see `docs/pruefprofile.md`). The page cannot write either — it is a static site — so it makes
 * the files: a package that is unpacked on the server, to be released with the next build.
 *
 * A version is named by a date, `2026-11-07`, as the interface names it (`wohngeld@2026-11-07`).
 * Everything here is pure; the files and the clock are handed in.
 */

import { dateiVon, ladeSchemataNeben, verweiseVon } from '../engine/oneproof/schema.ts'
import { formatVon } from '../engine/profil/laden.ts'
import type { ProfilIndexEintrag, ProfilRoh } from '../engine/profil/laden.ts'
import type { ZipDatei } from './zip.ts'

export const VERSIONSMUSTER = /^\d{4}-\d{2}-\d{2}$/

/** `profile/index.json`: the profiles the installation offers, with their versions. */
export interface ProfilIndex {
  profile: ProfilIndexEintrag[]
}

/** The files of a draft that its profile brings along, by their path in the folder of a version. */
export type Dateien = Record<string, unknown>

const alsTag = (datum: Date): string =>
  `${datum.getFullYear()}-${String(datum.getMonth() + 1).padStart(2, '0')}-${String(datum.getDate()).padStart(2, '0')}`

/** The day after `tag` (`2026-12-31` → `2027-01-01`). */
function naechsterTag(tag: string): string {
  // A part that is missing is `NaN` in the arithmetic below, as it always was.
  const [jahr = NaN, monat = NaN, tagImMonat = NaN] = tag.split('-').map(Number)
  return new Date(Date.UTC(jahr, monat - 1, tagImMonat + 1)).toISOString().slice(0, 10)
}

/** Is it a day that exists? (`2026-02-30` is not.) */
function istEchterTag(tag: string): boolean {
  const [jahr = NaN, monat = NaN, tagImMonat = NaN] = tag.split('-').map(Number)
  const datum = new Date(Date.UTC(jahr, monat - 1, tagImMonat))
  return datum.getUTCFullYear() === jahr && datum.getUTCMonth() === monat - 1 && datum.getUTCDate() === tagImMonat
}

/**
 * The version to propose: today — unless a version of today or later exists, then the day after
 * the latest one. A version is never proposed twice.
 */
export function schlageVersionVor(vorhandene: readonly string[], heute = new Date()): string {
  const juengste = [...vorhandene].sort().at(-1)
  const tag = alsTag(heute)
  return juengste !== undefined && juengste >= tag ? naechsterTag(juengste) : tag
}

/**
 * What is wrong with a version name, in words — or `null` if it can be used.
 */
export function pruefeVersion(version: string, vorhandene: readonly string[]): string | null {
  if (!VERSIONSMUSTER.test(version) || !istEchterTag(version)) {
    return 'Bitte ein Datum angeben, an dem die Version gelten soll, etwa 2026-11-07.'
  }
  if (vorhandene.includes(version)) return `Die Version ${version} gibt es schon. Pro Tag ist eine Version möglich.`
  return null
}

/**
 * The index with a new version entered, and — if asked — made the current one. A new profile
 * (`neu` with its name) is entered with its first version as the current one.
 *
 * @throws {Error} for a profile the index does not have, or a version it already has
 */
export function indexMitVersion(index: ProfilIndex, id: string, version: string, alsAktuell: boolean, neu: { name: string } | null = null): ProfilIndex {
  const eintrag = index.profile.find((kandidat) => kandidat.id === id)
  if (!eintrag && neu) return { ...index, profile: [...index.profile, { id, name: neu.name, aktuell: version, versionen: [version] }] }
  if (!eintrag) throw new Error(`Das Profil „${id}“ steht nicht im Index.`)
  if (eintrag.versionen.includes(version)) throw new Error(`Die Version ${version} steht schon im Index.`)

  return {
    ...index,
    profile: index.profile.map((kandidat) =>
      kandidat.id === id
        ? { ...kandidat, aktuell: alsAktuell ? version : kandidat.aktuell, versionen: [...kandidat.versionen, version].sort() }
        : kandidat,
    ),
  }
}

/** JSON the way the files of the profiles are written: two spaces, a newline at the end. */
export const formatiereJson = (wert: unknown): string => `${JSON.stringify(wert, null, 2)}\n`

/** The index as `index.json` is written: like `formatiereJson`, but a list of names on one line. */
export function formatiereIndex(index: unknown): string {
  return formatiereJson(index).replace(/\[\n\s+("(?:[^"\\]|\\.)*"(?:,\n\s+"(?:[^"\\]|\\.)*")*)\n\s*\]/g, (_, innen: string) => `[${innen.replace(/,\n\s+/g, ', ')}]`)
}

/**
 * A draft as the profile of a version: with the version it is released as, and the text for the
 * applicant without the spaces it was typed with.
 */
export function fuerVersion<R extends ProfilRoh>(roh: R, version: string): R {
  const neu = structuredClone(roh)
  neu.version = version
  const texte: { hinweis?: string }[] = [
    ...Object.values(neu.nachweisarten ?? {}),
    // An application type of format 1 has no places.
    ...(neu.antragsarten ?? []).flatMap((antragsart) => ('stellen' in antragsart ? (antragsart.stellen ?? []) : []).flatMap((stelle) => stelle.bedingungen ?? [])),
  ]
  for (const definition of texte) {
    if (typeof definition.hinweis !== 'string') continue
    const text = definition.hinweis.trim()
    if (text === '') delete definition.hinweis
    else definition.hinweis = text
  }
  return neu
}

/**
 * The files of a version besides `profil.json`, as paths inside its folder: catalogue, schemas,
 * mappings. An application type in the OneProof Format names only the schema of its benefit; the
 * schemas that one refers to (the frame) are counted where its content is at hand in `dateien`,
 * as for a draft that brought it along. {@link alleDateienDerVersion} reads them all.
 *
 * @param dateien   files of a draft, by path
 */
export function dateienDerVersion(roh: ProfilRoh, dateien: Dateien = {}): string[] {
  const pfade = [roh.dokumenttypen]
  for (const art of roh.antragsarten ?? []) {
    pfade.push(art.datei, ...Object.values(art.abbildungen ?? {}))
    if (formatVon(art) === 'oneproof') pfade.push(...verwiesen(art.datei, dateien))
  }
  return [...new Set(pfade.filter(Boolean))]
}

/** The schemas a schema of the OneProof Format refers to, next to it, as far as `dateien` holds them. */
function verwiesen(datei: string, dateien: Dateien): string[] {
  const ordner = datei.split('/').slice(0, -1)
  const gefunden: string[] = []
  const offen = [datei]
  for (let aktuell = offen.shift(); aktuell !== undefined; aktuell = offen.shift()) {
    const schema = dateien[aktuell]
    for (const urn of schema ? verweiseVon(schema) : []) {
      const name = dateiVon(urn)
      const pfad = [...ordner, name].join('/')
      if (!name || gefunden.includes(pfad)) continue
      gefunden.push(pfad)
      offen.push(pfad)
    }
  }
  return gefunden
}

/**
 * All files of a version besides `profil.json`: {@link dateienDerVersion}, and the schemas the
 * schemas of the OneProof Format refer to, read where the draft does not hold them.
 *
 * @param lies   a file of the version as JSON
 */
export async function alleDateienDerVersion(roh: ProfilRoh, lies: (pfad: string) => Promise<unknown>): Promise<string[]> {
  const pfade = dateienDerVersion(roh)
  for (const art of roh.antragsarten ?? []) {
    if (formatVon(art) === 'oneproof') pfade.push(...(await ladeSchemataNeben(lies, art.datei)).dateien)
  }
  return [...new Set(pfade)]
}

/** What a package of a version is made from. */
export interface VersionspaketEingabe {
  /** The draft's `profil.json`. */
  roh: ProfilRoh
  id: string
  version: string
  /** `profile/index.json` as it is now. */
  index: ProfilIndex
  alsAktuell: boolean
  /** Where the version it was made from is served; `null` for a new profile. */
  ordner: string | null
  holeDatei: (adresse: string) => Promise<Uint8Array>
  /** Files of the draft: a schema read from its XDF file, a catalogue. */
  dateien?: Dateien
}

/**
 * The files of the package: the folder of the new version, complete — a version is self-contained,
 * so that a result stays reproducible — and the updated index.
 *
 * @returns the files; their paths start with `profile/`
 */
export async function baueVersionspaket({ roh, id, version, index, alsAktuell, ordner, holeDatei, dateien = {} }: VersionspaketEingabe): Promise<ZipDatei[]> {
  const ziel = `profile/${id}/${version}/`
  const alsJson = async (pfad: string): Promise<unknown> => (Object.hasOwn(dateien, pfad) ? dateien[pfad] : JSON.parse(new TextDecoder().decode(await holeDatei(`${ordner}${pfad}`))))
  const uebernommen = await Promise.all(
    (await alleDateienDerVersion(roh, alsJson)).map(async (pfad) => ({
      name: `${ziel}${pfad}`,
      inhalt: Object.hasOwn(dateien, pfad) ? formatiereJson(dateien[pfad]) : await holeDatei(`${ordner}${pfad}`),
    })),
  )
  const neu = index.profile.some((eintrag) => eintrag.id === id) ? null : { name: roh.name ?? id }

  return [
    { name: `${ziel}profil.json`, inhalt: formatiereJson(fuerVersion(roh, version)) },
    ...uebernommen,
    { name: 'profile/index.json', inhalt: formatiereIndex(indexMitVersion(index, id, version, alsAktuell, neu)) },
  ]
}
