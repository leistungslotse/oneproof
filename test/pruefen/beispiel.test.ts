import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Json } from '../../src/engine/json.ts'
import { ladeBeispielBeschreibung, ladeBeispielDateien } from '../../src/pruefen/beispiel.ts'
import type { BeispielHolen } from '../../src/pruefen/beispiel.ts'

const ORDNER = '/beispiele/'

/** A site that serves these files, and remembers what was asked for. */
function seite(dateien: Record<string, Json | Uint8Array<ArrayBuffer>>): { holen: BeispielHolen; gefragt: string[] } {
  const gefragt: string[] = []
  const holen: BeispielHolen = async (adresse) => {
    gefragt.push(adresse)
    const pfad = decodeURIComponent(adresse.slice(ORDNER.length))
    if (!Object.hasOwn(dateien, pfad)) return new Response('nicht da', { status: 404 })
    const inhalt = dateien[pfad]
    return typeof inhalt === 'string' || inhalt instanceof Uint8Array
      ? new Response(inhalt)
      : new Response(JSON.stringify(inhalt), { headers: { 'content-type': 'application/json' } })
  }
  return { holen, gefragt }
}

describe('Beispielfälle', () => {
  it('reads a catalogue of several cases, with paths into subfolders', async () => {
    const { holen } = seite({
      'wohngeld/index.json': {
        beispiele: [
          { id: 'einfach', titel: 'Einfacher Fall', beschreibung: 'Vier Nachweise.', antrag: 'a.xml', nachweise: ['b.pdf'] },
          { id: 'berger', titel: 'Familie Berger', antrag: 'berger/antrag.xml', nachweise: ['berger/scan.pdf', 'berger/foto.jpg'] },
        ],
      },
    })
    const katalog = await ladeBeispielBeschreibung('wohngeld', { holen, ordner: ORDNER })
    assert.ok(katalog)
    assert.deepEqual(
      katalog.beispiele.map(({ id, titel, beschreibung, antrag }) => [id, titel, beschreibung, antrag]),
      [
        ['einfach', 'Einfacher Fall', 'Vier Nachweise.', 'a.xml'],
        ['berger', 'Familie Berger', '', 'berger/antrag.xml'],
      ],
    )
  })

  it('reads the older form with one case as a catalogue of one', async () => {
    const { holen } = seite({ 'wohngeld/index.json': { beschreibung: 'Erfunden.', antrag: 'a.xml', nachweise: ['b.pdf'] } })
    const katalog = await ladeBeispielBeschreibung('wohngeld', { holen, ordner: ORDNER })
    assert.ok(katalog)
    assert.deepEqual(katalog.beispiele, [{ id: 'beispiel-1', titel: 'Beispielfall', beschreibung: 'Erfunden.', antrag: 'a.xml', nachweise: ['b.pdf'] }])
  })

  it('leaves out a case whose paths lead out of the folder, and has none without cases', async () => {
    const { holen } = seite({
      'wohngeld/index.json': { beispiele: [{ antrag: '../geheim.xml', nachweise: [] }, { antrag: 'a.xml', nachweise: ['x//y.pdf'] }] },
    })
    assert.equal(await ladeBeispielBeschreibung('wohngeld', { holen, ordner: ORDNER }), null)
    assert.equal(await ladeBeispielBeschreibung('anderes', { holen, ordner: ORDNER }), null)
  })

  it('loads the files of a case, each part of the path encoded, named after the last part', async () => {
    const { holen, gefragt } = seite({
      'wohngeld/berger/antrag berger.xml': '<antrag/>',
      'wohngeld/berger/Scan Unterlagen.pdf': new Uint8Array([0x25, 0x50]),
      'wohngeld/berger/foto ausweis.JPG': new Uint8Array([0xff, 0xd8]),
    })
    const { antrag, nachweise } = await ladeBeispielDateien(
      'wohngeld',
      { antrag: 'berger/antrag berger.xml', nachweise: ['berger/Scan Unterlagen.pdf', 'berger/foto ausweis.JPG'] },
      { holen, ordner: ORDNER },
    )
    assert.deepEqual(gefragt, [
      '/beispiele/wohngeld/berger/antrag%20berger.xml',
      '/beispiele/wohngeld/berger/Scan%20Unterlagen.pdf',
      '/beispiele/wohngeld/berger/foto%20ausweis.JPG',
    ])
    assert.equal(antrag.name, 'antrag berger.xml')
    assert.equal(antrag.type, 'application/xml')
    assert.deepEqual(nachweise.map(({ name, type }) => [name, type]), [
      ['Scan Unterlagen.pdf', 'application/pdf'],
      ['foto ausweis.JPG', 'image/jpeg'],
    ])
  })

  it('says which file is missing', async () => {
    const { holen } = seite({ 'wohngeld/a.xml': '<antrag/>' })
    await assert.rejects(
      ladeBeispielDateien('wohngeld', { antrag: 'a.xml', nachweise: ['berger/fehlt.pdf'] }, { holen, ordner: ORDNER }),
      /„fehlt\.pdf“ konnte nicht geladen werden/,
    )
  })
})
