/**
 * Reads application data in the FIM XDatenfelder-3 instance format into a small tree.
 *
 * The element names of an instance ARE the ids of the schema (`G…` for groups, `F…` for
 * fields), so the tree needs no schema to be read. Two envelopes are accepted:
 *
 *  - a plain FIM instance as defined by the instance XSD of the schema (root
 *    `fim.S01000000123.…`, namespace `urn:xoev-de:xfall:standard:fim-s01000000123_1.7.0`);
 *  - the export of the LeistungsLotse application: `<myForm>` with an `<antragsdaten>` element
 *    that carries `schemaID` and `schemaVersion`.
 *
 * Nothing here is specific to a benefit. Which ids mean what is the business of the profile.
 */

import type { AntragFehler } from '../oneproof/pruefung.ts'

export interface Node {
  /** Element name = id in the schema. */
  id: string
  /** Trimmed text content of the element itself. */
  text: string
  /** Attributes (a `file` field carries id, content-type, …). */
  attrs: Record<string, string>
  children: Node[]
}

/** A file an application announces: FIM only in the export, the OneProof Format in `anlagen`. */
export interface Anhang {
  id: string
  name: string
  contentType: string
  length: number | null
}

export interface Instance {
  format: 'leistungslotse-export' | 'fim-instanz'
  /** E.g. `S01000000123`. */
  schemaId: string
  /** E.g. `1.7.0`. */
  version: string
  /** Synthetic root; its children are the top-level groups. */
  root: Node
  /** The files the envelope announces (only the export format lists them). */
  anhaenge: Anhang[]
  /** The version the application was written in, where it was read through the dictionary of another one (`abbildung.ts`). */
  urspruenglicheVersion?: string
}

/** What `readInstance` and `leseAntrag` take besides the text. */
export interface ReadInstanceOptionen {
  /** The parser is injectable so that tests can run without a browser. */
  DOMParser?: typeof globalThis.DOMParser
}

export class InstanceError extends Error {
  /** The errors of a file in the OneProof Format that does not hold against its schema (`oneproof/lesen.ts`). */
  declare fehler?: AntragFehler[]

  constructor(message: string) {
    super(message)
    this.name = 'InstanceError'
  }
}

const SCHEMA_ID = /^S\d{11}$/

export function readInstance(xml: string, { DOMParser = globalThis.DOMParser }: ReadInstanceOptionen = {}): Instance {
  if (typeof xml !== 'string' || xml.trim() === '') {
    throw new InstanceError('Die Antragsdaten sind leer.')
  }
  if (typeof DOMParser !== 'function') {
    throw new InstanceError('In dieser Umgebung steht kein XML-Parser zur Verfügung.')
  }
  // The browser parser never resolves external entities. A document type declaration has no
  // place in an application and is the only way to smuggle in entities, so it is refused outright.
  if (/<!DOCTYPE/i.test(xml)) {
    throw new InstanceError('Die Antragsdaten enthalten eine Dokumenttyp-Deklaration und werden nicht gelesen.')
  }

  let document: Document
  try {
    document = new DOMParser().parseFromString(xml, 'application/xml')
  } catch {
    // Some parsers throw on malformed input, browsers hand back a document with a parsererror.
    throw new InstanceError('Die Antragsdaten sind kein gültiges XML.')
  }
  const failure = document.getElementsByTagName('parsererror')[0]
  if (failure || !document.documentElement) {
    throw new InstanceError('Die Antragsdaten sind kein gültiges XML.')
  }

  const rootElement = document.documentElement
  const rootName = localName(rootElement)

  if (rootName === 'myForm') return readExport(rootElement)
  if (rootName.startsWith('fim.')) return readPlain(rootElement)

  throw new InstanceError(
    `Das Format ist unbekannt (Wurzelelement „${rootName}“). Erwartet wird eine FIM-Instanz ` +
      '(Wurzel „fim.S0100…“) oder der LeistungsLotse-Export mit „antragsdaten“.',
  )
}

function readExport(form: Element): Instance {
  const data = childrenOf(form).find((child) => localName(child) === 'antragsdaten')
  if (!data) {
    throw new InstanceError(
      'Die Datei enthält keine „antragsdaten“. Sie ist kein FIM-Export mit Wohngeld-Antragsdaten.',
    )
  }

  const schemaId = data.getAttribute('schemaID') ?? ''
  const version = data.getAttribute('schemaVersion') ?? ''
  if (!SCHEMA_ID.test(schemaId) || version === '') {
    throw new InstanceError('„antragsdaten“ nennt keine Schema-ID und keine Schema-Version.')
  }

  // The export lists the files it carries as elements with an `original-name`, whatever their name.
  const anhaenge: Anhang[] = []
  const evidence = childrenOf(form).find((child) => localName(child) === 'nachweise')
  for (const file of evidence ? descendantElements(evidence, (element) => element.hasAttribute('original-name')) : []) {
    anhaenge.push({
      id: file.getAttribute('id') ?? '',
      name: file.getAttribute('original-name') ?? (file.textContent ?? '').trim(),
      contentType: file.getAttribute('content-type') ?? '',
      length: toNumber(file.getAttribute('length')),
    })
  }

  return { format: 'leistungslotse-export', schemaId, version, root: toNode(data, 'antragsdaten'), anhaenge }
}

function readPlain(rootElement: Element): Instance {
  // fim.S01000000123.01000000123001007 — the schema id is the second segment.
  const schemaId = localName(rootElement).split('.')[1] ?? ''
  // urn:xoev-de:xfall:standard:fim-s01000000123_1.7.0 — the version closes the namespace.
  const version = /_(\d+\.\d+\.\d+)$/.exec(rootElement.namespaceURI ?? '')?.[1] ?? ''

  if (!SCHEMA_ID.test(schemaId) || version === '') {
    throw new InstanceError('Aus dem Wurzelelement lassen sich Schema-ID und Version nicht ablesen.')
  }

  return { format: 'fim-instanz', schemaId, version, root: toNode(rootElement, 'antragsdaten'), anhaenge: [] }
}

function toNode(element: Element, id = localName(element)): Node {
  const attrs: Record<string, string> = {}
  for (const attribute of Array.from(element.attributes ?? [])) attrs[attribute.name] = attribute.value

  const children = childrenOf(element).map((child) => toNode(child))

  // Text of the element itself, without the text of its children: a field holds exactly its own.
  const text = children.length === 0 ? (element.textContent ?? '').trim() : ''

  return { id, text, attrs, children }
}

const childrenOf = (element: Element): Element[] => Array.from(element.childNodes ?? []).filter((node): node is Element => node.nodeType === 1)

function descendantElements(element: Element, matches: (element: Element) => boolean): Element[] {
  const found: Element[] = []
  for (const child of childrenOf(element)) {
    if (matches(child)) found.push(child)
    found.push(...descendantElements(child, matches))
  }
  return found
}

const localName = (element: Element): string => element.localName ?? element.nodeName.split(':').pop()

const toNumber = (value: string | null): number | null => (value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null)

/* ---------------------------------------------------------------------------------------------
 * Version bridging
 * ------------------------------------------------------------------------------------------- */

/**
 * Renames the ids of a tree with a dictionary (old id → new id). Ids the dictionary does not
 * know stay as they are. This is how an application in an older schema version is made readable
 * for a profile that is written against the newer ids: the publisher of the schema delivers the
 * mapping, the nesting is kept as the application has it.
 */
export function renameIds(node: Node, dictionary: Record<string, string>): Node {
  return {
    ...node,
    id: node.id === 'antragsdaten' ? node.id : (dictionary[node.id] ?? node.id),
    children: node.children.map((child) => renameIds(child, dictionary)),
  }
}

/* ---------------------------------------------------------------------------------------------
 * Queries
 * ------------------------------------------------------------------------------------------- */

/** All direct children with this id. */
export const childrenWith = (node: Node, id: string): Node[] => node.children.filter((child) => child.id === id)

/**
 * All nodes reached by following a chain of ids downwards from `node`, in document order. A
 * repeated group is expanded, so the result may hold several nodes.
 */
export function followChain(node: Node, chain: readonly string[]): Node[] {
  let current = [node]
  for (const id of chain) current = current.flatMap((candidate) => childrenWith(candidate, id))
  return current
}

/** The first node with this id anywhere below `node` (depth first, document order). */
export function findFirst(node: Node, id: string): Node | null {
  for (const child of node.children) {
    if (child.id === id) return child
    const deeper = findFirst(child, id)
    if (deeper) return deeper
  }
  return null
}

/**
 * The text of the nearest field with this id: first inside `node`, then — walking up along
 * `ancestors` — inside each parent. A fact about "this row" is thus found next to the row, a
 * fact about the household further up. `ancestors` lists the parents from near to far.
 */
export function nearestValue(node: Node, ancestors: Node[], id: string): string | null {
  for (const scope of [node, ...ancestors]) {
    if (scope.id === id && scope.children.length === 0) return scope.text
    const hit = findFirst(scope, id)
    if (hit && hit.children.length === 0) return hit.text
  }
  return null
}
