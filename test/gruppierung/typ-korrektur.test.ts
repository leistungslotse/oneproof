import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import type { Document, PageTexts } from '../../src/engine/gruppierung/dokument.ts'
import type { Katalog } from '../../src/engine/gruppierung/typ-bezeichnung.ts'
import { korrigiereTypen } from '../../src/engine/gruppierung/typ-korrektur.ts'

/*
 * USER FINDING 20.09.2026: "A registration certificate that was handed in is also classified as
 * an ID document." Where the document text resolves the mix-up itself, the model does not decide.
 * The rule is in the catalog (`confusions`), so the next mix-up needs an entry, not a new class.
 */

// Trusted test data: the catalog as the profile ships it.
const katalog: Katalog = JSON.parse(
  readFileSync(new URL('../../public/profile/wohngeld/2026-11-15/dokumenttypen.json', import.meta.url), 'utf8'),
)

/** Freezes deeply: a function that mutates its input then fails with a TypeError. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    Object.values(value).forEach(deepFreeze)
  }
  return value
}

/** A document from the grouping with one page and its text. */
function disambiguationDocument(type: string, text: string, label = 'Ausweisdokument'): [Document[], PageTexts] {
  return [
    [
      {
        type,
        typeLabel: null,
        label,
        person: 'Maria Musterfrau',
        pages: [{ fileId: '7', page: 1 }],
        confidence: 88,
      },
    ],
    { 7: { 1: text } },
  ]
}

describe('korrigiereTypen', () => {
  it('macht aus der als Ausweis klassifizierten Meldebescheinigung wieder eine Meldebescheinigung', () => {
    const [documents, texts] = disambiguationDocument(
      'identity_document',
      'Stadt Musterstadt\nMeldebescheinigung nach § 18 BMG\nFolgende Personen sind gemeldet: ...',
    )

    const result = korrigiereTypen(documents, texts, katalog)

    assert.equal(result[0]?.type, 'registration_certificate')
    // The display name moves with the type: otherwise "Ausweisdokument" would stand above a registration certificate.
    assert.equal(result[0]?.label, 'Meldebescheinigung / Haushaltsbescheinigung')
    // The classification confidence is the model's statement and stays as it is.
    assert.equal(result[0]?.confidence, 88)
    assert.deepEqual(result[0]?.pages, documents[0]?.pages)
    // Instead of PHP's log line: where the type came from.
    assert.equal(result[0]?.correctedFrom, 'identity_document')
  })

  it('korrigiert auch die Gegenrichtung', () => {
    const [documents, texts] = disambiguationDocument(
      'registration_certificate',
      'BUNDESREPUBLIK DEUTSCHLAND\nPERSONALAUSWEIS / IDENTITY CARD\nMusterfrau',
      'Meldebescheinigung / Haushaltsbescheinigung',
    )

    const result = korrigiereTypen(documents, texts, katalog)

    assert.equal(result[0]?.type, 'identity_document')
    assert.equal(result[0]?.label, 'Ausweisdokument')
    assert.equal(result[0]?.correctedFrom, 'registration_certificate')
  })

  it('lässt die erweiterte Meldebescheinigung in Ruhe, die selbst Ausweisdaten nennt', () => {
    // Where BOTH sides speak, the model's proposal stays: a wrong correction costs more than a
    // missed one, and only whoever has the document in front of them can decide.
    const [documents, texts] = disambiguationDocument(
      'registration_certificate',
      'Erweiterte Meldebescheinigung\nAusweisdokument: Personalausweis, ausgestellt am 01.02.2020',
      'Meldebescheinigung / Haushaltsbescheinigung',
    )

    const result = korrigiereTypen(documents, texts, katalog)

    assert.equal(result[0]?.type, 'registration_certificate')
    assert.equal(result[0], documents[0])
  })

  it('findet das Stichwort auch im Kompositum und mit aufgelöstem Umlaut', () => {
    const texts = {
      Kompositum: 'Einwohnermeldeamtsauskunft der Stadt Musterstadt',
      Umlaut: 'Bestätigung der Meldebehörde Musterstadt',
      'Umlaut aufgelöst (OCR)': 'Bestaetigung der Meldebehoerde Musterstadt',
    }

    for (const [name, text] of Object.entries(texts)) {
      const [documents, pageTexts] = disambiguationDocument('identity_document', text)

      assert.equal(korrigiereTypen(documents, pageTexts, katalog)[0]?.type, 'registration_certificate', name)
    }
  })

  it('liest Groß- und Kleinschreibung, ß und Umlaute auf beiden Seiten gleich', () => {
    for (const text of ['MELDEBEHÖRDE MUSTERSTADT', 'meldebehörde musterstadt', 'MELDEBEHOERDE', 'Meldebestätigung', 'MELDEBESTAETIGUNG']) {
      const [documents, pageTexts] = disambiguationDocument('identity_document', text)

      assert.equal(korrigiereTypen(documents, pageTexts, katalog)[0]?.type, 'registration_certificate', text)
    }

    // "Reisepaß" with the old ß is the same word as the catalog keyword "reisepass".
    const [documents, pageTexts] = disambiguationDocument('registration_certificate', 'Reisepaß Nr. 123', 'Meldebescheinigung')

    assert.equal(korrigiereTypen(documents, pageTexts, katalog)[0]?.type, 'identity_document')
  })

  it('liest zerlegte Umlaute wie zusammengesetzte', () => {
    // "Meldebehörde" as a PDF of another system writes it: "o" plus a combining diaeresis.
    const zerlegt = 'Bestätigung der Meldebehörde Musterstadt'.normalize('NFD')
    assert.notEqual(zerlegt, zerlegt.normalize('NFC'))

    const [documents, pageTexts] = disambiguationDocument('identity_document', zerlegt)

    assert.equal(korrigiereTypen(documents, pageTexts, katalog)[0]?.type, 'registration_certificate')
  })

  it('gleicht ein Stichwort aus mehreren Wörtern auch über einen Zeilenumbruch ab', () => {
    // "bescheid ueber" in the keywords of `unless` hits "Bescheid\nüber" and "Bescheid  über" alike:
    // a line break or a second space in the OCR text must not lift the veto.
    for (const text of ['Renteninformation\nBescheid über Ihre Altersrente', 'Renteninformation\nBescheid\nüber Ihre Altersrente', 'Renteninformation\nBescheid   ueber Ihre Altersrente']) {
      const [documents, pageTexts] = disambiguationDocument('pension_notice', text, 'Rentenbescheid')

      assert.equal(korrigiereTypen(documents, pageTexts, katalog)[0]?.type, 'pension_notice', text)
    }
  })

  it('rührt einen Typ ohne Verwechslungsregel nicht an', () => {
    const [documents, texts] = disambiguationDocument('payslip', 'Meldebescheinigung', 'Lohn-/Gehaltsabrechnung')

    const result = korrigiereTypen(documents, texts, katalog)

    assert.equal(result[0]?.type, 'payslip')
    assert.equal(result[0], documents[0])
  })

  it('rührt ein Dokument ohne Seitentext nicht an', () => {
    const [documents] = disambiguationDocument('identity_document', '')

    assert.equal(korrigiereTypen(documents, {}, katalog)[0]?.type, 'identity_document')
    assert.equal(korrigiereTypen(documents, { 7: {} }, katalog)[0]?.type, 'identity_document')
    assert.equal(korrigiereTypen(documents, { 7: { 1: '   \n ' } }, katalog)[0]?.type, 'identity_document')
  })

  it('lässt den Ausweis Ausweis sein', () => {
    const [documents, texts] = disambiguationDocument(
      'identity_document',
      'BUNDESREPUBLIK DEUTSCHLAND\nPERSONALAUSWEIS\nMusterfrau, Maria',
    )

    const result = korrigiereTypen(documents, texts, katalog)

    assert.equal(result[0]?.type, 'identity_document')
    assert.equal(result[0], documents[0])
    assert.equal('correctedFrom' in result[0], false)
  })

  it('liest den Text ALLER Seiten: das entscheidende Wort steht nicht auf der ersten', () => {
    const documents = [
      {
        type: 'identity_document',
        label: 'Ausweisdokument',
        person: 'Maria Musterfrau',
        pages: [
          { fileId: '7', page: 1 },
          { fileId: '7', page: 2 },
          { fileId: '8', page: 1 },
        ],
      },
    ]
    const texts = { 7: { 1: 'Stadt Musterstadt', 2: 'Seite 2' }, 8: { 1: 'Dienstsiegel der Meldebehörde' } }

    assert.equal(korrigiereTypen(documents, texts, katalog)[0]?.type, 'registration_certificate')
  })

  it('korrigiert nur das betroffene Dokument und behält Reihenfolge und Referenzen der übrigen', () => {
    const [[wrong], texts] = disambiguationDocument('identity_document', 'Meldebescheinigung')
    assert.ok(wrong)
    const fine = { type: 'payslip', label: 'Lohn-/Gehaltsabrechnung', person: 'Maria Musterfrau', pages: [{ fileId: '7', page: 2 }] }
    const unknown = { type: 'gesellschaftsvertrag', label: 'Gesellschaftsvertrag', person: '', pages: [] }

    const result = korrigiereTypen([fine, wrong, unknown], texts, katalog)

    assert.equal(result.length, 3)
    assert.equal(result[0], fine)
    assert.equal(result[1]?.type, 'registration_certificate')
    assert.equal(result[2], unknown)
  })

  it('verändert die Eingabe nicht', () => {
    const [documents, texts] = disambiguationDocument('identity_document', 'Meldebescheinigung')
    deepFreeze(documents)
    deepFreeze(texts)

    const result = korrigiereTypen(documents, texts, katalog)

    assert.notEqual(result, documents)
    assert.equal(documents[0]?.type, 'identity_document')
    assert.equal(documents[0]?.label, 'Ausweisdokument')
    assert.equal('correctedFrom' in documents[0], false)
    assert.equal(result[0]?.type, 'registration_certificate')
  })

  it('korrigiert zweimal angewandt nicht weiter', () => {
    const [documents, texts] = disambiguationDocument('identity_document', 'Meldebescheinigung nach § 18 BMG')

    const once = korrigiereTypen(documents, texts, katalog)
    const twice = korrigiereTypen(once, texts, katalog)

    assert.equal(twice[0], once[0])
  })

  it('verträgt einen fehlenden Katalog', () => {
    const [documents, texts] = disambiguationDocument('identity_document', 'Meldebescheinigung')

    // invalid on purpose
    for (const missing of [undefined, null, 'kein Katalog']) {
      const result = korrigiereTypen(documents, texts, missing as never)

      assert.equal(result[0], documents[0])
      assert.notEqual(result, documents)
    }
  })

  it('hat im Katalog die beiden Regeln, an denen die Tests hängen', () => {
    assert.equal(katalog.identity_document?.confusions?.[0]?.type, 'registration_certificate')
    assert.equal(katalog.registration_certificate?.confusions?.[0]?.type, 'identity_document')
  })
})

describe('Verwechslungsregeln im Wohngeld-Katalog', () => {
  /** Corrects one document of type `typ` with the page text `text` against the real catalog. */
  const korrigiert = (typ: string, text: string): string | undefined =>
    korrigiereTypen(...disambiguationDocument(typ, text, katalog[typ]?.label), katalog)[0]?.type

  it('verweist nur auf Typen, die der Katalog kennt', () => {
    for (const [typ, eintrag] of Object.entries(katalog)) {
      for (const regel of eintrag.confusions ?? []) {
        assert.ok(Object.hasOwn(katalog, regel.type) && regel.type !== typ, `${typ} → ${regel.type}`)
      }
    }
  })

  it('korrigiert, wo nur eine Seite spricht', () => {
    const faelle: [string, string, string][] = [
      ['identity_document', 'AUFENTHALTSTITEL\nRESIDENCE PERMIT\nErwerbstätigkeit gestattet', 'residence_permit'],
      ['identity_document', 'Fiktionsbescheinigung nach § 81 Abs. 4 AufenthG', 'residence_permit'],
      ['rent_certificate', 'Wohnungsgeberbestätigung nach § 19 Bundesmeldegesetz\nEinzug am 01.03.2026', 'move_in_confirmation'],
      ['pension_notice', 'Deutsche Rentenversicherung\nRenteninformation 2026\nIhre bisher erreichte Rentenanwartschaft', 'other_document'],
      ['unemployment_benefit_notice', 'Jobcenter Musterstadt\nBescheid über Grundsicherungsgeld\nBedarfsgemeinschaft 123', 'citizen_benefit_notice'],
      ['citizen_benefit_notice', 'Jobcenter Musterstadt\nAufforderung zur Beantragung vorrangiger Leistungen nach § 12a SGB II', 'request_to_apply'],
      ['citizen_benefit_notice', 'Agentur für Arbeit\nArbeitslosengeld\nBemessungsentgelt 98,50 Euro täglich', 'unemployment_benefit_notice'],
      ['youth_welfare_notice', 'Jugendamt Musterstadt\nFestsetzung des Elternbeitrags für die Kindertagesstätte', 'child_care_cost_proof'],
      ['youth_welfare_notice', 'Jugendamt Musterstadt\nElternbeitrag für die Kita Sonnenschein', 'child_care_cost_proof'],
      ['youth_welfare_notice', 'Kita-Gebührenbescheid\nStadt Musterstadt', 'child_care_cost_proof'],
    ]

    for (const [typ, text, erwartet] of faelle) {
      assert.equal(korrigiert(typ, text), erwartet, `${typ}: ${text}`)
    }
  })

  it('lässt den Vorschlag stehen, wo beide Seiten sprechen', () => {
    const faelle: [string, string][] = [
      ['identity_document', 'REISEPASS / PASSPORT\nEtikett: Niederlassungserlaubnis, Aufenthaltstitel'],
      ['rent_certificate', 'Mietbescheinigung\nGrundmiete 600,00 EUR\nBetriebskosten 150,00 EUR\nWohnungsgeber: Hausverwaltung Muster'],
      ['pension_notice', 'Rentenbescheid\nDie Rente beginnt am 01.07.2026\nAnders als die Renteninformation ist er verbindlich.'],
      ['unemployment_benefit_notice', 'Arbeitslosengeld nach dem SGB III\nBemessungsentgelt 98,50 Euro\nReicht es nicht, hilft das Jobcenter.'],
      ['citizen_benefit_notice', 'Jobcenter Musterstadt\nBewilligungszeitraum 01.01.2026 bis 31.12.2026\nBitte beantragen Sie vorrangige Leistungen.'],
      ['youth_welfare_notice', 'Jugendamt\nVollzeitpflege nach § 33 SGB VIII mit Pflegegeld\nDas Kind besucht den Kindergarten.'],
      ['youth_welfare_notice', 'Jugendamt Musterstadt\nEingliederungshilfe nach § 35a SGB VIII\nIntegrationshilfe in der Kita'],
      // A line break or a second space inside "Hilfe zur Erziehung" does not lift the veto.
      ['youth_welfare_notice', 'Jugendamt Musterstadt\nHilfe zur\nErziehung nach § 27 SGB VIII\nDas Kind besucht den Kindergarten.'],
      ['youth_welfare_notice', 'Jugendamt Musterstadt\nHilfe  zur  Erziehung nach § 27 SGB VIII\nDas Kind besucht den Kindergarten.'],
      // "kita" is a word start: a first name that contains it is no child care.
      ['youth_welfare_notice', 'Jugendamt Musterstadt\nHilfe für junge Volljährige, betreutes Wohnen für Nikita Muster'],
    ]

    for (const [typ, text] of faelle) {
      assert.equal(korrigiert(typ, text), typ, `${typ}: ${text}`)
    }
  })
})

describe('korrigiereTypen mit einem eigenen Katalog', () => {
  // invalid on purpose: a rule list that is no list, rules that are no objects or lack a part
  const eigener = {
    a: {
      label: 'Alpha',
      confusions: [
        { type: 'b', requires: ['beta'], unless: ['gamma'] },
        { type: 'c', requires: ['gamma'] },
      ],
    },
    b: { label: 'Beta' },
    c: {},
    d: { label: 'Delta', confusions: [] },
    e: { label: 'Epsilon', confusions: 'keine Liste' },
    f: { label: 'Phi', confusions: [null, 'x', { requires: ['phi'] }, { type: 'fehlt', requires: ['phi'] }, { type: 'b', unless: ['x'] }, { type: 'b', requires: ['phi'] }] },
  } as never
  const dokument = (type: string, text: string): [Document[], PageTexts] => [
    [{ type, label: 'alt', person: 'P', pages: [{ fileId: '1', page: 1 }] }],
    { 1: { 1: text } },
  ]

  it('wendet die erste passende Regel an', () => {
    const [documents, texts] = dokument('a', 'Beta und Gamma')

    // The first rule is vetoed by `unless: gamma`, the second one fits.
    assert.equal(korrigiereTypen(documents, texts, eigener)[0]?.type, 'c')

    const [only, onlyTexts] = dokument('a', 'nur Beta')
    assert.equal(korrigiereTypen(only, onlyTexts, eigener)[0]?.type, 'b')
  })

  it('nimmt den Schlüssel als Bezeichnung, wenn der Zieltyp keine hat', () => {
    const [documents, texts] = dokument('a', 'gamma')

    assert.equal(korrigiereTypen(documents, texts, eigener)[0]?.label, 'c')
  })

  it('übergeht Regeln ohne requires, ohne Zieltyp, mit unbekanntem Ziel und Nicht-Objekte', () => {
    const [documents, texts] = dokument('f', 'phi')

    // Only the last rule is usable: the others are null, a string, without `type`, to a type
    // the catalog does not know, or without `requires` (which never applies).
    assert.equal(korrigiereTypen(documents, texts, eigener)[0]?.type, 'b')
  })

  it('rührt Typen mit leerer oder fehlerhafter Regelliste nicht an', () => {
    for (const type of ['b', 'c', 'd', 'e', 'unbekannt', '']) {
      const [documents, texts] = dokument(type, 'beta gamma phi')

      assert.equal(korrigiereTypen(documents, texts, eigener)[0], documents[0], type)
    }
  })

  it('findet Einträge nur unter eigenen Schlüsseln', () => {
    const [documents, texts] = dokument('constructor', 'beta')

    assert.equal(korrigiereTypen(documents, texts, eigener)[0], documents[0])
  })
})
