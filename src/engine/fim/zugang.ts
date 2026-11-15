/**
 * The access of the target derivation (`zuordnung/ziele.ts`) to an application in FIM.
 *
 * A place of evidence is a field of the data type `file`, named by the group it hangs in and the
 * field itself (`G…/F…`). The application is the tree of its elements, whose names are the ids of
 * the schema; the persons are the groups the profile binds (`personen`), the applicant first.
 *
 * What the access answers — where a position leads, the value of a field next to a place, the
 * words of a question — is described with the type `Zugang` in `zuordnung/ziele.ts`.
 */

import type { Fall, Namensteile, Ort as ZielOrt, Zugang } from '../zuordnung/ziele.ts'
import type { PersonBindung, Profil } from '../profil/laden.ts'
import { comparisonKey } from '../zuordnung/personen.ts'
import { childrenWith, followChain } from './instanz.ts'
import type { Node } from './instanz.ts'
import { fileFields, indexById, isRepeatable, labelOf, positionKey } from './schema.ts'
import type { Schema, SchemaNode } from './schema.ts'

/** What `fimZugang` takes. */
export interface FimZugangEingabe {
  profil: Profil
  schema: Schema
  /** The application as a tree. */
  wurzel: Node
}

/** A person of the household named in parts, with the group of her name. */
interface FimNamensteile extends Namensteile {
  knoten: Node
}

/** Somebody outside the household, with the groups of the application that name her. */
interface FimNebenperson {
  id: string
  vorname: string
  nachname: string
  anzeige: string
  rolle: string
  knoten: Node[]
}

/** A place as the access finds it in the tree of the application. */
interface FimFall extends Fall {
  /** The group that carries the file field, `null` where the application does not have it. */
  container: Node | null
  /** The groups from the root down to where the application reaches. */
  kette: Node[]
  /** The group the place is searched from: the last of the chain, or the root. */
  anker: Node
}

/** A place before it is described: where it is and how far the application reaches. */
type Erkundet = Pick<FimFall, 'art' | 'container' | 'kette' | 'anker' | 'direkt' | 'person'>

/** What the functions below share. */
interface Kontext {
  personen: { antragsteller: PersonBindung | undefined; mitglieder: PersonBindung | undefined }
  personenDefinitionen: PersonBindung[]
  wurzel: Node
  dateifelder: { field: SchemaNode; path: SchemaNode[] }[]
  ids: Map<string, SchemaNode[][]>
  /** The persons of the household: the applicant first, then the members; `null` where there is none. */
  knoten: (Node | null)[]
  namensteile: (FimNamensteile | null)[]
  namen: (string | null)[]
  wiederholbar: (id: string) => boolean
  nebenpersonen: FimNebenperson[]
}

/** A place that came from `faelle` of this access (one of another has no tree to read). */
const istFimFall = (fall: Fall): fall is FimFall => 'kette' in fall

export function fimZugang({ profil, schema, wurzel }: FimZugangEingabe): Zugang {
  const personen = profil.anbindungFuer ? profil.anbindungFuer(schema.schemaId).personen : profil.personen
  // A schema need not know a household: then there is only the applicant, or nobody at all.
  const antragsteller = personen.antragsteller
  const mitglieder = personen.mitglieder
  const ersterAntragsteller = antragsteller?.gruppe ? (childrenWith(wurzel, antragsteller.gruppe)[0] ?? null) : null
  const mitgliederKnoten = mitglieder?.gruppe ? alleMit(wurzel, mitglieder.gruppe) : []

  const ids = indexById(schema)
  const knoten = [ersterAntragsteller, ...mitgliederKnoten]
  const namensteile = knoten.map((person, index) => personenname(person, index === 0 ? antragsteller : mitglieder))

  const kontext: Kontext = {
    personen: { antragsteller, mitglieder },
    // `Personen` holds the two bindings and nothing else.
    personenDefinitionen: Object.values(personen),
    wurzel,
    dateifelder: fileFields(schema),
    ids,
    knoten,
    namensteile,
    namen: namensteile.map((teile) => teile?.anzeige ?? null),
    wiederholbar: (id) => {
      const knotenImSchema = ids.get(id)?.[0]?.at(-1)
      return knotenImSchema ? isRepeatable(knotenImSchema) : false
    },
    nebenpersonen: [],
  }
  kontext.nebenpersonen = sammleNebenpersonen(kontext)
  const schemaKnoten = (id: string): SchemaNode | null => ids.get(id)?.[0]?.at(-1) ?? null

  return {
    namensteile,
    nebenpersonen: kontext.nebenpersonen,


    rolle: (person) => (person === 0 ? antragsteller?.bezeichnung : mitglieder?.bezeichnung) ?? null,

    bezeichnung(person) {
      return person === 0 ? (antragsteller?.bezeichnung ?? 'antragstellende Person') : `${mitglieder?.bezeichnung ?? 'Person'} ${person}`
    },

    faelle(position) {
      return kontext.dateifelder
        .filter(({ path }) => positionKey(path) === position)
        .flatMap(({ path }) => erkunde(path, kontext).map((fall) => vollstaendig(fall, path, kontext)))
    },

    wert(feld, fall) {
      if (!fall) return suche(wurzel, feld, kontext)
      // Only a place of this access has a tree to read.
      if (!istFimFall(fall)) throw new Error('Der Fall stammt nicht aus dem Zugang zu einer FIM-Instanz.')
      return wertBei(feld, fall, kontext)
    },

    frage(feld) {
      const node = schemaKnoten(feld)
      return node ? (node.frage ?? node.bezeichnung ?? node.name) : feld
    },

    antwort: (feld, wert) => schemaKnoten(feld)?.werte?.[wert] ?? (wert === 'false' ? 'Nein' : wert === 'true' ? 'Ja' : wert),

    code: (feld, wert) => schemaKnoten(feld)?.werte?.[wert] ?? wert,

    nebenperson(fall) {
      if (!istFimFall(fall) || !fall.container) return null
      const behaelter = fall.container
      return kontext.nebenpersonen.find(({ knoten: namen }) => namen.some((name) => enthaelt(behaelter, name, kontext)))?.id ?? null
    },
  }
}

function alleMit(knoten: Node, id: string): Node[] {
  const gefunden: Node[] = []
  for (const kind of knoten.children) {
    if (kind.id === id) gefunden.push(kind)
    else gefunden.push(...alleMit(kind, id))
  }
  return gefunden
}

/** The name of a person of the household in its parts, or `null` if the application has none. */
function personenname(knoten: Node | null, definition: PersonBindung | undefined): FimNamensteile | null {
  if (!knoten || !definition) return null
  const gruppe = followChain(knoten, definition.name?.pfad ?? [])[0]
  if (!gruppe) return null
  const text = (id: string | undefined): string => (id ? (childrenWith(gruppe, id)[0]?.text?.trim() ?? '') : '')

  const vorname = text(definition.name.vorname)
  const nachname = text(definition.name.nachname)
  const anzeige = `${vorname} ${nachname}`.trim()
  if (anzeige === '') return null

  return { vorname, nachname, geburtsname: text(definition.name.geburtsname), anzeige, knoten: gruppe }
}

/**
 * Everybody else the application names: every group outside the household that carries a family
 * name in the fields the profile names persons with — the flatmate, the deceased member, the
 * recipient of maintenance, the representative. A document in their name is known, not foreign,
 * and the place it belongs to is the one at their entry.
 */
function sammleNebenpersonen(kontext: Kontext): FimNebenperson[] {
  const definitionen = kontext.personenDefinitionen.map((definition) => definition.name ?? {})
  const nachnamen = new Set(definitionen.map((name) => name.nachname).filter(Boolean))
  const vornamen = new Set(definitionen.map((name) => name.vorname).filter(Boolean))
  const imHaushalt = new Set(kontext.namensteile.filter((teile) => teile !== null).map((teile) => teile.knoten))
  const haushaltsNamen = new Set(kontext.namen.filter((name): name is string => Boolean(name)).map(comparisonKey))

  const blatt = (knoten: Node, ids: Set<string>): Node | undefined => knoten.children.find((kind) => ids.has(kind.id) && kind.children.length === 0)
  const gefunden = new Map<string, FimNebenperson>()

  const laufe = (knoten: Node): void => {
    const nachname = blatt(knoten, nachnamen)
    if (nachname && !imHaushalt.has(knoten)) {
      const vorname = blatt(knoten, vornamen)?.text?.trim() ?? ''
      const anzeige = `${vorname} ${nachname.text?.trim() ?? ''}`.trim()
      const schluessel = comparisonKey(anzeige)

      if (schluessel !== '' && !haushaltsNamen.has(schluessel)) {
        const vorhanden = gefunden.get(schluessel)
        if (vorhanden) vorhanden.knoten.push(knoten)
        else {
          const imSchema = kontext.ids.get(knoten.id)?.[0]?.at(-1)
          gefunden.set(schluessel, {
            id: `n${gefunden.size + 1}`,
            vorname,
            nachname: nachname.text?.trim() ?? '',
            anzeige,
            rolle: imSchema ? labelOf(imSchema) : '',
            knoten: [knoten],
          })
        }
      }
    }
    for (const kind of knoten.children) if (kind.children.length > 0) laufe(kind)
  }

  laufe(kontext.wurzel)
  return [...gefunden.values()]
}

/** Is `gesucht` the group itself or inside it, without entering a repeated group on the way? */
function enthaelt(gruppe: Node, gesucht: Node, kontext: Kontext): boolean {
  if (gruppe === gesucht) return true
  return gruppe.children.some(
    (kind) => kind.children.length > 0 && !kontext.wiederholbar(kind.id) && enthaelt(kind, gesucht, kontext),
  )
}

/* ---------------------------------------------------------------------------------------------
 * Finding the places in the application
 * ------------------------------------------------------------------------------------------- */

/**
 * Follows the schema path of a file field down into the application and reports every place at
 * which it leads to the group that carries the field — or where it ends.
 */
function erkunde(path: SchemaNode[], kontext: Kontext): Erkundet[] {
  const gruppen = path.slice(0, -1)
  const personenTiefe = gruppen.findIndex((gruppe) => istPersonengruppe(gruppe.id, kontext))
  const faelle: Erkundet[] = []

  const laufe = (knoten: Node, kette: Node[], tiefe: number): void => {
    const gruppe = gruppen[tiefe]
    // No group left to follow: the application has the group that carries the field.
    if (gruppe === undefined) {
      faelle.push({ art: 'vorhanden', container: knoten, kette, anker: knoten, direkt: true, person: personVon(kette, kontext) })
      return
    }

    const kinder = childrenWith(knoten, gruppe.id)
    if (kinder.length > 0) {
      for (const kind of kinder) laufe(kind, [...kette, kind], tiefe + 1)
      return
    }

    // A section of a person who does not exist is no place at all.
    if (personenTiefe !== -1 && tiefe <= personenTiefe) return

    faelle.push({
      art: 'fehlt',
      container: null,
      kette,
      anker: kette.at(-1) ?? knoten,
      // Only the group that carries the field itself may be opened, never one of its parents.
      direkt: tiefe === gruppen.length - 1,
      person: personVon(kette, kontext),
    })
  }

  laufe(kontext.wurzel, [], 0)
  return faelle
}

/**
 * The place as the derivation reads it: whether its existence states the fact, which entry it is,
 * the labels above it and where the package writes a reference to evidence for it.
 */
function vollstaendig(fall: Erkundet, path: SchemaNode[], kontext: Kontext): FimFall {
  const container = path.length > 1 ? (path.at(-2) ?? null) : null
  const eltern = fall.kette.at(-2) ?? kontext.wurzel
  const eigener = fall.container
  const geschwister = eigener && container && isRepeatable(container) ? childrenWith(eltern, eigener.id) : null
  return {
    ...fall,
    // A group the application has — as an entry that may or may not be there — states the fact by
    // existing. Only a group that is always there (`1:1`) says nothing by its presence.
    sagtAus: fall.art === 'vorhanden' && container !== null && isRepeatableOrOptional(container),
    eintrag: eigener && geschwister && geschwister.length > 0 ? geschwister.indexOf(eigener) + 1 : null,
    von: geschwister && geschwister.length > 0 ? geschwister.length : null,
    pfad: path.slice(0, -1).map(labelOf).slice(-3),
    ort: ortVon(fall, path, kontext),
  }
}

/** Is it the group of the applicant or of a member of the household? */
const istPersonengruppe = (id: string, kontext: Kontext): boolean =>
  id != null && (id === kontext.personen.antragsteller?.gruppe || id === kontext.personen.mitglieder?.gruppe)

function personVon(kette: Node[], kontext: Kontext): number | null {
  const { antragsteller, mitglieder } = kontext.personen
  for (const knoten of kette) {
    if (antragsteller?.gruppe && knoten.id === antragsteller.gruppe) return 0
    if (mitglieder?.gruppe && knoten.id === mitglieder.gruppe) {
      const position = kontext.knoten.indexOf(knoten)
      return position === -1 ? null : position
    }
  }
  return null
}

function isRepeatableOrOptional(knoten: SchemaNode): boolean {
  const [minimum, maximum] = String(knoten.anzahl ?? '1:1').split(':')
  return minimum === '0' || isRepeatable(knoten) || maximum === '*'
}

/**
 * The place of a target in the application, as the package writes it (see `fim/verweise.ts`): the
 * file field, the groups from the root down to the group that carries it, and how far down these
 * groups exist in this application. The groups below are missing and are opened by the evidence.
 */
export interface Ort {
  /** Id of the file field (in the schema version of the profile). */
  feld: string
  /** Ids of the groups from the root to the one that carries the field. */
  gruppen: string[]
  /** Position of each existing group among the elements of its parent, from the root; as long as `gruppen` where the group exists. */
  knoten: number[]
}

/** Is the place of a target one of an application in FIM (and not in the OneProof Format)? */
export const istFimOrt = (ort: ZielOrt): ort is Ort => 'feld' in ort

function ortVon(fall: Erkundet, path: SchemaNode[], kontext: Kontext): Ort {
  const knoten: number[] = []
  let eltern = kontext.wurzel
  for (const gruppe of fall.kette) {
    knoten.push(eltern.children.indexOf(gruppe))
    eltern = gruppe
  }
  const feld = path.at(-1)
  if (!feld) throw new Error('The path of a file field ends with the field.')
  return { feld: feld.id, gruppen: path.slice(0, -1).map(({ id }) => id), knoten }
}

/* ---------------------------------------------------------------------------------------------
 * Values next to a place
 * ------------------------------------------------------------------------------------------- */

/**
 * The value of a field next to the place: inside the group, then upwards — but never beyond the
 * person or, for a household-wide place, the section it belongs to. A fact about one row is thus
 * found at the row, a fact about the person at the person, and never at someone else.
 *
 * The search never steps into a repeated group it is not already standing in: the value of "the
 * first row" is not an answer for the second.
 */
function wertBei(feld: string, fall: FimFall, kontext: Kontext): string | null {
  const { kette } = fall
  const grenze = kette.findIndex((knoten) => istPersonengruppe(knoten.id, kontext))
  const sichtbar = kette.slice(grenze === -1 ? 0 : grenze)

  // A place without any group above it (a field directly at the root) sees the whole application.
  if (sichtbar.length === 0) return suche(kontext.wurzel, feld, kontext)

  for (const bereich of [fall.anker, ...sichtbar.filter((knoten) => knoten !== fall.anker).reverse()]) {
    const treffer = suche(bereich, feld, kontext)
    if (treffer !== null) return treffer
  }

  return null
}

/** Depth first, in document order, without entering repeated groups. */
function suche(knoten: Node, id: string, kontext: Kontext): string | null {
  if (knoten.id === id && knoten.children.length === 0) return knoten.text

  for (const kind of knoten.children) {
    if (kind.id === id && kind.children.length === 0) return kind.text
    if (kind.children.length > 0 && !kontext.wiederholbar(kind.id)) {
      const treffer = suche(kind, id, kontext)
      if (treffer !== null) return treffer
    }
  }

  return null
}
