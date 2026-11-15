/**
 * The JSON Schemas of the OneProof Format, and their compact form for the engine.
 *
 * A benefit has one schema per version (`wohngeld-1.0.schema.json`). It binds the frame
 * (`rahmen-1.0.schema.json`) that every application has whatever the benefit — message head,
 * persons, attachments — and describes the `fachdaten` with its code lists. Schemas name each other
 * by URN, `urn:oneproof:format:<name>:<version>`, and lie side by side as `<name>-<version>.schema.json`:
 * no address has to be reachable for a schema to be found.
 *
 * The compact form is what the rest of the engine reads for a FIM schema as well (`fim/schema.ts`):
 * a tree of nodes with id, label, multiplicity, data type and the values of code lists. The id of a
 * node is its pattern (`/fachdaten/personen/*\/einkommen`), so that a profile can name every place
 * of the application, and every id is unique.
 */

import type { Schema, SchemaNode } from '../fim/schema.ts'
import { istObjekt } from '../json.ts'
import type { Json } from '../json.ts'
import { JEDER, zusammen } from './zeiger.ts'

/** A schema as a subschema may be written: a schema, or `true` (everything fits) / `false` (nothing does). */
export type Teilschema = JsonSchema | boolean

/** A JSON Schema (draft 2020-12) of the OneProof Format, as far as the engine reads it. */
export interface JsonSchema {
  /** The URN of the schema, `urn:oneproof:format:<name>:<version>`; only the schema of a file has one. */
  $id?: string
  /** A reference: another schema by URN (`urn:oneproof:format:rahmen:1.0#/$defs/Person`), or a part of this one (`#/$defs/Name`). */
  $ref?: string
  title?: string
  description?: string
  type?: string
  format?: string
  /** The one value that fits. */
  const?: Json
  enum?: Json[]
  /** A code list as alternatives, each with its code (`const`) and its title. */
  oneOf?: { const?: Json; title?: string }[]
  allOf?: Teilschema[]
  properties?: Record<string, Teilschema>
  required?: string[]
  items?: Teilschema
  minItems?: number
  maxItems?: number
  /** Extension of the format: a list with at most one entry per person. */
  'x-eindeutig'?: 'person'
}

/** The schema of a benefit with every schema it refers to. */
export interface JsonSchemata {
  /** The schema of the benefit. */
  haupt: JsonSchema
  /** `haupt` first, then the schemas it refers to, directly or not. */
  alle: JsonSchema[]
}

/** The schemas of an application type, read from the folder of a version. */
export interface JsonSchemataNeben extends JsonSchemata {
  /** The paths of all of them, as files of the version. */
  dateien: string[]
}

/** The parts of a URN of the OneProof Format. */
export interface UrnTeile {
  name: string
  version: string
}

export const URN = 'urn:oneproof:format:'
export const RAHMEN = 'rahmen'

/** `urn:oneproof:format:wohngeld:1.0` → `{name: 'wohngeld', version: '1.0'}`, else `null`. */
export function urnTeile(urn: string | null | undefined): UrnTeile | null {
  const [, name, version] = /^urn:oneproof:format:([a-z][a-z0-9-]*):((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))$/.exec(String(urn ?? '')) ?? []
  return name !== undefined && version !== undefined ? { name, version } : null
}

/** Where the schema of this URN lies, next to the others: `wohngeld-1.0.schema.json`. */
export function dateiVon(urn: string | null | undefined): string | null {
  const teile = urnTeile(urn)
  return teile ? `${teile.name}-${teile.version}.schema.json` : null
}

/** The id of an application type in the OneProof Format: `oneproof:wohngeld`. */
export const antragsartVon = (leistung: string): string => `oneproof:${leistung}`

/** The schemas another one refers to, by URN, not counting itself. */
export function verweiseVon(schema: unknown): string[] {
  const eigene = istObjekt(schema) ? schema.$id : undefined
  const gefunden = new Set<string>()
  const laufe = (knoten: unknown): void => {
    if (Array.isArray(knoten)) return knoten.forEach(laufe)
    if (!istObjekt(knoten)) return
    if (typeof knoten.$ref === 'string' && knoten.$ref.startsWith(URN)) {
      const [ziel = ''] = knoten.$ref.split('#')
      if (ziel !== eigene) gefunden.add(ziel)
    }
    for (const wert of Object.values(knoten)) laufe(wert)
  }
  laufe(schema)
  return [...gefunden]
}

/**
 * A schema file as the reader hands it over. It is parsed JSON the department chose or the
 * installation ships; what it has to be — a schema with its `$id`, references that lead somewhere —
 * is checked where it is used (`ladeSchemata`, `kompaktesSchema`).
 */
async function liesSchema(lies: (datei: string) => Promise<unknown>, datei: string): Promise<JsonSchema> {
  return (await lies(datei)) as JsonSchema
}

/**
 * The schema of a benefit with every schema it refers to, loaded through `lies(datei)`.
 *
 * @param lies   reads a file next to the schema of the benefit
 * @param datei  the file of the benefit
 */
export async function ladeSchemata(lies: (datei: string) => Promise<unknown>, datei: string): Promise<JsonSchemata> {
  const haupt = await liesSchema(lies, datei)
  const alle: JsonSchema[] = [haupt]
  const offen = verweiseVon(haupt)
  const bekannt = new Set([haupt.$id])
  for (let urn = offen.shift(); urn !== undefined; urn = offen.shift()) {
    if (bekannt.has(urn)) continue
    bekannt.add(urn)
    const name = dateiVon(urn)
    if (!name) throw new Error(`Das Schema „${haupt.$id}“ verweist auf „${urn}“, das kein Schema des OneProof Formats ist.`)
    const schema = await liesSchema(lies, name)
    if (schema?.$id !== urn) throw new Error(`Die Datei „${name}“ ist nicht das Schema „${urn}“.`)
    alle.push(schema)
    offen.push(...verweiseVon(schema))
  }
  return { haupt, alle }
}

/**
 * The schemas of an application type in the OneProof Format, read from the folder of a version:
 * the file the application type names, and the schemas it refers to, which lie next to it. Also
 * the paths of all of them, as files of the version.
 *
 * @param lies   reads a file of the version by its path
 * @param datei  the file of the application type, e.g. `schema/wohngeld-1.0.schema.json`
 */
export async function ladeSchemataNeben(lies: (pfad: string) => Promise<unknown>, datei: string): Promise<JsonSchemataNeben> {
  const teile = datei.split('/')
  const name = teile.pop() ?? ''
  const neben = (andere: string | null): string => [...teile, andere].join('/')
  const { haupt, alle } = await ladeSchemata((andere) => lies(neben(andere)), name)
  return { haupt, alle, dateien: [datei, ...alle.slice(1).map(({ $id }) => neben(dateiVon($id)))] }
}

/* ---------------------------------------------------------------------------------------------
 * The compact form
 * ------------------------------------------------------------------------------------------- */

/** How a data type is called in the compact form, as for FIM fields. */
function typVon(typ: string | undefined, format: string | undefined, namen: ReadonlySet<string>): string | null {
  if (typ === 'boolean') return 'bool'
  if (typ === 'integer') return 'num_int'
  if (typ === 'number') return namen.has('Geldbetrag') ? 'num_currency' : 'num'
  if (typ === 'string') return format === 'date' ? 'date' : format === 'date-time' ? 'datetime' : 'text'
  return null
}

/** A node of the compact form. */
export interface OneProofKnoten extends SchemaNode {
  /** The pattern of the place, `/fachdaten/personen/*\/einkommen`. */
  id: string
  /** The name of the property, `*` for the entries of a list. */
  schluessel: string
  /** The title in the schema. */
  name: string
  beschreibung?: string
  /** `min:max`, `*` for unbounded — as in FIM. */
  anzahl: string
  /** `select` for a code list, else `input`. */
  art?: string
  /** `text`, `date`, `datetime`, `num`, `num_currency`, `num_int`, `bool`. */
  typ?: string
  /** Code → title. */
  werte?: Record<string, string>
  /** The value is the id of a person of the application. */
  verweis?: 'person'
  /** A section that answers a yes/no question with `vorhanden`. */
  thema?: boolean
  /** A list with at most one entry per person. */
  eindeutig?: 'person'
  /** The node is a list; its one child stands for every entry. */
  liste?: boolean
  kinder?: OneProofKnoten[]
}

/** The compact form of a schema of the OneProof Format: an application type of the engine, like a FIM schema. */
export interface OneProofSchema extends Schema {
  format: 'oneproof'
  kinder: OneProofKnoten[]
}

/** Is the schema one of the OneProof Format, in its compact form? A FIM schema has no `format`. */
export function istOneProofSchema(schema: Schema): schema is OneProofSchema {
  return 'format' in schema && schema.format === 'oneproof'
}

/** A schema with the documents it comes from, to be looked at part by part. */
interface Teil {
  schema: JsonSchema
  /** The `$id` of the document the schema stands in. */
  basis: string | undefined
}

/** A property of a node of the compact form as the schemas that describe it, side by side, give it. */
interface Facette {
  schema: Teilschema | undefined
  basis: string | undefined
}

/**
 * What a `$ref` leads to inside a document: the member of an object or an array — `knoten?.[teil]`,
 * as it stands for anything but `null` and `undefined`.
 */
const mitglied = (knoten: unknown, teil: string): unknown =>
  knoten === null || knoten === undefined ? undefined : Reflect.get(Object(knoten), teil)

/**
 * The compact form of a schema of the OneProof Format.
 *
 * @param schemata  as {@link ladeSchemata} gives them
 */
export function kompaktesSchema({ haupt, alle }: JsonSchemata): OneProofSchema {
  const teile = urnTeile(haupt.$id)
  if (!teile) throw new Error(`„${haupt.$id}“ ist keine Kennung eines Schemas im OneProof Format.`)
  const dokumente = new Map(alle.map((schema): [string | undefined, JsonSchema] => [schema.$id, schema]))

  /** A schema with every `$ref` and `allOf` resolved into a flat list of parts, each with its document. */
  const teileVon = (
    schema: Teilschema | undefined,
    basis: string | undefined,
    namen = new Set<string>(),
    gesehen = new Set<string>(),
  ): Teil[] => {
    if (schema === true || schema === false || !schema || typeof schema !== 'object') return []
    const liste: Teil[] = [{ schema, basis }]
    if (typeof schema.$ref === 'string') {
      const [dokument, zeiger = ''] = schema.$ref.split('#')
      const ziel = dokument === '' ? basis : dokument
      const name = zeiger.split('/').at(-1)
      const schluessel = `${ziel}#${zeiger}`
      if (!gesehen.has(schluessel)) {
        const aufgeloest = zeiger.split('/').slice(1).reduce(mitglied, dokumente.get(ziel))
        if (aufgeloest === undefined) throw new Error(`Der Verweis „${schema.$ref}“ im Schema „${basis}“ führt ins Leere.`)
        if (name) namen.add(name)
        // What a pointer leads to is a schema, as far as the schemas of the format go.
        liste.push(...teileVon(aufgeloest as Teilschema, ziel, namen, new Set([...gesehen, schluessel])))
      }
    }
    for (const unter of schema.allOf ?? []) liste.push(...teileVon(unter, basis, namen, gesehen))
    return liste
  }

  const baue = (facetten: Facette[], teilePfad: string[], schluessel: string, pflicht: boolean): OneProofKnoten => {
    const namen = new Set<string>()
    const alleTeile = facetten.flatMap(({ schema, basis }) => teileVon(schema, basis, namen))
    const erstes = <S extends keyof JsonSchema>(wort: S): JsonSchema[S] | undefined =>
      alleTeile.find(({ schema }) => schema[wort] !== undefined)?.schema[wort]

    const typ = erstes('type')
    const knoten: OneProofKnoten = {
      id: zusammen(teilePfad),
      schluessel,
      name: erstes('title') ?? schluessel,
      anzahl: `${pflicht ? 1 : 0}:1`,
    }
    const beschreibung = erstes('description')
    if (beschreibung) knoten.beschreibung = beschreibung

    const werte: Record<string, string> = {}
    for (const { schema } of alleTeile) {
      for (const eintrag of schema.oneOf ?? []) if (eintrag?.const !== undefined) werte[String(eintrag.const)] = eintrag.title ?? String(eintrag.const)
      for (const wert of schema.enum ?? []) if (!(String(wert) in werte)) werte[String(wert)] = String(wert)
      if (schema.const !== undefined && schema.const !== null && typeof schema.const !== 'object' && !(String(schema.const) in werte)) {
        werte[String(schema.const)] = String(schema.const)
      }
    }

    if (typ === 'object' || alleTeile.some(({ schema }) => schema.properties)) {
      const pflichten = new Set(alleTeile.flatMap(({ schema }) => schema.required ?? []))
      const eigenschaften = new Map<string, Facette[]>()
      for (const { schema, basis } of alleTeile) {
        for (const [name, unter] of Object.entries(schema.properties ?? {})) {
          if (unter === false) continue
          eigenschaften.set(name, [...(eigenschaften.get(name) ?? []), { schema: unter, basis }])
        }
      }
      const kinder = [...eigenschaften].map(([name, unterFacetten]) => baue(unterFacetten, [...teilePfad, name], name, pflichten.has(name)))
      if (kinder.length > 0) knoten.kinder = kinder
      if (kinder.some((kind) => kind.schluessel === 'vorhanden' && kind.typ === 'bool')) knoten.thema = true
      return knoten
    }

    if (typ === 'array' || alleTeile.some(({ schema }) => schema.items)) {
      const eintraege = alleTeile.filter(({ schema }) => schema.items).map(({ schema, basis }) => ({ schema: schema.items, basis }))
      const mindestens = Math.max(0, ...alleTeile.map(({ schema }) => schema.minItems ?? 0))
      const hoechstens = Math.min(Infinity, ...alleTeile.map(({ schema }) => schema.maxItems ?? Infinity))
      const eintrag = baue(eintraege, [...teilePfad, JEDER], JEDER, false)
      eintrag.anzahl = `${mindestens}:${Number.isFinite(hoechstens) ? hoechstens : '*'}`
      knoten.liste = true
      knoten.kinder = [eintrag]
      const eindeutig = erstes('x-eindeutig')
      if (eindeutig) knoten.eindeutig = eindeutig
      return knoten
    }

    const datentyp = typVon(typ, erstes('format'), namen)
    if (datentyp) knoten.typ = datentyp
    knoten.art = Object.keys(werte).length > 0 ? 'select' : 'input'
    if (Object.keys(werte).length > 0) knoten.werte = werte
    if (namen.has('Personenverweis')) knoten.verweis = 'person'
    return knoten
  }

  const wurzel = baue([{ schema: haupt, basis: haupt.$id }], [], '', true)
  return {
    schemaId: antragsartVon(teile.name),
    version: teile.version,
    name: haupt.title ?? teile.name,
    format: 'oneproof',
    kinder: wurzel.kinder ?? [],
  }
}

/** Every node of the compact form by its id. */
export function knotenNachId<K extends { id: string; kinder?: K[] }>(schema: { kinder?: K[] }): Map<string, K> {
  const index = new Map<string, K>()
  const laufe = (knoten: { kinder?: K[] }): void => {
    for (const kind of knoten.kinder ?? []) {
      index.set(kind.id, kind)
      laufe(kind)
    }
  }
  laufe(schema)
  return index
}

/**
 * The section a place belongs to: the node of the place where it has values of its own (an entry,
 * a section), else the node above it — as `findeBehaelter` finds it for FIM.
 */
export function behaelterVon(schema: OneProofSchema, id: string): OneProofKnoten | null {
  const pfad = pfadZu(schema, id)
  const letzter = pfad?.at(-1)
  if (!pfad || !letzter) return null
  return letzter.kinder ? letzter : (pfad.at(-2) ?? null)
}

/** Is a place asked for every person on its own: a value of a person, or of their entry in a list with one entry per person? */
export function jePersonImSchema(schema: OneProofSchema, id: string): boolean {
  if (id === '/personen/*' || id.startsWith('/personen/*/')) return true
  return (pfadZu(schema, id) ?? []).some((knoten) => knoten.eindeutig === 'person')
}

/** The node of a pattern and the nodes above it, from the top. */
export function pfadZu(schema: OneProofSchema, id: string): OneProofKnoten[] | null {
  const pfad: OneProofKnoten[] = []
  const laufe = (knoten: { kinder?: OneProofKnoten[] }): void => {
    for (const kind of knoten.kinder ?? []) {
      if (id === kind.id || id.startsWith(`${kind.id}/`)) {
        pfad.push(kind)
        if (id !== kind.id) laufe(kind)
        return
      }
    }
  }
  laufe(schema)
  return pfad.at(-1)?.id === id ? pfad : null
}
