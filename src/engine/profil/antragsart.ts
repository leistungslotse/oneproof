/**
 * A new application type for a profile of format 2, read from the XDF file of its FIM schema.
 *
 * The file is read (`fim/xdf.ts`) into a place per file field, with the condition its rules state.
 * What a place accepts comes from the profile where it already knows the place — the same schema
 * in an earlier version, or another application type with the same place — and is taken over as it
 * stands. Elsewhere the catalogue proposes the types whose name fits the place, or the condition
 * stays open. Who the persons of an application are and which field dates it: the binding of the
 * profile where the schema has its groups and fields, else a proposal by their names.
 *
 * Everything here is pure: the profile goes in, a changed profile and the schema file come out.
 */

import { isRepeatable, labelOf } from '../fim/schema.ts'
import type { Schema, SchemaNode } from '../fim/schema.ts'
import { leiteStellenAb, leseXdf } from '../fim/xdf.ts'
import type { Ableitung, XdfGelesen, XdfOptionen, XdfSchema } from '../fim/xdf.ts'
import { istOneProofSchema } from '../oneproof/schema.ts'
import type { JsonSchema, OneProofSchema } from '../oneproof/schema.ts'
import { eindeutig, knotenMitId, neueStelle, slug, STATUS } from './bedingungen.ts'
import type { AbgeleiteteStelle, AntragsartFormat2, Bedingung, ProfilFormat2, StelleFormat2 } from './bedingungen.ts'
import { formatVon, ProfilError, ROLLE } from './laden.ts'
import type { Anbindung, Dokumenttyp, Nennt, PersonBindung, Personen, Rolle } from './laden.ts'

/** Where an application in the OneProof Format is dated. */
export const STICHTAG_ONEPROOF = '/antragstellung/zeitpunkt'
/** Placeholders of a sentence: a FIM field, or a value of the OneProof Format by its pattern. */
const PLATZHALTER_ID = /\{(F\d+|\/[^|}]*)/g

/** A new FIM application type: the XDF file read, and the places derived from it. */
export interface AntragsartGelesen {
  format: 'fim'
  /** The version of XDatenfelder the file is in. */
  formatName: XdfGelesen['format']
  schema: XdfSchema
  /** The number of groups and fields of the schema. */
  elemente: number
  xdf: XdfGelesen
  ableitung: Ableitung
}

/** The XDF file read, and the places derived from it. */
export function liesAntragsart(text: string, optionen?: XdfOptionen): AntragsartGelesen {
  const xdf = leseXdf(text, optionen)
  return { format: 'fim', formatName: xdf.format, schema: xdf.schema, elemente: xdf.zahlen.elemente, xdf, ableitung: leiteStellenAb(xdf) }
}

/** Where the schema of an application type is kept inside the folder of a version. */
export const schemaDatei = (schema: Pick<Schema, 'schemaId' | 'version'>): string => `schema/${schema.schemaId}V${schema.version}.json`

/** The `profil.json` of a profile that has no application type yet. */
export const neuesProfil = ({ id, name }: { id: string; name: string }): ProfilFormat2 => ({
  format: 2,
  id,
  version: 'entwurf',
  name,
  dokumenttypen: 'dokumenttypen.json',
  antragsarten: [],
  personen: {},
  stichtag: null,
  wertetabellen: {},
})

/* ---------------------------------------------------------------------------------------------
 * Persons and date
 * ------------------------------------------------------------------------------------------- */

/** The persons an application names: the applicant, and the members of the household. */
export type Personenrolle = 'antragsteller' | 'mitglieder'

/** Who the persons of an application are and which field dates it: what a department confirms for an application type. */
export type Bindung = Pick<Anbindung, 'personen' | 'stichtag'>

/** A group or field of the schema a person or the date could be bound to. */
export interface Kandidat {
  id: string
  titel: string
}

/** What could be chosen for the persons and the date. */
export interface Kandidaten {
  antragsteller: Kandidat[]
  mitglieder: Kandidat[]
  stichtag: Kandidat[]
}

/** How persons and date are bound for an application of a schema, with what can be chosen. */
export interface Anbindungsvorschlag {
  /** The binding the profile has fits the schema, or the format fixes it. */
  passt: boolean
  anbindung: Bindung
  kandidaten: Kandidaten
}

const NACHNAME = /familienname|nachname/i
const VORNAME = /^vorname/i
const GEBURTSNAME = /geburtsname/i
const ANTRAGSTELLER = /antragstell/i
const MITGLIED = /haushaltsmitglied|haushaltsangeh|familienmitglied|mitglied/i
/** Groups with a name that are not a person of the household: a representative, a landlord, the deceased. */
const KEINE_PERSON = /vertret|bevollm|ansprech|betreu|vermiet|arbeitgeb|tod |tod$|todes|verstorb|zahlung|konto|untermiet|mitbewohn|nicht-haushalt/i
const STICHTAG = /erstellungszeitpunkt|antragsdatum|datum des antrags|antragstellungsdatum|datum der antragstellung|eingangsdatum/i

const textVon = (knoten: SchemaNode): string => `${knoten.name ?? ''} ${knoten.bezeichnung ?? ''}`

const BEZEICHNUNG: Record<Personenrolle, string> = { antragsteller: 'antragstellende Person', mitglieder: 'Haushaltsmitglied' }

/** The fields of a group that hold the name of a person. */
type Namensfelder = Pick<PersonBindung['name'], 'nachname' | 'vorname' | 'geburtsname'>

/** The name fields right in a group: family name and given name at least. */
function namensfelder(gruppe: Schema | SchemaNode): Namensfelder | null {
  const felder = (gruppe.kinder ?? []).filter((kind) => !kind.kinder)
  const finde = (muster: RegExp): string | null =>
    felder.find((feld) => muster.test(feld.name ?? '') || muster.test(feld.bezeichnung ?? ''))?.id ?? null
  const nachname = finde(NACHNAME)
  const vorname = finde(VORNAME)
  if (!nachname || !vorname) return null
  const geburtsname = finde(GEBURTSNAME)
  return { nachname, vorname, ...(geburtsname ? { geburtsname } : {}) }
}

/**
 * A group as a person the engine can name: the name fields right in it, or in one of its groups
 * that is not repeated. `null` for a group without a name.
 */
export function personAus(gruppe: SchemaNode | null | undefined, rolle: Personenrolle): PersonBindung | null {
  if (!gruppe?.kinder) return null
  const direkt = namensfelder(gruppe)
  const unter = direkt ? null : (gruppe.kinder.find((kind) => kind.kinder && !isRepeatable(kind) && namensfelder(kind)) ?? null)
  const felder = direkt ?? (unter ? namensfelder(unter) : null)
  if (!felder) return null
  return { gruppe: gruppe.id, name: { pfad: unter ? [unter.id] : [], ...felder }, bezeichnung: BEZEICHNUNG[rolle] }
}

/** Do the groups and fields of a binding all exist in the schema? */
function passtIn(schema: Schema, { personen, stichtag }: Bindung): boolean {
  const ids = Object.values(personen ?? {}).flatMap((person) => [
    person.gruppe,
    ...(person.name?.pfad ?? []),
    person.name?.nachname,
    person.name?.vorname,
    person.name?.geburtsname,
  ])
  return [...ids, stichtag].filter((id): id is string => Boolean(id)).every((id) => knotenMitId(schema, id))
}

/**
 * How persons and date are bound for an application of this schema, with what can be chosen.
 *
 * `passt`: the binding the profile has for it fits the schema — its groups and fields are all there.
 * That is the binding of the application type where the profile has it already (a new version of
 * its schema), else that of the profile.
 * Otherwise the proposal reads the names of the schema: the group of the applicant („Antragsteller“),
 * a repeated group of the household („Haushaltsmitglied“), each with name fields, and a field like
 * „Erstellungszeitpunkt“. What it does not find stays empty.
 *
 * @param roh   the profile, format 2
 */
export function schlageAnbindungVor(schema: Schema, roh: ProfilFormat2): Anbindungsvorschlag {
  // The OneProof Format names its persons in `personen` and its date in `antragstellung`.
  if (istOneProofSchema(schema)) {
    return {
      passt: true,
      anbindung: { personen: {}, stichtag: STICHTAG_ONEPROOF },
      kandidaten: { antragsteller: [], mitglieder: [], stichtag: [] },
    }
  }
  const gruppen: SchemaNode[] = []
  const felder: SchemaNode[] = []
  const gesehen = new Set<string>()
  const laufe = (knoten: Schema | SchemaNode, inWiederholung: boolean): void => {
    for (const unter of knoten.kinder ?? []) {
      if (gesehen.has(unter.id)) continue
      gesehen.add(unter.id)
      if (unter.kinder) {
        if (namensfelder(unter) || unter.kinder.some((kind) => kind.kinder && !isRepeatable(kind) && namensfelder(kind))) {
          gruppen.push(unter)
        }
        laufe(unter, inWiederholung || isRepeatable(unter))
      } else if (!inWiederholung && (unter.typ === 'date' || STICHTAG.test(textVon(unter)))) {
        felder.push(unter)
      }
    }
  }
  laufe(schema, false)

  const auswahl = (knoten: SchemaNode): Kandidat => ({ id: knoten.id, titel: labelOf(knoten) })
  const einmalig = gruppen.filter((gruppe) => !isRepeatable(gruppe))
  const wiederholt = gruppen.filter(isRepeatable)
  const kandidaten: Kandidaten = {
    antragsteller: einmalig.map(auswahl),
    mitglieder: wiederholt.map(auswahl),
    stichtag: felder.map(auswahl),
  }

  const vorher = roh.antragsarten?.find((art) => art.schema === schema.schemaId)
  const bisher: Bindung = {
    personen: vorher?.personen ?? roh.personen ?? {},
    stichtag: (vorher && Object.hasOwn(vorher, 'stichtag') ? vorher.stichtag : roh.stichtag) ?? null,
  }
  if (Object.keys(bisher.personen).length > 0 && passtIn(schema, bisher)) {
    return { passt: true, anbindung: bisher, kandidaten }
  }

  // The best by name; on a tie the first, which is the outer group: the person, not its name.
  const beste = (liste: SchemaNode[], muster: RegExp, mindestens: number): SchemaNode | null => {
    const bewertet = liste.map((gruppe) => ({ gruppe, punkte: KEINE_PERSON.test(textVon(gruppe)) ? -1 : muster.test(textVon(gruppe)) ? 2 : 0 }))
    const oben = Math.max(-1, ...bewertet.map(({ punkte }) => punkte))
    return oben >= mindestens ? (bewertet.find(({ punkte }) => punkte === oben)?.gruppe ?? null) : null
  }
  const antragsteller = beste(einmalig, ANTRAGSTELLER, 0)
  const mitglieder = beste(wiederholt, MITGLIED, 2)
  const stichtag = felder.find((feld) => STICHTAG.test(textVon(feld))) ?? null

  const personen: Personen = {}
  // Both are groups with name fields, as collected above: `personAus` finds a person in each.
  const antragstellerPerson = antragsteller ? personAus(antragsteller, 'antragsteller') : null
  if (antragstellerPerson) personen.antragsteller = antragstellerPerson
  const mitgliederPerson = mitglieder ? personAus(mitglieder, 'mitglieder') : null
  if (mitgliederPerson) personen.mitglieder = mitgliederPerson
  return { passt: false, anbindung: { personen, stichtag: stichtag?.id ?? null }, kandidaten }
}

/** The binding with another group or field chosen: `rolle` is a person or `stichtag`, `id` null for none. */
export function waehleAnbindung(schema: Schema, anbindung: Bindung, rolle: Personenrolle | 'stichtag', id: string | null): Bindung {
  if (rolle === 'stichtag') return { ...anbindung, stichtag: id || null }
  const personen = { ...anbindung.personen }
  const person = id ? personAus(knotenMitId(schema, id), rolle) : null
  if (person) personen[rolle] = person
  else delete personen[rolle]
  return { ...anbindung, personen }
}

/* ---------------------------------------------------------------------------------------------
 * The application type
 * ------------------------------------------------------------------------------------------- */

/** Words that say nothing about which document it is. */
const UNSPEZIFISCH = new Set(
  'nachweis nachweise nachweisen bescheinigung bescheid unterlage unterlagen dokument dokumente kopie kopien angabe angaben antrag antrags person personen datei dateien upload anlage anlagen sonstige sonstiger sonstiges weitere weiterer details abschnitt ueber einer eines einem beleg belege hochladen vorlage veraenderung veraenderungen aenderung aenderungen zusaetzliche'.split(
    ' ',
  ),
)

function woerter(text: string | null | undefined): string[] {
  return String(text ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .split(/[^a-z]+/)
    .filter((wort) => wort.length >= 5 && !UNSPEZIFISCH.has(wort))
}

/**
 * How many letters two words share at their start, where that says they mean the same: the whole
 * shorter word („Rente“, „Rentenbescheid“), or a long stem („Schwerbehinder…“) — not a prefix like
 * „Unter…“ of „Unterschrift“ and „Unterhalt“.
 */
function gemeinsam(a: string, b: string): number {
  let laenge = 0
  while (laenge < a.length && laenge < b.length && a[laenge] === b[laenge]) laenge++
  return laenge >= 5 && (laenge === Math.min(a.length, b.length) || laenge >= 7) ? laenge : 0
}

/**
 * The types of the catalogue whose name fits the place — „Schwerbehindertenausweis“ for a place
 * „Nachweis Schwerbehinderung“ —, the best four. Only a proposal: whether one suffices, the
 * department decides. The name is all the catalogue has to go by: it says what a document is,
 * not which statement of a benefit it proves.
 *
 * @param stelle   its title and, for a FIM place, the label of its file field
 */
export function katalogVorschlag(
  stelle: { titel?: string; feld?: string },
  typen: ReadonlyMap<string, Pick<Dokumenttyp, 'label'>>,
): string[] {
  const gesucht = [...new Set([...woerter(stelle.titel), ...woerter(stelle.feld)])]
  if (gesucht.length === 0) return []

  const treffer: { typ: string; punkte: number }[] = []
  for (const [typ, eintrag] of typen) {
    const eigene = woerter(eintrag.label)
    const punkte = Math.max(0, ...gesucht.flatMap((wort) => eigene.map((anderes) => gemeinsam(wort, anderes))))
    if (punkte > 0) treffer.push({ typ, punkte })
  }
  return treffer
    .sort((a, b) => b.punkte - a.punkte)
    .slice(0, 4)
    .map(({ typ }) => typ)
}

/** Does every question of `nennt` ask a field of the schema? */
function fragtIn(nennt: Nennt | undefined, schema: Schema): boolean {
  if (!nennt || nennt === 'immer') return true
  return [nennt].flat().every((frage) => !frage?.feld || knotenMitId(schema, frage.feld))
}

/**
 * A place of the profile taken over for the new schema. When the place asks for evidence follows
 * the rules of the new schema; where they say nothing, a condition set by hand stays — on the same
 * schema always, as long as its questions are there.
 */
function uebernimm(vorbild: StelleFormat2, abgeleitet: AbgeleiteteStelle, schema: Schema, gleichesSchema: boolean): StelleFormat2 {
  const kopie = structuredClone(vorbild)
  const da = (id: string): boolean => Boolean(knotenMitId(schema, id))
  const vonHand =
    kopie.herkunft?.art === 'profil' && Boolean(kopie.nennt) && fragtIn(kopie.nennt, schema) && (gleichesSchema || abgeleitet.herkunft.art !== 'regel')

  const stelle: Omit<StelleFormat2, 'bedingungen'> = {
    id: kopie.id,
    position: abgeleitet.position,
    titel: kopie.titel || abgeleitet.titel,
    bereich: kopie.bereich || abgeleitet.bereich,
    herkunft: vonHand ? { art: 'profil', ...(abgeleitet.herkunft.regeln ? { regeln: abgeleitet.herkunft.regeln } : {}) } : abgeleitet.herkunft,
  }
  const nennt = vonHand ? kopie.nennt : abgeleitet.nennt
  if (nennt) stelle.nennt = nennt
  if (vonHand ? kopie.nurFrage : abgeleitet.nurFrage) stelle.nurFrage = true
  if (kopie.auffang) stelle.auffang = true
  if (kopie.einmal) stelle.einmal = true
  if (kopie.aussage && [...kopie.aussage.matchAll(PLATZHALTER_ID)].every(([, id = '']) => da(id))) stelle.aussage = kopie.aussage
  const merkmale = (kopie.merkmale ?? []).filter((merkmal) => 'wert' in merkmal || da(merkmal.feld))
  if (merkmale.length > 0) stelle.merkmale = merkmale
  if (kopie.ohne) return { ...stelle, ohne: kopie.ohne, bedingungen: [] }

  // Conditions told apart by an answer need that question, and answers it still has.
  let bedingungen = kopie.bedingungen ?? []
  if (kopie.unterscheiden) {
    bedingungen = bedingungen
      .map((bedingung): Bedingung | null => {
        const wenn = bedingung.wenn
        const frage = wenn?.feld ? knotenMitId(schema, wenn.feld) : null
        if (!wenn || !frage) return null
        const bekannt = frage.typ === 'bool' ? ['true', 'false'] : Object.keys(frage.werte ?? {})
        const ja = (wenn.ja ?? []).filter((code) => bekannt.length === 0 || bekannt.includes(code))
        return ja.length > 0 ? { ...bedingung, wenn: { ...wenn, ja } } : null
      })
      .filter((bedingung): bedingung is Bedingung => bedingung !== null)
    if (bedingungen.length > 0 && (kopie.unterscheiden === 'je-frage' || da(kopie.unterscheiden))) stelle.unterscheiden = kopie.unterscheiden
    else bedingungen = []
  }
  if (bedingungen.length === 0) return { ...stelle, bedingungen: [{ id: stelle.id, status: STATUS.OFFEN, nachweise: {}, hinweis: '' }] }

  return { ...stelle, bedingungen }
}

/** A place derived from a schema; a FIM place carries the label of its file field, too. */
export type Ableitungsstelle = AbgeleiteteStelle & { feld?: string }

/** What both kinds of application type need to be added. */
interface EingabeGemeinsam {
  /** The places derived from the schema. */
  ableitung: { stellen: Ableitungsstelle[] }
  /** Who the persons are and which field dates the application, as confirmed. */
  anbindung: Bindung
  /** The catalogue of document types: its labels propose what a new place accepts. */
  typen: ReadonlyMap<string, Pick<Dokumenttyp, 'label'>>
}

/** A FIM application type, as `liesAntragsart` reads it. */
export interface EingabeFim extends EingabeGemeinsam {
  format?: 'fim'
  xdf: Pick<XdfGelesen, 'schema'>
}

/** An application type of the OneProof Format, as `liesOneProofSchema` reads it. */
export interface EingabeOneProof extends EingabeGemeinsam {
  format: 'oneproof'
  /** The compact schema. */
  schema: OneProofSchema
  /** The JSON Schemas as files of the version, by their path. */
  dateien: Record<string, JsonSchema>
}

/** An application type to add to a profile. */
export type AntragsartEingabe = EingabeFim | EingabeOneProof

/** How many places and conditions an application type has, the conditions by their state. */
export interface Zaehlung {
  /** The places that ask for evidence. */
  stellen: number
  /** The places that knowingly ask for none. */
  ohne: number
  bedingungen: number
  festgelegt: number
  vorschlag: number
  offen: number
}

/** What adding an application type makes. */
export interface EingefuegteAntragsart {
  /** The profile with the application type. */
  roh: ProfilFormat2
  /** The file of the schema: its path in the folder of a version, and what it holds. */
  datei: { pfad: string; inhalt: unknown }
  /** All files the application type brings, by their path in the folder of a version. */
  dateien: Record<string, unknown>
  zahlen: Zaehlung
}

/** A place of the new application type, made but not yet numbered. */
interface Stellenentwurf {
  stelle: StelleFormat2
  /** The place was taken over from the profile; else it is new. */
  uebernommen: boolean
  /** Its place in the order of the derived places. */
  reihe: number
  /** Where the place stood in the application type of the same schema before; -1 if there was none. */
  altIndex: number
}

/**
 * Adds an application type to a profile of format 2 — or replaces the one of the same schema, as
 * when a new version of it is released.
 *
 * An application type of the OneProof Format (`format: 'oneproof'`, from `oneproof/ableitung.ts`)
 * names its persons and its date by the format; the places the profile set by hand at values of
 * the schema (the rent, the floor space) stay as long as the schema has those values.
 *
 * @param roh   the profile, format 2
 */
export function fuegeAntragsartEin(roh: ProfilFormat2, eingabe: AntragsartEingabe): EingefuegteAntragsart {
  const { ableitung, anbindung, typen } = eingabe
  const oneproof = eingabe.format === 'oneproof'
  const schema: Schema = oneproof ? eingabe.schema : eingabe.xdf.schema
  const vorher = roh.antragsarten.find((art) => art.schema === schema.schemaId) ?? null
  const andere = roh.antragsarten.filter((art) => art.schema !== schema.schemaId)
  const vorbilder = andere.flatMap((art) => art.stellen ?? [])

  // Each derived place takes over the first place of the schema before at its value.
  const kandidaten = ableitung.stellen.map((abgeleitet) => ({
    abgeleitet,
    altIndex: vorher?.stellen?.findIndex((stelle) => stelle.position === abgeleitet.position) ?? -1,
  }))
  if (oneproof) {
    // Places the structure does not derive — set by hand at a value (the rent), or a second one at
    // the same value (the care order beside the power of attorney) — stay while the value is there.
    const genommen = new Set(kandidaten.map(({ altIndex }) => altIndex))
    for (const [altIndex, stelle] of (vorher?.stellen ?? []).entries()) {
      if (genommen.has(altIndex) || !knotenMitId(schema, stelle.position)) continue
      const abgeleitet: Ableitungsstelle = {
        position: stelle.position,
        titel: stelle.titel,
        bereich: stelle.bereich,
        herkunft: stelle.herkunft ?? { art: 'profil' },
        ...(stelle.nennt ? { nennt: stelle.nennt } : {}),
        ...(stelle.nurFrage ? { nurFrage: true } : {}),
      }
      kandidaten.push({ abgeleitet, altIndex })
    }
  }

  const stellenIds = new Set<string>()
  const bedingungIds = new Set<string>()
  const entwuerfe = kandidaten.map(({ abgeleitet, altIndex }, reihe): Stellenentwurf => {
    const vorbild =
      altIndex >= 0 ? vorher?.stellen[altIndex] : (vorbilder.find((stelle) => stelle.position === abgeleitet.position) ?? null)
    if (vorbild) return { stelle: uebernimm(vorbild, abgeleitet, schema, altIndex >= 0), uebernommen: true, reihe, altIndex }

    const stelle = neueStelle({ ...abgeleitet, id: slug(abgeleitet.titel), nennt: abgeleitet.nennt ?? null, nurFrage: abgeleitet.nurFrage === true }, null)
    const vorschlag = katalogVorschlag(abgeleitet, typen)
    if (vorschlag.length > 0) {
      // A new place has exactly one condition, an open one.
      stelle.bedingungen = stelle.bedingungen.map((offene) => ({
        ...offene,
        status: STATUS.VORSCHLAG,
        nachweise: Object.fromEntries(vorschlag.map((typ): [string, Rolle] => [typ, ROLLE.PRUEFEN])),
      }))
    }
    return { stelle, uebernommen: false, reihe, altIndex }
  })

  // Places taken over keep their ids; new ones get theirs after them.
  for (const entwurf of [...entwuerfe.filter((e) => e.uebernommen), ...entwuerfe.filter((e) => !e.uebernommen)]) {
    entwurf.stelle = mitEindeutigenIds(entwurf.stelle, stellenIds, bedingungIds)
  }
  // A new version of the schema keeps the order of its places (the result lists them so); new places follow.
  const rang = (entwurf: Stellenentwurf): number => (entwurf.altIndex >= 0 ? entwurf.altIndex : Number.MAX_SAFE_INTEGER)
  const stellen = (vorher ? [...entwuerfe].sort((a, b) => rang(a) - rang(b) || a.reihe - b.reihe) : entwuerfe).map(({ stelle }) => stelle)

  // A link to a coarser condition holds only where that condition is part of this application type.
  for (const stelle of stellen) {
    for (const bedingung of stelle.bedingungen) {
      for (const [typ, wert] of Object.entries(bedingung.nachweise ?? {})) {
        if (typeof wert === 'object' && wert.ersatzweise && !bedingungIds.has(wert.ersatzweise.bedingung)) {
          const { ersatzweise: _weg, ...rest } = wert
          bedingung.nachweise[typ] = Object.keys(rest).length === 1 ? rest.rolle : rest
        }
      }
    }
  }

  const neu = structuredClone(roh)
  const dateien: Record<string, unknown> = oneproof ? eingabe.dateien : { [schemaDatei(schema)]: schema }
  const datei = Object.keys(dateien)[0]
  // Cannot happen: a schema of FIM is one file, and the files of the OneProof Format are those of its schemas.
  if (datei === undefined) throw new ProfilError('Zum Schema gibt es keine Datei.')
  const eintrag: AntragsartFormat2 = {
    schema: schema.schemaId,
    ...(oneproof ? { format: 'oneproof' } : {}),
    version: schema.version,
    name: vorher?.name ?? schema.name,
    datei,
    ...(oneproof ? { stichtag: vorher?.stichtag ?? STICHTAG_ONEPROOF } : {}),
    ...(oneproof && vorher?.antragslage ? { antragslage: vorher.antragslage } : {}),
    stellen,
  }
  // Older versions are read through mappings to this version; for a new version they do not hold.
  if (vorher && vorher.version === schema.version) {
    if (vorher.abbildungen) eintrag.abbildungen = vorher.abbildungen
    if (vorher.abbildungKorrekturen) eintrag.abbildungKorrekturen = vorher.abbildungKorrekturen
  }

  const profilAnbindung: Bindung = { personen: neu.personen ?? {}, stichtag: neu.stichtag ?? null }
  if (oneproof) {
    // The format names the persons and the date; the binding of the profile is that of FIM.
  } else if (Object.keys(profilAnbindung.personen).length === 0 && andere.filter((art) => formatVon(art) === 'fim').length === 0) {
    neu.personen = anbindung.personen
    neu.stichtag = anbindung.stichtag
  } else if (JSON.stringify(anbindung) !== JSON.stringify(profilAnbindung)) {
    eintrag.personen = anbindung.personen
    eintrag.stichtag = anbindung.stichtag
  }

  const stelle = roh.antragsarten.findIndex((art) => art.schema === schema.schemaId)
  if (stelle === -1) neu.antragsarten.push(eintrag)
  else neu.antragsarten[stelle] = eintrag

  return { roh: neu, datei: { pfad: datei, inhalt: dateien[datei] }, dateien, zahlen: zaehleAntragsart(eintrag) }
}

/** A place with ids no other place or condition of the application type has; a single condition is named as its place. */
function mitEindeutigenIds(stelle: StelleFormat2, stellenIds: Set<string>, bedingungIds: Set<string>): StelleFormat2 {
  const id = eindeutig(stelle.id, stellenIds)
  const bedingungen = stelle.bedingungen.map((bedingung) => {
    const eigene = eindeutig(bedingung.id === stelle.id ? id : bedingung.id, bedingungIds)
    return eigene === bedingung.id ? bedingung : { ...bedingung, id: eigene }
  })
  return { ...stelle, id, bedingungen }
}

/** Places and conditions of an application type, the conditions by their state. */
export function zaehleAntragsart(antragsart: Pick<Partial<AntragsartFormat2>, 'stellen'>): Zaehlung {
  const zahlen: Zaehlung = { stellen: 0, ohne: 0, bedingungen: 0, festgelegt: 0, vorschlag: 0, offen: 0 }
  for (const stelle of antragsart.stellen ?? []) {
    if (stelle.ohne) {
      zahlen.ohne++
      continue
    }
    zahlen.stellen++
    for (const bedingung of stelle.bedingungen) {
      zahlen.bedingungen++
      if (Object.hasOwn(zahlen, bedingung.status)) zahlen[bedingung.status]++
    }
  }
  return zahlen
}
