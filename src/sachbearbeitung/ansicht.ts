/**
 * What the department's page shows of a profile of format 2: the places of an application type,
 * their conditions, and what a draft changes.
 *
 * There is no React in here — as in `pruefen/ansicht.ts`: the components only lay out what these
 * functions return, so that wording, grouping and filtering can be tested without a browser.
 */

import { findeBehaelter, optionalOderWiederholbar } from '../engine/fim/xdf.ts'
import { eintragVon, knotenMitId, pfadMitId } from '../engine/profil/bedingungen.ts'
import type { AntragsartFormat2, Bedingung, Ersatzweise, Herkunft, ProfilFormat2, Status, StelleFormat2, Zeitraum } from '../engine/profil/bedingungen.ts'
import { ROLLE } from '../engine/profil/laden.ts'
import type { Anbindung, Antragsart, Dokumenttyp, Frage, Merkmale, Rolle, Wertetabellen } from '../engine/profil/laden.ts'
import { labelOf } from '../engine/fim/schema.ts'
import type { Schema, SchemaNode } from '../engine/fim/schema.ts'
import { jePersonImSchema, istOneProofSchema, pfadZu } from '../engine/oneproof/schema.ts'
import { JEDE_ANTWORT } from '../engine/zuordnung/ziele.ts'
import { aufzaehlung, zaehle } from '../pruefen/ansicht.ts'
import type { StatusSchluessel } from '../status.ts'

/* ------------------------------------------------------------------------------------------ */
/* What can be chosen                                                                          */
/* ------------------------------------------------------------------------------------------ */

/** The value of the choice "not accepted" — a select carries text, and `null` is no text. */
export const NICHT_ZUGELASSEN = 'nicht'

/** A choice for a document type at a condition. */
export interface Wahl {
  /** What the select carries. */
  wert: string
  /** The role it stands for; `null` for "not accepted". */
  rolle: Rolle | null
  titel: string
  /** The state the statement can reach at best; `null` where the document does not count. */
  folge: StatusSchluessel | null
  beschreibung: string
}

/** The choice "not accepted": what no role stands for. */
const KEINE_WAHL: Wahl = { wert: NICHT_ZUGELASSEN, rolle: null, titel: 'Nicht zugelassen', folge: null, beschreibung: 'Zählt hier nicht.' }

/** The choices for a document type at a condition, strongest first; `folge`: the state it leads to at best. */
export const WAHL: readonly Wahl[] = Object.freeze([
  { wert: ROLLE.GENUEGT, rolle: ROLLE.GENUEGT, titel: 'Genügt', folge: 'belegt', beschreibung: 'Der Nachweis genügt für sich allein.' },
  {
    wert: ROLLE.PRUEFEN,
    rolle: ROLLE.PRUEFEN,
    titel: 'Kann genügen',
    folge: 'unklar',
    beschreibung: 'Ob der Inhalt passt, prüft die Sachbearbeitung.',
  },
  { wert: ROLLE.ERGAENZT, rolle: ROLLE.ERGAENZT, titel: 'Ergänzt nur', folge: 'offen', beschreibung: 'Stützt die Angabe, genügt aber allein nicht.' },
  KEINE_WAHL,
])

/** The choice that stands for a role (`null` is "not accepted"). */
export const wahlFuer = (rolle: string | null | undefined): Wahl => WAHL.find((wahl) => wahl.rolle === (rolle ?? null)) ?? KEINE_WAHL

/** The choice a value of the select stands for — `undefined` for a value that is none of them. */
export const wahlZuWert = (wert: string | undefined): Wahl | undefined => WAHL.find((wahl) => wahl.wert === wert)

/** How a condition stands, as the page shows it. */
export interface StandAnzeige {
  titel: string
  /** The KERN modifier of the badge. */
  badge: 'success' | 'info' | 'warning'
}

/** How a condition stands, as the page shows it. */
export const STAND: Readonly<Record<Status, StandAnzeige>> = Object.freeze({
  festgelegt: { titel: 'Festgelegt', badge: 'success' },
  vorschlag: { titel: 'Vorschlag', badge: 'info' },
  offen: { titel: 'Offen', badge: 'warning' },
})

/** How the page shows where a condition comes from. */
export interface HerkunftAnzeige {
  /** The step of the ladder; `null` where the condition is not on it. */
  nr: number | null
  titel: string
  klasse: string
}

/** Where the condition of a place comes from: the steps of the ladder, and a condition set by hand. */
export const HERKUNFT: Readonly<Record<Herkunft['art'], HerkunftAnzeige>> = Object.freeze({
  regel: { nr: 1, titel: 'Aus einer Regel', klasse: 'regel' },
  regelFremd: { nr: 2, titel: 'Regel nicht verstanden', klasse: 'fremd' },
  abschnitt: { nr: 3, titel: 'Aus dem Abschnitt', klasse: 'abschnitt' },
  immer: { nr: 4, titel: 'Immer', klasse: 'immer' },
  /** OneProof Format: a section with a yes/no question of its own („vorhanden“). */
  frage: { nr: null, titel: 'Aus der Ja/Nein-Frage', klasse: 'regel' },
  profil: { nr: null, titel: 'Aus dem bisherigen Profil', klasse: 'hand' },
})

/* ------------------------------------------------------------------------------------------ */
/* Places and conditions                                                                       */
/* ------------------------------------------------------------------------------------------ */

const fragenVon = (nennt: StelleFormat2['nennt']): Frage[] => (!nennt || nennt === 'immer' ? [] : [nennt].flat().filter((frage) => frage?.feld))

/** The name of an answer. A yes/no field that was a selection in an older version is named either way. */
const antwortName = (knoten: SchemaNode | null, code: string): string => {
  const werte = knoten?.werte
  // `hasOwn` says the code is there, so the fallback is dead.
  if (werte && Object.hasOwn(werte, code)) return werte[code] ?? code
  return code === 'true' ? 'Ja' : code === 'false' ? 'Nein' : code
}

/** The text of a question: what the form asks, else its label. */
const frageText = (knoten: SchemaNode | null, feld: string): string => (knoten ? (knoten.frage ?? labelOf(knoten)) : feld)

/** A question of `nennt` as a sentence: which answers ask for evidence, or that the field is filled in. */
export interface EinfacherSatz {
  frage: string
  /** The names of the answers that ask for evidence. */
  antworten: string[]
  /** The question is answered by the field being filled. */
  gefuellt: boolean
  jede?: undefined
  ausser?: undefined
}

/** A question of `nennt` as a sentence: any answer but some. */
export interface JedeAntwortSatz {
  frage: string
  antworten: string[]
  gefuellt: boolean
  jede: true
  /** The names of the answers that are none of "any answer". */
  ausser: string[]
}

/** A question of `nennt` as a sentence. */
export type FrageSatz = EinfacherSatz | JedeAntwortSatz

/**
 * A question of `nennt` as a sentence the department reads: „Art der Einnahmen = Lohn / Gehalt“,
 * that a field is filled in, or any answer but some (`"ja": ["*"]`): „Staatsangehörigkeit: jede
 * Antwort außer „Österreich“, …“.
 */
export function satzVon(frage: Frage, schema: Schema | null | undefined): FrageSatz {
  const knoten = schema ? knotenMitId(schema, frage.feld) : null
  const namen = (codes: readonly string[]): string[] => [...new Set(codes.map((code) => antwortName(knoten, code)))]
  const jede = !frage.gefuellt && (frage.ja ?? []).includes(JEDE_ANTWORT)
  const satz: EinfacherSatz = {
    frage: frageText(knoten, frage.feld).replace(/\s*\?\s*$/, ''),
    antworten: frage.gefuellt || jede ? [] : namen(frage.ja ?? []),
    gefuellt: frage.gefuellt === true,
  }
  return jede ? { ...satz, jede: true, ausser: namen(frage.nein ?? []) } : satz
}

/** A sentence of `satzVon` in one line. */
export const satzText = ({ frage, antworten, gefuellt, jede, ausser = [] }: FrageSatz): string => {
  if (gefuellt) return `„${frage}“ ist ausgefüllt`
  if (jede) return `${frage}: jede Antwort${ausser.length > 0 ? ` außer „${ausser.join('“, „')}“` : ''}`
  return `${frage} = „${antworten.join('“ oder „')}“`
}

/** What of a place the page reads to say when it asks for evidence. */
export type GiltStelle = Pick<StelleFormat2, 'position'> & Partial<StelleFormat2>

/** When a place asks for evidence: the questions, or how the structure decides. */
export interface GiltWenn {
  saetze: FrageSatz[]
  /** How the structure decides, where no question does. */
  art: 'immer' | 'abschnitt' | null
}

/** Does the section of a place decide by being in the application: may it be missing, or occur more than once? */
function abschnittEntscheidet(stelle: GiltStelle, schema: Schema | null | undefined): boolean {
  if (stelle.herkunft?.art === 'abschnitt') return true
  if (!schema || stelle.position.startsWith('/')) return false
  // A field at the root hangs in the schema itself, which has no multiplicity: neither optional nor repeated.
  const behaelter = findeBehaelter(schema, stelle.position)
  return optionalOderWiederholbar(behaelter && 'id' in behaelter ? behaelter : null)
}

/**
 * When a place asks for evidence, in sentences: the questions („oder“ between them), or how the
 * structure decides (`art`: 'immer' | 'abschnitt') — also where a rule names the place in words the
 * page does not understand: the engine then goes by the structure, too.
 */
export function giltWenn(stelle: GiltStelle, schema: Schema | null | undefined): GiltWenn {
  if (stelle.nennt === 'immer') return { saetze: [], art: 'immer' }
  const saetze = fragenVon(stelle.nennt).map((frage) => satzVon(frage, schema))
  if (saetze.length > 0) return { saetze, art: null }
  return { saetze: [], art: abschnittEntscheidet(stelle, schema) ? 'abschnitt' : 'immer' }
}

/** „Gilt, wenn …“ of a condition in one line. */
export function bedingungsText(stelle: GiltStelle, bedingung: Pick<Partial<Bedingung>, 'wenn'>, schema: Schema | null | undefined): string {
  if (stelle.unterscheiden && bedingung.wenn) return satzText(satzVon(bedingung.wenn, schema))
  const { saetze, art } = giltWenn(stelle, schema)
  if (saetze.length > 0) return saetze.map(satzText).join(' oder ')
  return art === 'abschnitt' ? 'der Abschnitt im Antrag ausgefüllt ist' : 'der Antrag diese Stelle enthält'
}

/** Where in the application the place is, from the groups of the schema: „Einkommen › Details › Nachweis“. */
export function pfadText(stelle: Pick<StelleFormat2, 'position'>, schema: Schema | null | undefined): string | null {
  if (schema && istOneProofSchema(schema)) return pfadZu(schema, stelle.position)?.map(labelOf).join(' › ') ?? null
  const [gruppe, feld] = stelle.position.split('/')
  const pfad = schema ? (gruppe ? pfadMitId(schema, gruppe) : []) : null
  const feldKnoten = schema && feld !== undefined ? knotenMitId(schema, feld) : null
  if (!pfad) return null
  return [...pfad.map(labelOf), feldKnoten ? labelOf(feldKnoten) : feld].join(' › ')
}

/** Is the place inside a repeated group of a person: asked for every person on its own? */
export function jePerson(stelle: Pick<StelleFormat2, 'position'>, anbindung: Pick<Partial<Anbindung>, 'personen'> | null | undefined, schema: Schema | null | undefined): boolean {
  if (schema && istOneProofSchema(schema)) return jePersonImSchema(schema, stelle.position)
  const [gruppe] = stelle.position.split('/')
  const pfad = schema && gruppe ? (pfadMitId(schema, gruppe) ?? []) : []
  const personen = Object.values(anbindung?.personen ?? {}).map((person) => person.gruppe)
  return pfad.some((knoten) => personen.includes(knoten.id))
}

/** How many documents a condition accepts, by role. */
export function zaehleRollen(bedingung: Pick<Partial<Bedingung>, 'nachweise'>): Record<Rolle, number> {
  const zahlen: Record<Rolle, number> = { genuegt: 0, pruefen: 0, ergaenzt: 0 }
  for (const wert of Object.values(bedingung.nachweise ?? {})) {
    const { rolle } = eintragVon(wert)
    if (Object.hasOwn(zahlen, rolle)) zahlen[rolle]++
  }
  return zahlen
}

/** „2 genügen · 1 kann genügen“ — or that none is accepted yet. */
export function nachweisText(bedingung: Pick<Partial<Bedingung>, 'nachweise'>): string {
  const { genuegt, pruefen, ergaenzt } = zaehleRollen(bedingung)
  const teile = [
    genuegt > 0 && zaehle(genuegt, 'genügt', 'genügen'),
    pruefen > 0 && zaehle(pruefen, 'kann genügen', 'können genügen'),
    ergaenzt > 0 && zaehle(ergaenzt, 'ergänzt nur', 'ergänzen nur'),
  ].filter(Boolean)
  return teile.length > 0 ? teile.join(' · ') : 'noch keine Nachweise zugelassen'
}

/** „mindestens 3 Monate, höchstens 6 Monate alt“. */
export function zeitraumText(zeitraum: Zeitraum | null | undefined): string | null {
  if (!zeitraum) return null
  const { hoechstensAlt } = zeitraum
  const alt = typeof hoechstensAlt === 'number' && Number.isInteger(hoechstensAlt) ? `, höchstens ${zaehle(hoechstensAlt, 'Monat', 'Monate')} alt` : ''
  return `mindestens ${zaehle(zeitraum.mindestens, 'Monat', 'Monate')}${alt}`
}

/** The places of one section. */
export interface Bereich {
  bereich: string
  stellen: StelleFormat2[]
}

/** The places of an application type by section, and those that ask for no evidence on purpose. */
export interface Stellengruppen {
  bereiche: Bereich[]
  ohne: StelleFormat2[]
}

/**
 * The places of an application type by section, in the order of the schema, and those that ask
 * for no evidence on purpose.
 */
export function gruppiereStellen(antragsart: Pick<Partial<AntragsartFormat2>, 'stellen'> | null | undefined): Stellengruppen {
  const bereiche: Bereich[] = []
  const ohne: StelleFormat2[] = []
  for (const stelle of antragsart?.stellen ?? []) {
    if (stelle.ohne) {
      ohne.push(stelle)
      continue
    }
    const bereich = stelle.bereich || 'Allgemein'
    let gruppe = bereiche.find((kandidat) => kandidat.bereich === bereich)
    if (!gruppe) bereiche.push((gruppe = { bereich, stellen: [] }))
    gruppe.stellen.push(stelle)
  }
  return { bereiche, ohne }
}

/** How many conditions an application type has, by state, and how many a draft changes. */
export interface Bedingungszahlen extends Record<Status, number> {
  gesamt: number
  geaendert: number
}

/** The conditions of an application type by their state, and how many a draft changes. */
export function zaehleBedingungen(antragsart: Pick<Partial<AntragsartFormat2>, 'schema' | 'stellen'> | null | undefined, geaendert: ReadonlySet<string> = new Set()): Bedingungszahlen {
  const zahlen: Bedingungszahlen = { gesamt: 0, festgelegt: 0, vorschlag: 0, offen: 0, geaendert: 0 }
  if (!antragsart) return zahlen
  for (const stelle of antragsart.stellen ?? []) {
    if (stelle.ohne) continue
    for (const bedingung of stelle.bedingungen) {
      zahlen.gesamt++
      if (Object.hasOwn(zahlen, bedingung.status)) zahlen[bedingung.status]++
      if (geaendert.has(`${antragsart.schema}|${bedingung.id}`)) zahlen.geaendert++
    }
  }
  return zahlen
}

/** Which conditions show: all, those in a state, or those the draft changed. */
export type Filter = 'alle' | 'geaendert' | Status

/** Does a condition show under the filter chosen: all, a state, or changed? */
export const passtZumFilter = (filter: Filter, bedingung: Pick<Bedingung, 'status'>, istGeaendert: boolean): boolean =>
  filter === 'alle' || (filter === 'geaendert' ? istGeaendert : bedingung.status === filter)

/**
 * The names of the application types without what they all begin with: „Mietzuschuss, Erstantrag“
 * for „Wohngeld – Mietzuschuss, Erstantrag“. A name is left whole where nothing would remain.
 *
 * @returns the short names by schema
 */
export function kurznamen(antragsarten: readonly (Pick<Antragsart, 'schema'> & Partial<Pick<Antragsart, 'name'>>)[]): Map<string, string> {
  const namen = antragsarten.map((art) => art.name ?? art.schema)
  const [erster = ''] = namen
  let vorn = namen.length > 1 ? erster : ''
  for (const name of namen) while (vorn && !name.startsWith(vorn)) vorn = vorn.slice(0, -1)
  // Only up to a separator: „Wohngeld – “, not „Wohngeld – Mi“.
  const ende = (trenner: string): number => (vorn.includes(trenner) ? vorn.lastIndexOf(trenner) + trenner.length : 0)
  const schnitt = Math.max(ende(' – '), ende(', '))
  return new Map(
    antragsarten.map((art): [string, string] => {
      const name = art.name ?? art.schema
      return [art.schema, name.slice(schnitt).trim() || name]
    }),
  )
}

/** A condition a condition can take its setting from. */
export interface Vorlage {
  schema: string
  bedingungId: string
  text: string
}

/**
 * The conditions a condition can take its setting from: the others of its place, and those of the
 * same place in the other application types of the profile — in an application type of the other
 * format, which names its places differently, the place of the same id.
 */
export function vorlagenFuer(roh: Pick<Partial<ProfilFormat2>, 'antragsarten'>, schema: string, stelle: Pick<StelleFormat2, 'id' | 'position'>, bedingungId: string): Vorlage[] {
  const namen = kurznamen(roh.antragsarten ?? [])
  const formatVon = (art: Pick<Antragsart, 'format'> | undefined): 'oneproof' | 'fim' => (art?.format === 'oneproof' ? 'oneproof' : 'fim')
  const eigenesFormat = formatVon((roh.antragsarten ?? []).find((art) => art.schema === schema))
  const liste: Vorlage[] = []
  for (const antragsart of roh.antragsarten ?? []) {
    const gleiche = antragsart.schema === schema
    const gleichesFormat = formatVon(antragsart) === eigenesFormat
    for (const andere of antragsart.stellen ?? []) {
      const dieselbe = gleiche || !gleichesFormat ? andere.id === stelle.id : andere.position === stelle.position
      if (andere.ohne || !dieselbe) continue
      for (const bedingung of andere.bedingungen) {
        if (gleiche && bedingung.id === bedingungId) continue
        const teile = [gleiche ? null : namen.get(antragsart.schema), andere.bedingungen.length > 1 ? (bedingung.titel ?? bedingung.id) : gleiche ? null : andere.titel]
        liste.push({ schema: antragsart.schema, bedingungId: bedingung.id, text: teile.filter(Boolean).join(' › ') || bedingung.id })
      }
    }
  }
  return liste
}

/** A condition that is still open, with where it is. */
export interface OffeneBedingung {
  schema: string
  antragsart: string
  stelle: string
  /** Its name where the place has several; `null` where it has one. */
  bedingung: string | null | undefined
}

/** Conditions of a profile that are still open, and how many proposals wait. */
export function offenImProfil(roh: Pick<Partial<ProfilFormat2>, 'antragsarten'> | null | undefined): { offen: OffeneBedingung[]; vorschlaege: number } {
  const offen: OffeneBedingung[] = []
  let vorschlaege = 0
  for (const antragsart of roh?.antragsarten ?? []) {
    for (const stelle of antragsart.stellen ?? []) {
      if (stelle.ohne) continue
      for (const bedingung of stelle.bedingungen) {
        if (bedingung.status === 'offen') offen.push({ schema: antragsart.schema, antragsart: antragsart.name, stelle: stelle.titel, bedingung: stelle.bedingungen.length > 1 ? bedingung.titel : null })
        if (bedingung.status === 'vorschlag') vorschlaege++
      }
    }
  }
  return { offen, vorschlaege }
}

/* ------------------------------------------------------------------------------------------ */
/* The documents of a condition                                                                */
/* ------------------------------------------------------------------------------------------ */

const REIHE: Readonly<Record<string, number>> = { genuegt: 0, pruefen: 1, ergaenzt: 2 }

/** A type of the catalogue as a row for a condition. */
export interface Zeile {
  typ: string
  label: string
  /** How the type counts now; `null` where it does not. */
  rolle: Rolle | null
  merkmale: Merkmale
  ersatzweise: Ersatzweise | null
  /** How it counted in the version the draft was made from; `undefined` where that version lacks the condition. */
  vorher: Rolle | null | undefined
  /** The condition names the type, now or in that version. */
  vorgesehen: boolean
  /** The catalogue does not know the type. */
  unbekannt?: true
}

/**
 * Every type of the catalogue as a row for a condition: how it counts now and in the version the
 * draft was made from (`vorher`, `undefined` where that version lacks the condition).
 *
 * The types the condition named when it was opened (`anfang`) or names in that version come first
 * (`vorgesehen`), strongest first. The order follows `anfang`, so that a row does not jump away
 * while it is being set.
 */
export function zeilenFuer(
  bedingung: Pick<Partial<Bedingung>, 'nachweise'>,
  basisBedingung: Pick<Partial<Bedingung>, 'nachweise'> | null | undefined,
  typen: ReadonlyMap<string, Pick<Dokumenttyp, 'label'>>,
  anfang: Pick<Partial<Bedingung>, 'nachweise'> = bedingung,
): Zeile[] {
  const genannt = new Set([...Object.keys(anfang.nachweise ?? {}), ...Object.keys(basisBedingung?.nachweise ?? {})])
  const zeile = (typ: string, label: string, unbekannt = false): Zeile => {
    const jetzt = eintragVon(bedingung.nachweise?.[typ])
    return {
      typ,
      label,
      rolle: jetzt.rolle,
      merkmale: jetzt.merkmale,
      ersatzweise: jetzt.ersatzweise,
      vorher: basisBedingung ? eintragVon(basisBedingung.nachweise?.[typ]).rolle : undefined,
      vorgesehen: genannt.has(typ),
      ...(unbekannt ? { unbekannt: true } : {}),
    }
  }
  const zeilen = [...typen].map(([typ, eintrag]) => zeile(typ, eintrag.label ?? typ))
  // A type the condition names that the catalogue does not know stays visible.
  for (const typ of new Set([...genannt, ...Object.keys(bedingung.nachweise ?? {})])) {
    if (!typen.has(typ)) zeilen.push({ ...zeile(typ, typ, true), vorgesehen: true })
  }
  const rang = (typ: string): number => {
    const { rolle } = eintragVon(anfang.nachweise?.[typ])
    return rolle === null ? 3 : (REIHE[rolle] ?? 3)
  }
  const nachLabel = (a: Zeile, b: Zeile): number => a.label.localeCompare(b.label, 'de')
  return [
    ...zeilen.filter((eintrag) => eintrag.vorgesehen).sort((a, b) => rang(a.typ) - rang(b.typ) || nachLabel(a, b)),
    ...zeilen.filter((eintrag) => !eintrag.vorgesehen).sort(nachLabel),
  ]
}

const normalisiere = (text: string | null | undefined): string =>
  String(text ?? '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')

/** The rows that fit what is typed: every word, anywhere in the name or the key. */
export function filtereZeilen<Z extends Pick<Zeile, 'label' | 'typ'>>(zeilen: readonly Z[], suche = ''): Z[] {
  const woerter = normalisiere(suche).split(/\s+/).filter(Boolean)
  return zeilen.filter((zeile) => woerter.every((wort) => normalisiere(`${zeile.label} ${zeile.typ}`).includes(wort)))
}

/** The documents of a condition in a sentence: „2 Nachweisarten genügen allein, 1 kann genügen. Alle anderen zählen nicht.“ */
export function rollenSatz(bedingung: Pick<Partial<Bedingung>, 'nachweise'>): string {
  const { genuegt, pruefen, ergaenzt } = zaehleRollen(bedingung)
  if (genuegt + pruefen + ergaenzt === 0) return 'Noch ist keine Unterlage zugelassen. Solange das so bleibt, verlangt die Prüfung hier nichts.'
  const teile = [
    genuegt === 0 ? 'Keine Nachweisart genügt allein' : zaehle(genuegt, 'Nachweisart genügt allein', 'Nachweisarten genügen allein'),
    pruefen > 0 && `${pruefen} ${pruefen === 1 ? 'kann' : 'können'} genügen`,
    ergaenzt > 0 && `${ergaenzt} ${ergaenzt === 1 ? 'ergänzt' : 'ergänzen'} nur`,
  ].filter((teil): teil is string => teil !== false)
  return `${aufzaehlung(teile)}. Alle anderen zählen hier nicht.`
}

/**
 * The conditions of a line in words — „Gilt nur für: Lohn / Gehalt“ — where the profile has a
 * table of values that names them (`wertetabellen`). A condition it cannot name is left out.
 */
export function merkmalText(merkmale: Merkmale | undefined, wertetabellen: Wertetabellen | undefined): string | null {
  const eintraege = Object.values(wertetabellen ?? {}).flatMap((tabelle) => Object.values(tabelle))
  const werte = Object.values(merkmale ?? {}).flat()
  const namen = werte.flatMap((wert) => eintraege.filter((eintrag) => eintrag.typen?.includes(wert)).map((eintrag) => eintrag.kurz))
  const einzigartig = [...new Set(namen)]
  return einzigartig.length > 0 ? `Gilt nur für: ${aufzaehlung(einzigartig)}` : null
}

/** An accepted document type as the applicant reads it. */
export interface VorschauQuelle {
  typ: string
  label: string
  rolle: Rolle
}

/** What an applicant reads of the accepted documents (`WelcheUnterlagen` of the check). */
export function vorschauQuellen(bedingung: Pick<Partial<Bedingung>, 'nachweise'>, typen: ReadonlyMap<string, Pick<Dokumenttyp, 'label'>>): VorschauQuelle[] {
  return Object.entries(bedingung.nachweise ?? {})
    .map(([typ, wert]) => ({ typ, label: typen.get(typ)?.label ?? typ, rolle: eintragVon(wert).rolle }))
    .filter(({ rolle }) => Object.hasOwn(REIHE, rolle))
    .sort((a, b) => a.label.localeCompare(b.label, 'de'))
}

/** Is a document counted month by month? The catalogue says so with a field „monat“. */
export const zaehltJeMonat = (eintrag: Pick<Dokumenttyp, 'fields'> | null | undefined): boolean => Object.hasOwn(eintrag?.fields ?? {}, 'monat')

/* ------------------------------------------------------------------------------------------ */
/* Period                                                                                      */
/* ------------------------------------------------------------------------------------------ */

/** A whole number of months from 1 on, as typed — or `null`. */
export function liesMonate(text: unknown): number | null {
  const getippt = String(text).trim()
  return /^\d{1,3}$/.test(getippt) && Number(getippt) >= 1 ? Number(getippt) : null
}

/* ------------------------------------------------------------------------------------------ */
/* The draft                                                                                   */
/* ------------------------------------------------------------------------------------------ */

/** "14:32 Uhr", from the time a draft was saved. */
export const uhrzeitText = (iso: string): string => `${new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`
