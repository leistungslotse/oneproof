// The attachments of the package written into an application in the OneProof Format, tested on their own:
// the cases of the Einstein package (`einstein.test.ts`) are one household with one entry per place.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mimeTypVon, schreibeAnlagen } from '../../src/engine/oneproof/anlagen.ts'
import type { AnlagenDatei, AnlagenVerweis } from '../../src/engine/oneproof/anlagen.ts'
import { kompaktesSchema, ladeSchemata } from '../../src/engine/oneproof/schema.ts'
import { leseText, lies } from '../hilfen/dateien.ts'

const text = await leseText('/beispiele/wohngeld/antrag-einstein-wohngeld-oneproof.json')
const schemata = await ladeSchemata((datei) => lies(`/format/oneproof/${datei}`), 'wohngeld-1.0.schema.json')
const schema = kompaktesSchema(schemata)

/** An attachment of the application as far as the tests look at it. */
interface Anlage {
  dateiname: string
  dokumentart?: string
  beschreibung?: string
  person?: string
  bezuege?: { stelle: string }[]
  mimeType: string
  hashwert?: { algorithmus: string; wert: string }
}

/** A file of the package: a document of the check, of the person with this index in the household (`null`: of nobody). */
const dokumentDatei = (name: string, person: number | null, aenderung: Partial<NonNullable<AnlagenDatei['dokument']>> = {}): AnlagenDatei => ({
  name,
  daten: new TextEncoder().encode(`Inhalt von ${name}`),
  dokument: {
    typ: 'income_certificate',
    typLabel: 'Verdienstbescheinigung',
    person: 'Albert Einstein',
    personTreffer: { index: person, stufe: null, bekannt: person !== null, kandidaten: [], neben: null, anzeige: null },
    nichtZugeordnet: false,
    ...aenderung,
  },
  upload: null,
})
const verweis = (datei: string, stelle: string | null): AnlagenVerweis => ({ datei, ort: { stelle }, bezeichnung: 'Einkommen' })

/** What `schreibeAnlagen` writes, with the attachments parsed. */
async function schreibe(dateien: AnlagenDatei[], verweise: AnlagenVerweis[]) {
  const ergebnis = await schreibeAnlagen({ text, schemata, schema, dateien, verweise })
  const anlagen: Anlage[] = JSON.parse(ergebnis.inhalt).anlagen ?? []
  return { ergebnis, anlagen }
}

const ALBERT = '/fachdaten/personen/1/einkommen/eintraege/0'

describe('Medientyp einer Datei', () => {
  it('follows the name, and the upload where the check could not open the file', () => {
    assert.equal(mimeTypVon('bescheid.PDF'), 'application/pdf')
    assert.equal(mimeTypVon('foto.jpeg'), 'image/jpeg')
    assert.equal(mimeTypVon('scan.heic'), 'image/heic')
    assert.equal(mimeTypVon('ohne-endung'), 'application/octet-stream')
    assert.equal(mimeTypVon('x.unbekannt'), 'application/octet-stream')
    assert.equal(mimeTypVon('x.pdf', 'image/png'), 'image/png')
    // What is no media type is not taken for one.
    assert.equal(mimeTypVon('x.pdf', 'kein Typ'), 'application/pdf')
    assert.equal(mimeTypVon('x.pdf', null), 'application/pdf')
  })
})

describe('Anlagen in den Antrag schreiben', () => {
  it('replaces the attachments the application brought along, and says which', async () => {
    const mitgebracht: { dateiname: string }[] = JSON.parse(text).anlagen
    assert.ok(mitgebracht.length > 0)

    const { ergebnis, anlagen } = await schreibe([dokumentDatei('neu.pdf', 1)], [verweis('neu.pdf', ALBERT)])

    assert.deepEqual(anlagen.map(({ dateiname }) => dateiname), ['neu.pdf'])
    assert.deepEqual(ergebnis.entfernt.map(({ wert }) => wert), mitgebracht.map(({ dateiname }) => dateiname))
    assert.deepEqual(anlagen[0]?.bezuege, [{ stelle: ALBERT }])
    assert.deepEqual(ergebnis.geschrieben, [{ datei: 'neu.pdf', bezeichnung: 'Einkommen', stelle: ALBERT }])
  })

  it('names the person of the document only where no place it supports belongs to someone else', async () => {
    const zuAlbert = await schreibe([dokumentDatei('a.pdf', 1)], [verweis('a.pdf', ALBERT)])
    assert.equal(zuAlbert.anlagen[0]?.person, 'p2')

    // The document is Svenja's (p1), the place it supports is Albert's: no person, the reference stays.
    const fremd = await schreibe([dokumentDatei('a.pdf', 0)], [verweis('a.pdf', ALBERT)])
    assert.equal(fremd.anlagen[0]?.person, undefined)
    assert.deepEqual(fremd.anlagen[0]?.bezuege, [{ stelle: ALBERT }])

    // A place of nobody (the rent of the household) does not stand in the way.
    const haushalt = await schreibe([dokumentDatei('a.pdf', 0)], [verweis('a.pdf', '/fachdaten/mietzuschuss/miete')])
    assert.equal(haushalt.anlagen[0]?.person, 'p1')

    // Nobody certain: no person.
    const niemand = await schreibe([dokumentDatei('a.pdf', null)], [verweis('a.pdf', ALBERT)])
    assert.equal(niemand.anlagen[0]?.person, undefined)
  })

  it('says why a reference was not written: the application has no value there yet', async () => {
    const { ergebnis, anlagen } = await schreibe([dokumentDatei('a.pdf', 1)], [verweis('a.pdf', null), verweis('a.pdf', ALBERT)])

    assert.deepEqual(anlagen[0]?.bezuege, [{ stelle: ALBERT }])
    assert.equal(ergebnis.nichtGeschrieben.length, 1)
    assert.match(ergebnis.nichtGeschrieben[0]?.grund ?? '', /noch keinen Wert/)

    const ohne = await schreibe([dokumentDatei('a.pdf', 1)], [verweis('a.pdf', null)])
    assert.equal(ohne.anlagen[0]?.bezuege, undefined)
  })

  it('writes the type of the document only where the schema knows it', async () => {
    assert.equal((await schreibe([dokumentDatei('a.pdf', 1)], [])).anlagen[0]?.dokumentart, 'income_certificate')
    assert.equal((await schreibe([dokumentDatei('a.pdf', 1, { typ: 'gibt_es_nicht' })], [])).anlagen[0]?.dokumentart, undefined)
    assert.equal((await schreibe([dokumentDatei('a.pdf', 1, { nichtZugeordnet: true })], [])).anlagen[0]?.dokumentart, undefined)
  })

  it('cuts a description at 255 characters, by code point, so that no emoji is split', async () => {
    const lang = await schreibe([dokumentDatei('a.pdf', 1, { typLabel: '😀'.repeat(300) })], [])
    const beschreibung = lang.anlagen[0]?.beschreibung ?? ''

    assert.equal(Array.from(beschreibung).length, 255)
    assert.ok(beschreibung.endsWith('…'))
    assert.ok(!beschreibung.includes('�'))
  })

  it('lists a file the check could not open as it was uploaded, with the type of the upload', async () => {
    const datei: AnlagenDatei = { name: 'scan-1.heic', daten: new Uint8Array([1, 2, 3]), dokument: null, upload: { name: 'scan.heic', mime: 'image/heic' } }

    const { anlagen } = await schreibe([datei], [])

    assert.equal(anlagen[0]?.beschreibung, 'Unverändert hochgeladene Datei „scan.heic“')
    assert.equal(anlagen[0]?.mimeType, 'image/heic')
    assert.equal(anlagen[0]?.dokumentart, undefined)
    assert.equal(anlagen[0]?.person, undefined)
  })

  it('writes no hash where the browser cannot compute one', async () => {
    const vorher = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
    assert.ok(vorher)
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true })
    try {
      const { anlagen } = await schreibe([dokumentDatei('a.pdf', 1)], [])
      assert.equal(anlagen[0]?.hashwert, undefined)
    } finally {
      Object.defineProperty(globalThis, 'crypto', vorher)
    }
    assert.equal(typeof (await schreibe([dokumentDatei('a.pdf', 1)], [])).anlagen[0]?.hashwert?.wert, 'string')
  })

  it('does not build an application the receiver would reject', async () => {
    await assert.rejects(schreibe([dokumentDatei(`${'x'.repeat(300)}.pdf`, 1)], []), /entspräche nicht mehr dem Schema/)
  })

  it('leaves the application as it was where there is nothing to attach', async () => {
    const ohne = await schreibeAnlagen({ text, schemata, schema, dateien: [], verweise: [] })

    assert.equal(JSON.parse(ohne.inhalt).anlagen, undefined)
    assert.deepEqual({ ...JSON.parse(ohne.inhalt), anlagen: undefined }, { ...JSON.parse(text), anlagen: undefined })
  })
})
