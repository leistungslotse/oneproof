import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { inSchemaVersion } from '../../src/engine/fim/abbildung.ts'
import { InstanceError, readInstance } from '../../src/engine/fim/instanz.ts'
import { ladeProfil } from '../../src/engine/profil/laden.ts'
import { alsCent, baueZiele } from '../../src/engine/zuordnung/ziele.ts'
import type { Zielableitung } from '../../src/engine/zuordnung/ziele.ts'
import { fixture, lies, WOHNGELD } from '../hilfen/dateien.ts'
import { DOMParser } from '../hilfen/xml.ts'

const profil = await ladeProfil(lies, WOHNGELD)

async function ziele(xml: string): Promise<Zielableitung> {
  const gelesen = readInstance(xml, { DOMParser })
  const { instanz, schema } = await inSchemaVersion(gelesen, profil)
  return baueZiele({ profil, schema, wurzel: instanz.root })
}

const benannt = (ergebnis: Zielableitung): string[] => [...ergebnis.infos.values()].filter((info) => info.benannt).map((info) => info.slot)

describe('Ziele des Beispielantrags (Mietzuschuss, Einstein)', async () => {
  // The same application in the version it was exported in and in the current one.
  const alt = await ziele(await fixture('antrag-mietzuschuss-1.6.1.xml'))
  const neu = await ziele(await fixture('antrag-mietzuschuss-1.7.0.xml'))

  it('reads the persons of the household in application order', () => {
    assert.deepEqual(neu.personen, ['Svenja Einstein', 'Albert Einstein'])
  })

  it('gives the same targets for the old and the new version of the application', () => {
    assert.deepEqual(alt.ziele, neu.ziele)
    assert.deepEqual(alt.entfaellt, neu.entfaellt)
  })

  it('names exactly the facts the application states', () => {
    assert.deepEqual(benannt(neu), [
      'miete#p-#1',
      'einnahmen#p0#1',
      'einnahmen#p1#1',
      'werbungskosten#p0#1',
      'werbungskosten#p1#1',
      'vermoegen#p0#1',
    ])
  })

  it('tells the two income rows apart by person, kind and amount', () => {
    const merkmale = (slot: string) => {
      const ziel = neu.ziele.find((kandidat) => kandidat.slot === slot)
      assert.ok(ziel)
      return ziel.merkmale
    }
    // `nebenperson: '-'`: a fact of the household, no evidence for it in the name of an outsider.
    assert.deepEqual(merkmale('einnahmen#p0#1'), { income_type: 'salary', betrag: '178900', nebenperson: '-' })
    assert.deepEqual(merkmale('einnahmen#p1#1'), { income_type: 'salary', betrag: '47700', nebenperson: '-' })
  })

  it('reads the names in their parts, with the birth name where the application has one', () => {
    assert.deepEqual(
      neu.namensteile.map((teile) => `${teile?.vorname}|${teile?.nachname}`),
      ['Svenja|Einstein', 'Albert|Einstein'],
    )
  })

  it('describes the situation of the applicant for the grouping model', () => {
    assert.ok(neu.antragslage.some((satz) => satz.startsWith('Mietverhältnis der antragstellenden Person: Hauptmieter')))
    assert.ok(!neu.antragslage.some((satz) => satz.includes('{')), 'no sentence with an empty placeholder')
  })

  it('describes what the application says in words', () => {
    const aussage = (slot: string) => neu.infos.get(slot)?.aussage?.replaceAll(/\s/g, ' ')
    assert.equal(aussage('miete#p-#1'), 'Gesamtmiete 950,00 € im Monat')
    assert.equal(aussage('einnahmen#p0#1'), 'Lohn / Gehalt: 1.789,00 € (monatlich)')
  })

  it('offers a catch-all where the application does not state a fact', () => {
    const schwerbehinderung = neu.ziele.filter((ziel) => ziel.art === 'schwerbehinderung')
    assert.deepEqual(schwerbehinderung.map((ziel) => [ziel.person, ziel.opensSection]), [
      [0, true],
      [1, true],
    ])
  })

  it('offers a catch-all for the representation although the application has no such section', () => {
    const vollmacht = neu.ziele.find((ziel) => ziel.art === 'vollmacht')
    assert.ok(vollmacht)
    assert.equal(vollmacht.opensSection, true)
    assert.equal(vollmacht.person, null)
  })

  it('records the questions the applicant answered with "no" as not required', () => {
    const kennungen = neu.entfaellt.map((eintrag) => eintrag.id)
    assert.ok(kennungen.includes('transferleistung#p0'))
    assert.ok(kennungen.includes('transferleistung#p1'))
    assert.ok(kennungen.includes('sterbefall#p-'))
    assert.ok(kennungen.includes('mitbewohner#p-'))
    assert.equal(new Set(kennungen).size, kennungen.length, 'one note per statement and person')
    const eintrag = neu.entfaellt.find((kandidat) => kandidat.id === 'unterhalt#p0')
    assert.ok(eintrag)
    assert.equal(eintrag.antwort, 'Nein')
    assert.match(eintrag.frage, /Unterhalt/)
  })

  it('creates no place for a section of a person who does not have it', () => {
    // Albert has no childcare section in the application — there is nothing to attach to.
    assert.equal(neu.ziele.filter((ziel) => ziel.art === 'kinderbetreuung' && ziel.person === 1).length, 0)
  })

  it('gives every target a unique slot', () => {
    const slots = neu.ziele.map((ziel) => ziel.slot)
    assert.equal(new Set(slots).size, slots.length)
  })

  it('states a rent change only where the application mentions one', () => {
    assert.equal(neu.ziele.some((ziel) => ziel.art === 'mietveraenderung'), false)
  })
})

describe('Antragsdaten lesen', () => {
  it('refuses an application of a schema the profile does not cover', async () => {
    const xml = (await fixture('antrag-mietzuschuss-1.7.0.xml')).replaceAll('S01000000123', 'S01000000199')
    await assert.rejects(() => ziele(xml), (fehler: unknown) => fehler instanceof InstanceError && /S01000000199/.test(fehler.message))
  })

  it('refuses a version it has no dictionary for', async () => {
    const xml = (await fixture('antrag-mietzuschuss-1.6.1.xml')).replaceAll('_1.6.1', '_1.5.0')
    await assert.rejects(() => ziele(xml), (fehler: unknown) => fehler instanceof InstanceError && /1\.5\.0/.test(fehler.message))
  })

  it('refuses a document with a document type declaration', () => {
    const xml = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><fim.S01000000123.x xmlns="urn:x_1.7.0"/>'
    assert.throws(() => readInstance(xml, { DOMParser }), InstanceError)
  })

  it('refuses text that is no XML', () => {
    assert.throws(() => readInstance('kein xml', { DOMParser }), InstanceError)
    assert.throws(() => readInstance('', { DOMParser }), InstanceError)
  })

  it('reads the export of the LeistungsLotse application with its announced files', () => {
    const xml = `<myForm><nachweise><F123 id="a" content-type="application/pdf" length="42" original-name="lohn.pdf">lohn.pdf</F123></nachweise>
      <antragsdaten xmlns="urn:leistungslotse:fim-export:antragsdaten:1.0" schemaID="S01000000123" schemaVersion="1.6.1"><G01000001247/></antragsdaten></myForm>`
    const gelesen = readInstance(xml, { DOMParser })
    assert.equal(gelesen.format, 'leistungslotse-export')
    assert.equal(gelesen.schemaId, 'S01000000123')
    assert.equal(gelesen.version, '1.6.1')
    assert.deepEqual(gelesen.anhaenge, [{ id: 'a', name: 'lohn.pdf', contentType: 'application/pdf', length: 42 }])
  })
})

describe('Beträge', () => {
  it('keeps amounts comparable as cents', () => {
    assert.equal(alsCent('1789.00'), '178900')
    assert.equal(alsCent('950,5'), '95050')
    assert.equal(alsCent('abc'), null)
  })
})
