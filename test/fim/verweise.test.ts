import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { inSchemaVersion } from '../../src/engine/fim/abbildung.ts'
import { InstanceError, readInstance } from '../../src/engine/fim/instanz.ts'
import type { Schema, SchemaNode } from '../../src/engine/fim/schema.ts'
import { fimWurzel, schreibeVerweise } from '../../src/engine/fim/verweise.ts'
import { istFimOrt } from '../../src/engine/fim/zugang.ts'
import type { Ort } from '../../src/engine/fim/zugang.ts'
import { ladeProfil } from '../../src/engine/profil/laden.ts'
import { baueZiele } from '../../src/engine/zuordnung/ziele.ts'
import { fixture, leseText, lies, WOHNGELD } from '../hilfen/dateien.ts'
import { DOMParser, parseXml, XMLSerializer } from '../hilfen/xml.ts'

const profil = await ladeProfil(lies, WOHNGELD)
const dom = { DOMParser, XMLSerializer }

/** The places of the targets of an application, by slot. */
async function orteVon(xml: string): Promise<{ schema: Schema; ort: (slot: string) => Ort }> {
  const { instanz, schema } = await inSchemaVersion(readInstance(xml, { DOMParser }), profil)
  const ziele = baueZiele({ profil, schema, wurzel: instanz.root })
  return {
    schema,
    ort(slot) {
      const info = ziele.infos.get(slot)
      assert.ok(info)
      assert.ok(istFimOrt(info.ort))
      return info.ort
    },
  }
}

const lese = (xml: string): Element => parseXml(xml).documentElement
const kinder = (element: Element): Element[] => Array.from(element.childNodes).filter((knoten): knoten is Element => knoten.nodeType === 1)
const namen = (element: Element): string[] => kinder(element).map((kind) => kind.localName)
function finde(element: Element, ...pfad: string[]): Element | null {
  let aktuell: Element | undefined = element
  for (const schritt of pfad) {
    const [name, nummer = 1] = String(schritt).split('#')
    aktuell = kinder(aktuell).filter((kind) => kind.localName === name)[Number(nummer) - 1]
    if (!aktuell) return null
  }
  return aktuell
}
/** Like `finde`, for a place that has to be there. */
function muss(element: Element, ...pfad: string[]): Element {
  const gefunden = finde(element, ...pfad)
  assert.ok(gefunden)
  return gefunden
}
const texte = (element: Element, feld: string): string[] =>
  Array.from(element.getElementsByTagNameNS('*', feld)).map((knoten) => (knoten.textContent ?? '').trim())

/** A node of the schema as the test writes it: its name is its id unless the test names it. */
type Entwurf = Omit<SchemaNode, 'name' | 'kinder'> & { name?: string; kinder?: Entwurf[] }
const baue = ({ name, kinder, ...rest }: Entwurf): SchemaNode => ({ ...rest, name: name ?? rest.id, ...(kinder ? { kinder: kinder.map(baue) } : {}) })

/* A small schema: one group with a file field among its fields, an optional group that may hold a
 * reference alone, and one that may not (a mandatory field). `L1` is a label: no element. */
const ENTWURF: Entwurf[] = [
  {
    id: 'G1',
    anzahl: '1:1',
    kinder: [
      { id: 'F1', typ: 'text', anzahl: '1:1' },
      { id: 'L1', art: 'label', typ: 'text', anzahl: '1:1' },
      { id: 'FD', typ: 'file', anzahl: '0:*' },
      {
        id: 'G2',
        name: 'Zusatz',
        anzahl: '0:1',
        kinder: [
          { id: 'F2', typ: 'text', anzahl: '0:1' },
          { id: 'FD', typ: 'file', anzahl: '0:2' },
          { id: 'FX', typ: 'file', anzahl: '0:*' },
        ],
      },
      { id: 'G3', name: 'Details', anzahl: '0:1', kinder: [{ id: 'F3', typ: 'text', anzahl: '1:1' }, { id: 'FD', typ: 'file', anzahl: '0:*' }] },
      { id: 'F4', typ: 'text', anzahl: '0:1' },
    ],
  },
  { id: 'FE', typ: 'file', anzahl: '0:1' },
]
const SCHEMA: Schema = { schemaId: 'S00000000001', version: '1.0.0', name: 'Test', kinder: ENTWURF.map(baue) }
const INSTANZ = '<fim.S00000000001.00000000001001000 xmlns="urn:test"><G1><F1>eins</F1><F4>vier</F4></G1></fim.S00000000001.00000000001001000>'
const AN_G1: Ort = { feld: 'FD', gruppen: ['G1'], knoten: [0] }
const IN_G2: Ort = { feld: 'FD', gruppen: ['G1', 'G2'], knoten: [0] }
const IN_G3: Ort = { feld: 'FD', gruppen: ['G1', 'G3'], knoten: [0] }

describe('Verweise im Antrag: Ordnung nach dem Schema', () => {
  it('puts a reference where the schema wants it, behind earlier fields and before later ones', () => {
    const { xml, geschrieben } = schreibeVerweise({ xml: INSTANZ, schema: SCHEMA, verweise: [{ datei: 'a.pdf', ort: AN_G1 }], ...dom })
    const g1 = muss(lese(xml), 'G1')
    assert.deepEqual(namen(g1), ['F1', 'FD', 'F4'])
    assert.equal(finde(g1, 'FD')?.textContent, 'a.pdf')
    assert.deepEqual(geschrieben.map(({ stelle }) => stelle), ['/fim.S00000000001.00000000001001000/G1/FD'])
  })

  it('keeps several references at one place in the order they come', () => {
    const verweise = ['a.pdf', 'b.pdf', 'c.pdf'].map((datei) => ({ datei, ort: AN_G1 }))
    const { xml, geschrieben } = schreibeVerweise({ xml: INSTANZ, schema: SCHEMA, verweise, ...dom })
    assert.deepEqual(texte(lese(xml), 'FD'), ['a.pdf', 'b.pdf', 'c.pdf'])
    assert.equal(geschrieben.at(-1)?.stelle, '/fim.S00000000001.00000000001001000/G1/FD[3]')
  })

  it('opens a group the application does not have if a reference may stand in it alone', () => {
    const { xml, nichtGeschrieben } = schreibeVerweise({ xml: INSTANZ, schema: SCHEMA, verweise: [{ datei: 'z.pdf', ort: IN_G2 }, { datei: 'y.pdf', ort: IN_G2 }], ...dom })
    assert.deepEqual(nichtGeschrieben, [])
    const g1 = muss(lese(xml), 'G1')
    assert.deepEqual(namen(g1), ['F1', 'G2', 'F4'], 'one group for both references, at its place')
    assert.deepEqual(texte(muss(g1, 'G2'), 'FD'), ['z.pdf', 'y.pdf'])
  })

  it('opens a missing group once, also for references into different fields of it', () => {
    const verweise = [
      { datei: 'x.pdf', ort: { feld: 'FX', gruppen: ['G1', 'G2'], knoten: [0] }, bezeichnung: 'Heimvertrag' },
      { datei: 'd.pdf', ort: IN_G2, bezeichnung: 'Miete' },
    ]
    const { xml, geschrieben } = schreibeVerweise({ xml: INSTANZ, schema: SCHEMA, verweise, ...dom })
    const g1 = muss(lese(xml), 'G1')
    assert.deepEqual(namen(g1), ['F1', 'G2', 'F4'])
    assert.deepEqual(namen(muss(g1, 'G2')), ['FD', 'FX'], 'in the order of the schema, not of the references')
    assert.deepEqual(geschrieben.map(({ datei, bezeichnung }) => [datei, bezeichnung]), [['x.pdf', 'Heimvertrag'], ['d.pdf', 'Miete']])
  })

  it('opens no group whose mandatory fields the application leaves empty, and says why', () => {
    const { xml, geschrieben, nichtGeschrieben } = schreibeVerweise({ xml: INSTANZ, schema: SCHEMA, verweise: [{ datei: 'd.pdf', ort: IN_G3 }], ...dom })
    assert.deepEqual(geschrieben, [])
    assert.equal(nichtGeschrieben.length, 1)
    assert.match(nichtGeschrieben[0]?.grund ?? '', /„Details“.*keine gültige FIM-Instanz/)
    assert.equal(finde(lese(xml), 'G1', 'G3'), null)
  })

  it('writes no more references than the field may hold', () => {
    const verweise = ['a.pdf', 'b.pdf', 'c.pdf'].map((datei) => ({ datei, ort: IN_G2 }))
    const { xml, nichtGeschrieben } = schreibeVerweise({ xml: INSTANZ, schema: SCHEMA, verweise, ...dom })
    assert.deepEqual(texte(lese(xml), 'FD'), ['a.pdf', 'b.pdf'])
    assert.deepEqual(nichtGeschrieben.map(({ datei, grund }) => [datei, grund]), [['c.pdf', 'An dieser Stelle sind höchstens 2 Dateien vorgesehen.']])

    const einzeln = schreibeVerweise({ xml: INSTANZ, schema: SCHEMA, verweise: ['e.pdf', 'f.pdf'].map((datei) => ({ datei, ort: { feld: 'FE', gruppen: [], knoten: [] } })), ...dom })
    assert.deepEqual(texte(lese(einzeln.xml), 'FE'), ['e.pdf'])
    assert.equal(einzeln.nichtGeschrieben[0]?.grund, 'An dieser Stelle ist nur eine Datei vorgesehen.')
  })

  it('removes the references the application brought along, and a group that held nothing else', () => {
    const mitAltem = INSTANZ.replace('<F4>', '<G2><FD>alt-1.pdf</FD></G2><G3><F3>drei</F3><FD>alt-2.pdf</FD></G3><F4>')
    const { xml, entfernt } = schreibeVerweise({ xml: mitAltem, schema: SCHEMA, verweise: [], ...dom })
    const g1 = muss(lese(xml), 'G1')
    assert.deepEqual(namen(g1), ['F1', 'G3', 'F4'], 'the empty optional group is gone, the other keeps its field')
    assert.deepEqual(entfernt, [
      { feld: 'FD', wert: 'alt-1.pdf' },
      { feld: 'FD', wert: 'alt-2.pdf' },
    ])
  })

  it('finds a place by the positions the check saw, before anything is removed', () => {
    // The old reference stands before G2 and goes; the place of G2 is still found.
    const mitAltem = INSTANZ.replace('<F4>', '<FD>alt.pdf</FD><G2><F2>zwei</F2></G2><F4>')
    assert.deepEqual(namen(muss(lese(mitAltem), 'G1')), ['F1', 'FD', 'G2', 'F4'])
    const { xml } = schreibeVerweise({ xml: mitAltem, schema: SCHEMA, verweise: [{ datei: 'neu.pdf', ort: { feld: 'FD', gruppen: ['G1', 'G2'], knoten: [0, 2] } }], ...dom })
    assert.deepEqual(texte(muss(lese(xml), 'G1', 'G2'), 'FD'), ['neu.pdf'])
  })

  it('refuses a place whose positions name another group', () => {
    const { nichtGeschrieben } = schreibeVerweise({ xml: INSTANZ, schema: SCHEMA, verweise: [{ datei: 'a.pdf', ort: { feld: 'FD', gruppen: ['G1', 'G2'], knoten: [0, 1] } }], ...dom })
    assert.equal(nichtGeschrieben[0]?.grund, 'Die Stelle wurde im Antrag nicht gefunden.')
  })

  it('names new elements like their siblings and keeps the text of every field', () => {
    const mitPraefix = '<f:fim.S00000000001.00000000001001000 xmlns:f="urn:test"><f:G1><f:F1> eins &amp; mehr </f:F1><f:F4>vier</f:F4></f:G1></f:fim.S00000000001.00000000001001000>'
    const { xml } = schreibeVerweise({ xml: mitPraefix, schema: SCHEMA, verweise: [{ datei: 'a.pdf', ort: AN_G1 }], ...dom })
    assert.match(xml, /<f:FD>a\.pdf<\/f:FD>/)
    assert.match(xml, /<f:F1> eins &amp; mehr <\/f:F1>/)
    assert.equal(lese(xml).namespaceURI, 'urn:test')
  })

  it('refuses what is no FIM instance', () => {
    assert.throws(() => schreibeVerweise({ xml: '<html/>', schema: SCHEMA, verweise: [], ...dom }), InstanceError)
    assert.throws(() => schreibeVerweise({ xml: 'kein xml', schema: SCHEMA, verweise: [], ...dom }), InstanceError)
    assert.throws(() => schreibeVerweise({ xml: '<!DOCTYPE x><x/>', schema: SCHEMA, verweise: [], ...dom }), InstanceError)
  })
})

describe('Verweise im Antrag: echte Anträge', async () => {
  it('names the root of an instance as the XSD does', () => {
    assert.deepEqual(fimWurzel('S01000000123', '1.7.0'), {
      name: 'fim.S01000000123.01000000123001007',
      namensraum: 'urn:xoev-de:xfall:standard:fim-s01000000123_1.7.0',
    })
  })

  it('writes the references of the Berger example where the schema has them, and changes nothing else', async () => {
    const xml = await leseText('/beispiele/wohngeld/berger/antrag-berger-mietzuschuss.xml')
    const { schema, ort } = await orteVon(xml)
    const verweise = [
      { datei: 'mietvertrag-miriam-berger.pdf', ort: ort('miete#p-#1') },
      { datei: 'kontoauszug-miriam-berger.pdf', ort: ort('miete#p-#1') },
      { datei: 'lohn-gehaltsabrechnung-miriam-berger.pdf', ort: ort('einnahmen#p0#1') },
      { datei: 'arbeitslosengeld-i-bescheid-daniel-berger.pdf', ort: ort('einnahmen#p1#1') },
      { datei: 'schwerbehindertenausweis-daniel-berger.pdf', ort: ort('schwerbehinderung#p1#1') },
    ]
    const ergebnis = schreibeVerweise({ xml, schema, verweise, ...dom })
    assert.deepEqual(ergebnis.nichtGeschrieben, [])

    const wurzel = lese(ergebnis.xml)
    const miete = muss(wurzel, 'G01000001396', 'G01000001422')
    assert.deepEqual(namen(miete), ['F00000000240', 'G00000000320', 'F00000000567', 'F00000000567', 'G01000001414', 'G01000001421'])
    assert.deepEqual(texte(miete, 'F00000000567'), ['mietvertrag-miriam-berger.pdf', 'kontoauszug-miriam-berger.pdf'])

    const daniel = muss(wurzel, 'G01000001217', 'G01000001218#1')
    const einnahme = muss(daniel, 'G01000001394', 'G01000001393', 'G01000001392')
    assert.deepEqual(namen(einnahme), ['F00000000574', 'G00000001093', 'G00000000333', 'F60000000296', 'G00000001482', 'G01000001398'])
    assert.equal(finde(einnahme, 'F60000000296')?.textContent, 'arbeitslosengeld-i-bescheid-daniel-berger.pdf')
    assert.equal(
      ergebnis.geschrieben.find(({ datei }) => datei.startsWith('schwer'))?.stelle,
      '/fim.S01000000123.01000000123001007/G01000001217/G01000001218[1]/G01000001401/G01000001441/F60000000296',
    )

    // Apart from the references the two instances are the same, field by field.
    const ohneVerweise = (text: string): string[] => text.split('\n').map((zeile) => zeile.trim()).filter((zeile) => zeile && !/<(F00000000567|F60000000296)>/.test(zeile))
    assert.deepEqual(ohneVerweise(ergebnis.xml), ohneVerweise(xml))
  })

  it('replaces the references of an application by those of the package', async () => {
    const xml = await fixture('antrag-mietzuschuss-1.7.0.xml')
    const { schema, ort } = await orteVon(xml)
    const ergebnis = schreibeVerweise({ xml, schema, verweise: [{ datei: 'verdienst-albert.pdf', ort: ort('einnahmen#p1#1') }], ...dom })
    assert.deepEqual(
      ergebnis.entfernt.map(({ wert }) => wert),
      ['vermogens-kapitalertragsnachweis-svenja-einstein.pdf', 'verdienstbescheinigung-des-arbeitgebers-albert-einstein.pdf'],
    )
    assert.deepEqual(texte(lese(ergebnis.xml), 'F60000000296'), ['verdienst-albert.pdf'])
  })

  it('writes an application of the older version in its own version, with its own ids', async () => {
    const xml = await fixture('antrag-mietzuschuss-1.6.1.xml')
    const { schema, ort } = await orteVon(xml)
    const abbildung = await profil.ladeAbbildung('S01000000123', '1.6.1')
    const ergebnis = schreibeVerweise({ xml, schema, abbildung, verweise: [{ datei: 'verdienst-albert.pdf', ort: ort('einnahmen#p1#1') }], ...dom })

    assert.equal(lese(ergebnis.xml).localName, 'fim.S01000000123.01000000123001006')
    assert.deepEqual(texte(lese(ergebnis.xml), 'F60000000296'), [])
    assert.deepEqual(texte(lese(ergebnis.xml), 'F00000000600'), ['verdienst-albert.pdf'])
    assert.match(ergebnis.geschrieben[0]?.stelle ?? '', /\/G01000001251\/G01000001252\/G00000001481\/G00000000330\/G00000000332\/F00000000600$/)
  })

  it('turns the export of the LeistungsLotse application into the plain FIM instance', async () => {
    const fim = await fixture('antrag-mietzuschuss-1.7.0.xml')
    const inhalt = fim.slice(fim.indexOf('>', fim.indexOf('<fim.')) + 1, fim.lastIndexOf('</fim.'))
    const export_ = `<myForm><nachweise><F123 id="a">lohn.pdf</F123></nachweise><antragsdaten xmlns="urn:leistungslotse:fim-export:antragsdaten:1.0" schemaID="S01000000123" schemaVersion="1.7.0">${inhalt}</antragsdaten></myForm>`
    const { schema, ort } = await orteVon(export_)
    const ergebnis = schreibeVerweise({ xml: export_, schema, verweise: [{ datei: 'mietvertrag.pdf', ort: ort('miete#p-#1') }], ...dom })

    const wurzel = lese(ergebnis.xml)
    assert.equal(wurzel.localName, 'fim.S01000000123.01000000123001007')
    assert.equal(wurzel.namespaceURI, 'urn:xoev-de:xfall:standard:fim-s01000000123_1.7.0')
    assert.equal(finde(wurzel, 'G01000001396', 'G01000001422', 'F00000000567')?.textContent, 'mietvertrag.pdf')
    assert.equal(finde(wurzel, 'G01000001396', 'G01000001422', 'F00000000567')?.namespaceURI, wurzel.namespaceURI)
    assert.doesNotMatch(ergebnis.xml, /myForm|antragsdaten|nachweise/)
  })
})
