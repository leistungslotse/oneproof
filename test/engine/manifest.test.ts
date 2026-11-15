import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { baueManifest, AUSLOESER } from '../../src/engine/manifest.ts'
import type { FruehePruefung, Manifest, ManifestEintrag } from '../../src/engine/manifest.ts'
import { pruefe } from '../../src/engine/pipeline.ts'
import { ladeProfil } from '../../src/engine/profil/laden.ts'
import { fixture, lies, WOHNGELD } from '../hilfen/dateien.ts'
import { datei, falscheKi, oeffne } from '../hilfen/falsche-ki.ts'
import { DOMParser } from '../hilfen/xml.ts'

const profil = await ladeProfil(lies, WOHNGELD)
const antragXml = await fixture('antrag-mietzuschuss-1.7.0.xml')

const ergebnis = await pruefe({
  profil,
  antragXml,
  DOMParser,
  oeffne,
  ki: falscheKi({
    regeln: [
      { muster: /Mietvertrag/, typ: 'rent_contract' },
      { muster: /Verdienstbescheinigung.*Albert/s, typ: 'income_certificate', person: 'Einstein, Albert' },
    ],
  }),
  nachweise: [
    datei('mietvertrag.pdf', ['Mietvertrag über die Wohnung', 'Unterschriften zum Mietvertrag'], { hash: 'aa11' }),
    datei('verdienst.pdf', ['Verdienstbescheinigung für Albert Einstein'], { hash: 'bb22' }),
  ],
})

const manifest = baueManifest(ergebnis, { fallId: 'f_test1', aktenzeichen: 'WG-2026-00001' })
const eintragIn = (von: Manifest, id: string): ManifestEintrag => {
  const gefunden = von.eintraege.find((kandidat) => kandidat.anforderungId === id)
  assert.ok(gefunden, `${id} is in the manifest`)
  return gefunden
}
const eintrag = (id: string): ManifestEintrag => eintragIn(manifest, id)

describe('Manifest', () => {
  it('names case, profile version and creation time', () => {
    assert.equal(manifest.fallId, 'f_test1')
    assert.equal(manifest.aktenzeichen, 'WG-2026-00001')
    assert.equal(manifest.leistung, 'wohngeld')
    assert.equal(manifest.profilVersion, 'wohngeld@2026-11-07')
    assert.match(manifest.profilVersion, /^[a-z0-9-]+@\d{4}-\d{2}-\d{2}$/)
    assert.equal(manifest.erstelltAm, ergebnis.erstelltAm)
  })

  it('leaves out case id and file number if there are none', () => {
    const ohne = baueManifest(ergebnis)
    assert.equal('fallId' in ohne, false)
    assert.equal('aktenzeichen' in ohne, false)
  })

  it('counts like the check does', () => {
    const { belegt, offen, unklar } = ergebnis.zusammenfassung
    assert.deepEqual(manifest.zusammenfassung, { belegt, offen, unklar })
    assert.equal(manifest.eintraege.length, belegt + offen + unklar)
  })

  it('lists only what has to be proven: no requirement the application rules out', () => {
    assert.ok(ergebnis.zusammenfassung.entfaellt > 0, 'the example has requirements that do not apply')
    assert.equal(
      manifest.eintraege.some(({ status }) => status === 'entfaellt'),
      false,
    )
    assert.deepEqual(
      manifest.eintraege.map(({ anforderungId }) => anforderungId),
      ergebnis.anforderungen.filter(({ status }) => status !== 'entfaellt').map(({ id }) => id),
    )
  })

  it('ties a proven requirement to its source, with hash and place', () => {
    const miete = eintrag('miete#p-#1')
    assert.equal(miete.status, 'belegt')
    assert.equal(miete.tatsache, 'Höhe der Miete: Gesamtmiete 950,00 € im Monat')
    assert.deepEqual(miete.beleg, {
      art: 'dokument',
      nachweistyp: 'Mietvertrag',
      quelle: 'mietvertrag.pdf',
      mimeType: 'application/pdf',
      hash: 'sha512-aa11',
      fundstelle: 'Seiten 1–2 von 2',
    })
    assert.deepEqual(miete.belege, [miete.beleg])
  })

  it('names the person of a requirement', () => {
    const albert = eintrag('einnahmen#p1#1')
    assert.deepEqual(albert.personen, ['Albert Einstein'])
    assert.match(albert.tatsache, /^Einkommen – Albert Einstein: /)
    assert.equal(albert.beleg?.fundstelle, 'Seite 1 von 1')
  })

  it('gives an open requirement a hint and no source', () => {
    const offen = eintrag('werbungskosten#p0#1')
    assert.equal(offen.status, 'offen')
    assert.ok(offen.hinweis)
    assert.match(offen.hinweis, /Fahrtkosten/)
    assert.equal('beleg' in offen, false)
    assert.equal('belege' in offen, false)
  })

  it('names the file of the package a source is delivered in, where there is a package', () => {
    const miete = ergebnis.anforderungen.find(({ id }) => id === 'miete#p-#1')
    assert.ok(miete)
    const [erster] = miete.belege
    assert.ok(erster)
    const mitPaket = baueManifest(ergebnis, { paketDateien: new Map([[erster.dokument, 'mietvertrag-wohnung.pdf']]) })
    const beleg = eintragIn(mitPaket, 'miete#p-#1').beleg
    assert.ok(beleg)
    assert.equal(beleg.datei, 'mietvertrag-wohnung.pdf')
    assert.equal(beleg.quelle, 'mietvertrag.pdf', 'the source stays the upload the pages come from')
    const ohnePaket = eintrag('miete#p-#1').beleg
    assert.ok(ohnePaket)
    assert.equal('datei' in ohnePaket, false)
  })

  it('keeps a history entry with the trigger for every requirement', () => {
    for (const kandidat of manifest.eintraege) {
      assert.deepEqual(kandidat.historie, [{ zeitpunkt: ergebnis.erstelltAm, status: kandidat.status, ausloeser: AUSLOESER }])
    }
  })

  it('records every change of status over the checks of a case, and only the changes', () => {
    const id = 'miete#p-#1'
    const frueher: FruehePruefung[] = [
      { erstelltAm: '2026-11-07T10:00:00.000Z', anforderungen: [{ id, status: 'offen' }] },
      { erstelltAm: '2026-11-07T10:05:00.000Z', anforderungen: [{ id, status: 'offen' }] },
      { erstelltAm: '2026-11-07T10:09:00.000Z', anforderungen: [{ id, status: 'unklar' }] },
    ]
    const miete = eintragIn(baueManifest(ergebnis, { frueher }), id)
    assert.deepEqual(
      miete.historie.map(({ zeitpunkt, status }) => [zeitpunkt, status]),
      [
        ['2026-11-07T10:00:00.000Z', 'offen'],
        ['2026-11-07T10:09:00.000Z', 'unklar'],
        [ergebnis.erstelltAm, miete.status],
      ].filter(([, status], index, liste) => index === 0 || status !== liste[index - 1]?.[1]),
    )
  })

  it('is plain JSON', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(manifest)), manifest)
  })

  it('writes no hash where the browser could not compute one', async () => {
    const ohneHash = await pruefe({
      profil,
      antragXml,
      DOMParser,
      oeffne,
      ki: falscheKi({ regeln: [{ muster: /Mietvertrag/, typ: 'rent_contract' }] }),
      nachweise: [datei('mietvertrag.pdf', ['Mietvertrag'], { hash: null })],
    })
    const miete = eintragIn(baueManifest(ohneHash), 'miete#p-#1')
    assert.equal(miete.beleg?.hash, null)
  })
})
