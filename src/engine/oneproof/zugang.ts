/**
 * The access of the target derivation (`zuordnung/ziele.ts`) to an application in the OneProof
 * Format.
 *
 * A place of evidence is a value of the application, named by a pattern: `/fachdaten/mietzuschuss/miete`,
 * `/fachdaten/personen/*\/einkommen/eintraege/*` for every entry of income of every person. The format
 * has no fields for files: an attachment names the values it supports (`anlagen[].bezuege`), and
 * this is what the package writes for a place (`Ort`).
 *
 * The persons are the list `personen`, the applicant first; any other place belongs to the person
 * its entry names with `person`. A question (`nennt`) is a pattern as well; its `*` take the
 * indices of the place, so that `/fachdaten/personen/*\/einkommen/vorhanden` is read for the person
 * of the place. Values are compared as text: `true`, `false`, `1789.5`, `tenant`.
 */

import { istObjekt } from '../json.ts'
import type { JsonObjekt } from '../json.ts'
import type { Profil } from '../profil/laden.ts'
import { comparisonKey } from '../zuordnung/personen.ts'
import type { Fall, Namensteile, Ort as ZielOrt, Zugang } from '../zuordnung/ziele.ts'
import type { OneProofAntrag } from './lesen.ts'
import { ANTRAGSTELLER, haushalt, personDerStelle } from './personen.ts'
import type { Haushaltsmitglied } from './personen.ts'
import { knotenNachId, pfadZu } from './schema.ts'
import type { OneProofKnoten, OneProofSchema } from './schema.ts'
import { JEDER, binde, istZeiger, mitgliedVon, musterVon, treffer, wertBei, zerlege, zusammen } from './zeiger.ts'

/**
 * Where the package refers to evidence for a target: the pointer of the value it supports. Where
 * the application ends above the place, the nearest value above it that still belongs to it (the
 * section of the person, the person) — or nothing where only the root is left.
 */
export interface Ort {
  /** JSON Pointer. */
  stelle: string | null
}

/** Is the place of a target one of an application in the OneProof Format (and not in FIM)? */
export const istOneProofOrt = (ort: ZielOrt): ort is Ort => 'stelle' in ort

/** The list of the persons of the application. */
const PERSONEN = '/personen'

/**
 * Values as text, as the profile compares them. A person or body named in parts (`PersonOderStelle`)
 * is her name; other sections and lists are no answer.
 */
export function alsText(wert: unknown): string | null {
  if (typeof wert === 'string') return wert
  if (typeof wert === 'number' || typeof wert === 'boolean') return String(wert)
  if (istObjekt(wert)) {
    if (typeof wert.familienname === 'string') return [wert.vorname, wert.familienname].filter((teil) => typeof teil === 'string').join(' ')
    if (typeof wert.organisation === 'string') return wert.organisation
  }
  return null
}

/** Answers in words: the title of a code, `Ja` and `Nein` for true and false. */
function inWorten(knoten: OneProofKnoten | null, wert: string): string {
  const titel = knoten?.werte && Object.hasOwn(knoten.werte, wert) ? knoten.werte[wert] : undefined
  if (titel !== undefined) return titel
  if (knoten?.typ === 'bool' || wert === 'true' || wert === 'false') return wert === 'true' ? 'Ja' : wert === 'false' ? 'Nein' : wert
  return wert
}

/** What `oneProofZugang` takes. */
export interface OneProofZugangEingabe {
  /** Not read here: the frame of the format fixes the persons, and the schema holds the rest. */
  profil?: Profil
  schema: OneProofSchema
  antrag: OneProofAntrag
}

/** A place as the access finds it in the application: where it ends in the file, besides what every access says of it. */
interface OneProofFall extends Fall {
  /** The parts of the pointer down to where the application reaches. */
  teile: string[]
}

/** A place that came from `faelle` of this access (one of another has no pointer to read). */
const istOneProofFall = (fall: Fall): fall is OneProofFall => 'teile' in fall

/** Somebody outside the household, with the pointers of the places that name her. */
interface OneProofNebenperson {
  id: string
  vorname: string
  nachname: string
  anzeige: string
  rolle: string
  zeiger: string[]
}

export function oneProofZugang({ schema, antrag }: OneProofZugangEingabe): Zugang {
  const { daten } = antrag
  const knoten = knotenNachId(schema)
  const knotenVon = (muster: string): OneProofKnoten | null => knoten.get(muster) ?? null

  const personen = haushalt(daten)
  const indexVon = new Map<unknown, number>(personen.map(({ id, index }): [unknown, number] => [id, index]))
  const quelleVon = new Map<number, number>(personen.map(({ index, quelle }): [number, number] => [index, quelle]))
  const rollen = knotenVon('/personen/*/rolle')?.werte ?? {}

  const namensteile = personen.map(({ person }): Namensteile | null => {
    const name = mitgliedVon(person, 'name') ?? {}
    const teil = (feld: string): string => String(mitgliedVon(name, feld) ?? '').trim()
    const vorname = teil('vorname')
    const nachname = teil('familienname')
    const anzeige = `${vorname} ${nachname}`.trim()
    return anzeige === '' ? null : { vorname, nachname, geburtsname: teil('geburtsname'), anzeige }
  })

  const nebenpersonen = sammleNebenpersonen(daten, knotenVon, namensteile)

  /** Lists with one entry per person (`x-eindeutig: person`), by their pattern. */
  const jePerson = [...knoten.values()].filter((kind) => kind.liste && kind.eindeutig === 'person').map((kind) => kind.id)

  return {
    namensteile,
    nebenpersonen,

    rolle(person) {
      if (person === 0) return 'antragstellende Person'
      const rolle = personen[person]?.rolle
      return typeof rolle === 'string' && rolle !== '' && rolle !== ANTRAGSTELLER ? (rollen[rolle] ?? null) : null
    },

    bezeichnung(person) {
      if (person === 0) return 'antragstellende Person'
      return `${this.rolle(person) ?? 'Person'} ${person}`
    },

    faelle(position) {
      const knotenDerPosition = knotenVon(position)
      if (!istZeiger(position) || !knotenDerPosition) return []
      return faelleVon(position, { daten, schema, knoten: knotenDerPosition, knotenVon, jePerson, personen, indexVon, quelleVon })
    },

    wert(feld, fall) {
      if (!istZeiger(feld)) return null
      const teile = binde(feld, fall && istOneProofFall(fall) ? fall.teile : [])
      return teile ? alsText(wertBei(daten, teile)) : null
    },

    frage: (feld) => knotenVon(feld)?.name ?? feld,

    antwort: (feld, wert) => inWorten(knotenVon(feld), wert),

    code: (feld, wert) => inWorten(knotenVon(feld), wert),

    nebenperson(fall) {
      if (fall.art !== 'vorhanden') return null
      // Only a place of this access has a pointer to read.
      if (!istOneProofFall(fall)) throw new Error('Der Fall stammt nicht aus dem Zugang zu einem Antrag im OneProof Format.')
      const oben = zusammen(fall.teile)
      return nebenpersonen.find(({ zeiger }) => zeiger.some((stelle) => direktDarunter(stelle, oben, daten)))?.id ?? null
    },
  }
}

/** A place of a position as the file has it, before it is described. */
interface Gefunden {
  teile: string[]
  fehlt: string[]
  /** The person of the household the place is a missing one for (a person without an entry in a list per person). */
  person: number | undefined
  ohneEintrag: boolean
}

/** What `faelleVon` reads: the application, its schema and the persons. */
interface FaelleKontext {
  daten: JsonObjekt
  schema: OneProofSchema
  /** The node of the position. */
  knoten: OneProofKnoten
  knotenVon: (muster: string) => OneProofKnoten | null
  /** Lists with one entry per person, by their pattern. */
  jePerson: string[]
  personen: Haushaltsmitglied[]
  indexVon: Map<unknown, number>
  quelleVon: Map<number, number>
}

/** The parts of a pointer or pattern that is known to be one: it starts with `/`. */
function teileVon(zeiger: string): string[] {
  const teile = zerlege(zeiger)
  if (!teile) throw new Error(`„${zeiger}“ ist kein JSON-Zeiger.`)
  return teile
}

/**
 * The places of a position. A list with one entry per person (`/fachdaten/personen`) has a place
 * for every person of the household: where the person has no entry, the place is missing for her
 * — not for nobody.
 */
function faelleVon(
  position: string,
  { daten, schema, knoten, knotenVon, jePerson, personen, indexVon, quelleVon }: FaelleKontext,
): OneProofFall[] {
  const positionTeile = teileVon(position)
  let gefunden: Gefunden[] = treffer(daten, position).map(({ teile, fehlt }) => ({ teile, fehlt, person: undefined, ohneEintrag: false }))

  const liste = jePerson.find((muster) => position.startsWith(`${muster}/${JEDER}`))
  if (liste) {
    const listenTeile = teileVon(liste)
    const roheEintraege = wertBei(daten, listenTeile)
    const eintraege: unknown[] = Array.isArray(roheEintraege) ? roheEintraege : []
    const vertreten = new Set(eintraege.map((eintrag) => mitgliedVon(eintrag, 'person')))
    // Ending at the list or above is no place of nobody: it is a missing place for every person
    // without an entry, as a section of a person in FIM that the application does not have.
    gefunden = gefunden.filter(({ teile }) => teile.length > listenTeile.length)
    for (const { id, index } of personen) {
      if (vertreten.has(id)) continue
      gefunden.push({ teile: [], fehlt: positionTeile.slice(listenTeile.length + 1), person: index, ohneEintrag: true })
    }
  }

  const pfad = pfadZu(schema, position) ?? []
  const eintragsliste = positionTeile.at(-1) === JEDER
  // The entries of a list of persons are told apart by the person, not by a row number.
  const listeDerPersonen = eintragsliste && [PERSONEN, ...jePerson].includes(zusammen(positionTeile.slice(0, -1)))
  const offenAb = oeffnenAb(positionTeile, knotenVon)

  return gefunden.map(({ teile, fehlt, person, ohneEintrag }) => {
    const vorhanden = fehlt.length === 0 && !ohneEintrag
    const personId = person === undefined ? personDerStelle(daten, teile) : null
    const index = person ?? (personId === null ? null : (indexVon.get(personId) ?? null))

    // How far the application reaches down to the place. The entry of a person in a list with one
    // per person counts as there: a person without one has answered none of its questions yet.
    const bis = positionTeile.length - fehlt.length
    const direkt = vorhanden || bis >= offenAb

    const eintrag = eintragsliste && vorhanden && !listeDerPersonen ? Number(teile.at(-1)) + 1 : null
    const geschwister = eintrag === null ? null : wertBei(daten, teile.slice(0, -1))

    return {
      art: vorhanden ? 'vorhanden' : 'fehlt',
      direkt,
      person: index,
      // A section or an entry the application need not have states the fact by being there; a given
      // value is an answer, and only the question decides about it.
      sagtAus: vorhanden && !knoten.thema && (eintragsliste || (Boolean(knoten.kinder) && String(knoten.anzahl).startsWith('0:'))),
      eintrag,
      von: Array.isArray(geschwister) ? geschwister.length : null,
      pfad: beschriftung(pfad),
      ort: { stelle: ortVon(teile, index, ohneEintrag, quelleVon) },
      teile,
    }
  })
}

/**
 * How many parts of a place the application must have for evidence to open the rest. The place
 * itself may be missing, and so may the list of which it is an entry (`eintraege` missing is the
 * same as `eintraege: []`), but no section above — that the application leaves out a section
 * mostly means that it does not apply: no `lastenzuschuss` for a tenant. Only the section with the
 * question the place belongs to may be missing as well: the question is not answered yet, which
 * opens the place as far as an answer „no“ does.
 */
function oeffnenAb(positionTeile: string[], knotenVon: (muster: string) => OneProofKnoten | null): number {
  let ab = positionTeile.length - (positionTeile.at(-1) === JEDER ? 2 : 1)
  // The section of the question lies above the place, without an entry of another list between.
  for (let laenge = positionTeile.length; laenge > 0; laenge--) {
    if (positionTeile[laenge - 1] === JEDER && laenge !== positionTeile.length) break
    if (knotenVon(zusammen(positionTeile.slice(0, laenge)))?.thema) {
      ab = Math.min(ab, laenge - 1)
      break
    }
  }
  return ab
}

/** The labels from the section down to the place: no list next to its entry, at most three. */
function beschriftung(pfad: OneProofKnoten[]): string[] {
  const namen: string[] = []
  for (const knoten of pfad) {
    if (knoten.id === '/fachdaten' || knoten.id === '/personen') continue
    if (knoten.liste) continue
    if (namen.at(-1) !== knoten.name) namen.push(knoten.name)
  }
  return namen.slice(-3)
}

/** The pointer the package refers to (see {@link Ort}). */
function ortVon(teile: string[], person: number | null, ohneEintrag: boolean, quelleVon: Map<number, number>): string | null {
  if (ohneEintrag) return person === null ? null : `/personen/${quelleVon.get(person)}`
  if (teile.length === 0) return null
  return zusammen(teile)
}

/**
 * Is the value at `stelle` the place at `oben` or inside it, without passing through an entry of a
 * list on the way? The name of a flatmate in her row is, the names of all flatmates in the section
 * are not.
 */
function direktDarunter(stelle: string, oben: string, daten: unknown): boolean {
  if (stelle !== oben && !stelle.startsWith(`${oben}/`)) return false
  const rest = teileVon(stelle).slice(teileVon(oben).length)
  let hier = wertBei(daten, oben)
  for (const teil of rest) {
    if (Array.isArray(hier)) return false
    hier = mitgliedVon(hier, teil)
  }
  return true
}

/**
 * Everybody else the application names: every value outside `personen` with a first name and a
 * family name — the flatmate, the deceased member, the recipient of maintenance, the person who
 * represents the applicant. A document in their name is known, not foreign, and the place it
 * belongs to is the one at their entry. A landlord or a lender named as a company is no person.
 */
function sammleNebenpersonen(
  daten: JsonObjekt,
  knotenVon: (muster: string) => OneProofKnoten | null,
  namensteile: (Namensteile | null)[],
): OneProofNebenperson[] {
  const haushaltsNamen = new Set(namensteile.filter((teile) => teile !== null).map(({ anzeige }) => comparisonKey(anzeige)))
  const gefunden = new Map<string, OneProofNebenperson>()

  const laufe = (wert: unknown, teile: string[]): void => {
    if (Array.isArray(wert)) return wert.forEach((eintrag: unknown, index) => laufe(eintrag, [...teile, String(index)]))
    if (!istObjekt(wert)) return

    const zeiger = zusammen(teile)
    const muster = musterVon(zeiger, daten)
    const knoten = muster === null ? null : knotenVon(muster)
    const hatVorname = knoten?.kinder?.some((kind) => kind.schluessel === 'vorname')
    if (muster !== null && knoten && typeof wert.familienname === 'string' && hatVorname) {
      const vorname = String(wert.vorname ?? '').trim()
      const nachname = wert.familienname.trim()
      const anzeige = `${vorname} ${nachname}`.trim()
      const schluessel = comparisonKey(anzeige)
      if (schluessel !== '' && !haushaltsNamen.has(schluessel)) {
        const vorhanden = gefunden.get(schluessel)
        if (vorhanden) vorhanden.zeiger.push(zeiger)
        else {
          // A name object is named after its holder („Name des Kindes“); an entry after its section.
          const rolle = knoten.schluessel === JEDER || knoten.schluessel === 'name' ? (knotenVon(muster.replace(/\/[^/]+$/, ''))?.name ?? knoten.name) : knoten.name
          gefunden.set(schluessel, { id: `n${gefunden.size + 1}`, vorname, nachname, anzeige, rolle, zeiger: [zeiger] })
        }
      }
    }
    for (const [schluessel, unter] of Object.entries(wert)) laufe(unter, [...teile, schluessel])
  }

  laufe(daten.fachdaten, ['fachdaten'])
  return [...gefunden.values()]
}
