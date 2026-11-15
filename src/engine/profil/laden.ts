/**
 * Loading and normalising an evidence profile.
 *
 * A profile is data, not code: it says which application types it covers (FIM schemas), where in
 * them evidence belongs (`stellen`), which document types prove which statement and how well
 * (`nachweisarten[...].quellen`). Everything the engine knows about a benefit is in here — a further
 * benefit needs a further folder under `public/profile/`, not further code.
 *
 * Files are read through an injected `lies(path)` that returns parsed JSON, so that the same code
 * runs in the browser (fetch) and in tests (file system).
 *
 * Format 2 (`bedingungen.ts`) states a complete profile per application type; it is translated
 * into the statements and places described here when it is loaded.
 */

import type { Schema } from '../fim/schema.ts'
import { istObjekt } from '../json.ts'
import { kompaktesSchema, ladeSchemataNeben } from '../oneproof/schema.ts'
import type { JsonSchemataNeben } from '../oneproof/schema.ts'
import { uebersetze } from './bedingungen.ts'
import type { ProfilFormat2, StelleFormat2 } from './bedingungen.ts'

/* ---------------------------------------------------------------------------------------------
 * Types: what the files of a profile hold, and what a loaded profile is
 * ------------------------------------------------------------------------------------------- */

/**
 * Reads a file of a profile by its path and hands it over parsed: the browser fetches it, the
 * tests read it from the file system. What the file holds is for the caller to say.
 */
export type JsonLeser = (pfad: string) => Promise<unknown>

/** How well a document type establishes the statement it is used for. */
export const ROLLE = Object.freeze({
  /** Sufficient on its own. */
  GENUEGT: 'genuegt',
  /** May be sufficient, but whether the content fits cannot be established automatically. */
  PRUEFEN: 'pruefen',
  /** Supports the statement, but is not enough on its own. */
  ERGAENZT: 'ergaenzt',
})

/** A value of {@link ROLLE}. */
export type Rolle = (typeof ROLLE)[keyof typeof ROLLE]

/** The format of an application type: FIM (XML data schema) or the OneProof Format (JSON Schema). */
export type Antragsformat = 'fim' | 'oneproof'

/**
 * A question of the application whose answer decides whether a place asks for evidence: the field
 * of a FIM schema (`F…`) or the place of an application in the OneProof Format (a pattern like
 * `/fachdaten/wohnraum/wohnverhaeltnis`), with the answers (codes) that state the fact.
 */
export interface Frage {
  feld: string
  /** The answers that state the fact: the place asks for evidence. */
  ja?: string[]
  /** The answers that say it does not apply. */
  nein?: string[]
  /** The answers that leave it open for now ("I will submit it later"). */
  spaeter?: string[]
  /** The question is answered by the field being filled, not by a code. */
  gefuellt?: boolean
}

/** What names a fact of an application: `"immer"`, one question, or a list of questions read as "or". */
export type Nennt = 'immer' | Frage | Frage[]

/** Features of a document or of a place: the name of a feature and its value, or the values that fit. */
export type Merkmale = Record<string, string | string[]>

/** A feature of a place read from a field of the application (by a code table, as an amount in cent, or as it stands). */
export interface MerkmalAusFeld {
  name: string
  feld: string
  /** The code table of the profile (`wertetabellen`) that translates the answer into the types it stands for. */
  tabelle?: string
  /** The answer is an amount, compared in cent. */
  als?: 'cent'
}

/** A feature a place has by itself, without a field of the application to read it from. */
export interface MerkmalFest {
  name: string
  wert: string | string[]
}

/** Where a feature of a place comes from: a field of the application, or the place itself. */
export type Merkmalsquelle = MerkmalAusFeld | MerkmalFest

/** How many months of evidence a statement needs, and of which types. */
export interface Abdeckung {
  einheit: 'monat'
  mindestens: number
  /** How old the oldest month may be at most, counted in months. */
  hoechstensAlt?: number
  /** The document types the months are counted for. */
  fuer: string[]
  /** The period is a proposal that stands for what the authority names. */
  beispiel?: boolean
}

/** A coarser statement a document may count for where the application states no fact of the exact one. */
export interface Groebere {
  art: string
  rolle?: Rolle
}

/** A document type of a statement in its full form. */
export interface QuellenEintrag {
  rolle: Rolle
  merkmale?: Merkmale
  /** The coarser statement: its `art`, or `art` and the role there. */
  groebere?: string | Groebere
}

/** A document type of a statement: its role alone, or in full. */
export type Quellenangabe = Rolle | QuellenEintrag

/** A statement of the engine ("the amount of the rent") with the document types that establish it. */
export interface Nachweisart {
  titel: string
  /** What the applicant reads while the evidence is missing. */
  hinweis?: string
  /** The document types that establish it, by catalogue key. */
  quellen: Record<string, Quellenangabe>
  abdeckung?: Abdeckung
}

/** What a code of a table stands for: a short name, and the document types of an income of that kind. */
export interface Wertzeile {
  kurz: string
  typen: string[]
}

/** Code tables of the profile: table → code → what it stands for. */
export type Wertetabellen = Record<string, Record<string, Wertzeile>>

/** The fields of a FIM schema that hold the name of a person. */
export interface NamensBindung {
  /** The groups from the person's group down to the group that holds the name fields. */
  pfad: string[]
  nachname: string
  vorname: string
  geburtsname?: string
}

/** A kind of person of an application in a FIM schema: its group and where its name stands. */
export interface PersonBindung {
  gruppe: string
  name: NamensBindung
  /** How the person is called in a result. */
  bezeichnung: string
}

/**
 * Who the persons of a FIM application are, by role: `antragsteller` (the applicant, a group that
 * occurs once) and `mitglieder` (the members of the household, a repeated group).
 */
export type Personen = Record<string, PersonBindung>

/** For an application type: its persons, the field that dates it, and the sentences about the applicant's situation. */
export interface Anbindung {
  personen: Personen
  /** The field of the schema that dates the application; `null` if none does. */
  stichtag: string | null
  /** Sentences about the situation of the applicant for the grouping model, with placeholders. */
  antragslage: string[]
}

/** For each version of a schema: field id → old code → new code (code lists whose codes changed). */
export type WerteAbbildungen = Record<string, Record<string, Record<string, string>>>

/** An application type of a profile, as `profil.json` lists it. */
export interface Antragsart {
  /** The id of the FIM schema (`S…`), or `oneproof:<benefit>` for the OneProof Format. */
  schema: string
  version: string
  name: string
  /** The file of its schema, relative to the folder of the profile version. */
  datei: string
  /** `'oneproof'` for the OneProof Format; FIM where it says nothing. */
  format?: 'oneproof'
  /** Older versions of the schema: version → file with the dictionary old id → new id. */
  abbildungen?: Record<string, string>
  /** Corrections to those dictionaries: version → old id → new id. */
  abbildungKorrekturen?: Record<string, Record<string, string>>
  /** Where this application type keeps its persons, where it differs from the profile. */
  personen?: Personen
  /** The field that dates this application type, where it differs from the profile (`null`: none). */
  stichtag?: string | null
  /** Sentences about the situation of the applicant, where they differ from the profile. */
  antragslage?: string[]
  /** Format 2 only: the places of evidence of this application type with their conditions. */
  stellen?: StelleFormat2[]
}

/** A place of evidence of format 1, as `profil.json` lists it. */
export interface StelleFormat1 {
  id: string
  /** The statement (`nachweisarten`) the place belongs to. */
  art: string
  /** The place: `group/field` in FIM, a pattern in the OneProof Format — a list where the schemas keep the field elsewhere. */
  position: string | string[]
  bereich: string
  titel: string
  /** A sentence with placeholders that says what the application states there. */
  aussage?: string
  nennt?: Nennt
  /** The place takes every document that fits no other place. */
  auffang?: boolean
  /** The question alone decides, not the existence of an optional group. */
  nurFrage?: boolean
  /** One requirement for the household, though the schema asks per person. */
  einmal?: boolean
  hinweis?: string
  merkmale?: Merkmalsquelle[]
  /** Only where format 2 is translated: the application types the place belongs to. */
  antragsarten?: string[]
}

/**
 * A place of the profile in the form the engine reads:
 *
 *  - `positionen`: the position or the list of positions, always as a list,
 *  - `nennt`: `"immer"`, one question, or a list of questions read as "or",
 *  - `nurFrage`: the question alone decides, not the existence of an optional group,
 *  - `einmal`: one requirement for the household, though the schema asks per person.
 */
export interface Stelle extends StelleFormat1 {
  positionen: string[]
  auffang: boolean
  nurFrage: boolean
  einmal: boolean
  merkmale: Merkmalsquelle[]
}

/** What `profil.json` of every format holds at its head. */
export interface ProfilKopf {
  id: string
  version: string
  name: string
  beschreibung?: string
  hinweis?: string
  /** The two letters a file number begins with; the first two letters of the `id` where it says nothing. */
  aktenzeichenPraefix?: string
  /** The file of the catalogue of document types, next to `profil.json`. */
  dokumenttypen: string
  werteAbbildungen?: WerteAbbildungen
  personen?: Personen
  stichtag?: string | null
  antragslage?: string[]
  wertetabellen?: Wertetabellen
}

/** `profil.json` of format 1: statements (`nachweisarten`) and places (`stellen`) for all application types together. */
export interface ProfilFormat1 extends ProfilKopf {
  format: 1
  antragsarten: Antragsart[]
  nachweisarten: Record<string, Nachweisart>
  stellen: StelleFormat1[]
  /** File fields of the schemas that knowingly have no place in the profile, with the reason. */
  bekanntOffen?: Record<string, string>
}

/** `profil.json` of either format. */
export type ProfilRoh = ProfilFormat1 | ProfilFormat2

/** An entry of the catalogue of document types as `dokumenttypen.json` has it. */
export interface Dokumenttyp {
  /** How the type is called for a person. */
  label: string
  /** What a document of the type is and how to tell it from others, for the model. */
  description: string
  /** What the model reads from a document of the type: name of the field → what is asked. */
  fields?: Record<string, string>
  /** Types the model often mistakes this one for. */
  confusions?: { type: string; requires: string[]; unless: string[] }[]
  match_against?: string[]
  /** The model lists the entries of a table (a bank statement) instead of single fields. */
  extract?: string
  transaction_fields?: Record<string, string>
}

/** The catalogue of document types by key (`payslip`, `rent_contract`, …). */
export type Katalog = Record<string, Dokumenttyp>

/** A document type of the catalogue together with its key. */
export interface Typ extends Dokumenttyp {
  key: string
}

/** One use of a document type: for which statement it counts, and how well. */
export interface Verwendung {
  /** The statement (`nachweisarten`). */
  art: string
  rolle: Rolle
  /** The features that tell which entries the document fits ("a pension notice fits no row of wages"). */
  merkmale: Merkmale
  /** The coarser statement where the application states no fact of the exact one, else `null`. */
  groebere: string | null
  /** The role at the coarser statement. */
  rolleGroeber: Rolle
}

/** The uses of every document type, by catalogue key. */
export type Verwendungen = Map<string, Verwendung[]>

/** A document type that establishes a statement, with its role there: the answer to "what is accepted for this?". */
export interface Quelle {
  typ: string
  label: string
  rolle: Rolle
  /** The statement is the exact one of the use, not its coarser one. */
  genau: boolean
  merkmale: Merkmale
}

/** An entry of `public/profile/index.json`: a profile the installation offers. */
export interface ProfilIndexEintrag {
  id: string
  name: string
  /** The version a check uses unless it names one. */
  aktuell: string
  versionen: string[]
}

/** A loaded profile: `profil.json` normalised, the catalogue of document types, and what is read on demand. */
export interface Profil {
  id: string
  version: string
  /** `id@version`: what a check names so that its result stays reproducible. */
  kennung: string
  name: string
  beschreibung: string
  hinweis: string
  /** The two letters a file number of this application type begins with, e.g. `WG-2026-…`. */
  aktenzeichenPraefix: string
  /** The folder of the profile version, e.g. `/profile/wohngeld/2026-11-07/`. */
  ordner: string
  format: 1 | 2
  /** The `profil.json` as it stands. */
  roh: ProfilRoh
  antragsarten: Antragsart[]
  personen: Personen
  wertetabellen: Wertetabellen
  /** The statements; in format 2 as translated by `uebersetze`. */
  nachweisarten: Record<string, Nachweisart>
  stellen: Stelle[]
  /** Sentences about the situation of the applicant for the grouping model, with placeholders. */
  antragslage: string[]
  /**
   * The field that dates the application (e.g. the time the message was created). How recent
   * evidence must be is measured from that day, not from the day of the check.
   */
  stichtag: string | null
  /** File fields of the schemas that knowingly have no place in the profile, with the reason. */
  bekanntOffen: Record<string, string>
  typen: Map<string, Typ>
  /** The catalogue as it stands in the file (object by type key), for the grouping steps. */
  katalog: Katalog
  /** Every use is the profile's: the catalogue only describes documents. */
  verwendungen: Verwendungen
  /** For every statement: the document types that establish it. */
  quellenJeArt: Map<string, Quelle[]>

  /**
   * The uses of every document type for an application of this type. In format 2 every
   * application type is a profile of its own: what another one accepts does not count here.
   */
  verwendungenFuer(schemaId: string): Verwendungen

  /**
   * Who the persons of an application are, which field dates it and what the sentences about the
   * situation of the applicant read. An application type may say so itself where its schema keeps
   * them elsewhere than the others of the profile. In the OneProof Format the frame fixes the
   * persons (`personen`, with their roles): there is nothing to bind.
   */
  anbindungFuer(schemaId: string): Anbindung

  /**
   * The compact schema of one application type, loaded on demand: the file itself for FIM, made
   * from the JSON Schema for the OneProof Format (`oneproof/schema.ts`). `null` for an application
   * type the profile does not have.
   */
  ladeSchema(schemaId: string): Promise<Schema | null>

  /**
   * The JSON Schema of an application type in the OneProof Format, with every schema it refers to
   * (the frame). They lie next to each other in the folder of the file the application type names.
   * `null` for any other application type.
   */
  ladeJsonSchema(schemaId: string): Promise<JsonSchemataNeben | null>

  /**
   * Dictionary old id → new id for an application written in an older schema version: the file
   * of the publisher, with the corrections the profile makes to it (`abbildungKorrekturen`).
   * `null` where the profile has none for that version.
   */
  ladeAbbildung(schemaId: string, version: string): Promise<Record<string, string> | null>

  /**
   * Values to translate for an application in an older schema version, by new field id: code
   * lists whose codes changed (`"04"` → `"004"`). Empty where nothing changed.
   */
  werteAbbildung(version: string): Record<string, Record<string, string>>
}

/* ---------------------------------------------------------------------------------------------
 * Loading
 * ------------------------------------------------------------------------------------------- */

/** The format of an application type: FIM (XML), unless it says it is the OneProof Format (JSON). */
export const formatVon = (antragsart: Pick<Antragsart, 'format'> | null | undefined): Antragsformat =>
  antragsart?.format === 'oneproof' ? 'oneproof' : 'fim'

/** The roles the engine knows; a validator asks it about whatever a profile says. */
const ROLLEN: ReadonlySet<unknown> = new Set(Object.values(ROLLE))

export class ProfilError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProfilError'
  }
}

/** `public/profile/index.json`: the list of profiles the installation offers. */
export async function ladeProfilIndex(lies: JsonLeser, basis = '/profile/'): Promise<ProfilIndexEintrag[]> {
  const index = await lies(`${basis}index.json`)
  if (!istObjekt(index) || !Array.isArray(index.profile)) throw new ProfilError('Der Profilindex ist ungültig.')
  // The index is a file of the installation, and its list is what `ladeProfilNachKennung` reads: id, aktuell, versionen.
  return index.profile as ProfilIndexEintrag[]
}

/**
 * Loads a profile by its name: `wohngeld` for the current version, `wohngeld@2026-11-07` for a
 * given one. A check always names the version it ran against, so that its result stays
 * reproducible when the profile is changed later.
 *
 * @param kennung  `id` or `id@version`
 */
export async function ladeProfilNachKennung(lies: JsonLeser, kennung: string, basis = '/profile/'): Promise<Profil> {
  const [id = '', version] = String(kennung).split('@')
  const eintrag = (await ladeProfilIndex(lies, basis)).find((kandidat) => kandidat.id === id)
  if (!eintrag) throw new ProfilError(`Das Profil „${id}“ gibt es nicht.`)

  const gewaehlt = version ?? eintrag.aktuell
  if (!eintrag.versionen?.includes(gewaehlt)) {
    throw new ProfilError(`Das Profil „${id}“ gibt es nicht in der Version ${gewaehlt}.`)
  }
  return ladeProfil(lies, `${basis}${id}/${gewaehlt}/`)
}

/**
 * @param ordner  folder of the profile version, e.g. `/profile/wohngeld/2026-11-07/`
 */
export async function ladeProfil(lies: JsonLeser, ordner: string): Promise<Profil> {
  const gelesen = await lies(`${ordner}profil.json`)
  const format = istObjekt(gelesen) ? gelesen.format : undefined
  if (format !== 1 && format !== 2) throw new ProfilError(`Unbekanntes Profilformat „${format}“.`)
  // The profile is a file of the installation or the draft of a department: the format is vouched for
  // right here, the rest is for `validiereProfil`. Everything below works with the declared type.
  const roh = gelesen as ProfilRoh

  // Format 2 lists conditions per application type; the engine reads them as statements and places.
  const uebersetzt = roh.format === 2 ? uebersetze(roh) : null
  const nachweisarten = uebersetzt?.nachweisarten ?? roh.nachweisarten ?? {}
  const personen = roh.personen ?? {}
  const stichtag = typeof roh.stichtag === 'string' && roh.stichtag !== '' ? roh.stichtag : null

  // The catalogue is an object keyed by document type. It is a file of the profile folder, checked by `validiereProfil`.
  const katalog = (await lies(`${ordner}${roh.dokumenttypen}`)) as Katalog
  const typen = new Map(Object.entries(katalog).map(([key, typ]): [string, Typ] => [key, { key, ...typ }]))
  const verwendungen = verwendungenAus(nachweisarten, typen)

  const schemaCache = new Map<string, Promise<Schema>>()
  const jsonSchemaCache = new Map<string, Promise<JsonSchemataNeben>>()
  const abbildungCache = new Map<string, Promise<Record<string, string>>>()
  const antragsartVon = (schemaId: string): Antragsart | undefined => roh.antragsarten.find((kandidat) => kandidat.schema === schemaId)
  const verwendungenJeAntragsart = new Map<string, Verwendungen>()

  const profil: Profil = {
    id: roh.id,
    version: roh.version,
    kennung: `${roh.id}@${roh.version}`,
    name: roh.name,
    beschreibung: roh.beschreibung ?? '',
    hinweis: roh.hinweis ?? '',
    aktenzeichenPraefix: roh.aktenzeichenPraefix ?? roh.id.slice(0, 2).toUpperCase(),
    ordner,
    format: roh.format,
    roh,
    antragsarten: roh.antragsarten,
    personen,
    wertetabellen: roh.wertetabellen ?? {},
    nachweisarten,
    stellen: (uebersetzt?.stellen ?? roh.stellen ?? []).map(normalisiereStelle),
    antragslage: Array.isArray(roh.antragslage) ? roh.antragslage : [],
    stichtag,
    bekanntOffen: uebersetzt?.bekanntOffen ?? roh.bekanntOffen ?? {},
    typen,
    katalog,
    // Every use is the profile's: the catalogue only describes documents.
    verwendungen,

    verwendungenFuer(schemaId) {
      if (!uebersetzt) return profil.verwendungen
      let jeArt = verwendungenJeAntragsart.get(schemaId)
      if (!jeArt) {
        const arten = uebersetzt.artenJeAntragsart.get(schemaId) ?? new Set<string>()
        jeArt = new Map(
          [...profil.verwendungen].map(([typ, liste]): [string, Verwendung[]] => [
            typ,
            liste.filter((verwendung) => arten.has(verwendung.art)),
          ]),
        )
        verwendungenJeAntragsart.set(schemaId, jeArt)
      }
      return jeArt
    },

    anbindungFuer(schemaId) {
      const art = antragsartVon(schemaId)
      const oneproof = formatVon(art) === 'oneproof'
      return {
        personen: art?.personen ?? (oneproof ? {} : personen),
        stichtag: art && Object.hasOwn(art, 'stichtag') ? art.stichtag || null : oneproof ? null : stichtag,
        antragslage: Array.isArray(art?.antragslage) ? art.antragslage : oneproof ? [] : profil.antragslage,
      }
    },

    async ladeSchema(schemaId) {
      const art = antragsartVon(schemaId)
      if (!art) return null
      let geladen = schemaCache.get(schemaId)
      if (!geladen) {
        geladen =
          formatVon(art) === 'oneproof'
            ? profil.ladeJsonSchema(schemaId).then((schemata) => {
                // Cannot happen: the application type is of the OneProof Format, as `ladeJsonSchema` asks, too.
                if (!schemata) throw new Error(`Das JSON Schema der Antragsart ${schemaId} fehlt.`)
                return kompaktesSchema(schemata)
              })
            : // The compact schema is a file of the profile folder, checked by `validiereProfil`.
              (lies(`${ordner}${art.datei}`) as Promise<Schema>)
        schemaCache.set(schemaId, geladen)
      }
      return geladen
    },

    async ladeJsonSchema(schemaId) {
      const art = antragsartVon(schemaId)
      if (!art || formatVon(art) !== 'oneproof') return null
      let geladen = jsonSchemaCache.get(schemaId)
      if (!geladen) {
        geladen = ladeSchemataNeben((pfad) => lies(`${ordner}${pfad}`), art.datei)
        jsonSchemaCache.set(schemaId, geladen)
      }
      return geladen
    },

    async ladeAbbildung(schemaId, version) {
      const art = antragsartVon(schemaId)
      const datei = art?.abbildungen?.[version]
      if (!art || !datei) return null
      const schluessel = `${schemaId}@${version}`
      let geladen = abbildungCache.get(schluessel)
      if (!geladen) {
        const korrekturen = art.abbildungKorrekturen?.[version] ?? {}
        // The dictionary of the publisher is a file of the profile folder.
        geladen = (lies(`${ordner}${datei}`) as Promise<Record<string, string>>).then((abbildung) => ({ ...abbildung, ...korrekturen }))
        abbildungCache.set(schluessel, geladen)
      }
      return geladen
    },

    werteAbbildung(version) {
      return roh.werteAbbildungen?.[version] ?? {}
    },

    quellenJeArt: quellenJeArt(verwendungen, typen),
  }

  return profil
}

function normalisiereStelle(stelle: StelleFormat1): Stelle {
  return {
    ...stelle,
    positionen: Array.isArray(stelle.position) ? stelle.position : [stelle.position],
    auffang: stelle.auffang === true,
    nurFrage: stelle.nurFrage === true,
    einmal: stelle.einmal === true,
    merkmale: stelle.merkmale ?? [],
  }
}

/** `groebere` as the art alone or as `{art, rolle}`. Landing at the coarser art supports, by default. */
function groebereAus(angabe: string | Groebere | null): { groebere: string | null; rolleGroeber: Rolle } {
  if (!angabe) return { groebere: null, rolleGroeber: ROLLE.ERGAENZT }
  if (typeof angabe === 'string') return { groebere: angabe, rolleGroeber: ROLLE.ERGAENZT }
  return { groebere: angabe.art ?? null, rolleGroeber: angabe.rolle ?? ROLLE.ERGAENZT }
}

/**
 * The effective uses of every document type: where it may be placed and in which role.
 *
 * Only what the profile names counts. A type named under `nachweisarten[...].quellen` is used
 * exactly as stated there, with the features and the coarser statement written there; a type named
 * nowhere has no use. The catalogue only describes documents and serves every benefit alike: which
 * statement a type proves, and with which features, is for the profile to say.
 *
 * A use may name a coarser art for where the application states no fact of the exact one (a loan
 * contract without a loan in the application lands at the property). There it only supports the
 * statement unless the profile says otherwise (`groebere: {art, rolle}`): that the application
 * states the coarser fact does not make the document prove it.
 *
 * @param typen  the catalogue; only its keys count
 */
export function verwendungenAus(nachweisarten: Record<string, Nachweisart>, typen: ReadonlyMap<string, unknown>): Verwendungen {
  const ausdruecklich: Verwendungen = new Map()

  for (const [art, definition] of Object.entries(nachweisarten)) {
    for (const [typ, angabe] of Object.entries(definition.quellen ?? {})) {
      const eintrag: QuellenEintrag = typeof angabe === 'string' ? { rolle: angabe } : angabe
      const verwendung: Verwendung = {
        art,
        rolle: eintrag.rolle,
        merkmale: eintrag.merkmale ?? {},
        ...groebereAus(eintrag.groebere ?? null),
      }
      ausdruecklich.set(typ, [...(ausdruecklich.get(typ) ?? []), verwendung])
    }
  }

  const alle: Verwendungen = new Map()
  for (const typ of typen.keys()) alle.set(typ, ausdruecklich.get(typ) ?? [])

  // Types a profile names but the catalogue does not know stay usable (their label is the key).
  for (const [typ, verwendungen] of ausdruecklich) if (!alle.has(typ)) alle.set(typ, verwendungen)

  return alle
}

/**
 * For every art: the document types that establish it, with their role and label — the answer to
 * "what is accepted for this statement?", for display and for the profile documentation.
 *
 * A use with a coarser art counts for that art too: a rent increase notice is the exact proof of a
 * rent change and, where the application states none, still a proof of the rent.
 */
export function quellenJeArt(verwendungen: Verwendungen, typen: ReadonlyMap<string, Pick<Dokumenttyp, 'label'>>): Map<string, Quelle[]> {
  const jeArt = new Map<string, Quelle[]>()

  for (const [typ, liste] of verwendungen) {
    for (const verwendung of liste) {
      for (const art of [verwendung.art, verwendung.groebere].filter((kandidat): kandidat is string => Boolean(kandidat))) {
        const genau = art === verwendung.art
        const rolle = genau ? verwendung.rolle : (verwendung.rolleGroeber ?? ROLLE.ERGAENZT)
        // The features tell which entries a type fits: a pension notice fits no row of wages.
        const merkmale = genau ? (verwendung.merkmale ?? {}) : {}
        const eintrag: Quelle = { typ, label: typen.get(typ)?.label ?? typ, rolle, genau, merkmale }
        const vorhanden = jeArt.get(art) ?? []
        if (!vorhanden.some((kandidat) => kandidat.typ === typ)) jeArt.set(art, [...vorhanden, eintrag])
      }
    }
  }

  return jeArt
}

export { ROLLEN }
