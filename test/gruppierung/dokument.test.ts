import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  documentIdentity,
  hasParts,
  isNumeric,
  numberedPages,
  pageKey,
  pageText,
  partsOf,
  toInt,
} from '../../src/engine/gruppierung/dokument.ts'
import type { Document, PageRef } from '../../src/engine/gruppierung/dokument.ts'

/** Freezes deeply: a function that mutates its input then fails with a TypeError. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    Object.values(value).forEach(deepFreeze)
  }
  return value
}

const page = (number: number, part?: PageRef['part'], fileId = '395'): PageRef =>
  part === undefined ? { fileId, page: number } : { fileId, page: number, part }

const document = (pages: PageRef[], extra: Partial<Document> = {}): Document => ({
  type: 'payslip',
  label: 'Lohn-/Gehaltsabrechnung',
  person: 'Anna Muster',
  pages,
  ...extra,
})

describe('pageKey und pageText', () => {
  it('schreibt die Seite als Datei:Seite', () => {
    assert.equal(pageKey({ fileId: '395', page: 3 }), '395:3')
    // The part is no part of the key: the same page stays the same page in any cut.
    assert.equal(pageKey({ fileId: '395', page: 3, part: 2 }), '395:3')
  })

  it('liefert den Seitentext oder einen leeren Text', () => {
    const texts = { 395: { 1: 'Seite eins', 2: 'Seite zwei' } }

    assert.equal(pageText(texts, page(2)), 'Seite zwei')
    assert.equal(pageText(texts, page(3)), '')
    assert.equal(pageText(texts, page(1, undefined, '999')), '')
    assert.equal(pageText({}, page(1)), '')
    assert.equal(pageText(undefined, page(1)), '')
  })

  it('greift nicht in Object.prototype', () => {
    assert.equal(pageText({}, { fileId: 'constructor', page: 1 }), '')
    assert.equal(pageText({}, { fileId: '__proto__', page: 1 }), '')
  })

  it('liest keinen Buchstaben aus einem Text, der kein Seitenverzeichnis ist', () => {
    // A malformed entry (a string where the pages of a file belong) must not yield its first
    // character as "page text".
    // invalid on purpose
    assert.equal(pageText({ 395: 'Seite eins' } as never, page(1)), '')
    assert.equal(pageText({ 395: null } as never, page(1)), '')
    assert.equal(pageText({ 395: 7 } as never, page(1)), '')
  })

  it('macht aus Nicht-Text einen Text', () => {
    // invalid on purpose
    assert.equal(pageText({ 395: { 1: 42 } } as never, page(1)), '42')
    assert.equal(pageText({ 395: { 1: null } } as never, page(1)), '')
  })
})

describe('isNumeric und toInt (PHP is_numeric und (int))', () => {
  it('erkennt Zahlen und Zahlenstrings, sonst nichts', () => {
    for (const value of [0, 1, -2, 2.5, '3', ' 3', '3 ', '-3', '+3', '1.5', '.5', '1e3', '2.']) {
      assert.equal(isNumeric(value), true, JSON.stringify(value))
    }
    for (const value of [null, undefined, true, false, '', ' ', 'abc', '3a', '0x1A', '.', NaN, Infinity, [], {}]) {
      assert.equal(isNumeric(value), false, String(value))
    }
  })

  it('schneidet ab und liest bei Strings das Zahlenpräfix', () => {
    assert.equal(toInt(3), 3)
    assert.equal(toInt(3.9), 3)
    assert.equal(toInt(-3.9), -3)
    assert.equal(toInt('7'), 7)
    assert.equal(toInt('12abc'), 12)
    assert.equal(toInt('1e2'), 100)
    assert.equal(toInt('abc'), 0)
    assert.equal(toInt(null), 0)
    assert.equal(toInt(undefined), 0)
    assert.equal(toInt(true), 1)
    assert.equal(toInt(NaN), 0)
    assert.equal(toInt(Infinity), 0)
    // PHP integers have no negative zero.
    assert.ok(Object.is(toInt(-0.5), 0))
  })
})

describe('numberedPages', () => {
  it('lässt eine Seite ohne eigene Nummer beim vorangehenden Teil', () => {
    const result = numberedPages([page(1, 1), page(2), page(3, 2), page(4)])

    assert.deepEqual(
      result.map((entry) => entry.part),
      [1, 1, 2, 2],
    )
  })

  it('lässt eine Seite VOR dem ersten Teil ohne Nummer, statt sie zu verlieren', () => {
    const result = numberedPages([page(1), page(2), page(3, 1)])

    assert.deepEqual(
      result.map((entry) => entry.part),
      [null, null, 1],
    )
    assert.equal(result.length, 3)
  })

  it('zählt die Teilnummer 0 als Nummer und null als fehlend', () => {
    const result = numberedPages([page(1, 0), page(2, null), page(3, 1)])

    assert.deepEqual(
      result.map((entry) => entry.part),
      [0, 0, 1],
    )
  })

  it('nimmt Zahlenstrings als Nummer und ignoriert alles andere', () => {
    // invalid on purpose: a part number that is a string or a boolean
    const result = numberedPages([page(1, '2' as never), page(2, 'abc' as never), page(3, 3.7), page(4, true as never)])

    assert.deepEqual(
      result.map((entry) => entry.part),
      [2, 2, 3, 3],
    )
  })

  it('überspringt Einträge ohne Datei und Nicht-Objekte', () => {
    // invalid on purpose: entries that are no pages
    const result = numberedPages([null, 'x', 7, { page: 1 }, { fileId: null, page: 2 }, page(3, 1)] as never)

    assert.deepEqual(result, [{ fileId: '395', page: 3, part: 1 }])
  })

  it('setzt Seite 1, wenn die Seitenzahl fehlt, und macht die Datei zum String', () => {
    // invalid on purpose: a file id that is a number, a page number that is a string
    const result = numberedPages([{ fileId: 7 }, { fileId: '8', page: '4' }] as never)

    assert.deepEqual(result, [
      { fileId: '7', page: 1, part: null },
      { fileId: '8', page: 4, part: null },
    ])
  })

  it('verträgt fehlende Seitenlisten', () => {
    assert.deepEqual(numberedPages(undefined), [])
    assert.deepEqual(numberedPages(null), [])
    // invalid on purpose
    assert.deepEqual(numberedPages('keine Liste' as never), [])
  })

  it('verändert die Eingabe nicht und gibt neue Objekte zurück', () => {
    const input = deepFreeze([page(1, 1), page(2)])
    const result = numberedPages(input)

    assert.notEqual(result[0], input[0])
    assert.deepEqual(input, [page(1, 1), page(2)])
  })
})

describe('partsOf und hasParts', () => {
  it('liefert für ein Dokument ohne Teile genau einen Teil, der das Dokument ist', () => {
    const parts = partsOf(document([page(1), page(2), page(3)]))

    assert.deepEqual(parts, [{ part: null, pages: [page(1), page(2), page(3)] }])
    assert.equal(hasParts(document([page(1), page(2), page(3)])), false)
  })

  it('liefert für zwölf Abrechnungen zwölf Teile in Lesereihenfolge', () => {
    const pages = Array.from({ length: 12 }, (_, index) => page(index + 1, index + 1))
    const parts = partsOf(document(pages))

    assert.equal(parts.length, 12)
    assert.equal(hasParts(document(pages)), true)

    parts.forEach((part, index) => {
      assert.equal(part.part, index + 1)
      // Per part exactly the page of its payslip, without a part number of its own.
      assert.deepEqual(part.pages, [{ fileId: '395', page: index + 1 }])
    })
  })

  it('führt Folgeseiten ohne Nummer beim vorangehenden Teil', () => {
    const parts = partsOf(document([page(1, 1), page(2), page(3, 2), page(4), page(5)]))

    assert.deepEqual(parts, [
      { part: 1, pages: [page(1), page(2)] },
      { part: 2, pages: [page(3), page(4), page(5)] },
    ])
  })

  it('eröffnet für Seiten vor dem ersten nummerierten Teil einen eigenen Teil ohne Nummer', () => {
    const parts = partsOf(document([page(1), page(2, 1), page(3, 2)]))

    assert.deepEqual(parts, [
      { part: null, pages: [page(1)] },
      { part: 1, pages: [page(2)] },
      { part: 2, pages: [page(3)] },
    ])
  })

  it('hält GENAU EINE Gruppe für keine Reihe, auch wenn ihre Seiten eine Nummer tragen', () => {
    // A series that shrinks to one part through a correction keeps the old number in its pages.
    const shrunken = document([page(5, 4), page(6, 4)])

    assert.deepEqual(partsOf(shrunken), [{ part: null, pages: [page(5), page(6)] }])
    assert.equal(hasParts(shrunken), false)
  })

  it('liefert für ein Dokument ohne brauchbare Seiten trotzdem einen Teil', () => {
    // invalid on purpose: missing or unusable page lists
    for (const pages of [[], undefined, null, [{ page: 1 }]]) {
      assert.deepEqual(partsOf(document(pages as never)), [{ part: null, pages: [] }])
      assert.equal(hasParts(document(pages as never)), false)
    }
  })

  it('ordnet die Teile nach dem ersten Auftreten in der Seitenliste, wie PHP', () => {
    // Not sorted by number: PHP groups by first appearance. The numbers the segmenter and the
    // merger write ascend along the pages, so there it is ascending part order.
    const parts = partsOf(document([page(1, 2), page(2, 1)]))

    assert.deepEqual(
      parts.map((entry) => entry.part),
      [2, 1],
    )
  })

  it('sammelt die Seiten einer Teilnummer, auch wenn sie nicht zusammenhängen', () => {
    const parts = partsOf(document([page(1, 1), page(2, 2), page(3, 1)]))

    assert.deepEqual(parts, [
      { part: 1, pages: [page(1), page(3)] },
      { part: 2, pages: [page(2)] },
    ])
  })

  it('kennt Seiten verschiedener Dateien', () => {
    const parts = partsOf(document([page(1, 1, 'a'), page(1, 2, 'b')]))

    assert.deepEqual(parts, [
      { part: 1, pages: [{ fileId: 'a', page: 1 }] },
      { part: 2, pages: [{ fileId: 'b', page: 1 }] },
    ])
  })

  it('verliert keine Seite: die Vereinigung der Teile sind die Seiten des Dokuments', () => {
    const pages = [page(3), page(7, 1), page(8), page(11, 2), page(12, 3), page(13)]
    const flat = partsOf(document(pages)).flatMap((part) => part.pages.map(pageKey))

    assert.deepEqual(flat.sort(), pages.map(pageKey).sort())
  })

  it('verändert das Dokument nicht', () => {
    const input = deepFreeze(document([page(1, 1), page(2, 2)]))

    partsOf(input)
    hasParts(input)
    documentIdentity(input)
  })
})

describe('documentIdentity', () => {
  it('besteht aus Typ, Person und den sortierten Seiten', () => {
    const identity = documentIdentity(document([page(2), page(1)]))

    assert.equal(identity, 'payslip|Anna Muster|395:1,395:2')
  })

  it('führt die Teilnummer als #Teil mit', () => {
    const identity = documentIdentity(document([page(1, 1), page(2, 2)]))

    assert.equal(identity, 'payslip|Anna Muster|395:1#1,395:2#2')
  })

  it('nimmt die wirksame Teilnummer, auch bei geerbter', () => {
    const identity = documentIdentity(document([page(1, 1), page(2)]))

    assert.equal(identity, 'payslip|Anna Muster|395:1#1,395:2#1')
  })

  it('hängt nicht an der Lesereihenfolge, wohl an der Seitenmenge', () => {
    const forward = document([page(1), page(2), page(3)])
    const backward = document([page(3), page(2), page(1)])
    const fewer = document([page(1), page(2)])

    assert.equal(documentIdentity(forward), documentIdentity(backward))
    assert.notEqual(documentIdentity(forward), documentIdentity(fewer))
  })

  it('macht dieselben Seiten in anderem Zuschnitt zu einem anderen Dokument', () => {
    const a = document([page(1, 1), page(2, 1), page(3, 2)])
    const b = document([page(1, 1), page(2, 2), page(3, 2)])
    const uncut = document([page(1), page(2), page(3)])

    assert.notEqual(documentIdentity(a), documentIdentity(b))
    assert.notEqual(documentIdentity(a), documentIdentity(uncut))
  })

  it('unterscheidet Typ und Person', () => {
    const base = document([page(1)])

    assert.notEqual(documentIdentity(base), documentIdentity({ ...base, type: 'income_certificate' }))
    assert.notEqual(documentIdentity(base), documentIdentity({ ...base, person: 'Bernd Muster' }))
    assert.equal(documentIdentity({ ...base, label: 'anderer Anzeigename' }), documentIdentity(base))
  })

  it('sortiert als Text wie PHP sort(): 395:10 steht vor 395:2', () => {
    const identity = documentIdentity(document([page(2), page(10), page(1)]))

    assert.equal(identity, 'payslip|Anna Muster|395:1,395:10,395:2')
  })

  it('verträgt ein Dokument ohne Person und ohne Seiten', () => {
    // invalid on purpose: no person, no pages
    assert.equal(documentIdentity({ type: 'rent_contract' } as never), 'rent_contract||')
  })
})
