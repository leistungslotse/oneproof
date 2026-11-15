import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pageKey, partsOf } from '../../src/engine/gruppierung/dokument.ts'
import type { Document, PageTexts } from '../../src/engine/gruppierung/dokument.ts'
import { monatDerSeite, schneideAbrechnungsmonate } from '../../src/engine/gruppierung/monate.ts'

/*
 * The case the wage comparison ran past twice: ONE PDF with twelve monthly payslips. For the
 * grouping that was one document, so twelve payslips stood there as one row. The cut is made
 * deterministically at the billing month. The result is ONE document with twelve parts.
 */

/** Freezes deeply: a function that mutates its input then fails with a TypeError. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    Object.values(value).forEach(deepFreeze)
  }
  return value
}

/** The head of a payslip in the spelling found in real files. */
const payslipPage = (month: string): string =>
  `00K 30139/51925/06108\n03.02.2025 Blatt: 1\n\n# Abrechnung der Brutto/Netto-Bezüge für ${month}\n\nGesamtbrutto 3.776,60`

const payslipDocument = (pages: number[], type = 'payslip'): Document => ({
  type,
  label: 'Lohn-/Gehaltsabrechnung',
  person: 'Matthias Schmitt',
  confidence: 90,
  pages: pages.map((page) => ({ fileId: '395', page })),
})

/** The page numbers per part: the cut as the application reads it later. */
function payslipParts(document: Document | undefined): number[][] {
  assert.ok(document)
  const parts = new Map<number, number[]>()

  for (const page of document.pages) {
    const key = page.part ?? 0
    parts.set(key, [...(parts.get(key) ?? []), page.page])
  }

  return [...parts.values()]
}

const MONTHS_2025 = [
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
]

describe('schneideAbrechnungsmonate', () => {
  it('zerlegt zwölf Monatsabrechnungen einer Datei in zwölf Teilbelege EINES Nachweises', () => {
    const pageTexts: Record<number, string> = {}
    MONTHS_2025.forEach((month, index) => {
      pageTexts[index + 1] = payslipPage(month)
    })
    const texts: PageTexts = { 395: pageTexts }

    const documents = schneideAbrechnungsmonate([payslipDocument([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])], texts)

    assert.equal(documents.length, 1)
    // Type, person and confidence stay as they are: the page set is cut, not the assignment.
    assert.equal(documents[0]?.type, 'payslip')
    assert.equal(documents[0]?.person, 'Matthias Schmitt')
    assert.equal(documents[0]?.confidence, 90)
    assert.deepEqual(
      payslipParts(documents[0]),
      Array.from({ length: 12 }, (_, index) => [index + 1]),
    )
    assert.deepEqual(
      documents[0]?.pages.map((page) => page.part),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    )
  })

  it('lässt die zweite Seite bei ihrer Abrechnung', () => {
    // The back carries the same billing month. Were the month the only cut point, a two-page
    // payslip would become one part per sheet.
    const documents = schneideAbrechnungsmonate([payslipDocument([1, 2, 3, 4])], {
      395: {
        1: 'Abrechnungsmonat Januar 2026',
        2: 'Seite 2 zur Abrechnung — Abrechnungsmonat Januar 2026',
        3: 'Abrechnungsmonat Februar 2026',
        4: 'Seite 2 zur Abrechnung — Abrechnungsmonat Februar 2026',
      },
    })

    assert.deepEqual(payslipParts(documents[0]), [
      [1, 2],
      [3, 4],
    ])
  })

  it('hängt eine Seite ohne erkennbaren Monat an die vorangehende Abrechnung', () => {
    // More common than the repeated month: the back carries only the social insurance overview.
    // A part of its own would be a piece of evidence without month and amount.
    const documents = schneideAbrechnungsmonate([payslipDocument([1, 2, 3])], {
      395: {
        1: payslipPage('Januar 2025'),
        2: 'Sozialversicherung: AOK Baden-Württemberg, Beitragsgruppenschlüssel 1111',
        3: payslipPage('Februar 2025'),
      },
    })

    assert.deepEqual(payslipParts(documents[0]), [[1, 2], [3]])
  })

  it('lässt ein Deckblatt ohne Monat bei der ersten Abrechnung', () => {
    // The first month found never cuts, or the cover sheet would be a monthless part of its own.
    const documents = schneideAbrechnungsmonate([payslipDocument([1, 2, 3])], {
      395: {
        1: 'Anlage zum Wohngeldantrag — Lohnunterlagen',
        2: payslipPage('Januar 2025'),
        3: payslipPage('Februar 2025'),
      },
    })

    assert.deepEqual(payslipParts(documents[0]), [[1, 2], [3]])
  })

  it('lässt ein Dokument unverändert, wenn nur ein Monat vorkommt', () => {
    // The very same object: an unchanged document keeps its identity and with it its assembled
    // PDF and the values read in an earlier run.
    const document = payslipDocument([1, 2])

    const documents = schneideAbrechnungsmonate([document], {
      395: { 1: payslipPage('Januar 2025'), 2: 'Fortsetzung der Abrechnung für Januar 2025' },
    })

    assert.equal(documents.length, 1)
    assert.equal(documents[0], document)
    assert.equal(
      documents[0]?.pages.some((page) => 'part' in page),
      false,
    )
  })

  it('lässt ein Dokument unverändert, wenn kein Monat zu lesen ist', () => {
    // Fail-safe: a wrong cut costs more than a missed one.
    const document = payslipDocument([1, 2, 3])

    const documents = schneideAbrechnungsmonate([document], {
      395: { 1: 'Gesamtbrutto 3.776,60', 2: 'Nettoverdienst 2.410,55', 3: 'Auszahlungsbetrag 2.410,55' },
    })

    assert.equal(documents[0], document)
  })

  it('rührt andere Nachweisarten nicht an', () => {
    // The income certificate shows twelve months in ONE document. Cutting it would invent
    // eleven certificates nobody issued.
    const document = payslipDocument([1, 2], 'income_certificate')

    const documents = schneideAbrechnungsmonate([document], {
      395: { 1: 'Verdienstbescheinigung für Januar 2025', 2: 'Verdienstbescheinigung für Februar 2025' },
    })

    assert.equal(documents[0], document)
  })

  it('schneidet eine Verdienstbescheinigung auch dann nicht, wenn der Text wie eine Abrechnung aussieht', () => {
    const document = payslipDocument([1, 2], 'income_certificate')

    const documents = schneideAbrechnungsmonate([document], {
      395: { 1: payslipPage('Januar 2025'), 2: payslipPage('Februar 2025') },
    })

    assert.equal(documents[0], document)
  })

  it('verliert keine Seite und erfindet keine', () => {
    const document = payslipDocument([3, 7, 11])

    const documents = schneideAbrechnungsmonate([document], {
      395: { 3: payslipPage('März 2025'), 7: payslipPage('Juli 2025'), 11: payslipPage('November 2025') },
    })

    assert.deepEqual(
      documents[0]?.pages.map((page) => page.page),
      [3, 7, 11],
    )
    assert.deepEqual(payslipParts(documents[0]), [[3], [7], [11]])
  })

  it('trennt eine Datei mit zwölf Monatsabrechnungen auch im Schreibbild des Bestands (01.2025)', () => {
    // From the feature test: the head carries the print date of the page ("03.MM.2025") BEFORE
    // the heading, the billing month as "MM.2025" behind it. The print date does not count.
    const pageTexts: Record<number, string> = {}
    for (let month = 1; month <= 12; month++) {
      const mm = String(month).padStart(2, '0')
      pageTexts[month] =
        `03.${mm}.2025 Blatt: 1\n\n# Abrechnung der Brutto/Netto-Bezüge für ${mm}.2025\n\nGesamtbrutto 3.776,60`
    }
    const texts: PageTexts = { 395: pageTexts }

    const documents = schneideAbrechnungsmonate(
      [{ type: 'payslip', label: 'Egal', person: 'Anna Muster', pages: payslipDocument(Array.from({ length: 12 }, (_, i) => i + 1)).pages }],
      texts,
    )

    const [first] = documents
    assert.ok(first)
    assert.equal(documents.length, 1)
    assert.equal(partsOf(first).length, 12)
    partsOf(first).forEach((part, index) => {
      assert.deepEqual(part.pages, [{ fileId: '395', page: index + 1 }])
    })
  })

  it('lässt eine zweiseitige Abrechnung als EIN Dokument stehen', () => {
    const document: Document = {
      type: 'payslip',
      label: 'Egal',
      person: 'Anna Muster',
      pages: [
        { fileId: '77', page: 1 },
        { fileId: '77', page: 2 },
      ],
    }

    const documents = schneideAbrechnungsmonate([document], {
      77: {
        1: 'Abrechnungsmonat Januar 2026\nGesamtbrutto 2.813,77',
        2: 'Abrechnungsmonat Januar 2026\nSozialversicherung',
      },
    })

    assert.equal(documents[0], document)
    assert.equal(documents[0]?.pages.length, 2)
  })

  it('trennt bei jedem Wechsel des Monats, auch beim Rücksprung', () => {
    // Cut only at a month that REPLACES another: January, February, January are three parts.
    const documents = schneideAbrechnungsmonate([payslipDocument([1, 2, 3])], {
      395: { 1: payslipPage('Januar 2025'), 2: payslipPage('Februar 2025'), 3: payslipPage('Januar 2025') },
    })

    assert.deepEqual(payslipParts(documents[0]), [[1], [2], [3]])
  })

  it('lässt ein Dokument mit einer Seite oder ohne Seiten unverändert', () => {
    const single = payslipDocument([1])
    const empty = payslipDocument([])
    // invalid on purpose: a document without a page list
    const withoutPages = { type: 'payslip', person: 'Anna Muster' } as never
    const texts = { 395: { 1: payslipPage('Januar 2025') } }

    const documents = schneideAbrechnungsmonate([single, empty, withoutPages], texts)

    assert.equal(documents[0], single)
    assert.equal(documents[1], empty)
    assert.equal(documents[2], withoutPages)
  })

  it('lässt ein Dokument unverändert, wenn die Seitentexte fehlen', () => {
    const document = payslipDocument([1, 2])

    assert.equal(schneideAbrechnungsmonate([document], {})[0], document)
    assert.equal(schneideAbrechnungsmonate([document], { 395: {} })[0], document)
  })

  it('liest die Texte je Datei: dieselbe Seitenzahl in zwei Dateien ist zwei Seiten', () => {
    const document: Document = {
      type: 'payslip',
      label: 'Egal',
      person: 'Anna Muster',
      pages: [
        { fileId: 'a', page: 1 },
        { fileId: 'b', page: 1 },
      ],
    }

    const documents = schneideAbrechnungsmonate([document], {
      a: { 1: payslipPage('Januar 2025') },
      b: { 1: payslipPage('Februar 2025') },
    })

    assert.deepEqual(
      documents[0]?.pages.map((page) => [page.fileId, page.page, page.part]),
      [
        ['a', 1, 1],
        ['b', 1, 2],
      ],
    )
  })

  it('vergibt die Teilnummern neu und behält die übrigen Felder der Seiten', () => {
    const document = {
      type: 'payslip',
      label: 'Egal',
      person: 'Anna Muster',
      pages: [
        { fileId: '395', page: 1, part: 9, hint: 'bleibt' },
        { fileId: '395', page: 2, part: 9 },
      ],
    }

    const documents = schneideAbrechnungsmonate([document], {
      395: { 1: payslipPage('Januar 2025'), 2: payslipPage('Februar 2025') },
    })

    assert.deepEqual(documents[0]?.pages, [
      { fileId: '395', page: 1, part: 1, hint: 'bleibt' },
      { fileId: '395', page: 2, part: 2 },
    ])
  })

  it('schneidet nur das passende Dokument und lässt die übrigen als dieselben Objekte stehen', () => {
    const payslip = payslipDocument([1, 2])
    const contract: Document = { type: 'rent_contract', label: 'Egal', person: 'Anna Muster', pages: [{ fileId: '12', page: 1 }] }

    const documents = schneideAbrechnungsmonate([contract, payslip, contract], {
      395: { 1: payslipPage('Januar 2025'), 2: payslipPage('Februar 2025') },
    })

    assert.equal(documents.length, 3)
    assert.equal(documents[0], contract)
    assert.notEqual(documents[1], payslip)
    assert.equal(documents[2], contract)
    assert.deepEqual(payslipParts(documents[1]), [[1], [2]])
  })

  it('verändert weder Dokumente noch Texte', () => {
    const input = deepFreeze([payslipDocument([1, 2])])
    const texts = deepFreeze({ 395: { 1: payslipPage('Januar 2025'), 2: payslipPage('Februar 2025') } })

    const documents = schneideAbrechnungsmonate(input, texts)

    assert.notEqual(documents, input)
    assert.equal(
      input[0]?.pages.some((page) => 'part' in page),
      false,
    )
  })

  it('hält die Invarianten für beliebige Seitenfolgen: keine Seite verloren, Teile steigen um höchstens 1', () => {
    // Deterministic pseudo-random page sequences (mulberry32), no external dependency.
    let state = 20260907
    const random = () => {
      state = (state + 0x6d2b79f5) | 0
      let t = Math.imul(state ^ (state >>> 15), 1 | state)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const samples: ((n: number) => string)[] = [
      (n) => payslipPage(`${MONTHS_2025[n % 12]}`),
      (n) => `Abrechnungsmonat ${String((n % 12) + 1).padStart(2, '0')}/2025`,
      () => 'Sozialversicherung: Beitragsgruppenschlüssel 1111',
      () => '',
      () => 'Gesamtbrutto 3.776,60, erstellt am 09.01.2026',
    ]

    for (let run = 0; run < 200; run++) {
      const count = 1 + Math.floor(random() * 12)
      const pages = Array.from({ length: count }, (_, index) => index * 2 + 1)
      const pageTexts: Record<number, string> = {}
      for (const page of pages) {
        const sample = samples[Math.floor(random() * samples.length)]
        assert.ok(sample)
        pageTexts[page] = sample(Math.floor(random() * 4))
      }
      const texts: PageTexts = { 395: pageTexts }

      const input = payslipDocument(pages)
      const [output] = schneideAbrechnungsmonate([input], texts)
      assert.ok(output)

      assert.deepEqual(output.pages.map(pageKey), input.pages.map(pageKey), 'same pages in the same order')

      if (output === input) continue

      const numbers = output.pages.map((page) => page.part ?? 0)
      assert.equal(numbers[0], 1)
      assert.ok(numbers.every((number, index) => index === 0 || number - (numbers[index - 1] ?? 0) === 0 || number - (numbers[index - 1] ?? 0) === 1))
      assert.ok((numbers.at(-1) ?? 0) >= 2, 'a document that changed has at least two parts')
    }
  })
})

describe('monatDerSeite', () => {
  const cases: Record<string, [string, string | null]> = {
    'Überschrift mit Monatsnamen': ['# Abrechnung der Brutto/Netto-Bezüge für Januar 2025', '01.2025'],
    Abrechnungsmonat: ['Abrechnungsmonat Januar 2026\nSachbearbeiter/-in Michel Heine', '01.2026'],
    'numerisch mit Punkt': ['Entgeltabrechnung 03.2025', '03.2025'],
    'numerisch mit Schrägstrich': ['Gehaltsabrechnung 11/2024', '11.2024'],
    'Umlaut ausgeschrieben': ['Lohnabrechnung für Maerz 2025', '03.2025'],
    'Zeitraum mit Tagesdatum': ['Abrechnungszeitraum 01.01.2025 - 31.01.2025', '01.2025'],
    // The print date of a December payslip lies in January. Read as the billing month, the cut
    // would split every payslip in the wrong place.
    'Druckdatum zählt nicht': ['Die Abrechnung wurde am 09.01.2026 um 23:05:51 erstellt.', null],
    'Tagesdatum ohne Zeitraum-Anker zählt nicht': ['Gehaltsabrechnung, erstellt am 03.02.2025', null],
    'Betrag hinter der Überschrift ist kein Monat': [
      'Entgeltabrechnung Gesamtbrutto 3.776,60 EUR, Jahreswert 45.319,20',
      null,
    ],
    'ohne Überschrift kein Monat': ['Zahlungseingang Januar 2025', null],
  }

  for (const [name, [text, month]] of Object.entries(cases)) {
    it(`liest den Abrechnungsmonat aus den Schreibweisen des Bestands: ${name}`, () => {
      assert.equal(monatDerSeite(text), month)
    })
  }

  it('liest März in allen drei Schreibweisen und in jeder Groß-/Kleinschreibung', () => {
    for (const march of ['März', 'märz', 'MÄRZ', 'Maerz', 'MAERZ', 'maerz', 'Marz', 'MARZ']) {
      assert.equal(monatDerSeite(`Abrechnungsmonat ${march} 2025`), '03.2025', march)
    }
  })

  it('liest jeden Monat des Jahres', () => {
    MONTHS_2025.forEach((month, index) => {
      const expected = `${String(index + 1).padStart(2, '0')}.2025`

      assert.equal(monatDerSeite(`Abrechnungsmonat ${month}`), expected, month)
      assert.equal(monatDerSeite(`Abrechnungsmonat ${month.toUpperCase()}`), expected, month.toUpperCase())
      assert.equal(monatDerSeite(`Lohnabrechnung ${expected}`), expected)
    })
  })

  it('akzeptiert Punkt und fehlendes Leerzeichen zwischen Monat und Jahr', () => {
    assert.equal(monatDerSeite('Abrechnungsmonat Januar. 2025'), '01.2025')
    assert.equal(monatDerSeite('Abrechnungsmonat Januar 2025'), '01.2025')
    assert.equal(monatDerSeite('Abrechnungsmonat Januar2025'), '01.2025')
    assert.equal(monatDerSeite('Abrechnungsmonat 03 / 2025'), '03.2025')
    assert.equal(monatDerSeite('Abrechnungsmonat: 03.2025'), '03.2025')
  })

  it('erkennt jede Überschrift, auch in Großschreibung und mit Umlaut', () => {
    const anchors = [
      'Abrechnungsmonat',
      'Abrechnungszeitraum',
      'Lohnzahlungszeitraum',
      'Entgeltabrechnung',
      'Verdienstabrechnung',
      'Gehaltsabrechnung',
      'Lohnabrechnung',
      'Bezügemitteilung',
      'Abrechnung',
    ]

    for (const anchor of anchors) {
      assert.equal(monatDerSeite(`${anchor} Mai 2025`), '05.2025', anchor)
      assert.equal(monatDerSeite(`${anchor.toUpperCase()} MAI 2025`), '05.2025', anchor.toUpperCase())
    }
  })

  it('liest bei einem Zeitraum auch Tagesdaten mit einstelligem Tag und Monat', () => {
    assert.equal(monatDerSeite('Abrechnungszeitraum 1.3.2025 bis 31.3.2025'), '03.2025')
    assert.equal(monatDerSeite('Lohnzahlungszeitraum 01.02.2025 - 28.02.2025'), '02.2025')
    assert.equal(monatDerSeite('Abrechnungszeitraum 10.10.2025 - 31.10.2025'), '10.2025')
    assert.equal(monatDerSeite('Abrechnungszeitraum 1.12.2025 - 31.12.2025'), '12.2025')
  })

  it('lässt ein Tagesdatum hinter einem Monats-Anker nicht gelten', () => {
    // Only a heading that names a PERIOD allows the full date.
    assert.equal(monatDerSeite('Abrechnungsmonat 31.01.2025'), null)
    assert.equal(monatDerSeite('Entgeltabrechnung 15.03.2025'), null)
  })

  it('liest einen Monat hinter einem Datum, aber nicht den Rest davon', () => {
    // "01.2025" inside "31.01.2025" is not a month; the one behind a space is.
    assert.equal(monatDerSeite('Abrechnung 31.01.2025 für 02.2025'), '02.2025')
    assert.equal(monatDerSeite('Abrechnung 131.01.2025'), null)
    assert.equal(monatDerSeite('Abrechnung 1/01.2025'), null)
  })

  it('lehnt ungültige Monate und Jahre ab', () => {
    for (const text of [
      'Abrechnungsmonat 13.2025',
      'Abrechnungsmonat 00.2025',
      'Abrechnungsmonat 03.1899',
      'Abrechnungsmonat 03.2125',
      'Abrechnungsmonat Januar 2125',
      'Abrechnungsmonat Mär 2025',
      'Abrechnungsmonat Sommer 2025',
    ]) {
      assert.equal(monatDerSeite(text), null, text)
    }
  })

  it('wertet jede Überschrift der Seite aus, bis eine einen Monat nennt', () => {
    const filler = ' '.repeat(70)

    // The first heading has no month within its window, the second has.
    assert.equal(monatDerSeite(`Lohnabrechnung${filler}Abrechnungsmonat März 2025`), '03.2025')
    // A later heading is not consulted once an earlier one has answered.
    assert.equal(monatDerSeite('Abrechnungsmonat Januar 2025 und Abrechnungsmonat Februar 2025'), '01.2025')
  })

  it('zählt das Fenster hinter der Überschrift auf 60 Zeichen', () => {
    const anchor = 'Abrechnungsmonat'

    // "Januar 2025" is 11 characters: 49 filler characters leave it exactly inside the window.
    assert.equal(monatDerSeite(`${anchor}${' '.repeat(49)}Januar 2025`), '01.2025')
    // One more and the year is cut off.
    assert.equal(monatDerSeite(`${anchor}${' '.repeat(50)}Januar 2025`), null)
  })

  it('zählt das Fenster in Zeichen, nicht in Bytes (bewusste Abweichung von PHP)', () => {
    // PHP's substr() counts bytes: 49 umlauts are 98 bytes there and push the month out of the
    // window. JavaScript counts characters, so the same text still reads.
    assert.equal(monatDerSeite(`Abrechnungsmonat${'ü'.repeat(49)}Januar 2025`), '01.2025')
  })

  it('verträgt Leereingaben', () => {
    assert.equal(monatDerSeite(''), null)
    assert.equal(monatDerSeite(undefined), null)
    assert.equal(monatDerSeite(null), null)
  })
})
