import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readInstance } from '../../src/engine/fim/instanz.ts'
import type { Document } from '../../src/engine/gruppierung/dokument.ts'
import { ladeProfil } from '../../src/engine/profil/laden.ts'
import type { Anforderung } from '../../src/engine/zuordnung/anforderungen.ts'
import { datumAus, ordneZu } from '../../src/engine/zuordnung/index.ts'
import type { OrdneZuEingabe, Zuordnung } from '../../src/engine/zuordnung/index.ts'
import type { MonateJeSeite } from '../../src/engine/zuordnung/posten.ts'
import { fixture, lies, WOHNGELD } from '../hilfen/dateien.ts'
import { DOMParser } from '../hilfen/xml.ts'

const profil = await ladeProfil(lies, WOHNGELD)
const antrag = readInstance(await fixture('antrag-mietzuschuss-1.7.0.xml'), { DOMParser })

const dokument = (typ: string, person: string | null, ...seiten: [string, number][]): Document => ({
  type: typ,
  label: typ,
  // ungültig mit Absicht: eine Unterlage ohne erkennbaren Namen steht als `null`, nicht als ''
  person: person as never,
  pages: seiten.map(([fileId, page]) => ({ fileId, page })),
})

const dateien = new Map<string, { name: string }>(
  ['albert', 'silvia', 'vermoegen', 'konto', 'ausweis', 'miete', 'lohn1', 'lohn2', 'lohn3'].map((id) => [id, { name: `${id}.pdf` }]),
)

/** The day the checks of this file run on: the payslips of the examples are from early 2026. */
const STICHTAG = new Date('2026-04-15T12:00:00')

const pruefe = (dokumente: Document[], optionen: Partial<OrdneZuEingabe> = {}): Promise<Zuordnung> =>
  ordneZu({ profil, antrag, dokumente, dateien, stichtag: STICHTAG, ...optionen })
const status = (ergebnis: Zuordnung, id: string): Anforderung => {
  const anforderung = ergebnis.anforderungen.find((kandidat) => kandidat.id === id)
  assert.ok(anforderung, `Anforderung ${id} fehlt`)
  return anforderung
}

describe('Anforderungen am Beispielantrag', async () => {
  const ergebnis = await pruefe([
    dokument('income_certificate', 'Einstein, Albert', ['albert', 1]),
    dokument('income_certificate', 'Einstein, Silvia', ['silvia', 1]),
    dokument('asset_proof', 'Svenja Einstein', ['vermoegen', 1]),
    dokument('bank_statement', 'Svenja Einstein', ['konto', 1], ['konto', 2]),
    dokument('identity_document', 'Svenja Einstein', ['ausweis', 1]),
  ])

  it('puts the evidence of a person at that person’s row', () => {
    const albert = status(ergebnis, 'einnahmen#p1#1')
    assert.equal(albert.status, 'belegt')
    assert.deepEqual(albert.belege.map((beleg) => beleg.typ), ['income_certificate'])
    assert.equal(albert.belege[0]?.dateien[0]?.name, 'albert.pdf')
    assert.equal(albert.belege[0]?.dateien[0]?.seitenText, 'Seite 1')
  })

  it('does not take a document of an unknown person for settled', () => {
    const svenja = status(ergebnis, 'einnahmen#p0#1')
    assert.equal(svenja.status, 'unklar')
    assert.match(svenja.note ?? '', /Silvia Einstein/)
    assert.match(svenja.note ?? '', /kommt im Antrag nicht vor/)
  })

  it('files a document of an unknown person with the reason, so that the application does not refer to it', () => {
    const beleg = status(ergebnis, 'einnahmen#p0#1').belege.find(({ person }) => person === 'Silvia Einstein')
    assert.ok(beleg)
    const silvia = ergebnis.ablage.find(({ dokument, slot }) => dokument === beleg.dokument && slot === 'einnahmen#p0#1')
    assert.ok(silvia)
    assert.equal(silvia.grund, 'Die Unterlage lautet auf „Silvia Einstein“. Diese Person kommt im Antrag nicht vor.')
    const albert = ergebnis.ablage.find(({ slot }) => slot === 'einnahmen#p1#1')
    assert.ok(albert)
    assert.equal(albert.grund, undefined)
  })

  it('lets a bank statement stand for the rent only as something to check', () => {
    const miete = status(ergebnis, 'miete#p-#1')
    assert.equal(miete.status, 'unklar')
    assert.deepEqual(miete.belege.map((beleg) => beleg.typ), ['bank_statement'])
    assert.match(miete.note ?? '', /Kontoauszug/)
  })

  it('counts a document that suffices on its own for the asset statement', () => {
    const vermoegen = status(ergebnis, 'vermoegen#p0#1')
    assert.equal(vermoegen.status, 'belegt')
    // The bank statement is placed here too — in the weaker role, which does not change the status.
    assert.deepEqual(vermoegen.belege.map((beleg) => beleg.typ).sort(), ['asset_proof', 'bank_statement'])
  })

  it('leaves what nothing was found for open and says what to bring', () => {
    const werbungskosten = status(ergebnis, 'werbungskosten#p0#1')
    assert.equal(werbungskosten.status, 'offen')
    assert.match(werbungskosten.hint ?? '', /Fahrtkosten/)
    assert.equal(werbungskosten.belege.length, 0)
  })

  it('sets aside what the application says does not apply', () => {
    const entfaellt = status(ergebnis, 'unterhalt#p0')
    assert.equal(entfaellt.status, 'entfaellt')
    assert.match(entfaellt.reason ?? '', /beantwortet/)
  })

  it('lists documents without a place with the reason', () => {
    assert.deepEqual(ergebnis.nichtZugeordnet.map((beleg) => beleg.typ), ['identity_document'])
    assert.match(ergebnis.nichtZugeordnet[0]?.grund ?? '', /kein Nachweis dieser Art/)
  })

  it('summarises the statuses', () => {
    assert.deepEqual(
      (({ belegt, offen, unklar }) => ({ belegt, offen, unklar }))(ergebnis.zusammenfassung),
      { belegt: 2, offen: 2, unklar: 2 },
    )
    assert.ok(ergebnis.zusammenfassung.entfaellt > 0)
  })

  it('reports the application and the version it was read in', () => {
    assert.equal(ergebnis.antrag.schema, 'S01000000123')
    assert.deepEqual(ergebnis.antrag.personen, ['Svenja Einstein', 'Albert Einstein'])
  })
})

describe('Unterlagen auf eine andere Person', () => {
  it('sets aside a document of an unknown person where the person has evidence of their own', async () => {
    const ergebnis = await pruefe([
      dokument('income_certificate', 'Svenja Einstein', ['lohn1', 1]),
      dokument('income_certificate', 'Kevin Yilmaz', ['lohn2', 1]),
    ])
    const svenja = status(ergebnis, 'einnahmen#p0#1')
    assert.equal(svenja.status, 'belegt')
    assert.deepEqual(svenja.belege.map(({ person }) => person), ['Svenja Einstein'], 'the payslip of someone else is no evidence here')

    const kevin = ergebnis.nichtZugeordnet.find(({ person }) => person === 'Kevin Yilmaz')
    assert.ok(kevin, 'it is listed as without a place')
    assert.equal(kevin.grund, 'Die Unterlage lautet auf „Kevin Yilmaz“. Diese Person kommt im Antrag nicht vor.')
    assert.equal(kevin.dateien[0]?.name, 'lohn2.pdf')

    const abgelegt = ergebnis.ablage.filter(({ slot }) => slot === 'einnahmen#p0#1')
    assert.deepEqual(
      abgelegt.map(({ grund }) => grund ?? null),
      [null, 'Die Unterlage lautet auf „Kevin Yilmaz“. Diese Person kommt im Antrag nicht vor.'],
    )
  })

  it('keeps it where it is all there is, as unclear: the name may have been misread', async () => {
    const ergebnis = await pruefe([dokument('income_certificate', 'Kevin Yilmaz', ['lohn2', 1])])
    const svenja = status(ergebnis, 'einnahmen#p0#1')
    assert.equal(svenja.status, 'unklar')
    assert.deepEqual(svenja.belege.map(({ person }) => person), ['Kevin Yilmaz'])
    assert.equal(ergebnis.nichtZugeordnet.length, 0)
  })
})

describe('Rolle und Abdeckung', () => {
  it('accepts a rental contract on its own for the rent', async () => {
    const ergebnis = await pruefe([dokument('rent_contract', null, ['miete', 1], ['miete', 2])])
    const miete = status(ergebnis, 'miete#p-#1')
    assert.equal(miete.status, 'belegt')
    assert.equal(miete.belege[0]?.dateien[0]?.seitenText, 'Seiten 1–2')
  })

  it('does not let supplementary documents alone prove the rent', async () => {
    const ergebnis = await pruefe([dokument('utility_statement', null, ['miete', 1])])
    const miete = status(ergebnis, 'miete#p-#1')
    assert.equal(miete.status, 'offen')
    assert.match(miete.note ?? '', /ergänzende Unterlagen/)
  })

  it('asks for more months when payslips cover too few', async () => {
    const monate: Record<string, string> = { 'lohn1:1': '01.2026', 'lohn2:1': '02.2026', 'lohn3:1': '02.2026' }
    const eingabe = (...dateiIds: string[]) => dateiIds.map((id) => dokument('payslip', 'Svenja Einstein', [id, 1]))
    const monateJeSeite: MonateJeSeite = ({ fileId, page }) => monate[`${fileId}:${page}`] ?? null

    const zuWenig = await pruefe(eingabe('lohn1', 'lohn2'), { monateJeSeite })
    assert.equal(status(zuWenig, 'einnahmen#p0#1').status, 'unklar')
    assert.match(status(zuWenig, 'einnahmen#p0#1').note ?? '', /2 von 3 Monaten/)

    // The same month twice counts once.
    const doppelt = await pruefe(eingabe('lohn2', 'lohn3'), { monateJeSeite })
    assert.match(status(doppelt, 'einnahmen#p0#1').note ?? '', /1 von 3 Monaten/)
  })

  it('considers the period covered once enough months are there', async () => {
    const monate: Record<string, string> = { 'a:1': '01.2026', 'b:1': '02.2026', 'c:1': '03.2026' }
    const dokumente = ['a', 'b', 'c'].map((id) => dokument('payslip', 'Svenja Einstein', [id, 1]))
    const ergebnis = await pruefe(dokumente, { monateJeSeite: ({ fileId, page }) => monate[`${fileId}:${page}`] ?? null })
    assert.equal(status(ergebnis, 'einnahmen#p0#1').status, 'belegt')
  })

  it('does not ask for a period when one document certifies it', async () => {
    const dokumente = [dokument('income_certificate', 'Svenja Einstein', ['lohn1', 1])]
    const ergebnis = await pruefe(dokumente)
    assert.equal(status(ergebnis, 'einnahmen#p0#1').status, 'belegt')
  })

  it('does not count payslips that are too old', async () => {
    const monate: Record<string, string> = { 'a:1': '01.2019', 'b:1': '02.2019', 'c:1': '03.2019' }
    const dokumente = ['a', 'b', 'c'].map((id) => dokument('payslip', 'Svenja Einstein', [id, 1]))
    const ergebnis = await pruefe(dokumente, { monateJeSeite: ({ fileId, page }) => monate[`${fileId}:${page}`] ?? null })

    const svenja = status(ergebnis, 'einnahmen#p0#1')
    assert.equal(svenja.status, 'unklar')
    assert.match(svenja.note ?? '', /0 von 3 Monaten/)
    assert.match(svenja.note ?? '', /3 Abrechnungen sind älter als 6 Monate \(01\.2019, 02\.2019, 03\.2019\)/)
    assert.equal(svenja.action, 'Aktuelle Abrechnungen hinzufügen')
  })

  it('does not let a contract switch the count of months off', async () => {
    const monate: Record<string, string> = { 'lohn1:1': '03.2026' }
    const ergebnis = await pruefe(
      [dokument('employment_contract', 'Svenja Einstein', ['lohn2', 1]), dokument('payslip', 'Svenja Einstein', ['lohn1', 1])],
      { monateJeSeite: ({ fileId, page }) => monate[`${fileId}:${page}`] ?? null },
    )
    assert.equal(status(ergebnis, 'einnahmen#p0#1').status, 'unklar')
    assert.match(status(ergebnis, 'einnahmen#p0#1').note ?? '', /1 von 3 Monaten/)
  })

  it('does not count a document at the coarser art as proof of it', async () => {
    // A rent change notice without a change of rent in the application lands at the rent: it may
    // show the new rent, which has to be checked.
    const ergebnis = await pruefe([dokument('rent_change_notice', null, ['miete', 1])])
    const miete = status(ergebnis, 'miete#p-#1')
    assert.equal(miete.status, 'unklar')
    assert.equal(miete.belege[0]?.rolle, 'pruefen')
  })
})

describe('Mehrdeutige Zuordnung', () => {
  it('does not settle a fact with a document that fits two persons equally', async () => {
    // Svenja and Albert both have an income; a payslip without a name could be either's.
    const ergebnis = await pruefe([dokument('income_certificate', null, ['lohn1', 1])])
    const svenja = status(ergebnis, 'einnahmen#p0#1')
    assert.equal(svenja.status, 'unklar')
    assert.match(svenja.note ?? '', /passt zu 2 Angaben im Antrag gleich gut/)
    assert.match(svenja.note ?? '', /keine Person des Antrags erkennbar/)

    // The other row does not claim that nothing is there: the document may as well be Albert's.
    const albert = status(ergebnis, 'einnahmen#p1#1')
    assert.equal(albert.status, 'unklar')
    assert.match(albert.note ?? '', /passt auch zu dieser Angabe und steht vorläufig bei „Einkommen · Svenja Einstein“/)
    assert.equal(albert.action, 'Zuordnung prüfen')
  })

  it('accepts payments as proof of maintenance paid, the title only as a supplement', async () => {
    const xml = (await fixture('antrag-mietzuschuss-1.7.0.xml')).replace(
      /(<F00000002026>)001(<\/F00000002026>)/,
      '$1002$2',
    )
    const mitUnterhalt = readInstance(xml, { DOMParser })
    const lauf = (dokumente: Document[]) => ordneZu({ profil, antrag: mitUnterhalt, dokumente, dateien, stichtag: STICHTAG })
    const unterhalt = (ergebnis: Zuordnung): Anforderung => {
      const anforderung = ergebnis.anforderungen.find((kandidat) => kandidat.id.startsWith('unterhalt#p0'))
      assert.ok(anforderung)
      return anforderung
    }

    assert.equal(unterhalt(await lauf([dokument('maintenance_payment_proof', 'Svenja Einstein', ['konto', 1])])).status, 'belegt')
    assert.equal(unterhalt(await lauf([dokument('maintenance_title', 'Svenja Einstein', ['konto', 1])])).status, 'offen')
    assert.equal(unterhalt(await lauf([dokument('bank_statement', 'Svenja Einstein', ['konto', 1])])).status, 'unklar')
  })

  it('settles it once the document names the person', async () => {
    const ergebnis = await pruefe([dokument('income_certificate', 'Einstein, Albert', ['lohn1', 1])])
    assert.equal(status(ergebnis, 'einnahmen#p1#1').status, 'belegt')
  })

  it('takes a document of the household for the household', async () => {
    const ergebnis = await pruefe([dokument('rent_contract', 'Eheleute Einstein', ['miete', 1])])
    const miete = status(ergebnis, 'miete#p-#1')
    assert.equal(miete.status, 'belegt')
    assert.equal(miete.note, null)
  })
})

describe('Vertretung und Betreuung', async () => {
  // The representation question changed its codes from 1.6.1 ("02") to 1.7.0 ("002"); the
  // publisher's dictionary renames the fields, the profile translates the values.
  const v161 = await fixture('antrag-mietzuschuss-1.6.1.xml')
  const v170 = await fixture('antrag-mietzuschuss-1.7.0.xml')
  const mit161 = (code: string) =>
    v161.replace(
      '<G01000001247>',
      `<G00000001059><F00000001827>${code}</F00000001827><G00000000241><F00000000013>Kant</F00000000013><F00000000154>Immanuel</F00000000154></G00000000241></G00000001059><G01000001247>`,
    )
  const mit170 = (code: string) =>
    v170.replace(
      '<G01000001213>',
      `<G60000000220><F60000000352>${code}</F60000000352><G60000000224><F60000000227>Kant</F60000000227><F60000000228>Immanuel</F60000000228></G60000000224></G60000000220><G01000001213>`,
    )
  const lauf = async (xml: string) => {
    const ergebnis = await ordneZu({
      profil,
      antrag: readInstance(xml, { DOMParser }),
      dokumente: [dokument('power_of_attorney', 'Kant, Immanuel', ['ausweis', 1])],
      dateien,
      stichtag: STICHTAG,
    })
    return ergebnis.anforderungen.filter(({ id }) => /^(vollmacht|betreuungsurkunde)/.test(id)).map(({ id, status }) => `${id}:${status}`)
  }

  it('asks for the certificate of the legal guardian, and for the power of attorney of the authorised person', async () => {
    assert.deepEqual(await lauf(mit170('002')), ['betreuungsurkunde#p-#1:belegt'])
    assert.deepEqual(await lauf(mit170('004')), ['vollmacht#p-#1:belegt'])
    assert.deepEqual(await lauf(mit170('001')), ['vollmacht#p-:entfaellt'])
  })

  it('reads the two-digit codes of version 1.6.1 the same way', async () => {
    assert.deepEqual(await lauf(mit161('02')), await lauf(mit170('002')))
    assert.deepEqual(await lauf(mit161('04')), await lauf(mit170('004')))
    assert.deepEqual(await lauf(mit161('01')), await lauf(mit170('001')))
  })
})

describe('Stichtag', () => {
  it('reads the date of an application in the forms applications write it', () => {
    const tag = (text: string) => datumAus(text)?.toISOString().slice(0, 10) ?? null
    assert.equal(tag('13.08.2026 09:09:46'), '2026-08-13')
    assert.equal(tag('1.2.2026'), '2026-02-01')
    assert.equal(tag('2026-08-13T09:09:46Z'), '2026-08-13')
    assert.equal(tag('31.02.2026'), null)
    assert.equal(tag('gestern'), null)
    assert.equal(tag(''), null)
  })

  it('measures from the date of the application unless told otherwise', async () => {
    const ergebnis = await ordneZu({ profil, antrag, dokumente: [], dateien })
    assert.equal(ergebnis.antrag.stichtag, '2026-08-13')
    assert.equal(ergebnis.antrag.stichtagAusAntrag, true)
    assert.equal((await pruefe([])).antrag.stichtag, '2026-04-15')
  })
})

describe('Ohne Dokumente', () => {
  it('leaves every stated fact open', async () => {
    const ergebnis = await pruefe([])
    assert.equal(ergebnis.zusammenfassung.belegt, 0)
    assert.equal(ergebnis.zusammenfassung.offen, 6)
    assert.deepEqual(ergebnis.nichtZugeordnet, [])
  })
})
