/**
 * The targets of an application: every place at which evidence may be referenced.
 *
 * This is the one half of the placement (the other are the documents, see `posten.ts`). It is
 * derived — not hand-written per benefit — from three sources:
 *
 *  - the schema: where places of evidence exist;
 *  - the application: which of these places the application actually has (and for which person);
 *  - the profile (`stellen`): which art of evidence belongs to a position, whether a question of the
 *    application states the fact, which features tell repeated entries apart.
 *
 * The result feeds the placement engine and, at the same time, is the list of requirements the
 * result page shows: a *named* target is a fact the application states and therefore has to be
 * established; a *catch-all* target exists so that evidence which the application does not ask for
 * still lands in the right section instead of getting lost.
 *
 * How the places are found and values read differs by format and is behind a {@link Zugang}: FIM
 * (`fim/zugang.ts`) knows file fields in groups, the OneProof Format (`oneproof/zugang.ts`) places
 * named by JSON Pointer patterns. Everything in here is the same for both.
 */

import type { Node } from '../fim/instanz.ts'
import type { Schema } from '../fim/schema.ts'
import { fimZugang } from '../fim/zugang.ts'
import type { Ort as FimOrt } from '../fim/zugang.ts'
import type { Ort as OneProofOrt } from '../oneproof/zugang.ts'
import type { Frage, Merkmale, Nennt, Profil, Stelle } from '../profil/laden.ts'

const EURO = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })

/**
 * A placeholder in a sentence of the profile: `{F00000000575|eur}` (FIM) or
 * `{/fachdaten/personen/*\/einkommen/eintraege/*\/betrag|eur}` (OneProof Format), with an optional format.
 */
export const PLATZHALTER = /\{(F\d+|\/[^|}]*)(?:\|([^}]+))?\}/g

/** In `ja` of a question: any answer that is not listed under `nein` or `spaeter`. */
export const JEDE_ANTWORT = '*'

/** A target as the placement engine uses it. */
export interface Ziel {
  slot: string
  art: string
  person: number | null
  merkmale: Merkmale
  opensSection: boolean
  keepsSection: boolean
  label: string
}

/** Everything the result needs to know about a target beyond what the placement engine uses. */
export interface ZielInfo {
  slot: string
  /** Id of the `stelle` in the profile. */
  stelle: string
  art: string
  bereich: string | null
  titel: string
  /** What to bring, where the profile says it for this place. */
  hinweis: string | null
  person: number | null
  personLabel: string | null
  /** 1-based position among the entries of a repeated group. */
  eintrag: number | null
  /** Number of entries. */
  von: number | null
  /** What the application says, in words. */
  aussage: string | null
  /** Labels of the groups from the section down to the place. */
  pfad: string[]
  /** The application states the fact → a requirement. */
  benannt: boolean
  /** The answer to the question is still outstanding. */
  spaeter: boolean
  /** The question that states the fact (if the profile names one). */
  frage: string | null
  /** Where in the application a reference to evidence for it is written. */
  ort: Ort
}

/**
 * Where the package writes a reference to evidence for a target. Its form is the format's:
 * FIM names the file field and the groups down to it (`fim/zugang.ts`), the OneProof Format the
 * JSON Pointer of the value the evidence supports (`oneproof/zugang.ts`).
 */
export type Ort = FimOrt | OneProofOrt

/** A place of a position in one application, as the access finds it. */
export interface Fall {
  /** The application has the place, or ends above it. */
  art: 'vorhanden' | 'fehlt'
  /** Only the place itself is missing, not a section above it: evidence may open it. */
  direkt: boolean
  /** The person of the household it belongs to (0 = applicant). */
  person: number | null
  /** The place is there although it need not be: its existence states the fact. */
  sagtAus: boolean
  /** 1-based position among the entries of a list. */
  eintrag: number | null
  /** Number of entries. */
  von: number | null
  /** Labels from the section down to the place. */
  pfad: string[]
  ort: Ort
}

/** A person of the household named in parts, as the application gives the name. */
export interface Namensteile {
  vorname: string
  nachname: string
  geburtsname: string
  anzeige: string
}

/** A person the application names outside the household (a flatmate, a deceased member, …), with the role it gives her. */
export interface NebenpersonInfo {
  id: string
  vorname: string
  nachname: string
  anzeige: string
  rolle: string
}

/** What the derivation needs of an application, whatever its format. */
export interface Zugang {
  /** The persons of the household, the applicant first; `null` where the application gives no name. */
  namensteile: (Namensteile | null)[]
  /** Persons the application names outside the household. */
  nebenpersonen: NebenpersonInfo[]
  /** The role of a person of the household, in words. */
  rolle: (person: number) => string | null
  /** A person without a name, in words. */
  bezeichnung: (person: number) => string
  /** The places of a position. */
  faelle: (position: string) => Fall[]
  /** The value of a field next to a place (`null`: in the whole application), as text. */
  wert: (feld: string, fall: Fall | null) => string | null
  /** The question of a field. */
  frage: (feld: string) => string
  /** An answer in words, for the reader. */
  antwort: (feld: string, wert: string) => string
  /** A code in words, for a sentence. */
  code: (feld: string, wert: string) => string
  /** The person outside the household the place holds. */
  nebenperson: (fall: Fall) => string | null
}

/** A requirement the application rules out itself: the answer in the application is the reason. */
export interface Entfaellt {
  id: string
  stelle: string
  art: string
  bereich: string | null
  titel: string
  person: number | null
  personLabel: string | null
  /** The question of the application. */
  frage: string
  /** The answer given. */
  antwort: string
  /** Every question that said "no", where several do (see `nennt` as a list). */
  antworten: { frage: string; antwort: string }[]
}

/** What {@link baueZiele} derives: the targets, how to describe them, and what the application rules out. */
export interface Zielableitung {
  /** The targets in the order of the profile; the first wins on a tie. */
  ziele: Ziel[]
  /** What the result needs to know about every target, by slot. */
  infos: Map<string, ZielInfo>
  /** The requirements the application rules out itself. */
  entfaellt: Entfaellt[]
  /** The names of the persons of the household, `null` where the application gives none. */
  personen: (string | null)[]
  /** The role of every person of the household in words („antragstellende Person“, „Haushaltsmitglied“). */
  rollen: (string | null)[]
  /** The names of the household in parts, for the comparison with the names on documents. */
  namensteile: (Namensteile | null)[]
  /** Persons the application names outside the household: a flatmate, a deceased member, … */
  nebenpersonen: NebenpersonInfo[]
  /** Sentences about the situation of the applicant for the grouping model. */
  antragslage: string[]
}

/** What {@link baueZiele} reads: the profile, the schema and the application — in FIM, or through an access of any format. */
export type BaueZieleEingabe = ZieleAusFim | ZieleAusZugang

/** The application in FIM: its tree. */
export interface ZieleAusFim {
  profil: Profil
  schema: Schema
  wurzel: Node
  zugang?: undefined
}

/** The application of any format, behind its access. */
export interface ZieleAusZugang {
  profil: Profil
  schema: { schemaId: string }
  wurzel?: Node
  zugang: Zugang
}

/** What the derivation hands from function to function. */
interface Kontext {
  profil: Profil
  zugang: Zugang
}

/** What the derivation makes of a place: which kind of target it is, and whether the application rules it out. */
interface Urteil {
  ziel: ZielArt | null
  entfaellt: boolean
  spaeter: boolean
  gate: Gate | null
}

/** A named target states a fact of the application; a catch-all takes the evidence the application does not ask for. */
type ZielArt = 'benannt' | 'auffang'

/** How the answer to a question counts. */
type Klasse = 'ja' | 'nein' | 'spaeter'

/** An answer that counts: the question, the value, and what it says. */
interface Beantwortet {
  feld: string
  wert: string
  klasse: Klasse
}

/** The answer that decided, and every question that gave it. */
interface Gate extends Beantwortet {
  alle: { feld: string; wert: string }[]
}

/** No question gave an answer that counts. */
interface Offen {
  feld: string | null
  wert: null
  klasse: null
  alle: []
}

/** The reading of one question: an answer that counts, or not. */
type Antwort = Beantwortet | { feld: string; wert: string | null; klasse: null }

/** A place of a position in an application, with the judgement of the profile on it. */
interface Fundort {
  fall: Fall
  urteil: Urteil
}

/** Derives the targets of an application from profile, schema and application. */
export function baueZiele(eingabe: BaueZieleEingabe): Zielableitung {
  const { profil, schema } = eingabe
  const zugang: Zugang =
    eingabe.zugang === undefined ? fimZugang({ profil, schema: eingabe.schema, wurzel: eingabe.wurzel }) : eingabe.zugang
  const kontext: Kontext = { profil, zugang }

  const ziele: Ziel[] = []
  const infos = new Map<string, ZielInfo>()
  const entfaellt: Entfaellt[] = []

  for (const stelle of profil.stellen) {
    // A place of format 2 belongs to one application type.
    if (stelle.antragsarten && !stelle.antragsarten.includes(schema.schemaId)) continue

    const faelle: Fundort[] = []
    for (const position of stelle.positionen) {
      for (const fall of zugang.faelle(position)) faelle.push({ fall, urteil: bewerte(stelle, fall, kontext) })
    }

    const zaehler = new Map<number | string, number>()
    for (const { fall, urteil } of stelle.einmal ? einmalFuerDenHaushalt(faelle) : faelle) {
      if (urteil.entfaellt) {
        const eintrag = entfaelltEintrag(stelle, fall, urteil, kontext)
        // One note per statement and person, however many rows say the same.
        if (!entfaellt.some((vorhanden) => vorhanden.id === eintrag.id)) entfaellt.push(eintrag)
      }

      if (urteil.ziel === null) continue

      const person = fall.person
      const schluessel = person ?? '-'
      const nummer = (zaehler.get(schluessel) ?? 0) + 1
      zaehler.set(schluessel, nummer)

      const slot = `${stelle.id}#p${schluessel}#${nummer}`
      const info = infoFuer(stelle, fall, urteil, slot, kontext)

      ziele.push({
        slot,
        art: stelle.art,
        person,
        merkmale: { ...merkmaleFuer(stelle, fall, kontext), ...nebenpersonMerkmal(fall, kontext) },
        opensSection: urteil.ziel === 'auffang',
        keepsSection: urteil.ziel === 'benannt' && fall.art === 'fehlt',
        label: etikett(info),
      })
      infos.set(slot, info)
    }
  }

  return {
    ziele,
    infos,
    entfaellt,
    personen: zugang.namensteile.map((teile) => teile?.anzeige ?? null),
    /** The role of every person of the household in words („antragstellende Person“, „Haushaltsmitglied“). */
    rollen: zugang.namensteile.map((_, person) => zugang.rolle(person)),
    /** The names of the household in parts, for the comparison with the names on documents. */
    namensteile: zugang.namensteile,
    /** Persons the application names outside the household: a flatmate, a deceased member, … */
    nebenpersonen: zugang.nebenpersonen.map(({ id, vorname, nachname, anzeige, rolle }) => ({ id, vorname, nachname, anzeige, rolle })),
    antragslage: antragslageVon(profil, schema.schemaId, kontext),
  }
}

/**
 * A statement that belongs to the household although the schema asks for it per person — the
 * costs of child care: ONE requirement, at the first person who states it (as in the original),
 * open to the documents of every person. Only if nobody states it does a "no" count, and then once.
 */
function einmalFuerDenHaushalt(faelle: Fundort[]): Fundort[] {
  const haushaltsweit = ({ fall, ...rest }: Fundort): Fundort => ({ ...rest, fall: { ...fall, person: null } })

  const benannt = faelle.find(({ urteil }) => urteil.ziel === 'benannt')
  if (benannt) return [haushaltsweit(benannt)]

  const auffang = faelle.find(({ urteil }) => urteil.ziel === 'auffang')
  const nein = faelle.find(({ urteil }) => urteil.entfaellt)
  if (nein) return [haushaltsweit({ ...nein, urteil: { ...nein.urteil, ziel: auffang ? 'auffang' : null } })]
  return auffang ? [haushaltsweit(auffang)] : []
}

/**
 * The feature that ties a place to a person outside the household. A place whose entry holds such
 * a person (the row of the flatmate, the entry of the deceased, the maintenance row with its
 * recipient) carries that person, so that a document in their name finds exactly this entry. A
 * place of a person of the household that holds nobody else carries `-`: a document in the name
 * of someone outside the household is no evidence for a fact about a member of the household.
 */
function nebenpersonMerkmal(fall: Fall, { zugang }: Kontext): Merkmale {
  const person = zugang.nebenperson(fall)
  if (person) return { nebenperson: person }
  return fall.person === null ? {} : { nebenperson: KEINE_NEBENPERSON }
}

/** Marks a place of the household that holds no person from outside it. */
export const KEINE_NEBENPERSON = '-'

/**
 * What the application says about the situation of the applicant, as sentences for the grouping
 * model (the profile's `antragslage`): tenant or subtenant, owner of a flat or a house. It tells the
 * direction of a document — a sublease contract the applicant pays under looks exactly like one she
 * earns from. Sentences whose values the application does not give are left out.
 */
function antragslageVon(profil: Profil, schemaId: string, kontext: Kontext): string[] {
  const saetze = profil.anbindungFuer ? profil.anbindungFuer(schemaId).antragslage : profil.antragslage
  return (saetze ?? []).map((vorlage) => fuelle(vorlage, null, kontext)).filter((satz) => satz !== null)
}

/* ---------------------------------------------------------------------------------------------
 * Does the application state the fact?
 * ------------------------------------------------------------------------------------------- */

function bewerte(stelle: Stelle, fall: Fall, kontext: Kontext): Urteil {
  const nennt = stelle.nennt ?? null
  const auffang = fall.direkt && stelle.auffang

  if (nennt === 'immer') {
    // The statement is made by the application type itself. It needs the parent chain, though:
    // if even that is missing, there is nothing to attach evidence to.
    return fall.direkt ? ergebnisVon('benannt') : ergebnisVon(null)
  }

  const gate = nennt ? lesen(nennt, fall, kontext) : null

  // A place the application has — as an entry that may or may not be there — states the fact by
  // existing. Only a place that is always there says nothing by its presence, and nor does one the
  // profile lets the question alone decide about (`nurFrage`): "details of the rent" exist for a
  // tenant and for a resident of a home alike.
  if (fall.art === 'vorhanden' && !stelle.nurFrage && (!nennt || fall.sagtAus)) {
    return ergebnisVon('benannt')
  }

  if (!gate) return ergebnisVon(auffang ? 'auffang' : null)

  switch (gate.klasse) {
    case 'ja':
      return ergebnisVon('benannt', { gate })
    case 'spaeter':
      return ergebnisVon('benannt', { gate, spaeter: true })
    case 'nein':
      return ergebnisVon(auffang ? 'auffang' : null, { gate, entfaellt: true })
    default:
      return ergebnisVon(auffang ? 'auffang' : null)
  }
}

const ergebnisVon = (ziel: ZielArt | null, zusatz: Partial<Urteil> = {}): Urteil => ({
  ziel,
  entfaellt: false,
  spaeter: false,
  gate: null,
  ...zusatz,
})

/**
 * Reads the question(s) named by `nennt` next to the place and classifies the answer.
 *
 * Several questions are read as "or" — "severely disabled OR in need of care": one "yes" states
 * the fact, an outstanding answer keeps it open, and only "no" without any "yes" makes it not
 * apply. A question the application (or its schema) does not have counts as unanswered, which is
 * also how one list serves application types that ask the same in different fields.
 *
 * @returns the answer that decided, with `alle`: every question that gave it
 */
function lesen(nennt: Exclude<Nennt, 'immer'>, fall: Fall, kontext: Kontext): Gate | Offen {
  const antworten = (Array.isArray(nennt) ? nennt : [nennt]).map((frage) => leseFrage(frage, fall, kontext))

  for (const klasse of ['ja', 'spaeter', 'nein'] as const) {
    const treffer = antworten.filter((antwort): antwort is Beantwortet => antwort.klasse === klasse)
    const [erste] = treffer
    if (erste) return { ...erste, alle: treffer.map(({ feld, wert }) => ({ feld, wert })) }
  }
  return { feld: antworten[0]?.feld ?? null, wert: null, klasse: null, alle: [] }
}

function leseFrage(frage: Frage, fall: Fall, { zugang }: Kontext): Antwort {
  const wert = zugang.wert(frage.feld, fall)

  if (wert === null || wert === '') return { feld: frage.feld, wert: null, klasse: null }
  if (frage.gefuellt) return { feld: frage.feld, wert, klasse: 'ja' }
  if ((frage.ja ?? []).includes(wert)) return { feld: frage.feld, wert, klasse: 'ja' }
  if ((frage.nein ?? []).includes(wert)) return { feld: frage.feld, wert, klasse: 'nein' }
  if ((frage.spaeter ?? []).includes(wert)) return { feld: frage.feld, wert, klasse: 'spaeter' }
  // `ja: ["*"]`: every other answer states the fact — a citizenship outside a list of states.
  if ((frage.ja ?? []).includes(JEDE_ANTWORT)) return { feld: frage.feld, wert, klasse: 'ja' }
  return { feld: frage.feld, wert, klasse: null }
}

/* ---------------------------------------------------------------------------------------------
 * Description of a target
 * ------------------------------------------------------------------------------------------- */

function infoFuer(stelle: Stelle, fall: Fall, urteil: Urteil, slot: string, kontext: Kontext): ZielInfo {
  const person = fall.person
  return {
    slot,
    stelle: stelle.id,
    art: stelle.art,
    bereich: stelle.bereich ?? null,
    titel: stelle.titel,
    hinweis: stelle.hinweis ?? null,
    person,
    personLabel: person === null ? null : bezeichnungVon(person, kontext),
    eintrag: fall.eintrag,
    von: fall.von,
    aussage: stelle.aussage ? fuelle(stelle.aussage, fall, kontext) : null,
    pfad: fall.pfad,
    benannt: urteil.ziel === 'benannt',
    spaeter: urteil.spaeter,
    frage: urteil.gate ? kontext.zugang.frage(urteil.gate.feld) : null,
    ort: fall.ort,
  }
}

function etikett(info: ZielInfo): string {
  const teile = [info.titel]
  if (info.personLabel) teile.push(info.personLabel)
  if (info.eintrag && info.von && info.von > 1) teile.push(`Zeile ${info.eintrag}`)
  return teile.join(' · ')
}

function bezeichnungVon(person: number, { zugang }: Kontext): string {
  return zugang.namensteile[person]?.anzeige || zugang.bezeichnung(person)
}

function merkmaleFuer(stelle: Stelle, fall: Fall, { profil, zugang }: Kontext): Merkmale {
  const merkmale: Merkmale = {}

  for (const spezifikation of stelle.merkmale) {
    // A feature the place has by itself: the property tax has its own field in the OneProof Format,
    // where FIM has a row with the kind of cost.
    if ('wert' in spezifikation) {
      merkmale[spezifikation.name] = spezifikation.wert
      continue
    }

    const roh = zugang.wert(spezifikation.feld, fall)
    if (roh === null || roh === '') continue

    if (spezifikation.tabelle) {
      const typen = profil.wertetabellen[spezifikation.tabelle]?.[roh]?.typen ?? []
      const [einziger] = typen
      if (einziger !== undefined && typen.length === 1) merkmale[spezifikation.name] = einziger
      else if (typen.length > 1) merkmale[spezifikation.name] = typen
    } else if (spezifikation.als === 'cent') {
      const cent = alsCent(roh)
      if (cent !== null) merkmale[spezifikation.name] = cent
    } else {
      merkmale[spezifikation.name] = roh
    }
  }

  return merkmale
}

/** "1789.00" → "178900": the form in which amounts are compared. */
export function alsCent(text: string): string | null {
  const zahl = Number(String(text).replace(',', '.'))
  return Number.isFinite(zahl) ? String(Math.round(zahl * 100)) : null
}

/* ---------------------------------------------------------------------------------------------
 * Sentences
 * ------------------------------------------------------------------------------------------- */

/** A sentence with placeholders filled from the application, or `null` if one stays empty. */
function fuelle(vorlage: string, fall: Fall | null, kontext: Kontext): string | null {
  let vollstaendig = true
  const text = vorlage.replace(PLATZHALTER, (_: string, feld: string, format: string | undefined) => {
    const roh = kontext.zugang.wert(feld, fall)
    const formatiert = formatiere(roh, feld, format, kontext)
    if (formatiert === null) vollstaendig = false
    return formatiert ?? ''
  })

  return vollstaendig ? text.replace(/\s+/g, ' ').trim() : null
}

function formatiere(roh: string | null | undefined, feld: string, format: string | undefined, { profil, zugang }: Kontext): string | null {
  if (roh === null || roh === undefined || roh === '') return null

  if (format === 'eur') {
    const zahl = Number(roh)
    return Number.isFinite(zahl) ? EURO.format(zahl) : null
  }

  if (format === 'code') return zugang.code(feld, roh)

  if (format?.startsWith('tabelle:')) {
    const name = format.slice('tabelle:'.length)
    return profil.wertetabellen[name]?.[roh]?.kurz ?? null
  }

  return roh
}

function entfaelltEintrag(stelle: Stelle, fall: Fall, urteil: Urteil, kontext: Kontext): Entfaellt {
  const { zugang } = kontext
  const person = fall.person
  const { gate } = urteil
  if (!gate) throw new Error(`Die Stelle ${stelle.id} entfällt ohne eine beantwortete Frage.`)
  const antworten = (gate.alle.length ? gate.alle : [gate]).map(({ feld, wert }) => ({
    frage: zugang.frage(feld),
    antwort: zugang.antwort(feld, wert),
  }))
  const [erste] = antworten
  if (!erste) throw new Error(`Die Stelle ${stelle.id} entfällt ohne eine beantwortete Frage.`)

  return {
    id: `${stelle.id}#p${person ?? '-'}`,
    stelle: stelle.id,
    art: stelle.art,
    bereich: stelle.bereich ?? null,
    titel: stelle.titel,
    person,
    personLabel: person === null ? null : bezeichnungVon(person, kontext),
    frage: erste.frage,
    antwort: erste.antwort,
    /** Every question that said "no", where several do (see `nennt` as a list). */
    antworten,
  }
}
