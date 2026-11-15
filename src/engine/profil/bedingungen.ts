/**
 * Profile format 2: a complete evidence profile per application type, made of conditions.
 *
 * Every application type (FIM schema) of a profile lists its places of evidence (`stellen`), and
 * every place one condition or several (`bedingungen`): which documents count there and how well,
 * for which period, and what the applicant reads while one is missing. Where in the schema the
 * condition comes from is recorded with the place (`herkunft`, see `fim/xdf.ts`).
 *
 *   antragsarten[].stellen[] = {
 *     id, position, titel, bereich,
 *     herkunft: {art: 'regel'|'regelFremd'|'abschnitt'|'immer'|'profil', regeln?: [{id, name, satz}]},
 *     nennt?, nurFrage?, auffang?, einmal?, aussage?, merkmale?,     how the engine reads the place
 *     unterscheiden?: 'F…' | 'je-frage',                             one condition per answer / question
 *     ohne?: 'Grund',                                               knowingly no evidence here
 *     bedingungen: [{
 *       id, titel?, art?, wenn?: {feld, ja},
 *       status: 'festgelegt'|'vorschlag'|'offen',
 *       nachweise: {typ: rolle | {rolle, merkmale?, ersatzweise?: {bedingung, rolle}}},
 *       zeitraum?: {mindestens, hoechstensAlt?, fuer: [typ], beispiel?},
 *       hinweis?,
 *     }],
 *   }
 *
 * Unlike format 1 everything is written out: a type that a condition does not list does not count
 * there — the defaults of the catalogue only serve to make proposals.
 *
 * The engine reads the format of version 1 (`nachweisarten`, `stellen`); `uebersetze` makes it.
 * Conditions that are the same within an application type and say so (`art`) share a statement of
 * the engine, as `stellen` of format 1 share a `nachweisart`: a document is then placed once for
 * them. A condition that lists no document asks for nothing.
 */

import type { Schema, SchemaNode } from '../fim/schema.ts'
import { fileFields, indexById, positionKey } from '../fim/schema.ts'
import { optionalOderWiederholbar } from '../fim/xdf.ts'
import type {
  Abdeckung,
  Antragsart,
  Frage,
  Merkmale,
  Merkmalsquelle,
  Nachweisart,
  Nennt,
  ProfilKopf,
  QuellenEintrag,
  Rolle,
  StelleFormat1,
} from './laden.ts'

/** The role a document keeps at a coarser statement unless the profile says otherwise (as in `laden.ts`). */
const ERGAENZT = 'ergaenzt'

/** How far a condition is settled: set by the department, proposed by the tool, or still open. */
export const STATUS = Object.freeze({ FESTGELEGT: 'festgelegt', VORSCHLAG: 'vorschlag', OFFEN: 'offen' })

/** A value of {@link STATUS}. */
export type Status = (typeof STATUS)[keyof typeof STATUS]

/** A rule of the schema that names a place, with the sentence that does. */
export interface HerkunftRegel {
  id: string
  name: string
  satz: string
}

/** Where the condition of a place comes from, as `fim/xdf.ts` derives it; `profil` where the department set it by hand. */
export interface Herkunft {
  art: 'regel' | 'regelFremd' | 'abschnitt' | 'immer' | 'profil' | 'frage'
  /** The rules that name the place (`regel`, `regelFremd`), or that named it before it was set by hand (`profil`). */
  regeln?: HerkunftRegel[]
  /** The yes/no question of the section, by its place in the OneProof Format (`frage`). */
  feld?: string
}

/** How many months of evidence a condition needs, and of which types. */
export interface Zeitraum {
  mindestens: number
  /** How old the oldest month may be at most, counted in months. */
  hoechstensAlt?: number | null
  /** The document types the months are counted for. */
  fuer: string[]
  /** The period is a proposal that stands for what the authority names. */
  beispiel?: boolean
}

/** The coarser condition a document counts for where this one does not apply, and its role there. */
export interface Ersatzweise {
  /** The id of the condition. */
  bedingung: string
  rolle?: Rolle
}

/** A document type of a condition in its full form. */
export interface NachweisEintrag {
  rolle: Rolle
  merkmale?: Merkmale
  ersatzweise?: Ersatzweise
}

/** A document type of a condition: its role alone, or in full. */
export type Nachweis = Rolle | NachweisEintrag

/** A condition of a place: which documents count, how well, for which period, and what the applicant reads meanwhile. */
export interface Bedingung {
  id: string
  /** Where the place is told apart: the answer this condition is for. */
  titel?: string
  /** Conditions of an application type with the same `art` and the same settings share a statement of the engine. */
  art?: string
  /** Where the place is told apart: the answer that makes this condition the one that applies. */
  wenn?: Frage
  status: Status
  /** The document types that count, by catalogue key. */
  nachweise: Record<string, Nachweis>
  zeitraum?: Zeitraum
  /** What the applicant reads while the evidence is missing. */
  hinweis?: string
}

/** A place of evidence of format 2: where it is, what asks for it, and its conditions. */
export interface StelleFormat2 {
  id: string
  /** `group/field` in FIM, a pattern in the OneProof Format. */
  position: string
  titel: string
  bereich: string
  herkunft: Herkunft
  /** What names a fact of the application; the engine reads it as in format 1. */
  nennt?: Nennt
  nurFrage?: boolean
  auffang?: boolean
  einmal?: boolean
  /** A sentence with placeholders that says what the application states there. */
  aussage?: string
  merkmale?: Merkmalsquelle[]
  /** One condition per answer of a question of the section (its `F…`), or per yes/no question (`je-frage`). */
  unterscheiden?: string
  /** The place knowingly asks for no evidence; the reason. Then it has no conditions. */
  ohne?: string
  bedingungen: Bedingung[]
}

/**
 * A place derived from the schema of an application type: where it is, how it is called and where
 * its condition comes from. The profile then decides what the place accepts.
 */
export interface AbgeleiteteStelle {
  position: string
  titel: string
  bereich: string
  herkunft: Herkunft
  /**
   * The question or questions that decide, where a rule or the structure of the schema names them;
   * `immer` only for a place of the profile that is kept for a new version of its schema.
   */
  nennt?: Nennt
  nurFrage?: boolean
}

/** An application type of format 2: a complete profile of its own. */
export interface AntragsartFormat2 extends Antragsart {
  stellen: StelleFormat2[]
}

/**
 * `profil.json` of format 2: the places of evidence and their conditions are per application type;
 * there are no statements (`nachweisarten`), places (`stellen`) or open fields (`bekanntOffen`) of the whole profile.
 */
export interface ProfilFormat2 extends ProfilKopf {
  format: 2
  antragsarten: AntragsartFormat2[]
  nachweisarten?: undefined
  stellen?: undefined
  bekanntOffen?: undefined
}

/** A place with one of its conditions. */
export interface StelleUndBedingung {
  stelle: StelleFormat2
  bedingung: Bedingung
}

/** An entry of `nachweise` in its full form. */
export interface Eintrag {
  /** `null` for a type the condition does not list. */
  rolle: Rolle | null
  merkmale: Merkmale
  ersatzweise: Ersatzweise | null
}

/** What `signatur` takes into account besides the documents and the period. */
export interface SignaturOptionen {
  /** The text for the applicant counts. */
  mitHinweis?: boolean
  /** How far the condition is settled counts. */
  mitStatus?: boolean
}

/** A format 2 profile in the form the engine reads (see `uebersetze`). */
export interface Uebersetzung {
  /** A statement per group of conditions, by the name `<schema>:<art>`. */
  nachweisarten: Record<string, Nachweisart>
  /** A place per condition, each bound to its application type (`antragsarten`). */
  stellen: StelleFormat1[]
  /** The places that knowingly ask for no evidence, by position, with the reason. */
  bekanntOffen: Record<string, string>
  /** The statements each application type uses, by its schema. */
  artenJeAntragsart: Map<string, Set<string>>
}

/** An entry of `nachweise` in its full form. */
export function eintragVon(wert: Nachweis): Eintrag & { rolle: Rolle }
export function eintragVon(wert: Nachweis | null | undefined): Eintrag
export function eintragVon(wert: Nachweis | null | undefined): Eintrag {
  const eintrag: Partial<NachweisEintrag> = typeof wert === 'string' ? { rolle: wert } : (wert ?? {})
  return { rolle: eintrag.rolle ?? null, merkmale: eintrag.merkmale ?? {}, ersatzweise: eintrag.ersatzweise ?? null }
}

/** An entry in its shortest form: the role alone where nothing else is set. */
export function kurzform({
  rolle,
  merkmale = {},
  ersatzweise = null,
}: {
  rolle: Rolle
  merkmale?: Merkmale
  ersatzweise?: Ersatzweise | null
}): Nachweis {
  const mehr: { merkmale?: Merkmale; ersatzweise?: Ersatzweise } = {}
  if (Object.keys(merkmale).length > 0) mehr.merkmale = merkmale
  if (ersatzweise) mehr.ersatzweise = ersatzweise
  return Object.keys(mehr).length === 0 ? rolle : { rolle, ...mehr }
}

const sortiert = (objekt: Merkmale | null | undefined): Merkmale =>
  Object.fromEntries(Object.entries(objekt ?? {}).sort(([a], [b]) => a.localeCompare(b)))

/** What a department can set at a condition, comparable: the same text for the same setting. */
export function signatur(bedingung: Partial<Bedingung>, { mitHinweis = false, mitStatus = false }: SignaturOptionen = {}): string {
  const nachweise = Object.entries(bedingung.nachweise ?? {})
    .map(([typ, wert]): [string, Rolle, Merkmale, (string | undefined)[] | null] => {
      const { rolle, merkmale, ersatzweise } = eintragVon(wert)
      return [typ, rolle, sortiert(merkmale), ersatzweise ? [ersatzweise.bedingung, ersatzweise.rolle] : null]
    })
    .sort(([a], [b]) => a.localeCompare(b))
  const zeitraum = bedingung.zeitraum
    ? [bedingung.zeitraum.mindestens, bedingung.zeitraum.hoechstensAlt ?? null, [...(bedingung.zeitraum.fuer ?? [])].sort(), bedingung.zeitraum.beispiel === true]
    : null
  return JSON.stringify([nachweise, zeitraum, mitHinweis ? (bedingung.hinweis ?? '').trim() : null, mitStatus ? bedingung.status : null])
}

/** Does the condition accept any document? Without one it asks for nothing. */
export const laesstZu = (bedingung: Pick<Partial<Bedingung>, 'nachweise'>): boolean => Object.keys(bedingung.nachweise ?? {}).length > 0

/** The conditions of an application type, with their place. */
export const bedingungenVon = (antragsart: Pick<Partial<AntragsartFormat2>, 'stellen'>): StelleUndBedingung[] =>
  (antragsart.stellen ?? []).filter((stelle) => !stelle.ohne).flatMap((stelle) => stelle.bedingungen.map((bedingung) => ({ stelle, bedingung })))

/* ---------------------------------------------------------------------------------------------
 * For the engine
 * ------------------------------------------------------------------------------------------- */

/**
 * The profile in the form the engine reads: a statement (`nachweisart`) and a place (`stelle`) per
 * condition, each place bound to its application type.
 *
 * @param roh   a `profil.json` of format 2
 */
export function uebersetze(roh: ProfilFormat2): Uebersetzung {
  const nachweisarten: Record<string, Nachweisart> = {}
  const stellen: StelleFormat1[] = []
  const bekanntOffen: Record<string, string> = {}
  const artenJeAntragsart = new Map<string, Set<string>>()

  for (const antragsart of roh.antragsarten ?? []) {
    const schema = antragsart.schema

    // Which statement each condition becomes: shared where conditions say they are one (`art`) and
    // are set the same.
    const artVon = new Map<string, string>()
    const gruppen = new Map<string, { signatur: string; art: string }[]>()
    for (const { bedingung } of bedingungenVon(antragsart)) {
      if (!laesstZu(bedingung)) continue
      const schluessel = bedingung.art ?? bedingung.id
      const liste = gruppen.get(schluessel) ?? []
      const eigene = signatur(bedingung)
      let gruppe = liste.find((kandidat) => kandidat.signatur === eigene)
      if (!gruppe) {
        gruppe = { signatur: eigene, art: `${schema}:${schluessel}${liste.length > 0 ? `~${liste.length + 1}` : ''}` }
        liste.push(gruppe)
        gruppen.set(schluessel, liste)
      }
      artVon.set(bedingung.id, gruppe.art)
    }
    artenJeAntragsart.set(schema, new Set(artVon.values()))

    for (const stelle of antragsart.stellen ?? []) {
      if (stelle.ohne) {
        bekanntOffen[stelle.position] = stelle.ohne
        continue
      }
      const geteilt = Boolean(stelle.unterscheiden)

      for (const bedingung of stelle.bedingungen) {
        const art = artVon.get(bedingung.id)
        if (!art) continue

        if (!nachweisarten[art]) {
          nachweisarten[art] = {
            titel: stelle.titel,
            quellen: quellenVon(bedingung, artVon),
            ...(bedingung.zeitraum ? { abdeckung: abdeckungVon(bedingung.zeitraum) } : {}),
          }
        }

        stellen.push({
          id: geteilt ? bedingung.id : stelle.id,
          art,
          antragsarten: [schema],
          position: stelle.position,
          bereich: stelle.bereich,
          titel: geteilt && bedingung.titel ? `${stelle.titel}: ${bedingung.titel}` : stelle.titel,
          // Always set, also when empty: the text of another condition of the statement does not apply here.
          hinweis: (bedingung.hinweis ?? '').trim(),
          ...(geteilt
            ? { nennt: bedingung.wenn, nurFrage: true }
            : { ...(stelle.nennt ? { nennt: stelle.nennt } : {}), nurFrage: stelle.nurFrage === true, auffang: stelle.auffang === true }),
          einmal: stelle.einmal === true,
          ...(stelle.aussage ? { aussage: stelle.aussage } : {}),
          merkmale: stelle.merkmale ?? [],
        })
      }
    }
  }

  return { nachweisarten, stellen, bekanntOffen, artenJeAntragsart }
}

/** `nachweise` of a condition as `quellen` of format 1, with the finer-to-coarser link resolved. */
function quellenVon(bedingung: Bedingung, artVon: ReadonlyMap<string, string>): Record<string, QuellenEintrag> {
  const quellen: Record<string, QuellenEintrag> = {}
  for (const [typ, wert] of Object.entries(bedingung.nachweise ?? {})) {
    const { rolle, merkmale, ersatzweise } = eintragVon(wert)
    const groebere = ersatzweise ? artVon.get(ersatzweise.bedingung) : null
    quellen[typ] = {
      rolle,
      merkmale,
      ...(ersatzweise && groebere ? { groebere: { art: groebere, rolle: ersatzweise.rolle ?? ERGAENZT } } : {}),
    }
  }
  return quellen
}

const abdeckungVon = (zeitraum: Zeitraum): Abdeckung => ({
  einheit: 'monat',
  mindestens: zeitraum.mindestens,
  ...(typeof zeitraum.hoechstensAlt === 'number' && Number.isInteger(zeitraum.hoechstensAlt)
    ? { hoechstensAlt: zeitraum.hoechstensAlt }
    : {}),
  fuer: zeitraum.fuer ?? [],
  ...(zeitraum.beispiel ? { beispiel: true } : {}),
})

/** Every place of evidence of a schema with its first path, in schema order. */
export function positionenVon(schema: Schema): Map<string, SchemaNode[]> {
  const orte = new Map<string, SchemaNode[]>()
  for (const { path } of fileFields(schema)) {
    const position = positionKey(path)
    if (!orte.has(position)) orte.set(position, path)
  }
  return orte
}

/** Where the condition of a place comes from when no rule is known: its section. */
export const herkunftNachStruktur = (pfad: SchemaNode[]): 'abschnitt' | 'immer' =>
  pfad.length > 1 && optionalOderWiederholbar(pfad.at(-2)) ? 'abschnitt' : 'immer'

/** What a place needs to be made new. */
export interface NeueStelleEingabe {
  id: string
  position: string
  titel: string
  bereich: string
  /** Where its condition comes from; the structure of the schema decides where it is not known. */
  herkunft?: Herkunft | null
  nennt?: Nennt | null
  nurFrage?: boolean
}

/**
 * A place with one open condition.
 *
 * @param pfad  the path of its field in the schema; may be left out where the origin is given
 */
export function neueStelle(
  { id, position, titel, bereich, herkunft = null, nennt = null, nurFrage = false }: NeueStelleEingabe,
  pfad: SchemaNode[] | null,
): StelleFormat2 {
  if (!herkunft && !pfad) throw new Error('Ohne Herkunft braucht eine Stelle den Pfad ihres Feldes im Schema.')
  return {
    id,
    position,
    titel,
    bereich,
    herkunft: herkunft ?? { art: herkunftNachStruktur(pfad ?? []) },
    ...(nennt ? { nennt } : {}),
    ...(nurFrage ? { nurFrage: true } : {}),
    bedingungen: [{ id, status: STATUS.OFFEN, nachweise: {}, hinweis: '' }],
  }
}

/** An id made of a title: lower case, umlauts spelt out, words joined by `_`. */
export function slug(text: string): string {
  const ersetzt = String(text)
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return (ersetzt.slice(0, 40).replace(/_+$/, '') || 'stelle')
}

/** `id`, or `id_2`, `id_3`, … if it is taken; the id is then taken. */
export function eindeutig(id: string, vergeben: Set<string>): string {
  let kandidat = id
  for (let nummer = 2; vergeben.has(kandidat); nummer++) kandidat = `${id}_${nummer}`
  vergeben.add(kandidat)
  return kandidat
}

const indizes = new WeakMap<Schema, Map<string, SchemaNode[][]>>()

/** The index of a schema by id, made once per schema. */
function indexVon(schema: Schema): Map<string, SchemaNode[][]> {
  let index = indizes.get(schema)
  if (!index) {
    index = indexById(schema)
    indizes.set(schema, index)
  }
  return index
}

/**
 * The node an id names in an index made by `indexById`: the last one of its first path (a field may
 * occur in many places, with the same values). `null` where the index does not know the id.
 */
export function knotenIm(index: ReadonlyMap<string, SchemaNode[][]>, id: string): SchemaNode | null {
  const wege = index.get(id)
  if (!wege) return null
  const [weg] = wege
  // Cannot happen: `indexById` starts the list of an id with its first path.
  if (!weg) throw new Error(`Der Index des Schemas kennt zur Kennung „${id}“ keinen Pfad.`)
  return weg.at(-1) ?? null
}

/** The first node of a schema with this id (a field may occur in many places, with the same values). */
export function knotenMitId(schema: Schema, id: string): SchemaNode | null {
  return knotenIm(indexVon(schema), id)
}

/** The first path of a schema to a node with this id. */
export function pfadMitId(schema: Schema, id: string): SchemaNode[] | null {
  return indexVon(schema).get(id)?.[0] ?? null
}
