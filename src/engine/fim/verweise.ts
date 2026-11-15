/**
 * Writes the references to the evidence of a package into the application.
 *
 * The application is a FIM instance. Its fields of the data type `file` hold the name of a file
 * that is delivered with it — the PHP original writes them the same way (`FimNodeEmitter`), and the
 * package is the XML plus these files. A package names its own files, so every reference the
 * application brought along is removed first: it would name a file the package does not contain.
 * Then each document is referenced at the place the check filed it at (`ort`, see
 * `zuordnung/ziele.ts`), in the order the schema prescribes for the elements of a group.
 *
 * A reference is written only where the instance stays valid against the schema:
 *
 *  - into a group the application has, as often as the field may occur there;
 *  - into a group the application does not have (evidence of a fact the application does not
 *    state, or a "yes" without any details) only if the group may stand with nothing but the
 *    reference, that is if no field in it is mandatory. A value the application does not give is
 *    not invented, and a group whose mandatory fields stay empty makes the whole instance invalid
 *    — a receiver that validates it would reject the application, not just the reference.
 *
 * Here this module departs from the PHP original, which opens such a group anyway. What is not
 * written stays in the package without a reference and is reported with the reason.
 *
 * The application is kept as it is apart from that: an instance in an older schema version is
 * written in its own version, with the ids of that version. The export of the LeistungsLotse
 * application (`<myForm>`) becomes the plain FIM instance it carries. Whitespace between elements
 * is laid out anew; the content of every field stays as it was.
 */

import { InstanceError } from './instanz.ts'
import type { Ort } from './zugang.ts'
import type { Schema, SchemaNode } from './schema.ts'

/** What a reference needs to be written: the file and the place; everything else of it is handed back as it is. */
export interface FimVerweis {
  datei: string
  ort: Ort
}

/** What `schreibeVerweise` takes. */
export interface SchreibeVerweiseEingabe<V extends FimVerweis> {
  /** The application as it was uploaded. */
  xml: string
  /** The schema in the version of the profile. */
  schema: Schema
  /** What to write where. */
  verweise: V[]
  /** Old id → id of the profile, if the application is in an older version of the schema. */
  abbildung?: Record<string, string> | null
  DOMParser?: typeof globalThis.DOMParser
  XMLSerializer?: typeof globalThis.XMLSerializer
}

/** What `schreibeVerweise` made of the application. */
export interface SchreibeVerweiseErgebnis<V extends FimVerweis> {
  xml: string
  /** `stelle`: where the reference stands, as element names with positions `/…/G…[2]/F…`. */
  geschrieben: (V & { stelle: string })[]
  nichtGeschrieben: (V & { grund: string })[]
  /** References the application brought along. */
  entfernt: { feld: string; wert: string }[]
}

export function schreibeVerweise<V extends FimVerweis>({
  xml,
  schema,
  verweise,
  abbildung = null,
  DOMParser = globalThis.DOMParser,
  XMLSerializer = globalThis.XMLSerializer,
}: SchreibeVerweiseEingabe<V>): SchreibeVerweiseErgebnis<V> {
  if (/<!DOCTYPE/i.test(xml)) throw new InstanceError('Die Antragsdaten enthalten eine Dokumenttyp-Deklaration.')
  const parser = new DOMParser()
  let gelesen: Document | null
  try {
    gelesen = parser.parseFromString(xml, 'application/xml')
  } catch {
    gelesen = null
  }
  if (!gelesen?.documentElement || gelesen.getElementsByTagName('parsererror')[0]) {
    throw new InstanceError('Die Antragsdaten sind kein gültiges XML.')
  }

  const dokument = alsFimInstanz(gelesen, parser)
  const wurzel = dokument.documentElement
  const namensraum = wurzel.namespaceURI
  const ids = idsDerVersion(abbildung)

  // 1. Find every place before anything moves: the positions count the elements as uploaded.
  const ziele = verweise.map((verweis) => ({ verweis, ziel: findeOrt(wurzel, verweis.ort, ids) }))

  // 2. Take out what the application referenced itself.
  const dateifelder = new Set(alleDateifelder(schema).map(ids.alt))
  const alte = elementeUnter(wurzel).filter((element) => dateifelder.has(nameVon(element)))
  const entfernt = alte.map((element) => ({ feld: nameVon(element), wert: (element.textContent ?? '').trim() }))
  const geleert = new Set<Element>()
  for (const element of alte) {
    const eltern = elternVon(element)
    if (!eltern) throw new Error('Ein Element unterhalb der Wurzel hat ein Elternelement.')
    geleert.add(eltern)
    eltern.removeChild(element)
  }

  // 3. Write the new references.
  const geschrieben: SchreibeVerweiseErgebnis<V>['geschrieben'] = []
  const nichtGeschrieben: SchreibeVerweiseErgebnis<V>['nichtGeschrieben'] = []
  /** Groups opened here, by place: a second reference into the same group finds it. */
  const eroeffnet = new Map<string, Element>()
  for (const { verweis, ziel } of ziele) {
    const { ort } = verweis
    const lehneAb = (grund: string): void => {
      nichtGeschrieben.push({ ...verweis, grund })
    }
    if (!ziel.element) {
      lehneAb('Die Stelle wurde im Antrag nicht gefunden.')
      continue
    }

    const schemaPfad = knotenAmPfad(schema, ort.gruppen)
    const feldSchema = schemaPfad && (schemaPfad.at(-1)?.kinder ?? schema.kinder).find(({ id }) => id === ort.feld)
    if (!schemaPfad || !feldSchema) {
      lehneAb('Die Stelle kommt im Schema nicht vor.')
      continue
    }

    const fehlend = schemaPfad.slice(ziel.tiefe)
    const unmoeglich = fehlend.find((gruppe, index) => !kannAllein(gruppe, fehlend[index + 1]?.id ?? ort.feld))
    if (unmoeglich) {
      lehneAb(
        `Im Antrag fehlen die Angaben „${bezeichnungVon(unmoeglich)}“, zu denen dieser Nachweis gehört. ` +
          'Ohne sie wäre ein Verweis an dieser Stelle keine gültige FIM-Instanz.',
      )
      continue
    }

    let behaelter = ziel.element
    for (const [index, gruppe] of fehlend.entries()) {
      const tiefe = ziel.tiefe + index
      const schluessel = `${ort.knoten.join('.')}|${ort.gruppen.slice(0, tiefe + 1).join('/')}`
      let angelegt = eroeffnet.get(schluessel)
      if (!angelegt) {
        const neu = neuesElement(dokument, behaelter, ids.alt(gruppe.id), namensraum)
        const elternSchema = tiefe === 0 ? schema : schemaPfad[tiefe - 1]
        if (!elternSchema) throw new Error('Die Gruppe über einer fehlenden Gruppe kommt im Schema vor.')
        angelegt = fuegeEin(behaelter, neu, elternSchema, ids)
        eroeffnet.set(schluessel, angelegt)
      }
      behaelter = angelegt
    }

    const hoechstens = hoechstzahl(feldSchema)
    const vorhanden = kinderVon(behaelter).filter((kind) => nameVon(kind) === ids.alt(ort.feld)).length
    if (vorhanden >= hoechstens) {
      lehneAb(`An dieser Stelle ${hoechstens === 1 ? 'ist nur eine Datei' : `sind höchstens ${hoechstens} Dateien`} vorgesehen.`)
      continue
    }

    const feld = neuesElement(dokument, behaelter, ids.alt(ort.feld), namensraum)
    feld.appendChild(dokument.createTextNode(verweis.datei))
    fuegeEin(behaelter, feld, schemaPfad.at(-1) ?? schema, ids)
    geschrieben.push({ ...verweis, stelle: stelleVon(feld) })
  }

  // 4. A group that held nothing but the old reference goes with it, where the schema lets it.
  for (const element of geleert) entferneLeere(element, wurzel, schema, ids)

  formatiere(wurzel, '')
  const text = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(wurzel)}\n`
  return { xml: text, geschrieben, nichtGeschrieben, entfernt }
}

/* ---------------------------------------------------------------------------------------------
 * The instance
 * ------------------------------------------------------------------------------------------- */

/**
 * `fim.S01000000123.01000000123001007` and `urn:xoev-de:xfall:standard:fim-s01000000123_1.7.0`
 * for schema S01000000123 in version 1.7.0: the names the instance XSD gives its root.
 */
export function fimWurzel(schemaId: string, version: string): { name: string; namensraum: string } {
  const [haupt = '0', neben = '0'] = String(version).split('.')
  return {
    name: `fim.${schemaId}.${schemaId.slice(1)}${haupt.padStart(3, '0')}${neben.padStart(3, '0')}`,
    namensraum: `urn:xoev-de:xfall:standard:fim-${schemaId.toLowerCase()}_${version}`,
  }
}

/** The plain FIM instance: as it is, or taken out of the envelope of the LeistungsLotse export. */
function alsFimInstanz(gelesen: Document, parser: DOMParser): Document {
  const wurzel = gelesen.documentElement
  if (nameVon(wurzel).startsWith('fim.')) return gelesen
  if (nameVon(wurzel) !== 'myForm') throw new InstanceError('Die Antragsdaten sind keine FIM-Instanz.')

  const daten = kinderVon(wurzel).find((kind) => nameVon(kind) === 'antragsdaten')
  const schemaId = daten?.getAttribute('schemaID') ?? ''
  const version = daten?.getAttribute('schemaVersion') ?? ''
  if (!daten || !/^S\d{11}$/.test(schemaId) || version === '') {
    throw new InstanceError('Die Antragsdaten nennen kein Schema und keine Version.')
  }

  const { name, namensraum } = fimWurzel(schemaId, version)
  const neu = parser.parseFromString(`<${name} xmlns="${namensraum}"/>`, 'application/xml')
  kopiere(daten, neu.documentElement, neu, namensraum)
  return neu
}

/** The elements and texts below `quelle`, in the namespace of the instance; no attributes. */
function kopiere(quelle: Element, ziel: Element, dokument: Document, namensraum: string | null): void {
  for (const kind of kinderVon(quelle)) {
    const kopie = dokument.createElementNS(namensraum, nameVon(kind))
    if (kinderVon(kind).length > 0) kopiere(kind, kopie, dokument, namensraum)
    else kopie.appendChild(dokument.createTextNode((kind.textContent ?? '').trim()))
    ziel.appendChild(kopie)
  }
}

/** The ids of the version of the application and those of the profile, both ways. */
interface IdsDerVersion {
  neu: (id: string) => string
  alt: (id: string) => string
}

/** Ids of the version of the application ↔ ids of the profile. Unknown ids are the same in both. */
function idsDerVersion(abbildung: Record<string, string> | null): IdsDerVersion {
  const zurueck = new Map<string, string>()
  for (const [alt, neu] of Object.entries(abbildung ?? {})) if (!zurueck.has(neu)) zurueck.set(neu, alt)
  return {
    neu: (id) => abbildung?.[id] ?? id,
    alt: (id) => zurueck.get(id) ?? id,
  }
}

/**
 * The deepest group of the place that the application has, and how deep it lies. The positions
 * are checked against the names, so that a place found in another application cannot land in
 * this one.
 */
function findeOrt(wurzel: Element, ort: Ort, ids: IdsDerVersion): { element: Element | null; tiefe: number } {
  let element = wurzel
  for (const [tiefe, position] of ort.knoten.entries()) {
    const kind = kinderVon(element)[position]
    if (!kind || ids.neu(nameVon(kind)) !== ort.gruppen[tiefe]) return { element: null, tiefe }
    element = kind
  }
  return { element, tiefe: ort.knoten.length }
}

/* ---------------------------------------------------------------------------------------------
 * The schema
 * ------------------------------------------------------------------------------------------- */

/** The schema nodes along a path of group ids from the root, or `null` if the path does not exist. */
function knotenAmPfad(schema: Schema, gruppen: string[]): SchemaNode[] | null {
  const pfad: SchemaNode[] = []
  let knoten: Schema | SchemaNode = schema
  for (const id of gruppen) {
    const kind: SchemaNode | undefined = (knoten.kinder ?? []).find((kandidat) => kandidat.id === id)
    if (!kind) return null
    knoten = kind
    pfad.push(kind)
  }
  return pfad
}

function alleDateifelder(schema: Schema): string[] {
  const ids = new Set<string>()
  const laufe = (knoten: Schema | SchemaNode): void => {
    for (const kind of knoten.kinder ?? []) {
      if (kind.typ === 'file') ids.add(kind.id)
      laufe(kind)
    }
  }
  laufe(schema)
  return [...ids]
}

/** A label is text of the form; the instance never carries it. */
const kommtVor = (knoten: SchemaNode): boolean => knoten.art !== 'label'
const mindestzahl = (knoten: SchemaNode): number => (kommtVor(knoten) ? Number(String(knoten.anzahl ?? '1:1').split(':')[0]) || 0 : 0)

function hoechstzahl(knoten: SchemaNode): number {
  const hoechstens = String(knoten.anzahl ?? '1:1').split(':')[1]
  return hoechstens === '*' ? Number.POSITIVE_INFINITY : Number(hoechstens) || 1
}

/** May the group stand with nothing in it but `inhalt` (the next group, or the file field)? */
const kannAllein = (gruppe: SchemaNode, inhalt: string): boolean => (gruppe.kinder ?? []).every((kind) => kind.id === inhalt || mindestzahl(kind) === 0)

const bezeichnungVon = (knoten: SchemaNode): string => knoten.bezeichnung ?? knoten.name

/* ---------------------------------------------------------------------------------------------
 * The tree
 * ------------------------------------------------------------------------------------------- */

const istElement = (knoten: Node | null): knoten is Element => knoten?.nodeType === 1
const kinderVon = (element: Element): Element[] => Array.from(element.childNodes ?? []).filter(istElement)
/** The parent of an element, if it is an element as well (the root has the document above it). */
const elternVon = (element: Element): Element | null => (istElement(element.parentNode) ? element.parentNode : null)
const nameVon = (element: Element): string => element.localName ?? String(element.nodeName).split(':').pop()

function elementeUnter(element: Element): Element[] {
  return kinderVon(element).flatMap((kind) => [kind, ...elementeUnter(kind)])
}

/** A new element named like its siblings: in the namespace of the instance, with their prefix. */
function neuesElement(dokument: Document, eltern: Element, id: string, namensraum: string | null): Element {
  return dokument.createElementNS(namensraum, eltern.prefix ? `${eltern.prefix}:${id}` : id)
}

/**
 * Puts `neu` among the elements of `eltern` where the schema wants it: behind every element that
 * comes before it or is of its own kind, before the first that comes after it. Elements the
 * schema does not know do not decide anything.
 */
function fuegeEin(eltern: Element, neu: Element, elternSchema: Schema | SchemaNode, ids: IdsDerVersion): Element {
  const reihenfolge = (elternSchema.kinder ?? []).map(({ id }) => id)
  const rang = (element: Element): number => reihenfolge.indexOf(ids.neu(nameVon(element)))
  const eigener = rang(neu)
  const danach = kinderVon(eltern).find((kind) => rang(kind) > eigener)
  eltern.insertBefore(neu, danach ?? null)
  return neu
}

/** The element names from the root down to `element`, with the position among equal siblings. */
function stelleVon(element: Element): string {
  const teile: string[] = []
  for (let knoten: Element | null = element; knoten; knoten = elternVon(knoten)) {
    const name = nameVon(knoten)
    const eltern = elternVon(knoten)
    const gleiche = eltern ? kinderVon(eltern).filter((kind) => nameVon(kind) === name) : [knoten]
    teile.unshift(gleiche.length > 1 ? `${name}[${gleiche.indexOf(knoten) + 1}]` : name)
  }
  return `/${teile.join('/')}`
}

/**
 * Removes a group that has become empty and may be left out, then looks at its parent. A group the
 * schema demands stays, empty: that is valid for a group whose fields are all optional.
 */
function entferneLeere(element: Element, wurzel: Element, schema: Schema, ids: IdsDerVersion): void {
  let aktuell: Element | null = element
  while (aktuell && aktuell !== wurzel && aktuell.parentNode && kinderVon(aktuell).length === 0 && (aktuell.textContent ?? '').trim() === '') {
    const pfad: string[] = []
    for (let knoten: Element | null = aktuell; knoten && knoten !== wurzel; knoten = elternVon(knoten)) pfad.unshift(ids.neu(nameVon(knoten)))
    const knotenSchema = knotenAmPfad(schema, pfad)?.at(-1)
    if (!knotenSchema || mindestzahl(knotenSchema) > 0) return

    const eltern = elternVon(aktuell)
    if (!eltern) throw new Error('Ein Element unterhalb der Wurzel hat ein Elternelement.')
    eltern.removeChild(aktuell)
    aktuell = eltern
  }
}

/**
 * Lays out the elements one per line, two spaces deeper per level. Only whitespace between
 * elements is touched; a field keeps its text exactly.
 */
function formatiere(element: Element, einrueckung: string): void {
  const kinder = Array.from(element.childNodes ?? [])
  if (!kinder.some((knoten) => knoten.nodeType === 1)) return

  const dokument = element.ownerDocument
  for (const knoten of kinder) {
    if (knoten.nodeType === 3 && (knoten.nodeValue ?? '').trim() === '') element.removeChild(knoten)
  }
  const innen = `${einrueckung}  `
  for (const knoten of Array.from(element.childNodes)) {
    element.insertBefore(dokument.createTextNode(`\n${innen}`), knoten)
    if (istElement(knoten)) formatiere(knoten, innen)
  }
  element.appendChild(dokument.createTextNode(`\n${einrueckung}`))
}
