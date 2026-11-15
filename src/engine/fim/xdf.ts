/**
 * Reading a FIM data schema as the FIM portal publishes it (XDatenfelder 3, and XDatenfelder 2 where
 * the two agree), for the department's page: a new application type of a profile is made from it.
 *
 * Two things come out of the file:
 *
 *  - the compact schema the engine reads (see `schema.ts`);
 *  - the places of evidence (fields of the data type `file`) and where the condition of each comes
 *    from. The first step that applies decides:
 *
 *      1. `regel`       a rule of the schema names the place in a sentence the page understands:
 *                       „Wenn F… "Frage" = 002 "Ja", dann muss G… befüllt sein.“
 *      2. `regelFremd`  a rule names the place, but in words the page cannot read
 *      3. `abschnitt`   no rule; the section of the place may be missing or repeated, so it decides
 *                       by being in the application
 *      4. `immer`       no rule; the section is in every application, so the place always is
 *
 * The file is only read as an XML tree. Nothing in it is executed or fetched.
 */

import { isRepeatable, labelOf, positionKey } from './schema.ts'
import type { Schema, SchemaNode } from './schema.ts'
import { behaelterVon, istOneProofSchema } from '../oneproof/schema.ts'
import type { AbgeleiteteStelle, Herkunft, HerkunftRegel } from '../profil/bedingungen.ts'
import type { Frage } from '../profil/laden.ts'

/** A node of a parsed XML document, as far as the reading of a schema needs it. */
export interface XmlKnoten {
  readonly nodeType: number
  readonly nodeName: string
  readonly localName?: string | null
  readonly namespaceURI?: string | null
  readonly textContent: string | null
  readonly firstChild: XmlKnoten | null
  readonly nextSibling: XmlKnoten | null
}

/** A parsed XML document. */
export interface XmlDokument {
  readonly documentElement: XmlKnoten | null
  getElementsByTagName(name: string): { readonly length: number }
}

/** What an XML parser of the environment (the browser's, or xmldom's in Node) offers. */
export interface XmlParser {
  parseFromString(text: string, mimeType: 'application/xml'): XmlDokument
}

/** The parser's constructor; xmldom takes options, the browser's `DOMParser` ignores them. */
export type XmlParserKlasse = new (optionen?: { onError?: () => void }) => XmlParser

/** What `leseXdf` takes besides the text. */
export interface XdfOptionen {
  /** The XML parser; the one of the environment unless given (for the tests). */
  DOMParser?: XmlParserKlasse
}

export class XdfError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'XdfError'
  }
}

/* ---------------------------------------------------------------------------------------------
 * XML helpers. Only local names count: XDatenfelder 2 and 3 differ in their namespace prefix.
 * ------------------------------------------------------------------------------------------- */

const lokal = (knoten: XmlKnoten): string => knoten.localName ?? String(knoten.nodeName).split(':').pop() ?? ''

function elemente(knoten: XmlKnoten): XmlKnoten[] {
  const gefunden: XmlKnoten[] = []
  for (let kind = knoten.firstChild; kind; kind = kind.nextSibling) if (kind.nodeType === 1) gefunden.push(kind)
  return gefunden
}

const kinder = (knoten: XmlKnoten, name: string): XmlKnoten[] => elemente(knoten).filter((kind) => lokal(kind) === name)
const kind = (knoten: XmlKnoten, name: string): XmlKnoten | null => kinder(knoten, name)[0] ?? null
const reinerText = (knoten: XmlKnoten | null): string => (knoten?.textContent ?? '').replace(/\s+/g, ' ').trim()
const textVon = (knoten: XmlKnoten | null, name: string): string => (knoten ? reinerText(kind(knoten, name)) : '')
const idVon = (knoten: XmlKnoten): string => textVon(kind(knoten, 'identifikation'), 'id')
const versionVon = (knoten: XmlKnoten): string => textVon(kind(knoten, 'identifikation'), 'version')
const codeVon = (knoten: XmlKnoten, name: string): string => textVon(kind(knoten, name), 'code')

/* ---------------------------------------------------------------------------------------------
 * The sentences of the rules
 * ------------------------------------------------------------------------------------------- */

/** An id as rules write it: `F60000000352`, with a version (`V1.2.0`) or as a path (`G….F…`). */
const ID = '[GF]\\d{8,11}(?:V[\\d.]+)?(?:\\.[GF]\\d{8,11}(?:V[\\d.]+)?)*'

/** „Wenn [das] Feld F… "Name" = 002 "Ja" [ODER = 003 "…"], dann muss|darf [die] Datenfeldgruppe G… …“ */
const SATZ = new RegExp(
  `^Wenn (?:das |die )?(?:Feld|Felder|Datenfeld)?\\s*(${ID})\\s+"([^"]*)"\\s*(=|<>)\\s*(.*?),\\s*dann (muss|darf) (?:das |die |der )?(?:Datenfeldgruppe|Feldgruppe|Datenfeld|Feld|Gruppe)\\s+(${ID})`,
  'i',
)

/** Any sentence with a condition and a target, in whatever words. */
const SATZ_FREI = new RegExp(`^Wenn\\b.*?(${ID}).*?\\bdann\\b.*?(${ID})`, 'si')

const letzteId = (text: string): string => (text.split(/\.(?=[GF]\d)/).at(-1) ?? '').replace(/V[\d.]+$/, '')

/** An answer a rule names: its code (where the sentence gives one) and its name. */
export interface Antwort {
  code: string | null
  name: string
}

/** A sentence of a rule the page understands: the question, the answers and the target. */
export interface VerstandenerSatz {
  verstanden: true
  /** The id of the rule. */
  regel: string
  satz: string
  /** The question: the id of its field. */
  feld: string
  feldName: string
  /** `=` or `<>`. */
  op: string
  antworten: Antwort[]
  /** `muss` or `darf`. */
  folge: string
  /** The id of the group or field the sentence is about. */
  ziel: string
}

/** A sentence with a condition and a target the page cannot read. */
export interface FremderSatz {
  verstanden: false
  regel: string
  satz: string
  ziel: string
}

/** A sentence of a rule. */
export type Satz = VerstandenerSatz | FremderSatz

/** `002 "Ja" ODER = 003 "Später"` → the answers with code and name; `"wahr"` → the truth value. */
function antwortenAus(rechts: string): Antwort[] {
  const paare = [...rechts.matchAll(/(?:^|\s|=)([0-9A-Za-z_.-]+)\s+"([^"]+)"/g)].map(([, code = '', name = '']) => ({ code, name }))
  if (paare.length > 0) return paare
  const wahrheit = /"(wahr|falsch|true|false)"/i.exec(rechts)?.[1]?.toLowerCase()
  if (wahrheit) return [{ code: wahrheit === 'wahr' || wahrheit === 'true' ? 'true' : 'false', name: wahrheit === 'wahr' || wahrheit === 'true' ? 'Ja' : 'Nein' }]
  const roh = rechts.replace(/^=\s*/, '').replace(/"/g, '').trim()
  return roh ? [{ code: null, name: roh }] : []
}

/**
 * The sentences of a rule. One the page understands carries the question, the answers and the
 * target; any other sentence that has a target is kept as "named, but not understood".
 */
export function leseSaetze(regel: { id: string; text: string }): Satz[] {
  const saetze: Satz[] = []
  for (const satz of regel.text.split(/(?<=\.)\s+(?=Wenn )/i)) {
    const verstanden = SATZ.exec(satz)
    if (verstanden) {
      // Every group of the sentence takes part in a match: the defaults only satisfy the type.
      const [, feld = '', feldName = '', op = '', rechts = '', folge = '', ziel = ''] = verstanden
      saetze.push({ verstanden: true, regel: regel.id, satz, feld: letzteId(feld), feldName, op, antworten: antwortenAus(rechts), folge: folge.toLowerCase(), ziel: letzteId(ziel) })
      continue
    }
    const frei = SATZ_FREI.exec(satz)
    if (frei) saetze.push({ verstanden: false, regel: regel.id, satz, ziel: letzteId(frei[2] ?? '') })
  }
  return saetze
}

/* ---------------------------------------------------------------------------------------------
 * The schema
 * ------------------------------------------------------------------------------------------- */

/** The compact schema as read from a file: the schema of `schema.ts` and the title the publisher gives it. */
export interface XdfSchema extends Schema {
  bezeichnung: string
}

/** A rule of the schema as the file has it. */
export interface XdfRegel {
  id: string
  name: string
  text: string
}

/** What `leseXdf` makes of a file. */
export interface XdfGelesen {
  /** XDatenfelder 3 or 2. */
  format: 'XDF3' | 'XDF2'
  schema: XdfSchema
  /** The rules of the schema by id. */
  regeln: Map<string, XdfRegel>
  /** The rules attached to a node of `schema`, by id. */
  regelnAn: Map<Schema | SchemaNode, string[]>
  zahlen: { elemente: number; gruppen: number; felder: number }
}

/**
 * Reads the file.
 *
 * @param text
 * @param optionen   the parser can be injected for the tests
 */
export function leseXdf(text: string, { DOMParser = globalThis.DOMParser }: XdfOptionen = {}): XdfGelesen {
  if (typeof text !== 'string' || text.trim() === '') throw new XdfError('Die Datei ist leer.')
  if (typeof DOMParser !== 'function') throw new XdfError('In dieser Umgebung steht kein XML-Parser zur Verfügung.')
  // A schema has no document type declaration; it is the only way to bring in entities.
  if (/<!DOCTYPE/i.test(text)) throw new XdfError('Die Datei enthält eine Dokumenttyp-Deklaration und wird nicht gelesen.')

  let dokument: XmlDokument
  try {
    dokument = new DOMParser({ onError: () => {} }).parseFromString(text, 'application/xml')
  } catch {
    throw new XdfError('Die Datei ist kein gültiges XML.')
  }
  if (!dokument?.documentElement || dokument.getElementsByTagName('parsererror').length > 0) {
    throw new XdfError('Die Datei ist kein gültiges XML.')
  }

  const wurzel = dokument.documentElement
  const stamm = kind(wurzel, 'stammdatenschema') ?? kind(wurzel, 'datenschema')
  if (!/^xdatenfelder\./i.test(lokal(wurzel)) || !stamm) {
    throw new XdfError('Die Datei ist kein FIM-Datenschema (XDatenfelder). Erwartet wird das Stammdatenschema, wie es das FIM-Portal ausliefert.')
  }
  const format = /xdatenfelder_3|xdf3/i.test(`${wurzel.namespaceURI ?? ''} ${wurzel.nodeName}`) ? 'XDF3' : 'XDF2'

  const regeln = new Map<string, XdfRegel>()
  const regelnAn = new Map<Schema | SchemaNode, string[]>()
  const zahlen = { elemente: 0, gruppen: 0, felder: 0 }

  const sammleRegeln = (element: XmlKnoten): string[] => {
    const ids: string[] = []
    for (const regel of kinder(element, 'regel')) {
      const id = idVon(regel)
      if (!id) continue
      if (!regeln.has(id)) {
        regeln.set(id, { id, name: textVon(regel, 'name'), text: textVon(regel, 'freitextRegel') || textVon(regel, 'definition') || textVon(regel, 'beschreibung') })
      }
      ids.push(id)
    }
    return ids
  }

  const baue = (element: XmlKnoten): SchemaNode[] => {
    const liste: SchemaNode[] = []
    for (const struktur of kinder(element, 'struktur')) {
      const anzahl = textVon(struktur, 'anzahl') || '1:1'
      for (const enthaelt of kinder(struktur, 'enthaelt')) {
        for (const teil of elemente(enthaelt)) {
          const art = lokal(teil)
          if (art !== 'datenfeldgruppe' && art !== 'datenfeld') continue
          const knoten = knotenAus(teil, art)
          knoten.anzahl = anzahl
          regelnAn.set(knoten, sammleRegeln(teil))
          zahlen.elemente++
          if (art === 'datenfeldgruppe') {
            zahlen.gruppen++
            knoten.kinder = baue(teil)
          } else {
            zahlen.felder++
          }
          liste.push(knoten)
        }
      }
    }
    return liste
  }

  const schema: XdfSchema = {
    schemaId: idVon(stamm),
    version: versionVon(stamm),
    name: textVon(stamm, 'name'),
    bezeichnung: textVon(stamm, 'bezeichnung') || textVon(stamm, 'bezeichnungEingabe'),
    kinder: [],
  }
  if (!/^S\d+$/.test(schema.schemaId)) throw new XdfError('Das Schema hat keine gültige Kennung (S…).')
  const wurzelRegeln = sammleRegeln(stamm)
  schema.kinder = baue(stamm)
  regelnAn.set(schema, wurzelRegeln)

  return { format, schema, regeln, regelnAn, zahlen }
}

/** A group or field as the compact schema writes it. */
function knotenAus(element: XmlKnoten, art: 'datenfeldgruppe' | 'datenfeld'): SchemaNode {
  const name = textVon(element, 'name') || idVon(element)
  const knoten: SchemaNode = { id: idVon(element), name }
  const ausgabe = textVon(element, 'bezeichnungAusgabe')
  const eingabe = textVon(element, 'bezeichnungEingabe')
  if (ausgabe && ausgabe !== name) knoten.bezeichnung = ausgabe
  if (eingabe && eingabe !== (knoten.bezeichnung ?? name)) knoten.frage = eingabe

  if (art === 'datenfeld') {
    knoten.art = codeVon(element, 'feldart')
    knoten.typ = codeVon(element, 'datentyp')
    const werte: Record<string, string> = {}
    for (const wert of kinder(kind(element, 'werte') ?? element, 'wert')) {
      const code = textVon(wert, 'code')
      if (code) werte[code] = textVon(wert, 'name') || code
    }
    if (Object.keys(werte).length > 0) knoten.werte = werte
  }
  return knoten
}

/* ---------------------------------------------------------------------------------------------
 * The places of evidence and where their condition comes from
 * ------------------------------------------------------------------------------------------- */

/** How a place is called and where it belongs. */
export interface StellenBeschreibung {
  titel: string
  /** The section the place belongs to. */
  bereich: string
  /** The label of the file field. */
  feld: string
  /** The labels of the groups above it. */
  pfad: string[]
}

/**
 * How a place is called and where it belongs, from its path in the schema: named after the field —
 * or after its section, where the field only says "evidence" — and grouped by the section above.
 *
 * @param pfad   from the top-level group down to the file field
 */
export function beschreibeStelle(pfad: SchemaNode[]): StellenBeschreibung {
  const feld = pfad.at(-1)
  if (!feld) throw new Error('A place is named by at least its field.')
  const gruppen = pfad.slice(0, -1)
  const behaelter = gruppen.at(-1) ?? null
  return {
    titel: NICHTSSAGEND.test(labelOf(feld).trim()) && behaelter ? labelOf(behaelter) : labelOf(feld),
    bereich: labelOf(gruppen.at(-2) ?? behaelter ?? { id: '', name: 'Allgemein' }),
    feld: labelOf(feld),
    pfad: gruppen.map(labelOf),
  }
}

/** May the node be missing, or occur more than once? */
export function optionalOderWiederholbar(knoten: SchemaNode | null | undefined): boolean {
  const [minimum] = String(knoten?.anzahl ?? '1:1').split(':')
  return minimum === '0' || (knoten ? isRepeatable(knoten) : false)
}

/** A file field whose label says nothing beyond "evidence": the place is named after its section. */
const NICHTSSAGEND = /^(nachweis(e)?|nachweis\(e\)|anlage(n)?|upload|datei(en)?|dokument(e)?|unterlage(n)?|beleg(e)?)$/i

const SPAETER = /später|nachreich|nachgereicht/i

/**
 * The question a sentence asks, as the engine reads it (`nennt` of a place): which answers state
 * the fact, which say it does not apply, which leave it open for now. `null` if the answers of the
 * sentence cannot be told by their codes.
 */
function frageAus(satz: VerstandenerSatz, frage: SchemaNode | undefined): Frage | null {
  const alle = frage?.typ === 'bool' ? ['true', 'false'] : Object.keys(frage?.werte ?? {})
  const nachName = (name: string): string | null =>
    Object.entries(frage?.werte ?? {}).find(([, wert]) => wert.trim().toLowerCase() === name.trim().toLowerCase())?.[0] ?? null
  const genannt = satz.antworten
    .map(({ code, name }) => (code && (alle.length === 0 || alle.includes(code)) ? code : nachName(name)))
    .filter((code): code is string => Boolean(code))
  if (genannt.length === 0) return null

  let treffer: string[]
  if (satz.op === '=') treffer = genannt
  else if (alle.length > 0) treffer = alle.filter((code) => !genannt.includes(code))
  else return null
  if (treffer.length === 0) return null

  // "I will answer later" states nothing yet, whichever side of the rule it is on.
  const nameVon = (code: string): string => frage?.werte?.[code] ?? ''
  const spaeter = alle.filter((code) => SPAETER.test(nameVon(code)))
  const ja = treffer.filter((code) => !spaeter.includes(code))
  const nein = alle.filter((code) => !treffer.includes(code) && !spaeter.includes(code))
  if (ja.length === 0) return null

  return { feld: satz.feld, ja, ...(nein.length > 0 ? { nein } : {}), ...(spaeter.length > 0 ? { spaeter } : {}) }
}

/** A place derived from a FIM schema: where it is, how it is called, where its condition comes from. */
export interface AbgeleiteteFimStelle extends AbgeleiteteStelle {
  /** The label of the file field. */
  feld: string
  /** The labels of the groups above it. */
  pfad: string[]
}

/** A rule of the schema that no sentence the page reads came out of. */
export interface NichtAusgewertet extends XdfRegel {
  /** The rule concerns a place of evidence. */
  beiNachweis: boolean
}

/** What `leiteStellenAb` finds in a schema. */
export interface Ableitung {
  stellen: AbgeleiteteFimStelle[]
  regeln: { gesamt: number; ausgewertet: number; nichtAusgewertet: NichtAusgewertet[] }
  /** How many file fields the schema has (places may share a position). */
  nachweisfelder: number
}

/**
 * Every place of evidence of the schema, in schema order, with its title, the section it belongs
 * to, where its condition comes from and — where a rule says it — the question that decides.
 *
 * A place is the group a file field hangs in and the field (`positionKey`), as a profile names it.
 * The same place may occur at several points of the schema (for the applicant and for every
 * member of the household); it is one place.
 *
 * @param gelesen   as `leseXdf` gives it
 */
export function leiteStellenAb({ schema, regeln, regelnAn }: Pick<XdfGelesen, 'schema' | 'regeln' | 'regelnAn'>): Ableitung {
  const saetze = [...regeln.values()].flatMap(leseSaetze)
  const ersteKnoten = new Map<string, SchemaNode>()
  const orte = new Map<string, SchemaNode[]>()
  let nachweisfelder = 0

  const laufe = (knoten: Schema | SchemaNode, pfad: SchemaNode[]): void => {
    for (const unter of knoten.kinder ?? []) {
      const hier = [...pfad, unter]
      if (!ersteKnoten.has(unter.id)) ersteKnoten.set(unter.id, unter)
      if (unter.typ === 'file') {
        nachweisfelder++
        const position = positionKey(hier)
        if (!orte.has(position)) orte.set(position, hier)
      }
      if (unter.kinder) laufe(unter, hier)
    }
  }
  laufe(schema, [])

  const unbrauchbar = new Set<string>()
  const beiNachweis = new Set<string>()

  const stellen = [...orte].map(([position, pfad]): AbgeleiteteFimStelle => {
    const feld = pfad.at(-1)
    if (!feld) throw new Error('A place is named by at least its field.')
    const gruppen = pfad.slice(0, -1)
    const behaelter = gruppen.at(-1) ?? null
    const ids = pfad.map(({ id }) => id)
    const anPfad = new Set(pfad.flatMap((knoten) => regelnAn.get(knoten) ?? []))

    // A rule names a place by the id of a group above it or of the field. A field like "Nachweis"
    // stands in many groups, though: a rule that names the field counts only where it is attached.
    // And a rule about a group high above says nothing about a place below an optional section.
    const trifft = (satz: Satz): boolean => {
      const tiefe = ids.lastIndexOf(satz.ziel)
      if (tiefe === -1) return false
      if (satz.ziel === feld.id && !anPfad.has(satz.regel)) return false
      return !gruppen.slice(tiefe + 1).some(optionalOderWiederholbar)
    }

    const fremd: Satz[] = saetze.filter((satz) => !satz.verstanden && trifft(satz))
    const verstanden = saetze.filter((satz): satz is VerstandenerSatz => satz.verstanden && satz.folge === 'muss' && trifft(satz))
    for (const satz of [...fremd, ...verstanden]) beiNachweis.add(satz.regel)

    // The rule at the level closest to the field decides.
    const tiefe = (satz: Satz): number => ids.lastIndexOf(satz.ziel)
    const naechste = verstanden.length > 0 ? Math.max(...verstanden.map(tiefe)) : -1
    const fragen: Frage[] = []
    const gruende: HerkunftRegel[] = []
    let nurFrage = false
    for (const satz of verstanden.filter((kandidat) => tiefe(kandidat) === naechste)) {
      const frage = frageAus(satz, ersteKnoten.get(satz.feld))
      if (!frage) {
        // Understood, but its answers cannot be told by code: as good as not understood.
        unbrauchbar.add(satz.regel)
        fremd.push({ ...satz, verstanden: false })
        continue
      }
      const schluessel = JSON.stringify(frage)
      if (!fragen.some((vorhanden) => JSON.stringify(vorhanden) === schluessel)) fragen.push(frage)
      if (!gruende.some((grund) => grund.satz === satz.satz)) gruende.push({ id: satz.regel, name: regeln.get(satz.regel)?.name ?? '', satz: satz.satz })
      if (satz.ziel === feld.id) nurFrage = true
    }

    let herkunft: Herkunft
    if (fragen.length > 0) herkunft = { art: 'regel', regeln: gruende }
    else if (fremd.length > 0) herkunft = { art: 'regelFremd', regeln: [...new Map(fremd.map((satz): [string, HerkunftRegel] => [satz.regel, { id: satz.regel, name: regeln.get(satz.regel)?.name ?? '', satz: satz.satz }])).values()] }
    else if (behaelter && optionalOderWiederholbar(behaelter)) herkunft = { art: 'abschnitt' }
    else herkunft = { art: 'immer' }

    return {
      position,
      ...beschreibeStelle(pfad),
      herkunft,
      ...(fragen.length > 0 ? { nennt: fragen.length === 1 ? fragen[0] : fragen } : {}),
      ...(nurFrage ? { nurFrage: true } : {}),
    }
  })

  // Rules that could not be read, and whether they concern a place of evidence.
  const verstandeneRegeln = new Set(saetze.filter((satz) => satz.verstanden).map((satz) => satz.regel))
  const nichtAusgewertet = [...regeln.values()]
    .filter((regel) => !verstandeneRegeln.has(regel.id) || unbrauchbar.has(regel.id))
    .map((regel) => ({ ...regel, beiNachweis: beiNachweis.has(regel.id) }))

  return {
    stellen,
    regeln: { gesamt: regeln.size, ausgewertet: regeln.size - nichtAusgewertet.length, nichtAusgewertet },
    nachweisfelder,
  }
}

/* ---------------------------------------------------------------------------------------------
 * What a place could be told apart by
 * ------------------------------------------------------------------------------------------- */

const JA_NEIN = /^(ja|nein)\b|später|nachreich|nachgereicht/i

/** One answer of a question by which the conditions of a place can be told apart. */
export interface UnterscheidungAntwort {
  /** The question and the answers for which the condition applies. */
  wenn: { feld: string; ja: string[] }
  titel: string
  /** The code of the answer; `null` for a yes/no question. */
  code: string | null
}

/** A question of the section of a place by which its conditions could differ. */
export interface Unterscheidung {
  /** The id of the field that is asked, or `je-frage`. */
  wert: string
  frage: string
  antworten: UnterscheidungAntwort[]
}

/** A yes/no question of a section, with the answers that say yes. */
interface JaNeinFrage {
  feld: SchemaNode
  ja: string[]
}

/**
 * The questions of the section of a place by which its conditions could differ: a selection with
 * three answers or more ("Art der Einnahmen"), or — where the section asks several yes/no
 * questions — one condition per question. Only what the engine can read at the place counts: the
 * section itself and its groups that are not repeated.
 */
export function unterscheidungenFuer(schema: Schema, position: string): Unterscheidung[] {
  // The OneProof Format names a place by its pattern; in FIM a field at the root has no section of its own.
  const behaelter = istOneProofSchema(schema)
    ? behaelterVon(schema, position)
    : position.startsWith('/')
      ? null
      : findeBehaelter(schema, position)
  if (!behaelter) return []

  const felder: SchemaNode[] = []
  const sammle = (knoten: Schema | SchemaNode): void => {
    for (const unter of knoten.kinder ?? []) {
      if (unter.kinder) {
        if (!isRepeatable(unter)) sammle(unter)
      } else if (!felder.some(({ id }) => id === unter.id)) felder.push(unter)
    }
  }
  sammle(behaelter)

  const frageText = (feld: SchemaNode): string => (feld.frage ?? labelOf(feld)).replace(/\s*\?\s*$/, '')
  const optionen: Unterscheidung[] = []

  for (const feld of felder) {
    const werte = Object.entries(feld.werte ?? {})
    if (feld.art === 'select' && werte.length >= 3 && !werte.every(([, name]) => JA_NEIN.test(name))) {
      optionen.push({
        wert: feld.id,
        frage: frageText(feld),
        antworten: werte.map(([code, name]) => ({ wenn: { feld: feld.id, ja: [code] }, titel: name, code })),
      })
    }
  }

  const jaNein = felder
    .map((feld): JaNeinFrage | null => {
      if (feld.typ === 'bool') return { feld, ja: ['true'] }
      const werte = Object.entries(feld.werte ?? {})
      const ja = werte.filter(([, name]) => /^ja\b/i.test(name)).map(([code]) => code)
      return feld.art === 'select' && werte.length > 0 && werte.every(([, name]) => JA_NEIN.test(name)) && ja.length > 0 ? { feld, ja } : null
    })
    .filter((frage): frage is JaNeinFrage => Boolean(frage))
  if (jaNein.length >= 2) {
    optionen.push({
      wert: 'je-frage',
      frage: `Je Frage (${jaNein.length} Ja/Nein-Fragen)`,
      antworten: jaNein.map(({ feld, ja }) => ({ wenn: { feld: feld.id, ja }, titel: frageText(feld), code: null })),
    })
  }
  return optionen
}

/** The group a place hangs in (the first occurrence), or the schema itself for a field at the root. */
export function findeBehaelter(schema: Schema, position: string): Schema | SchemaNode | null {
  const [gruppe, feld] = position.split('/')
  let gefunden: Schema | SchemaNode | null = null
  const laufe = (knoten: Schema | SchemaNode): void => {
    for (const unter of knoten.kinder ?? []) {
      if (gefunden) return
      if (unter.id === feld && ('id' in knoten ? knoten.id : '') === gruppe && !unter.kinder) {
        gefunden = knoten
        return
      }
      if (unter.kinder) laufe(unter)
    }
  }
  laufe(schema)
  return gefunden
}
