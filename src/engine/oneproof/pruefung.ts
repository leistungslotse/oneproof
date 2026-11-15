/**
 * Is a file a valid application in the OneProof Format?
 *
 * First against the JSON Schema of its benefit and version (Draft 2020-12, with Ajv), then against
 * the rules of the frame that a JSON Schema cannot state:
 *
 *  - every person has an id of her own, and every reference to a person names one of them;
 *  - a list that says so (`x-eindeutig: "person"`) has at most one entry per person;
 *  - no file name occurs twice among the attachments;
 *  - every place an attachment refers to (`bezuege[].stelle`) is a value the file gives;
 *  - an attachment that names a person refers only to places of that person or of nobody.
 *
 * Before any of that the file is held against a few limits that keep the check itself affordable: a
 * list with an upper bound is counted (Ajv, which collects every error, would otherwise check a list
 * of tens of thousands of entries against its schema one by one, quadratically for a list of
 * unique pointers), the nesting is bounded, and so is the length of a text.
 *
 * A file with errors is not read at all, not even in parts. The errors name their place as a JSON
 * Pointer, so that the sending service finds them.
 */

import Ajv2020 from 'ajv/dist/2020.js'
import type { ErrorObject, ValidateFunction } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { istObjekt } from '../json.ts'
import { personDerStelle } from './personen.ts'
import type { JsonSchemata, OneProofKnoten, OneProofSchema } from './schema.ts'
import { treffer, mitgliedVon, wertBei, zerlege, zusammen } from './zeiger.ts'

/** An error of an application: the place as a JSON Pointer (empty for the whole file) and what is wrong there, in words. */
export interface AntragFehler {
  stelle: string
  meldung: string
}

/** At most this many errors are collected; the message names the first few. */
export const HOECHSTENS_FEHLER = 100
const IN_DER_MELDUNG = 5

/**
 * The deepest nesting of objects and lists a file may have. The schemas need about ten levels; the
 * free area (`erweiterungen`) is the only place that takes more, and a file nested thousands of
 * levels deep would break the writing of the package (`JSON.stringify` recurses).
 */
export const HOECHSTE_TIEFE = 64

/** The longest text a file may hold. A schema has no text of more than a few thousand characters; Ajv checks the pattern of a text of millions with a regular expression that overflows the stack. */
export const LAENGSTER_TEXT = 1_000_000

/** At most this many characters of a name from the file go into a message. */
const NAME_IN_MELDUNG = 60

const pruefer = new WeakMap<object, ValidateFunction>()

/** The compiled validator of a schema and the schemas it refers to; compiled once. */
function prueferFuer({ haupt, alle }: JsonSchemata): ValidateFunction {
  let vorhanden = pruefer.get(haupt)
  if (!vorhanden) {
    // Strict, so that a typo in a schema fails loudly. `required` in a branch without `properties`
    // (`else: {required: ["richtung"]}`) is good JSON Schema, not a typo.
    try {
      const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true })
      addFormats(ajv)
      // A value other than "person" (a typo, `true`) would switch the rule off without a word: refuse it.
      ajv.addKeyword({ keyword: 'x-eindeutig', schemaType: 'string', metaSchema: { enum: ['person'] } })
      for (const schema of alle) if (schema !== haupt) ajv.addSchema(schema)
      vorhanden = ajv.compile(haupt)
    } catch (grund) {
      // Ajv turns a schema into code with `new Function` (already for the meta-schema, when the first
      // schema is added); a page whose Content-Security-Policy forbids that cannot check a file.
      if (grund instanceof EvalError) {
        throw new Error(
          'Die Antragsdatei kann auf dieser Seite nicht geprüft werden: Ihre Sicherheitsrichtlinie (Content-Security-Policy) verbietet „unsafe-eval“, das die Prüfung gegen das Schema braucht. Bitte wenden Sie sich an den Betreiber der Seite.',
        )
      }
      throw grund
    }
    pruefer.set(haupt, vorhanden)
  }
  return vorhanden
}

/**
 * A name from the file as a message shows it: without control characters (a line break, the mark
 * that turns the text around), and at most {@link NAME_IN_MELDUNG} characters.
 */
export function genannt(name: unknown): string {
  const zeichen = Array.from(String(name).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' '))
  return zeichen.length <= NAME_IN_MELDUNG ? zeichen.join('') : `${zeichen.slice(0, NAME_IN_MELDUNG - 1).join('')}…`
}

/** The words for a key of a table, if it has some. */
const nachschlagen = (tabelle: Record<string, string>, schluessel: unknown): string | undefined => tabelle[String(schluessel)]

/** An error of Ajv in words, without the noise of the branches that led to it. */
function inWorten(fehler: ErrorObject): string {
  const p = fehler.params ?? {}
  switch (fehler.keyword) {
    case 'required':
      return `Die Angabe „${genannt(p.missingProperty)}“ fehlt.`
    case 'additionalProperties':
      return `Die Angabe „${genannt(p.additionalProperty)}“ kennt das Format hier nicht.`
    case 'false schema':
      return 'Diese Angabe ist hier nicht zulässig.'
    case 'type':
      return `Erwartet wird ${nachschlagen({ object: 'ein Objekt', array: 'eine Liste', string: 'ein Text', number: 'eine Zahl', integer: 'eine ganze Zahl', boolean: 'true oder false' }, p.type) ?? p.type}.`
    case 'const':
    case 'enum':
    case 'oneOf':
      return 'Der Wert ist hier nicht vorgesehen.'
    case 'pattern':
      return p.pattern === '\\S' ? 'Der Text besteht nur aus Leerzeichen.' : 'Der Wert hat nicht die verlangte Form.'
    case 'format':
      return `Der Wert ist ${nachschlagen({ date: 'kein gültiges Datum', 'date-time': 'kein gültiger Zeitpunkt', email: 'keine gültige E-Mail-Adresse', uuid: 'keine gültige UUID', 'json-pointer': 'kein gültiger JSON-Pointer' }, p.format) ?? `nicht im Format „${p.format}“`}.`
    case 'minLength':
      return 'Der Text ist zu kurz.'
    case 'maxLength':
      return `Der Text ist länger als ${p.limit} Zeichen.`
    case 'minimum':
    case 'exclusiveMinimum':
      return 'Der Wert ist zu klein.'
    case 'maximum':
    case 'exclusiveMaximum':
      return 'Der Wert ist zu groß.'
    case 'minItems':
      return p.limit === 1 ? 'Die Liste ist leer.' : `Die Liste hat weniger als ${p.limit} Einträge.`
    case 'maxItems':
      return `Die Liste hat mehr als ${p.limit} Einträge.`
    case 'uniqueItems':
      return 'Die Liste enthält einen Eintrag doppelt.'
    case 'minProperties':
      return 'Die Angabe ist leer.'
    case 'maxProperties':
      return 'Bei „vorhanden: false“ folgen keine weiteren Angaben.'
    case 'contains':
      return (
        nachschlagen({ '/personen': 'Genau eine Person hat die Rolle „antragsteller“.', '/anlagen': 'Höchstens eine Anlage ist das Antragsdokument.' }, fehler.instancePath) ??
        'Die Liste hat nicht die verlangte Zahl solcher Einträge.'
      )
    case 'anyOf':
      return 'Die Angabe passt zu keiner der erlaubten Formen.'
    default:
      return 'Die Angabe entspricht nicht dem Schema.'
  }
}

/** Errors that only say a branch did not hold; the error inside the branch says why. */
const NUR_VERZWEIGUNG = new Set(['if', 'then', 'else', 'allOf'])

/**
 * An error inside `contains` is no error: it says that an entry is not the one looked for (not the
 * applicant, not the application document) — the `contains` error of the list says what is wrong.
 */
const imContains = (fehler: ErrorObject): boolean => /\/contains\//.test(fehler.schemaPath ?? '')

function schemaFehler(pruefe: ValidateFunction, daten: unknown): AntragFehler[] {
  if (pruefe(daten)) return []
  const roh = (pruefe.errors ?? []).filter((fehler) => !NUR_VERZWEIGUNG.has(fehler.keyword) && !imContains(fehler))
  // A code that is not on the list fails every branch of the `oneOf` and the `oneOf` itself: one message.
  const codeFehler = new Set(roh.filter((fehler) => fehler.keyword === 'oneOf').map((fehler) => fehler.instancePath))
  // An `anyOf` of which each branch wants one value (a family name or an organisation): one message.
  const eineVon = new Map<string, string[]>()
  for (const eintrag of roh.filter((kandidat) => kandidat.keyword === 'required' && /\/anyOf\/\d+\/required$/.test(kandidat.schemaPath ?? ''))) {
    eineVon.set(eintrag.instancePath, [...(eineVon.get(eintrag.instancePath) ?? []), eintrag.params.missingProperty])
  }
  const gesehen = new Set()
  const fehler: AntragFehler[] = []
  for (const eintrag of roh) {
    if (eintrag.keyword === 'const' && codeFehler.has(eintrag.instancePath)) continue
    if (eintrag.keyword === 'required' && /\/anyOf\/\d+\/required$/.test(eintrag.schemaPath ?? '')) continue
    const stelle = eintrag.instancePath
    const fehlen = eintrag.keyword === 'anyOf' ? eineVon.get(stelle) : null
    const meldung = fehlen ? `Es fehlt die Angabe ${fehlen.map((name) => `„${name}“`).join(' oder ')}.` : inWorten(eintrag)
    const schluessel = `${stelle} ${meldung}`
    if (gesehen.has(schluessel)) continue
    gesehen.add(schluessel)
    fehler.push({ stelle, meldung })
  }
  return fehler
}

/** A place of the file as a pointer, from the chain of its parents. */
interface Spur {
  eltern: Spur | null
  schluessel: string
}

const zeigerVon = (spur: Spur | null): string => {
  const teile: string[] = []
  for (let hier = spur; hier?.eltern; hier = hier.eltern) teile.unshift(hier.schluessel)
  return zusammen(teile)
}

/**
 * The limits of the file itself, found without the schema: how deep it is nested and how long a text
 * is. Walks without recursion, so that a file of any depth gets an answer.
 */
function formFehler(daten: unknown): AntragFehler[] {
  const fehler: AntragFehler[] = []
  const stapel: { wert: object; spur: Spur; tiefe: number }[] = []
  if (typeof daten === 'object' && daten !== null) stapel.push({ wert: daten, spur: { eltern: null, schluessel: '' }, tiefe: 1 })
  while (stapel.length > 0 && fehler.length < HOECHSTENS_FEHLER) {
    const hier = stapel.pop()
    if (!hier) break
    if (hier.tiefe > HOECHSTE_TIEFE) {
      // The place where the limit is crossed, once: nothing below it is looked at.
      fehler.push({ stelle: zeigerVon(hier.spur), meldung: `Die Angaben sind hier tiefer als ${HOECHSTE_TIEFE} Ebenen verschachtelt.` })
      continue
    }
    for (const [schluessel, wert] of Object.entries(hier.wert)) {
      const spur = { eltern: hier.spur, schluessel }
      if (typeof wert === 'string' && wert.length > LAENGSTER_TEXT) {
        fehler.push({ stelle: zeigerVon(spur), meldung: `Der Text ist länger als ${LAENGSTER_TEXT.toLocaleString('de-DE')} Zeichen.` })
      } else if (typeof wert === 'object' && wert !== null) {
        stapel.push({ wert, spur, tiefe: hier.tiefe + 1 })
      }
    }
  }
  return fehler
}

/** The lists of the schema with an upper bound, with their patterns and that bound. */
function listenMitGrenze(schema: OneProofSchema): { muster: string; hoechstens: number }[] {
  const listen: { muster: string; hoechstens: number }[] = []
  const laufe = (kinder: OneProofKnoten[] | undefined): void => {
    for (const kind of kinder ?? []) {
      // The bound of a list is the multiplicity of its one child, which stands for every entry.
      const hoechstens = /^\d+:(\d+)$/.exec(kind.kinder?.[0]?.anzahl ?? '')?.[1]
      if (kind.liste && hoechstens !== undefined) listen.push({ muster: kind.id, hoechstens: Number(hoechstens) })
      laufe(kind.kinder)
    }
  }
  laufe(schema.kinder)
  return listen
}

/**
 * Lists that are longer than the schema allows. Counted before Ajv sees the file: with every error
 * collected, Ajv checks each entry of a list of 20 000 empty persons against its schema — more than
 * a minute — to say in the end what one look at the length says.
 */
function listenFehler(daten: unknown, schema: OneProofSchema): AntragFehler[] {
  const fehler: AntragFehler[] = []
  for (const { muster, hoechstens } of listenMitGrenze(schema)) {
    for (const { teile, fehlt } of treffer(daten, muster)) {
      if (fehlt.length > 0) continue
      const liste = wertBei(daten, teile)
      if (Array.isArray(liste) && liste.length > hoechstens) fehler.push({ stelle: zusammen(teile), meldung: `Die Liste hat mehr als ${hoechstens} Einträge.` })
    }
  }
  return fehler
}

/** Every value of a pattern in the file, with its pointer. */
const werteBei = (daten: unknown, muster: string): { zeiger: string; teile: string[]; wert: unknown }[] =>
  treffer(daten, muster)
    .filter(({ fehlt }) => fehlt.length === 0)
    .map(({ teile }) => ({ zeiger: zusammen(teile), teile, wert: wertBei(daten, teile) }))

/** The rules a JSON Schema cannot state (see the head of the file). */
function regelFehler(daten: unknown, schema: OneProofSchema): AntragFehler[] {
  // A file that holds against the schema is an object.
  if (!istObjekt(daten)) throw new Error('Die Regeln des Rahmens gelten für ein Objekt.')
  const fehler: AntragFehler[] = []
  const personen: unknown[] = Array.isArray(daten.personen) ? daten.personen : []
  const ids = new Map<string, number>()
  for (const [index, person] of personen.entries()) {
    const id = mitgliedVon(person, 'id')
    if (typeof id !== 'string') continue
    const vorher = ids.get(id)
    if (vorher !== undefined) fehler.push({ stelle: `/personen/${index}/id`, meldung: `Die Kennung „${genannt(id)}“ hat schon die Person /personen/${vorher}.` })
    else ids.set(id, index)
  }

  const knoten: OneProofKnoten[] = []
  const laufe = (liste: OneProofKnoten[] | undefined): void => {
    for (const kind of liste ?? []) {
      knoten.push(kind)
      laufe(kind.kinder)
    }
  }
  laufe(schema.kinder)

  for (const verweis of knoten.filter((kind) => kind.verweis === 'person')) {
    for (const { zeiger, wert } of werteBei(daten, verweis.id)) {
      if (typeof wert === 'string' && !ids.has(wert)) fehler.push({ stelle: zeiger, meldung: `Eine Person mit der Kennung „${genannt(wert)}“ gibt es in „personen“ nicht.` })
    }
  }

  for (const liste of knoten.filter((kind) => kind.liste && kind.eindeutig === 'person')) {
    for (const { zeiger, wert } of werteBei(daten, liste.id)) {
      const vergeben = new Map<string, number>()
      const eintraege: unknown[] = Array.isArray(wert) ? wert : []
      for (const [index, eintrag] of eintraege.entries()) {
        const person = mitgliedVon(eintrag, 'person')
        if (typeof person !== 'string') continue
        const vorher = vergeben.get(person)
        if (vorher !== undefined) fehler.push({ stelle: `${zeiger}/${index}/person`, meldung: `Zur Person „${genannt(person)}“ gibt es hier schon den Eintrag ${zeiger}/${vorher}.` })
        else vergeben.set(person, index)
      }
    }
  }

  const anlagen: unknown[] = Array.isArray(daten.anlagen) ? daten.anlagen : []
  const dateinamen = new Map<string, number>()
  for (const [index, anlage] of anlagen.entries()) {
    const name = mitgliedVon(anlage, 'dateiname')
    if (typeof name === 'string') {
      const vorher = dateinamen.get(name)
      if (vorher !== undefined) fehler.push({ stelle: `/anlagen/${index}/dateiname`, meldung: `Den Dateinamen „${genannt(name)}“ hat schon die Anlage /anlagen/${vorher}.` })
      else dateinamen.set(name, index)
    }
    const roheBezuege = mitgliedVon(anlage, 'bezuege')
    const bezuege: unknown[] = Array.isArray(roheBezuege) ? roheBezuege : []
    for (const [nummer, bezug] of bezuege.entries()) {
      const stelle = `/anlagen/${index}/bezuege/${nummer}/stelle`
      const ziel = mitgliedVon(bezug, 'stelle')
      const teile = zerlege(ziel)
      if (!teile || wertBei(daten, teile) === undefined) {
        fehler.push({ stelle, meldung: `Die Stelle „${genannt(ziel)}“ gibt es in dieser Datei nicht.` })
        continue
      }
      const person = personDerStelle(daten, teile)
      const anlagenPerson = mitgliedVon(anlage, 'person')
      if (typeof anlagenPerson === 'string' && person !== null && person !== anlagenPerson) {
        fehler.push({ stelle, meldung: `Die Anlage gehört zur Person „${genannt(anlagenPerson)}“, die Stelle „${genannt(ziel)}“ zur Person „${genannt(person)}“.` })
      }
    }
  }

  return fehler
}

/**
 * @param daten      the application, parsed
 * @param schemata   the JSON Schemas of its benefit and version
 * @param kompakt    their compact form (`schema.ts`)
 * @returns at most {@link HOECHSTENS_FEHLER}, empty if valid
 */
export function pruefeAntrag(daten: unknown, schemata: JsonSchemata, kompakt: OneProofSchema): AntragFehler[] {
  // What the schema would find out slowly or not at all comes first, and alone: a file that is too
  // deep or has a list that is too long is not checked any further.
  const grenzen = [...formFehler(daten), ...listenFehler(daten, kompakt)]
  if (grenzen.length > 0) return grenzen.slice(0, HOECHSTENS_FEHLER)

  const ausSchema = schemaFehler(prueferFuer(schemata), daten)
  // The rules build on a file the schema accepts: a reference to a person needs persons with ids.
  const fehler = ausSchema.length > 0 ? ausSchema : regelFehler(daten, kompakt)
  return fehler.slice(0, HOECHSTENS_FEHLER)
}

/** The errors in one message: the first few with their place, the rest counted. */
export function fehlerText(fehler: readonly AntragFehler[]): string {
  const genannt = fehler.slice(0, IN_DER_MELDUNG).map(({ stelle, meldung }) => `${stelle || 'Datei'}: ${meldung}`)
  const rest = fehler.length - genannt.length
  const mehr = fehler.length >= HOECHSTENS_FEHLER ? `mindestens ${rest}` : String(rest)
  return `${genannt.join(' ')}${rest > 0 ? ` Dazu ${mehr} ${rest === 1 ? 'weiterer Fehler' : 'weitere Fehler'}.` : ''}`
}
