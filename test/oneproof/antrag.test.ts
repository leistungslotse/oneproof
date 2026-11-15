import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { FORMAT_NAME, leseAntrag } from '../../src/engine/antrag.ts'
import { InstanceError } from '../../src/engine/fim/instanz.ts'
import { inProfil, leseOneProofAntrag } from '../../src/engine/oneproof/lesen.ts'
import { haushalt, personDerStelle } from '../../src/engine/oneproof/personen.ts'
import { istOneProofOrt } from '../../src/engine/oneproof/zugang.ts'
import { ladeProfil } from '../../src/engine/profil/laden.ts'
import { bereiteAntragVor } from '../../src/engine/zuordnung/index.ts'
import type { ZielInfo } from '../../src/engine/zuordnung/ziele.ts'
import { leseText, lies } from '../hilfen/dateien.ts'
import { DOMParser } from '../hilfen/xml.ts'

/** The example application, as far as the tests change it. */
interface Beispiel {
  leistung: { art: string }
  version: string
  personen: { id: string; name?: unknown; staatsangehoerigkeit?: string }[]
  anlagen: { bezuege?: { stelle: string }[] }[]
  fachdaten: {
    antrag: { vertretung?: unknown }
    wohnraum: { wohnverhaeltnis?: string; eigentumMitMehrAlsZweiWohnungen?: boolean }
    personen: unknown[]
    kinderUndUnterhalt: { kinderbetreuungskosten?: unknown }
    vermoegen?: unknown
    mietzuschuss?: unknown
    lastenzuschuss?: unknown
  }
}

const profil = await ladeProfil(lies, '/profile/wohngeld/2026-11-15/')
const text = await leseText('/format/oneproof/wohngeld-1.0.beispiel.json')
// Trusted test data: the example file of the format.
const beispiel: Beispiel = JSON.parse(text)
const mit = (aendere: (daten: Beispiel) => void): string => {
  const daten = structuredClone(beispiel)
  aendere(daten)
  return JSON.stringify(daten)
}

/** The target of a slot, which has to be there. */
function infoVon(infos: Map<string, ZielInfo>, slot: string): ZielInfo {
  const eintrag = infos.get(slot)
  assert.ok(eintrag)
  return eintrag
}

/** The pointer the package refers to for a slot of an application in the OneProof Format. */
function stelleVon(infos: Map<string, ZielInfo>, slot: string): string | null {
  const { ort } = infoVon(infos, slot)
  assert.ok(istOneProofOrt(ort))
  return ort.stelle
}

describe('Antragsdatei im OneProof Format lesen', () => {
  it('is told from a FIM instance by its content, not by its name', async () => {
    assert.equal(leseAntrag(text).format, 'oneproof')
    assert.equal(FORMAT_NAME.oneproof, 'OneProof Format (JSON)')
    const xml = await leseText('/beispiele/wohngeld/antrag-einstein-wohngeld-1.7.0.xml')
    assert.equal(leseAntrag(xml, { DOMParser }).format, 'fim-instanz')
  })

  it('reads the benefit, the version and the attachments', () => {
    const antrag = leseOneProofAntrag(text)
    assert.equal(antrag.schemaId, 'oneproof:wohngeld')
    assert.equal(antrag.version, '1.0')
    assert.equal(antrag.anhaenge.length, 8)
    assert.deepEqual(antrag.anhaenge[0], { id: 'antrag-wg-2026-004711.pdf', name: 'antrag-wg-2026-004711.pdf', contentType: 'application/pdf', length: null })
  })

  it('tells a file saved as UTF-16 from a broken one', () => {
    const utf16 = new TextDecoder().decode(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]))
    assert.throws(() => leseAntrag(utf16), (fehler: unknown) => fehler instanceof InstanceError && /nicht als UTF-8 gespeichert/.test(fehler.message))
  })

  it('takes a PDF or a photo in the field for what it is, not for a file saved in the wrong encoding', () => {
    const gelesen = (bytes: Buffer): string => new TextDecoder().decode(bytes)
    const pdf = gelesen(Buffer.concat([Buffer.from('%PDF-1.7\n%'), Buffer.from([0xe2, 0xe3, 0xcf, 0xd3]), Buffer.from('\n1 0 obj\n<<>>\nendobj\n'), Buffer.alloc(40)]))
    const png = gelesen(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]), Buffer.from('IHDR')]))
    for (const datei of [pdf, png]) {
      assert.throws(() => leseAntrag(datei, { DOMParser }), (fehler: unknown) => fehler instanceof InstanceError && /kein gültiges XML/.test(fehler.message) && !/UTF-8/.test(fehler.message))
    }
    // Both byte orders of UTF-16, with and without the byte order mark, are told as such.
    const utf16 = Buffer.from(text, 'utf16le')
    for (const bytes of [utf16, Buffer.concat([Buffer.from([0xff, 0xfe]), utf16]), Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(utf16).swap16()])]) {
      assert.throws(() => leseAntrag(gelesen(bytes)), (fehler: unknown) => fehler instanceof InstanceError && /nicht als UTF-8 gespeichert/.test(fehler.message))
    }
  })

  it('says what is wrong with a file that is no application in the format', () => {
    const fehler = (eingabe: string): void => assert.throws(() => leseOneProofAntrag(eingabe), InstanceError)
    fehler('{ kein json')
    fehler('[1, 2]')
    assert.throws(() => leseOneProofAntrag('{"standard": "anderes"}'), /„standard“ ist „anderes“, erwartet wird „oneproof-format“/)
    assert.throws(() => leseOneProofAntrag(mit((d) => (d.leistung.art = 'Wohngeld'))), /keine Leistung/)
    assert.throws(() => leseOneProofAntrag(mit((d) => (d.version = '1'))), /keine Version wie „1.0“/)
  })

  it('takes it only for a benefit and a version the profile knows, and only if it is valid', async () => {
    const { antragsart, schema } = await inProfil(leseOneProofAntrag(text), profil)
    assert.equal(antragsart.format, 'oneproof')
    assert.equal(schema.schemaId, 'oneproof:wohngeld')

    await assert.rejects(inProfil(leseOneProofAntrag(mit((d) => (d.leistung.art = 'kindergeld'))), profil), /Antrag auf „kindergeld“ im OneProof Format/)
    await assert.rejects(inProfil(leseOneProofAntrag(mit((d) => (d.version = '1.1'))), profil), /Version 1.1 des OneProof Formats für „wohngeld“ vor\. Unterstützt wird die Version 1\.0\./)
    await assert.rejects(inProfil(leseOneProofAntrag(mit((d) => delete d.personen[0]?.name)), profil), (fehler: unknown) => {
      assert.ok(fehler instanceof InstanceError)
      assert.match(fehler.message, /entspricht nicht dem Schema „urn:oneproof:format:wohngeld:1\.0“\. \/personen\/0: Die Angabe „name“ fehlt\./)
      assert.deepEqual(fehler.fehler, [{ stelle: '/personen/0', meldung: 'Die Angabe „name“ fehlt.' }])
      return true
    })
  })

  it('is not known to a profile without the OneProof Format', async () => {
    const aelter = await ladeProfil(lies, '/profile/wohngeld/2026-11-07/')
    await assert.rejects(inProfil(leseOneProofAntrag(text), aelter), /Das Profil „Wohngeld“ deckt .* ab\./)
  })
})

describe('Personen eines Antrags im OneProof Format', () => {
  it('puts the applicant first and finds the person a value belongs to', () => {
    const daten = structuredClone(beispiel)
    daten.personen.reverse()
    assert.deepEqual(haushalt(daten).map(({ id, quelle }) => [id, quelle]), [['p1', 2], ['p3', 0], ['p2', 1]])
    assert.equal(personDerStelle(beispiel, '/personen/2/name'), 'p3')
    assert.equal(personDerStelle(beispiel, '/fachdaten/personen/1/einkommen/eintraege/0'), 'p2')
    assert.equal(personDerStelle(beispiel, '/fachdaten/einkommensentwicklung/einmaligeZahlungen/eintraege/0'), 'p1', 'an entry that names its person')
    assert.equal(personDerStelle(beispiel, '/fachdaten/mietzuschuss/miete'), null)
  })
})

const vorbereitet = await bereiteAntragVor({ profil, antrag: leseAntrag(text) })

describe('Zu belegende Angaben eines Antrags im OneProof Format', () => {
  const { ziele, infos, entfaellt } = vorbereitet.ziele
  const benannt = ziele.filter(({ slot }) => infoVon(infos, slot).benannt).map(({ slot }) => slot)
  const info = (slot: string): ZielInfo => infoVon(infos, slot)

  it('names the persons, their roles and the date of the application', () => {
    assert.deepEqual(vorbereitet.personen, ['Anna Beispiel', 'Jonas Beispiel', 'Lea Beispiel'])
    assert.deepEqual(vorbereitet.ziele.rollen, ['antragstellende Person', 'Haushaltsmitglied', 'Haushaltsmitglied'])
    assert.equal(vorbereitet.stichtag?.getTime(), new Date(2026, 9, 21, 12).getTime())
  })

  it('asks for evidence of what the application states', () => {
    assert.deepEqual(benannt, [
      'miete#p-#1',
      'mietveraenderung#p-#1',
      'einnahmen#p0#1',
      'einnahmen#p1#1',
      'werbungskosten#p0#1',
      'einmalige_einnahmen#p0#1',
      'kinderbetreuung#p-#1',
      'schwerbehinderung#p2#1',
    ])
  })

  it('says what the application states there, at which value', () => {
    assert.equal(info('miete#p-#1').aussage, 'Gesamtmiete 980,00 € im Monat')
    assert.equal(info('einnahmen#p1#1').aussage, 'Gehalt oder Lohn: 1.100,00 € (monatlich)')
    assert.equal(stelleVon(infos, 'einnahmen#p1#1'), '/fachdaten/personen/1/einkommen/eintraege/0')
    assert.equal(stelleVon(infos, 'kinderbetreuung#p-#1'), '/fachdaten/kinderUndUnterhalt/kinderbetreuungskosten/eintraege/0')
    assert.deepEqual(ziele.find(({ slot }) => slot === 'einnahmen#p0#1')?.merkmale, { income_type: 'salary', betrag: '245000', nebenperson: '-' })
  })

  it('keeps a place for evidence of what is not stated, at the nearest value above it', () => {
    assert.equal(info('werbungskosten#p1#1').benannt, false)
    assert.equal(stelleVon(infos, 'werbungskosten#p1#1'), '/fachdaten/personen/1/einkommen')
    assert.equal(stelleVon(infos, 'aufenthaltstitel#p2#1'), '/personen/2')
    assert.equal(info('aufenthaltstitel#p2#1').eintrag, null, 'a person is no row of a list')
  })

  it('opens a place where its question is not answered yet, as far as a no does, also for a person without an entry', async () => {
    const ohne = (aendere: (daten: Beispiel) => void, weg: string): Promise<Map<string, ZielInfo>> =>
      bereiteAntragVor({
        profil,
        antrag: leseAntrag(
          mit((d) => {
            aendere(d)
            d.anlagen = d.anlagen.filter(({ bezuege }) => !bezuege?.some(({ stelle }) => stelle.startsWith(weg)))
          }),
        ),
      }).then(({ ziele: { infos } }) => infos)
    const ohneEintrag = await ohne((d) => d.fachdaten.personen.pop(), '/fachdaten/personen/2')
    assert.deepEqual(ohneEintrag.get('schwerbehinderung#p2#1')?.ort, { stelle: '/personen/2' })
    assert.equal(ohneEintrag.get('schwerbehinderung#p2#1')?.benannt, false)
    const ohneFrage = await ohne((d) => delete d.fachdaten.kinderUndUnterhalt.kinderbetreuungskosten, '/fachdaten/kinderUndUnterhalt/kinderbetreuungskosten')
    assert.deepEqual(ohneFrage.get('kinderbetreuung#p-#1')?.ort, { stelle: '/fachdaten/kinderUndUnterhalt' })
    const ohneVermoegen = await ohne((d) => delete d.fachdaten.vermoegen, '/fachdaten/vermoegen')
    assert.deepEqual(ohneVermoegen.get('vermoegen#p-#1')?.ort, { stelle: '/fachdaten' }, 'the nearest value above, even right below the root')
  })

  it('lets a fact fall away where the application answers its question with no', () => {
    const grund = (id: string) => entfaellt.find((eintrag) => eintrag.id === id)
    assert.equal(grund('vermoegen#p-')?.antwort, 'Nein')
    assert.equal(grund('vollmacht#p-')?.frage, 'Die antragstellende Person wird vertreten')
    assert.equal(grund('aufenthaltstitel#p0')?.antwort, 'DE')
    assert.equal(grund('schwerbehinderung#p2'), undefined)
  })

  it('asks for a residence permit of a person from outside the EU and for the power of attorney of a representative', async () => {
    const anders = await bereiteAntragVor({
      profil,
      antrag: leseAntrag(
        mit((d) => {
          const [, zweite] = d.personen
          assert.ok(zweite)
          zweite.staatsangehoerigkeit = 'TR'
          d.fachdaten.antrag.vertretung = { vorhanden: true, art: 'authorized_representative', vertreter: { vorname: 'Max', familienname: 'Muster' } }
        }),
      ),
    })
    const { infos: andere, entfaellt: weg } = anders.ziele
    assert.equal(andere.get('aufenthaltstitel#p1#1')?.benannt, true)
    assert.equal(andere.get('aufenthaltstitel#p0#1')?.benannt, false)
    assert.equal(andere.get('vollmacht#p-#1')?.benannt, true)
    assert.ok(!weg.some(({ id }) => id === 'vollmacht#p-'))
  })

  it('asks for the charges of an owner where the application is one for a charges allowance', async () => {
    const lasten = await bereiteAntragVor({
      profil,
      antrag: leseAntrag(
        mit((d) => {
          d.fachdaten.wohnraum.wohnverhaeltnis = 'owner'
          d.fachdaten.wohnraum.eigentumMitMehrAlsZweiWohnungen = false
          delete d.fachdaten.mietzuschuss
          d.fachdaten.lastenzuschuss = {
            eigentumsform: 'house',
            fremdmittel: { vorhanden: true, eintraege: [{ zweck: 'price', glaeubiger: 'Sparkasse Auenthal', nennbetrag: 180000, restbetrag: 96000 }] },
            zuschuesseDritter: { vorhanden: true, eintraege: [{ zuschussgeber: { organisation: 'Landesförderbank' }, betragMonat: 50 }] },
          }
          d.anlagen = d.anlagen.filter(({ bezuege }) => !bezuege?.some(({ stelle }) => stelle.startsWith('/fachdaten/mietzuschuss')))
        }),
      ),
    }).then(
      (vorbereitet) => ({ vorbereitet, fehler: undefined }),
      (fehler: unknown) => ({ vorbereitet: undefined, fehler }),
    )
    assert.equal(lasten.fehler, undefined, lasten.fehler instanceof Error ? lasten.fehler.message : undefined)
    assert.ok(lasten.vorbereitet)
    const namen = lasten.vorbereitet.ziele.ziele.filter(({ slot }) => infoVon(lasten.vorbereitet.ziele.infos, slot).benannt).map(({ slot }) => slot.split('#')[0])
    assert.ok(!namen.includes('miete'))
    assert.ok(namen.includes('belastung'), 'the property itself')
    assert.ok(namen.includes('fremdmittel'), 'the loan it states')
    assert.ok(namen.includes('wohnflaeche'), 'the floor space of an owner')
    assert.equal(lasten.vorbereitet.ziele.infos.get('fremdmittel#p-#1')?.aussage, 'Kaufpreis: ursprünglich 180.000,00 €, Restbetrag 96.000,00 €')
    assert.equal(lasten.vorbereitet.ziele.infos.get('zuschuss_belastung#p-#1')?.aussage, 'von Landesförderbank', 'a body named in parts reads as its name')
  })
})
