import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Manifest } from '../../src/engine/manifest.ts'
import { pruefe } from '../../src/engine/pipeline.ts'
import { bauePaket } from '../../src/engine/paket/paket.ts'
import { ladeProfil } from '../../src/engine/profil/laden.ts'
import type { Seite } from '../../src/engine/zuordnung/posten.ts'
import { GRUPPIERUNG, NACHWEISE, SCAN } from '../hilfen/berger.ts'
import { leseText, lies, WOHNGELD } from '../hilfen/dateien.ts'
import { falscheKi, oeffne } from '../hilfen/falsche-ki.ts'
import { DOMParser, XMLSerializer } from '../hilfen/xml.ts'
import { alsText, liesZip } from '../hilfen/zip-lesen.ts'
import type { ZipDatei } from '../hilfen/zip-lesen.ts'

const profil = await ladeProfil(lies, WOHNGELD)
const antragXml = await leseText('/beispiele/wohngeld/berger/antrag-berger-mietzuschuss.xml')
const ergebnis = await pruefe({ profil, antragXml, DOMParser, oeffne, ki: falscheKi({ gruppierungsAntworten: [GRUPPIERUNG] }), nachweise: NACHWEISE })

/** A "PDF" that names its pages, so that the test sees which pages went where. */
const setzeZusammen = async (seiten: readonly Seite[]) => new TextEncoder().encode(`%PDF ${seiten.map(({ fileId, page }) => `${fileId}:${page}`).join(',')}`)
const original = async (fileId: string) => new TextEncoder().encode(`ORIGINAL ${fileId}`)
const eingang = { aktenzeichen: 'WG-2026-00042', fallId: 'f_berger' }

const paket = await bauePaket({ ergebnis, antragXml, profil, eingang, setzeZusammen, original, DOMParser, XMLSerializer, jetzt: () => new Date(2026, 10, 7, 12) })
const dateien = liesZip(paket.daten)
const dateiIn = (archiv: readonly ZipDatei[], name: string): ZipDatei => {
  const gefunden = archiv.find((kandidat) => kandidat.name === name)
  assert.ok(gefunden, `${name} is in the package`)
  return gefunden
}
const datei = (name: string): ZipDatei => dateiIn(dateien, name)
const antrag = new DOMParser().parseFromString(alsText(datei('antrag.xml').daten), 'application/xml')
const verweise = (feld: string) => Array.from(antrag.getElementsByTagNameNS('*', feld)).map((element) => element.textContent)

describe('Antragspaket', () => {
  it('is named after the file number and holds the application, the manifest and an overview first', () => {
    assert.equal(paket.name, 'WG-2026-00042-antragspaket.zip')
    assert.deepEqual(dateien.slice(0, 3).map(({ name }) => name), ['antrag.xml', 'oneproof-manifest.json', 'inhalt.txt'])
  })

  it('delivers one file per document, its pages in the order of the document', () => {
    const pdfs = Object.fromEntries(dateien.filter(({ name }) => name.endsWith('.pdf')).map(({ name, daten }) => [name, alsText(daten)]))
    assert.equal(pdfs['mietvertrag-miriam-berger.pdf'], '%PDF f1:1,f1:4,f1:10')
    assert.equal(pdfs['lohn-gehaltsabrechnung-miriam-berger.pdf'], '%PDF f1:2,f1:5,f1:9', 'three payslips of one person are one file')
    assert.equal(pdfs['arbeitslosengeld-i-bescheid-daniel-berger.pdf'], '%PDF f1:3,f1:7')
    assert.equal(pdfs['nicht-zugeordnete-seiten.pdf'], '%PDF f1:8')
  })

  it('loses no page: every uploaded page is in exactly one file', () => {
    const seiten = dateien
      .filter(({ name }) => name.endsWith('.pdf'))
      .flatMap(({ daten }) => alsText(daten).replace(/^%PDF /, '').split(','))
      .filter((seite) => /^f\d+:\d+$/.test(seite))
    const erwartet = [...SCAN.map((_, index) => `f1:${index + 1}`), 'f2:1']
    assert.deepEqual([...seiten].sort(), [...erwartet].sort())
  })

  it('delivers a file that could not be opened as it was uploaded, and says so', () => {
    assert.equal(alsText(datei('rueckseite-ausweis.pdf').daten), 'ORIGINAL f3')
    assert.deepEqual(paket.hinweise, ['„Rückseite Ausweis.pdf“ konnte nicht geöffnet werden und liegt dem Paket unverändert bei.'])
  })

  it('references every document at its place in the application, by its file name in the package', () => {
    assert.deepEqual(verweise('F00000000567'), ['mietvertrag-miriam-berger.pdf', 'kontoauszug-miriam-berger.pdf'])
    assert.deepEqual(verweise('F60000000296'), [
      'lohn-gehaltsabrechnung-miriam-berger.pdf',
      'kontoauszug-miriam-berger.pdf',
      'nachweis-kinderbetreuungskosten-miriam-berger.pdf',
      'arbeitslosengeld-i-bescheid-daniel-berger.pdf',
      'schwerbehindertenausweis-gdb-bescheid-pflegegradbescheid-daniel-berger.pdf',
    ])
    for (const name of [...verweise('F00000000567'), ...verweise('F60000000296')]) assert.ok(datei(name), `${name} is in the package`)
  })

  it('leaves documents without a place in the package, without a reference, and says why', () => {
    const referenziert = new Set([...verweise('F00000000567'), ...verweise('F60000000296')])
    const ohne = paket.dateien.filter(({ verweise: stellen }) => stellen.length === 0).map(({ name }) => name)
    assert.deepEqual(ohne, ['kindergeldbescheid-miriam-berger.pdf', 'vermoegens-kapitalertragsnachweis-miriam-berger.pdf', 'nicht-zugeordnete-seiten.pdf', 'rueckseite-ausweis.pdf'])
    for (const name of ohne) assert.equal(referenziert.has(name), false)

    const inhalt = alsText(datei('inhalt.txt').daten)
    assert.match(inhalt, /kindergeldbescheid-miriam-berger\.pdf\n.*\n.*\n {4}ohne Verweis im Antrag: Für diesen Antrag ist kein Nachweis dieser Art vorgesehen\./)
    assert.match(inhalt, /vermoegens-kapitalertragsnachweis-miriam-berger\.pdf\n.*\n.*\n {4}ohne Verweis im Antrag: Im Antrag fehlen die Angaben „Details zum Vermögen“/)
    assert.match(inhalt, /kontoauszug-miriam-berger\.pdf\n.*\n.*\n {4}Verweis im Antrag: Höhe der Miete\n.*F00000000567\[2\]\n {4}Verweis im Antrag: Einkommen · Miriam Berger\n/)
  })

  it('hands the manifest over with the file of every source', () => {
    const manifest: Manifest = JSON.parse(alsText(datei('oneproof-manifest.json').daten))
    assert.equal(manifest.aktenzeichen, 'WG-2026-00042')
    assert.deepEqual(manifest.zusammenfassung, { belegt: 5, offen: 0, unklar: 0 })
    const miete = manifest.eintraege.find(({ anforderungId }) => anforderungId === 'miete#p-#1')
    assert.ok(miete)
    assert.deepEqual(miete.belege?.map(({ datei: name, fundstelle }) => [name, fundstelle]), [
      ['mietvertrag-miriam-berger.pdf', 'Seiten 1, 4, 10 von 13'],
      ['kontoauszug-miriam-berger.pdf', 'Seite 12 von 13'],
    ])
    for (const eintrag of manifest.eintraege) for (const beleg of eintrag.belege ?? []) assert.ok(dateien.some(({ name }) => name === beleg.datei), beleg.datei)
  })

  it('does not refer to a document the check filed with a reason against it, and says the reason', async () => {
    const GRUND = 'Die Unterlage lautet auf „Kevin Berger“. Diese Person kommt im Antrag nicht vor.'
    const alg = ergebnis.dokumente.find(({ typ }) => typ === 'unemployment_benefit_notice')
    assert.ok(alg)
    const geaendert = {
      ...ergebnis,
      ablage: ergebnis.ablage.map((eintrag) => (eintrag.dokument === alg.id ? { ...eintrag, grund: GRUND } : eintrag)),
    }
    const anders = await bauePaket({ ergebnis: geaendert, antragXml, profil, eingang, setzeZusammen, original, DOMParser, XMLSerializer })
    const inhalt = liesZip(anders.daten)
    const xml = alsText(dateiIn(inhalt, 'antrag.xml').daten)
    assert.ok(!xml.includes('arbeitslosengeld-i-bescheid-daniel-berger.pdf'), 'no reference to it')
    const datei_ = anders.dateien.find(({ name }) => name === 'arbeitslosengeld-i-bescheid-daniel-berger.pdf')
    assert.ok(datei_)
    assert.deepEqual(datei_.verweise, [])
    assert.equal(datei_.ohneVerweis, GRUND)
    assert.match(alsText(dateiIn(inhalt, 'inhalt.txt').daten), /ohne Verweis im Antrag: Die Unterlage lautet auf „Kevin Berger“/)
  })

  it('reports what the page needs: name, bytes, manifest, files with their references or the reason there is none', () => {
    assert.ok(paket.daten instanceof Uint8Array)
    assert.deepEqual(paket.manifest, JSON.parse(alsText(datei('oneproof-manifest.json').daten)))

    const mietvertrag = paket.dateien.find(({ name }) => name === 'mietvertrag-miriam-berger.pdf')
    assert.deepEqual(mietvertrag, {
      name: 'mietvertrag-miriam-berger.pdf',
      groesse: datei('mietvertrag-miriam-berger.pdf').daten.length,
      art: 'Mietvertrag · Miriam Berger',
      seiten: 3,
      herkunft: 'scan-unterlagen-familie-berger.pdf, Seiten 1, 4, 10',
      verweise: [{ bezeichnung: 'Höhe der Miete', stelle: '/fim.S01000000123.01000000123001007/G01000001396/G01000001422/F00000000567' }],
      ohneVerweis: null,
      dokument: 'D1',
      upload: null,
    })

    const ausweis = paket.dateien.find(({ name }) => name === 'rueckseite-ausweis.pdf')
    assert.ok(ausweis)
    assert.equal(ausweis.upload, 'f3')
    assert.equal(ausweis.art, 'unverändert hochgeladene Datei „Rückseite Ausweis.pdf“')
    assert.ok(ausweis.ohneVerweis)
    assert.match(ausweis.ohneVerweis, /^Die Datei konnte nicht geöffnet werden: /)
  })
})
