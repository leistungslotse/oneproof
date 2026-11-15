import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readInstance } from '../../src/engine/fim/instanz.ts'
import type { Schema } from '../../src/engine/fim/schema.ts'
import { STATUS, uebersetze } from '../../src/engine/profil/bedingungen.ts'
import type { Bedingung, ProfilFormat2, StelleFormat2 } from '../../src/engine/profil/bedingungen.ts'
import { liesMitProfil } from '../../src/engine/profil/entwurf.ts'
import { ladeProfil } from '../../src/engine/profil/laden.ts'
import type { ProfilFormat1 } from '../../src/engine/profil/laden.ts'
import { ausFormat1 } from '../../src/engine/profil/umstellung.ts'
import { validiereProfil } from '../../src/engine/profil/validieren.ts'
import type { NichtZugeordnet } from '../../src/engine/zuordnung/anforderungen.ts'
import { bereiteAntragVor, ordneZu } from '../../src/engine/zuordnung/index.ts'
import type { Zuordnung } from '../../src/engine/zuordnung/index.ts'
import { fixture, leseText, lies, WOHNGELD } from '../hilfen/dateien.ts'
import { DOMParser } from '../hilfen/xml.ts'

const format1 = await ladeProfil(lies, WOHNGELD)
const roh1 = await lies<ProfilFormat1>(`${WOHNGELD}profil.json`)
const schemas = new Map(
  await Promise.all(
    roh1.antragsarten.map(async (art): Promise<[string, Schema]> => [art.schema, await lies<Schema>(`${WOHNGELD}${art.datei}`)]),
  ),
)
const roh2 = ausFormat1(roh1, { schemas, typen: format1.typen })
const format2 = await ladeProfil(liesMitProfil(lies, WOHNGELD, roh2), WOHNGELD)

const ANTRAEGE = {
  berger: () => leseText('/beispiele/wohngeld/berger/antrag-berger-mietzuschuss.xml'),
  schmidt: () => leseText('/beispiele/wohngeld/schmidt/antrag-schmidt-lastenzuschuss.xml'),
  yilmaz: () => leseText('/beispiele/wohngeld/yilmaz/antrag-yilmaz-weiterleistung.xml'),
  einstein: () => leseText('/beispiele/wohngeld/antrag-einstein-wohngeld-1.7.0.xml'),
  'mietzuschuss 1.6.1': () => fixture('antrag-mietzuschuss-1.6.1.xml'),
}

/** The result without the names the engine gives its statements: format 2 prefixes them with the application type. */
const vergleichbar = ({ plan: { rejections: _abgelehnt, ...plan }, ...ergebnis }: Zuordnung): unknown =>
  JSON.parse(
    JSON.stringify({ ...ergebnis, plan }, (schluessel, inhalt) =>
      schluessel === 'art' ? undefined : typeof inhalt === 'string' ? inhalt.replace(/S\d{11}:/g, '') : inhalt,
    ),
  )

/**
 * The one intended difference: format 2 knows the evidence of each application type on its own. A
 * document none of its conditions lists is one the application does not provide for — format 1
 * only said it found no place for it.
 */
function wieFormat2(ergebnis: Zuordnung, schema: string): Zuordnung {
  const verwendungen = format2.verwendungenFuer(schema)
  const nichtVorgesehen = ({ typ, typLabel }: NichtZugeordnet): boolean =>
    typLabel !== 'Nicht erkannt' && (verwendungen.get(typ) ?? []).length === 0
  return {
    ...ergebnis,
    nichtZugeordnet: ergebnis.nichtZugeordnet.map((eintrag) =>
      nichtVorgesehen(eintrag) ? { ...eintrag, grund: 'Für diesen Antrag ist kein Nachweis dieser Art vorgesehen.' } : eintrag,
    ),
  }
}

/** The first path at which two plain values differ, or null: quicker and shorter than a diff of the whole. */
function ersterUnterschied(a: unknown, b: unknown, pfad = ''): string | null {
  if (JSON.stringify(a) === JSON.stringify(b)) return null
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const schluessel of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const unterschied = ersterUnterschied(Reflect.get(a, schluessel), Reflect.get(b, schluessel), `${pfad}.${schluessel}`)
      if (unterschied) return unterschied
    }
  }
  return `${pfad}: ${JSON.stringify(a)?.slice(0, 300)} statt ${JSON.stringify(b)?.slice(0, 300)}`
}

describe('Profilformat 2: Umstellung des Wohngeld-Profils', () => {
  it('turns every place of every application type into a decided condition', () => {
    assert.equal(roh2.format, 2)
    assert.equal(roh2.antragsarten.length, 6)
    for (const antragsart of roh2.antragsarten) {
      for (const stelle of antragsart.stellen) {
        if (stelle.ohne) continue
        assert.equal(stelle.bedingungen.length, 1)
        assert.equal(stelle.bedingungen[0]?.status, STATUS.FESTGELEGT, `${antragsart.schema} ${stelle.id}`)
      }
    }
  })

  it('writes the uses of the profile out, features included', () => {
    const mietzuschuss = roh2.antragsarten.find(({ schema }) => schema === 'S01000000123')
    assert.ok(mietzuschuss)
    const einnahmen = mietzuschuss.stellen.find(({ id }) => id === 'einnahmen')?.bedingungen[0]
    assert.ok(einnahmen)
    assert.deepEqual(einnahmen.nachweise.payslip, { rolle: 'genuegt', merkmale: { income_type: 'salary' } })
    assert.equal(einnahmen.nachweise.bank_statement, 'ergaenzt')
    assert.equal(einnahmen.zeitraum?.mindestens, 3)
  })

  it('keeps the link to the coarser statement as a link to its condition', () => {
    const lastenzuschuss = roh2.antragsarten.find(({ schema }) => schema === 'S01000000126')
    assert.ok(lastenzuschuss)
    const fremdmittel = lastenzuschuss.stellen.find(({ id }) => id === 'fremdmittel')?.bedingungen[0]
    assert.ok(fremdmittel)
    assert.deepEqual(fremdmittel.nachweise.loan_contract, { rolle: 'genuegt', ersatzweise: { bedingung: 'belastung', rolle: 'ergaenzt' } })
  })

  it('keeps the places that knowingly ask for nothing, with the reason', () => {
    const mietzuschuss = roh2.antragsarten.find(({ schema }) => schema === 'S01000000123')
    assert.ok(mietzuschuss)
    assert.match(mietzuschuss.stellen.find(({ position }) => position === '/F01000002054')?.ohne ?? '', /Upload OD/)
  })

  it('is consistent with its schemas and the catalogue', async () => {
    const { fehler, warnungen } = await validiereProfil(format2)
    assert.deepEqual(fehler, [])
    assert.deepEqual(warnungen, [])
  })

  for (const [name, lesen] of Object.entries(ANTRAEGE)) {
    it(`decides the application „${name}“ exactly as format 1 does`, async () => {
      const antrag = readInstance(await lesen(), { DOMParser })
      const { ziele } = await bereiteAntragVor({ profil: format1, antrag })
      const personen = ziele.personen.filter((person): person is string => Boolean(person))

      // Every type of the catalogue once for every person, and once for nobody.
      const dokumente = [...format1.typen.keys()].flatMap((typ) =>
        [...personen, ''].map((person, index) => ({ type: typ, label: typ, person, pages: [{ fileId: `${typ}-${index}`, page: 1 }] })),
      )
      const stichtag = new Date('2026-09-15T12:00:00')

      const erwartet = await ordneZu({ profil: format1, antrag, dokumente, stichtag })
      const ergebnis = await ordneZu({ profil: format2, antrag, dokumente, stichtag })
      assert.ok(erwartet.anforderungen.length > 10)
      assert.equal(ersterUnterschied(vergleichbar(ergebnis), vergleichbar(wieFormat2(erwartet, ergebnis.antrag.schema))), null)
    })
  }
})

describe('Profilformat 2: Übersetzung für die Engine', () => {
  /** A place as these tests write it: without what the translation does not read (`bereich`, `herkunft`). */
  type Teilstelle = Omit<StelleFormat2, 'bereich' | 'herkunft'>

  const profil = (stellen: Teilstelle[]): ProfilFormat2 => ({
    format: 2,
    id: 'test',
    version: '1',
    name: 'Test',
    dokumenttypen: 'dokumenttypen.json',
    antragsarten: [
      {
        schema: 'S1',
        version: '1',
        name: 'Test',
        datei: 'S1.json',
        stellen: stellen.map((stelle): StelleFormat2 => ({ bereich: 'Bereich', herkunft: { art: 'immer' }, ...stelle })),
      },
    ],
  })
  const bedingung = (id: string, nachweise: Bedingung['nachweise'], mehr: Partial<Bedingung> = {}): Bedingung => ({
    id,
    status: STATUS.FESTGELEGT,
    nachweise,
    ...mehr,
  })

  it('makes one statement per condition and binds the place to its application type', () => {
    const { nachweisarten, stellen } = uebersetze(profil([{ id: 'a', position: 'G1/F1', titel: 'A', bedingungen: [bedingung('a', { x: 'genuegt' })] }]))
    assert.deepEqual(Object.keys(nachweisarten), ['S1:a'])
    assert.deepEqual(stellen[0]?.antragsarten, ['S1'])
    assert.equal(stellen[0]?.art, 'S1:a')
  })

  it('lets conditions share a statement only where they say so and are set the same', () => {
    const { stellen } = uebersetze(
      profil([
        { id: 'a', position: 'G1/F1', titel: 'A', bedingungen: [bedingung('a', { x: 'genuegt' }, { art: 'miete' })] },
        { id: 'b', position: 'G1/F2', titel: 'B', bedingungen: [bedingung('b', { x: 'genuegt' }, { art: 'miete' })] },
        { id: 'c', position: 'G1/F3', titel: 'C', bedingungen: [bedingung('c', { x: 'pruefen' }, { art: 'miete' })] },
        { id: 'd', position: 'G1/F4', titel: 'D', bedingungen: [bedingung('d', { x: 'genuegt' })] },
      ]),
    )
    assert.deepEqual(
      stellen.map(({ art }) => art),
      ['S1:miete', 'S1:miete', 'S1:miete~2', 'S1:d'],
    )
  })

  it('asks for nothing where a condition accepts no document, or the place knowingly has none', () => {
    const { stellen, bekanntOffen } = uebersetze(
      profil([
        { id: 'a', position: 'G1/F1', titel: 'A', bedingungen: [bedingung('a', {})] },
        { id: 'b', position: 'G1/F2', titel: 'B', ohne: 'Der Antrag selbst', bedingungen: [] },
      ]),
    )
    assert.deepEqual(stellen, [])
    assert.deepEqual(bekanntOffen, { 'G1/F2': 'Der Antrag selbst' })
  })

  it('reads a place told apart by an answer as one place per condition', () => {
    const { stellen } = uebersetze(
      profil([
        {
          id: 'e',
          position: 'G1/F1',
          titel: 'Einkommen',
          unterscheiden: 'F9',
          bedingungen: [
            bedingung('e:001', { pension_notice: 'genuegt' }, { titel: 'Rente', wenn: { feld: 'F9', ja: ['001'] } }),
            bedingung('e:002', { payslip: 'genuegt' }, { titel: 'Lohn', wenn: { feld: 'F9', ja: ['002'] } }),
          ],
        },
      ]),
    )
    assert.deepEqual(
      stellen.map(({ id, titel, nennt, nurFrage }) => ({ id, titel, nennt, nurFrage })),
      [
        { id: 'e:001', titel: 'Einkommen: Rente', nennt: { feld: 'F9', ja: ['001'] }, nurFrage: true },
        { id: 'e:002', titel: 'Einkommen: Lohn', nennt: { feld: 'F9', ja: ['002'] }, nurFrage: true },
      ],
    )
  })

  it('gives a document a condition does not list no use there: the catalogue only proposes', async () => {
    const ohne = structuredClone(roh2)
    for (const antragsart of ohne.antragsarten) {
      for (const stelle of antragsart.stellen) for (const eintrag of stelle.bedingungen) delete eintrag.nachweise.disability_notice
    }
    const profil = await ladeProfil(liesMitProfil(lies, WOHNGELD, ohne), WOHNGELD)
    assert.deepEqual(profil.verwendungen.get('disability_notice'), [])
    assert.equal(format2.verwendungen.get('disability_notice')?.length, 6)
  })
})
