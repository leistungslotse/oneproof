import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { istObjekt } from '../../src/engine/json.ts'
import { documentIdentity, hasParts, pageKey, partsOf } from '../../src/engine/gruppierung/dokument.ts'
import type { Document, PageRef } from '../../src/engine/gruppierung/dokument.ts'
import { schneideAbrechnungsmonate } from '../../src/engine/gruppierung/monate.ts'
import { fuehreReihenZusammen } from '../../src/engine/gruppierung/reihen.ts'
import { AUFFANGTYP } from '../../src/engine/gruppierung/typ-bezeichnung.ts'
import type { Katalog } from '../../src/engine/gruppierung/typ-bezeichnung.ts'

/*
 * Twelve payslips of one person are ONE piece of evidence for filing (one card, one PDF, one
 * reference) and twelve for checking. The merge moves the separation into parts, it does not
 * remove it. Only what is the same series professionally is merged: same type AND same person.
 */

/** Freezes deeply: a function that mutates its input then fails with a TypeError. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    Object.values(value).forEach(deepFreeze)
  }
  return value
}

// Trusted test data: the catalog as the profile ships it.
const katalog: Katalog = deepFreeze(
  JSON.parse(
    readFileSync(new URL('../../public/profile/wohngeld/2026-11-15/dokumenttypen.json', import.meta.url), 'utf8'),
  ),
)

const NBSP = String.fromCharCode(0xa0)

/** What a test adds to a document; some tests add fields the type does not know. */
type Extra = Partial<Document> & Record<string, unknown>

/** A one-page document of the model, not yet merged. */
const document = (type: string, person: string, pages: PageRef[], extra: Extra = {}): Document => ({
  type,
  label: katalog[type]?.label ?? type,
  person,
  pages,
  ...extra,
})
const page = (number: number, part?: PageRef['part'], fileId = '395'): PageRef =>
  part === undefined ? { fileId, page: number } : { fileId, page: number, part }
const payslip = (person: string, pageNumber: number, extra: Extra = {}): Document => document('payslip', person, [page(pageNumber)], extra)

const pageKeys = (documents: Document[]): string[] => documents.flatMap((entry) => entry.pages.map(pageKey)).sort()

/** The document at `index`: the tests only ask for places that are filled. */
function an(documents: Document[], index: number): Document {
  const dokument = documents[index]
  assert.ok(dokument)
  return dokument
}

/** A field of a document by name, also one the type does not know. */
function feld(dokument: Document | undefined, name: string): unknown {
  assert.ok(istObjekt(dokument))
  return dokument[name]
}

describe('fuehreReihenZusammen', () => {
  it('führt zwölf einzeln erkannte Abrechnungen zu EINEM Nachweis mit zwölf Teilbelegen zusammen', () => {
    // The common case from the other side: the model reports twelve payslips as twelve documents.
    const documents = Array.from({ length: 12 }, (_, index) => payslip('Anna Muster', index + 1))

    const result = fuehreReihenZusammen(documents, katalog)

    assert.equal(result.length, 1)
    assert.equal(result[0]?.type, 'payslip')
    assert.equal(result[0]?.person, 'Anna Muster')
    assert.equal(result[0]?.pages.length, 12)
    assert.equal(partsOf(an(result, 0)).length, 12)
    assert.equal(hasParts(an(result, 0)), true)

    partsOf(an(result, 0)).forEach((part, index) => {
      // Per part exactly the page of its payslip, in reading order.
      assert.equal(part.part, index + 1)
      assert.deepEqual(part.pages, [{ fileId: '395', page: index + 1 }])
    })
  })

  it('lässt einen Nachweis ohne Personenbezug für sich stehen', () => {
    // Two rent contracts without a person can be one flat in two versions or two flats. A series
    // would claim a link nobody checked.
    const documents = [document('rent_contract', '', [page(1)]), document('rent_contract', '', [page(2)])]

    const result = fuehreReihenZusammen(documents, katalog)

    assert.equal(result.length, 2)
    assert.equal(result[0], documents[0])
    assert.equal(result[1], documents[1])
  })

  it('hält einen Namen aus Leerraum für keine Person', () => {
    // invalid on purpose: no person at all
    const documents = [payslip('   ', 1), payslip('\t\n', 2), payslip(undefined as never, 3)]

    assert.equal(fuehreReihenZusammen(documents, katalog).length, 3)
  })

  it('führt Nachweise verschiedener Personen NICHT zusammen', () => {
    const documents = [payslip('Anna Muster', 1), payslip('Bernd Muster', 2)]

    const result = fuehreReihenZusammen(documents, katalog)

    assert.equal(result.length, 2)
    assert.deepEqual(
      result.map((entry) => entry.person),
      ['Anna Muster', 'Bernd Muster'],
    )
    assert.equal(hasParts(an(result, 0)), false)
  })

  it('führt Kontoauszüge derselben Person NICHT zu einer Reihe zusammen', () => {
    // The bank statement is read PAGE BY PAGE and would never write a part value set: a series
    // would carry parts that stand there for ever as "values not read".
    const documents = [
      document('bank_statement', 'Anna Muster', [page(1)]),
      document('bank_statement', 'Anna Muster', [page(2)]),
    ]

    const result = fuehreReihenZusammen(documents, katalog)

    assert.equal(result.length, 2)
    assert.equal(hasParts(an(result, 0)), false)
    assert.equal(hasParts(an(result, 1)), false)
  })

  it('führt Auffang-Dokumente (Sonstiges) derselben Person NICHT zusammen', () => {
    // "Sonstiges Dokument" is the remainder class, not a genus: a company contract and a trade
    // registration of one person would be ONE card of "2 parts".
    const documents = [
      document(AUFFANGTYP, 'Anna Muster', [page(1)]),
      document(AUFFANGTYP, 'Anna Muster', [page(2)]),
    ]

    const result = fuehreReihenZusammen(documents, katalog)

    assert.equal(result.length, 2)
    assert.equal(hasParts(an(result, 0)), false)
    assert.equal(hasParts(an(result, 1)), false)
  })

  it('lässt manuelle Korrekturen und "Nicht zugeordnet" unberührt', () => {
    // A correction is a human decision, "Nicht zugeordnet" a non-answer of the model. Both must
    // stay addressable, and neither joins a series of the same type and person.
    const first = payslip('Anna Muster', 1)
    const manual = payslip('Anna Muster', 2, { source: 'manual' })
    const second = payslip('Anna Muster', 3)
    const unassigned = payslip('Anna Muster', 4, { unassigned: true, source: 'fallback' })
    const secondManual = payslip('Anna Muster', 5, { source: 'manual' })

    const result = fuehreReihenZusammen([first, manual, second, unassigned, secondManual], katalog)

    assert.equal(result.length, 4)
    assert.equal(partsOf(an(result, 0)).length, 2)
    assert.deepEqual(
      result[0]?.pages.map((entry) => entry.page),
      [1, 3],
    )
    assert.equal(result[1], manual)
    assert.equal(result[2], unassigned)
    assert.equal(result[3], secondManual)
  })

  it('nimmt nur ein echtes unassigned === true und source === "manual" aus', () => {
    // As in PHP the checks are strict: another value does not exclude a document.
    const documents = [payslip('Anna', 1, { unassigned: false }), payslip('Anna', 2, { source: 'ai' }), payslip('Anna', 3, { source: 'fallback' })]

    assert.equal(fuehreReihenZusammen(documents, katalog).length, 1)
  })

  it('führt nur Typen zusammen, die der Katalog mit Feldern führt', () => {
    // invalid on purpose: fields that are no object or list
    const eigener = {
      mitFeldern: { label: 'Mit Feldern', fields: { a: 'Feld A' } },
      mitFeldliste: { label: 'Mit Liste', fields: ['a'] },
      leereFelder: { label: 'Leer', fields: {} },
      leereListe: { label: 'Leere Liste', fields: [] },
      ohneFelder: { label: 'Ohne' },
      keineFelder: { label: 'Kein Objekt', fields: 'a' },
    } as never
    const pair = (type: string): Document[] => [document(type, 'Anna', [page(1)]), document(type, 'Anna', [page(2)])]

    assert.equal(fuehreReihenZusammen(pair('mitFeldern'), eigener).length, 1)
    assert.equal(fuehreReihenZusammen(pair('mitFeldliste'), eigener).length, 1)
    for (const type of ['leereFelder', 'leereListe', 'ohneFelder', 'keineFelder', 'unbekannt', '', 'constructor']) {
      assert.equal(fuehreReihenZusammen(pair(type), eigener).length, 2, type)
    }
  })

  it('führt ohne Katalog nichts zusammen', () => {
    const documents = [payslip('Anna', 1), payslip('Anna', 2)]

    for (const missing of [undefined, null, {}]) {
      assert.equal(fuehreReihenZusammen(documents, missing).length, 2)
    }
  })

  it('bildet im echten Katalog für jeden Typ mit Feldern eine Reihe, außer für den Auffangtyp', () => {
    const merged: string[] = []
    const alone: string[] = []

    for (const type of Object.keys(katalog)) {
      const pair = [document(type, 'Anna', [page(1)]), document(type, 'Anna', [page(2)])]

      ;(fuehreReihenZusammen(pair, katalog).length === 1 ? merged : alone).push(type)
    }

    // The bank statement has no fields (it is read page by page), the catch-all is no genus.
    assert.deepEqual(alone.sort(), ['bank_statement', 'other_document'])
    assert.equal(merged.length, Object.keys(katalog).length - 2)
  })

  it('stellt die Reihe dorthin, wo ihr erstes Dokument stand', () => {
    const contract = document('rent_contract', 'Anna Muster', [page(1, undefined, '12')])
    const bernd = payslip('Bernd Muster', 3)
    const documents = [contract, payslip('Anna Muster', 1), bernd, payslip('Anna Muster', 2), payslip('Anna Muster', 4)]

    const result = fuehreReihenZusammen(documents, katalog)

    assert.equal(result.length, 3)
    // The contract stays first. The series of Anna stands second, where her first payslip stood.
    assert.equal(result[0], contract)
    assert.equal(result[1]?.person, 'Anna Muster')
    assert.deepEqual(
      result[1]?.pages.map((entry) => entry.page),
      [1, 2, 4],
    )
    assert.equal(result[2], bernd)
  })

  it('lässt eine Reihe aus einem Dokument dasselbe Objekt', () => {
    // Rebuilt, the document would lose its identity and with it PDF and values read earlier.
    const single = payslip('Anna Muster', 1, { confidence: 70 })
    const other = document('rent_contract', 'Anna Muster', [page(1, undefined, '12')])
    // invalid on purpose: a document without a page list
    const withoutPages = { type: 'payslip', person: 'Bernd', label: 'Lohn' } as never

    const result = fuehreReihenZusammen([single, other, withoutPages], katalog)

    assert.equal(result[0], single)
    assert.equal(result[1], other)
    assert.equal(result[2], withoutPages)
  })

  it('schneidet beim Schlüssel nur den Leerraum ab, die Person bleibt wie sie war', () => {
    const documents = [payslip(' Anna Muster ', 1), payslip('Anna Muster', 2), payslip('Anna Muster\n', 3)]

    const result = fuehreReihenZusammen(documents, katalog)

    assert.equal(result.length, 1)
    // The merged document is the first one with its person as it stood.
    assert.equal(result[0]?.person, ' Anna Muster ')
    assert.equal(partsOf(an(result, 0)).length, 3)
  })

  it('trimmt wie PHP: ein geschütztes Leerzeichen macht keine andere Person gleich', () => {
    // PHP trim() strips ASCII whitespace and NUL, not U+00A0.
    const documents = [payslip('Anna Muster', 1), payslip(`Anna Muster${NBSP}`, 2)]

    assert.equal(fuehreReihenZusammen(documents, katalog).length, 2)
  })

  it('lässt Teile bestehen, die ein Ausgangsdokument schon trägt', () => {
    // A file cut by the month segmenter keeps its parts as parts of the series. They do not
    // collapse into one lump part.
    const cut = document('payslip', 'Anna Muster', [page(1, 1), page(2, 1), page(3, 2), page(4, 3)])
    const next = payslip('Anna Muster', 5)
    const twoPages = document('payslip', 'Anna Muster', [page(6, undefined, '77'), page(7, undefined, '77')])

    const result = fuehreReihenZusammen([cut, next, twoPages], katalog)

    assert.equal(result.length, 1)
    assert.deepEqual(result[0]?.pages, [
      { fileId: '395', page: 1, part: 1 },
      { fileId: '395', page: 2, part: 1 },
      { fileId: '395', page: 3, part: 2 },
      { fileId: '395', page: 4, part: 3 },
      { fileId: '395', page: 5, part: 4 },
      { fileId: '77', page: 6, part: 5 },
      { fileId: '77', page: 7, part: 5 },
    ])
  })

  it('beginnt für jedes Ausgangsdokument einen neuen Teil, auch bei gleicher eigener Nummer', () => {
    const first = document('payslip', 'Anna', [page(1, 1), page(2, 2)])
    const second = document('payslip', 'Anna', [page(3, 2), page(4, 2)])

    const result = fuehreReihenZusammen([first, second], katalog)

    assert.deepEqual(
      result[0]?.pages.map((entry) => entry.part),
      [1, 2, 3, 3],
    )
  })

  it('macht aus Seiten vor dem ersten Teil eines Ausgangsdokuments einen Teil für sich', () => {
    const first = document('payslip', 'Anna', [page(1), page(2), page(3, 1)])
    const second = payslip('Anna', 4)

    const result = fuehreReihenZusammen([first, second], katalog)

    assert.deepEqual(
      result[0]?.pages.map((entry) => [entry.page, entry.part]),
      [
        [1, 1],
        [2, 1],
        [3, 2],
        [4, 3],
      ],
    )
  })

  it('überspringt Ausgangsdokumente ohne brauchbare Seiten', () => {
    const empty = document('payslip', 'Anna', [])
    // invalid on purpose: entries that are no pages
    const broken = document('payslip', 'Anna', [{ page: 1 }, null] as never)
    const real = payslip('Anna', 1)
    const another = payslip('Anna', 2)

    const result = fuehreReihenZusammen([empty, broken, real, another], katalog)

    assert.equal(result.length, 1)
    assert.deepEqual(
      result[0]?.pages.map((entry) => [entry.page, entry.part]),
      [
        [1, 1],
        [2, 2],
      ],
    )
    // Fields come from the first document of the series, empty or not.
    assert.equal(result[0]?.label, empty.label)
  })

  it('nimmt die vorsichtigste Zuordnungssicherheit für die Reihe', () => {
    // invalid on purpose: the certainty of the model may be text
    const confidences = (values: (number | string | null | undefined)[]): number | null | undefined =>
      fuehreReihenZusammen(
        values.map((value, index) => payslip('Anna', index + 1, value === undefined ? {} : { confidence: value as never })),
        katalog,
      )[0]?.confidence

    assert.equal(confidences([90, 75, 88]), 75)
    assert.equal(confidences([90, null, 88]), 88)
    assert.equal(confidences([undefined, 60]), 60)
    assert.equal(confidences([null, undefined]), null)
    assert.equal(confidences(['80', 'abc', 95]), 80)
    assert.equal(confidences([88.9, 90]), 88)
    assert.equal(confidences([0, 90]), 0)
  })

  it('zählt die Sicherheit eines Ausgangsdokuments ohne Seiten nicht mit', () => {
    // As in PHP: the confidence is read only for documents that contribute pages.
    const empty = document('payslip', 'Anna', [], { confidence: 10 })

    const result = fuehreReihenZusammen([empty, payslip('Anna', 1, { confidence: 90 }), payslip('Anna', 2, { confidence: 80 })], katalog)

    assert.equal(result[0]?.confidence, 80)
  })

  it('übernimmt alle übrigen Felder vom ersten Dokument', () => {
    const first = payslip('Anna Muster', 1, { id: 17, typeLabel: null, source: 'ai', note: 'bleibt' })
    const second = payslip('Anna Muster', 2, { id: 18, label: 'anderer Name', note: 'weg' })

    const result = fuehreReihenZusammen([first, second], katalog)[0]

    assert.equal(feld(result, 'id'), 17)
    assert.equal(feld(result, 'note'), 'bleibt')
    assert.equal(result?.label, first.label)
    assert.equal(result?.source, 'ai')
    assert.equal(result?.typeLabel, null)
  })

  it('verändert die Eingabe nicht', () => {
    const documents = deepFreeze([payslip('Anna', 1), payslip('Anna', 2), payslip('Bernd', 3)])

    const result = fuehreReihenZusammen(documents, katalog)

    assert.notEqual(result, documents)
    assert.equal(documents.length, 3)
    assert.equal(documents[0]?.pages[0]?.part, undefined)
    assert.equal(result.length, 2)
  })

  it('ändert nichts, wenn man es auf sein Ergebnis anwendet', () => {
    const documents = [payslip('Anna', 1), payslip('Bernd', 2), payslip('Anna', 3), document('rent_contract', 'Anna', [page(4)])]

    const once = fuehreReihenZusammen(documents, katalog)
    const twice = fuehreReihenZusammen(once, katalog)

    assert.deepEqual(twice, once)
    assert.equal(twice[0], once[0])
  })

  it('macht dieselben Seiten in einer Reihe zu einem anderen Dokument als einzeln (Identität)', () => {
    const documents = [payslip('Anna', 1), payslip('Anna', 2)]

    const [series] = fuehreReihenZusammen(documents, katalog)
    assert.ok(series)

    assert.equal(documentIdentity(series), 'payslip|Anna|395:1#1,395:2#2')
  })

  it('verliert keine Seite und erfindet keine (Invariante I1), auch bei beliebiger Mischung', () => {
    // Deterministic pseudo-random document lists (mulberry32), no external dependency.
    let state = 20260907
    const random = () => {
      state = (state + 0x6d2b79f5) | 0
      let t = Math.imul(state ^ (state >>> 15), 1 | state)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const pick = <T>(list: T[]): T => {
      const eintrag = list[Math.floor(random() * list.length)]
      if (eintrag === undefined) throw new Error('Die Liste ist leer.')
      return eintrag
    }

    for (let run = 0; run < 300; run++) {
      let next = 1
      const documents = Array.from({ length: 1 + Math.floor(random() * 10) }, () => {
        const pages = Array.from({ length: Math.floor(random() * 4) }, (): PageRef => {
          const entry = { fileId: pick(['395', '396', '77']), page: next++ }
          return random() < 0.4 ? { ...entry, part: pick([1, 2, 3]) } : entry
        })

        return document(pick(['payslip', 'payslip', 'rent_contract', 'bank_statement', AUFFANGTYP, 'income_certificate']), pick(['', 'Anna', 'Anna', 'Bernd']), pages, {
          ...(random() < 0.15 ? { source: 'manual' as const } : {}),
          ...(random() < 0.1 ? { unassigned: true } : {}),
          ...(random() < 0.7 ? { confidence: pick([null, 40, 80, 95]) } : {}),
        })
      })

      const result = fuehreReihenZusammen(documents, katalog)

      assert.deepEqual(pageKeys(result), pageKeys(documents), 'union of the pages stays the same')
      assert.ok(result.length <= documents.length)
      assert.deepEqual(fuehreReihenZusammen(result, katalog), result, 'a second pass changes nothing')
    }
  })
})

describe('Schnitt und Zusammenführung', () => {
  const MONTHS = [
    'Januar 2025',
    'Februar 2025',
    'März 2025',
    'April 2025',
    'Mai 2025',
    'Juni 2025',
    'Juli 2025',
    'August 2025',
    'September 2025',
    'Oktober 2025',
    'November 2025',
    'Dezember 2025',
  ] as const
  const text = (month: string): string => `Abrechnung der Brutto/Netto-Bezüge für ${month}\n\nGesamtbrutto 3.776,60`
  const person = 'Anna Muster'

  it('enden beim selben Ergebnis: eine Datei mit zwölf Monaten, zwölf Dateien mit einem Monat', () => {
    // One file, twelve pages: cut at the billing month.
    const file = document('payslip', person, MONTHS.map((_, index) => page(index + 1)))
    const fileTexts = { 395: Object.fromEntries(MONTHS.map((month, index) => [index + 1, text(month)])) }
    const fromFile = fuehreReihenZusammen(schneideAbrechnungsmonate([file], fileTexts), katalog)

    // Twelve files, one page each: merged.
    const files = MONTHS.map((_, index) => document('payslip', person, [page(1, undefined, `f${index}`)]))
    const filesTexts = Object.fromEntries(MONTHS.map((month, index) => [`f${index}`, { 1: text(month) }]))
    const fromFiles = fuehreReihenZusammen(schneideAbrechnungsmonate(files, filesTexts), katalog)

    for (const result of [fromFile, fromFiles]) {
      assert.equal(result.length, 1)
      assert.equal(partsOf(an(result, 0)).length, 12)
      assert.ok(partsOf(an(result, 0)).every((part) => part.pages.length === 1))
    }
  })

  it('behalten die Monate einer Datei als eigene Teile, wenn mehrere Dateien zusammenkommen', () => {
    const first = document('payslip', person, [1, 2, 3, 4, 5, 6].map((number) => page(number, undefined, 'a')), { confidence: 85 })
    const second = document('payslip', person, [1, 2, 3, 4, 5, 6].map((number) => page(number, undefined, 'b')), { confidence: 92 })
    const texts = {
      a: Object.fromEntries(MONTHS.slice(0, 6).map((month, index) => [index + 1, text(month)])),
      b: Object.fromEntries(MONTHS.slice(6).map((month, index) => [index + 1, text(month)])),
    }

    const result = fuehreReihenZusammen(schneideAbrechnungsmonate([first, second], texts), katalog)

    assert.equal(result.length, 1)
    // 6 + 6 parts, not two lump parts.
    assert.equal(partsOf(an(result, 0)).length, 12)
    assert.deepEqual(
      result[0]?.pages.map((entry) => entry.part),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    )
    assert.equal(result[0]?.confidence, 85)
    assert.deepEqual(pageKeys(result), pageKeys([first, second]))
  })

  it('schneidet eine Datei der Reihe nur, wenn sie wirklich mehrere Monate trägt', () => {
    // A two-page payslip of one month stays one part inside a series of three files.
    const single = document('payslip', person, [page(1, undefined, 'a'), page(2, undefined, 'a')])
    const others = [document('payslip', person, [page(1, undefined, 'b')]), document('payslip', person, [page(1, undefined, 'c')])]
    const texts = {
      a: { 1: text(MONTHS[0]), 2: `Seite 2\nAbrechnungsmonat ${MONTHS[0]}` },
      b: { 1: text(MONTHS[1]) },
      c: { 1: text(MONTHS[2]) },
    }

    const result = fuehreReihenZusammen(schneideAbrechnungsmonate([single, ...others], texts), katalog)

    assert.deepEqual(
      partsOf(an(result, 0)).map((part) => part.pages.length),
      [2, 1, 1],
    )
  })
})
