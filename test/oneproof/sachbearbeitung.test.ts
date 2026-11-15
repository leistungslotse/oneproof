import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { leseAntrag } from '../../src/engine/antrag.ts'
import { unterscheidungenFuer } from '../../src/engine/fim/xdf.ts'
import { liesOneProofSchema, OneProofSchemaFehler } from '../../src/engine/oneproof/ableitung.ts'
import { kompaktesSchema, ladeSchemataNeben } from '../../src/engine/oneproof/schema.ts'
import { fuegeAntragsartEin, neuesProfil, schlageAnbindungVor, STICHTAG_ONEPROOF } from '../../src/engine/profil/antragsart.ts'
import { unterscheide } from '../../src/engine/profil/bearbeiten.ts'
import type { StelleFormat2 } from '../../src/engine/profil/bedingungen.ts'
import { liesMitProfil } from '../../src/engine/profil/entwurf.ts'
import { ladeProfil, ladeProfilNachKennung } from '../../src/engine/profil/laden.ts'
import { validiereProfil } from '../../src/engine/profil/validieren.ts'
import { bereiteAntragVor } from '../../src/engine/zuordnung/index.ts'
import { giltWenn, HERKUNFT, jePerson, pfadText, vorlagenFuer } from '../../src/sachbearbeitung/ansicht.ts'
import { bearbeite } from '../../src/sachbearbeitung/arbeit.ts'
import type { Arbeitsstand } from '../../src/sachbearbeitung/arbeit.ts'
import { alleDateienDerVersion, baueVersionspaket, dateienDerVersion } from '../../src/sachbearbeitung/version.ts'
import type { ProfilIndex } from '../../src/sachbearbeitung/version.ts'
import { leseBytes, leseText, lies } from '../hilfen/dateien.ts'

const ORDNER = '/profile/wohngeld/2026-11-15/'
const ONEPROOF = 'oneproof:wohngeld'
const profil = await ladeProfil(lies, ORDNER)
const roh = profil.roh
// The released profile is in format 2.
assert.ok(roh.format === 2)
const art = roh.antragsarten.find(({ schema }) => schema === ONEPROOF)
assert.ok(art)
const schema = kompaktesSchema(await ladeSchemataNeben((pfad) => lies(`${ORDNER}${pfad}`), art.datei))
const stelle = (id: string): StelleFormat2 => {
  const gefunden = art.stellen.find((kandidat) => kandidat.id === id)
  assert.ok(gefunden, id)
  return gefunden
}

const schemaText = await leseText('/format/oneproof/wohngeld-1.0.schema.json')
const liesNeben = (datei: string) => lies(`/format/oneproof/${datei}`)
const gelesen = await liesOneProofSchema(schemaText, { liesNeben })

describe('Sachbearbeitung: eine Antragsart im OneProof Format ansehen', () => {
  it('names the place by the sections of the schema and knows which places are asked per person', () => {
    assert.equal(pfadText(stelle('einnahmen'), schema), 'Fachdaten Wohngeld › Angaben je Person › Angaben zu einer Person › Einkommen › Einnahmen › Einnahme')
    assert.equal(jePerson(stelle('einnahmen'), {}, schema), true)
    assert.equal(jePerson(stelle('aufenthaltstitel'), {}, schema), true)
    assert.equal(jePerson(stelle('miete'), {}, schema), false)
  })

  it('says when a place asks, in the words of the schema', () => {
    const { saetze } = giltWenn(stelle('vermoegen'), schema)
    assert.deepEqual(saetze, [{ frage: 'Der Haushalt hat Vermögen', antworten: ['Ja'], gefuellt: false }])
    assert.equal(HERKUNFT[stelle('vermoegen').herkunft.art].titel, 'Aus der Ja/Nein-Frage')
  })

  it('takes a setting over from the place of the same id in a FIM application type', () => {
    const vorlagen = vorlagenFuer(roh, ONEPROOF, stelle('miete'), 'miete')
    assert.ok(vorlagen.some(({ schema: andere, bedingungId }) => andere.startsWith('S0') && bedingungId === 'miete'))
  })
})

describe('Sachbearbeitung: Bedingungen je Antwort im OneProof Format', () => {
  const optionen = unterscheidungenFuer(schema, '/fachdaten/personen/*/einkommen/eintraege/*')

  it('offers the kind of income as the question to tell conditions apart', () => {
    const art_ = optionen.find(({ wert }) => wert === '/fachdaten/personen/*/einkommen/eintraege/*/art')
    assert.ok(art_, optionen.map(({ wert }) => wert).join(', '))
    assert.ok(art_.antworten.some(({ code }) => code === 'pension'))
  })

  it('makes the engine ask per answer', async () => {
    const getrennt = unterscheide(roh, schema, 'einnahmen', '/fachdaten/personen/*/einkommen/eintraege/*/art')
    const anders = await ladeProfil(liesMitProfil(lies, ORDNER, getrennt), ORDNER)
    assert.deepEqual((await validiereProfil(anders)).fehler, [])
    const vorbereitet = await bereiteAntragVor({ profil: anders, antrag: leseAntrag(await leseText('/format/oneproof/wohngeld-1.0.beispiel.json')) })
    const benannt = vorbereitet.ziele.ziele.filter(({ slot }) => vorbereitet.ziele.infos.get(slot)?.benannt).map(({ slot }) => slot)
    assert.ok(benannt.includes('einnahmen:salary#p0#1'), benannt.join(', '))
  })
})

describe('Sachbearbeitung: eine Antragsart aus dem JSON Schema anlegen', () => {
  it('reads the schema of a benefit with its frame, and says what is wrong with another file', async () => {
    assert.equal(gelesen.format, 'oneproof')
    assert.equal(gelesen.schema.schemaId, ONEPROOF)
    assert.deepEqual(Object.keys(gelesen.dateien), ['schema/wohngeld-1.0.schema.json', 'schema/rahmen-1.0.schema.json'])
    await assert.rejects(liesOneProofSchema('nicht json', { liesNeben }), OneProofSchemaFehler)
    await assert.rejects(liesOneProofSchema('{"$id": "https://example.org/schema"}', { liesNeben }), /urn:oneproof:format:<name>:<version>/)
    await assert.rejects(liesOneProofSchema(await leseText('/format/oneproof/rahmen-1.0.schema.json'), { liesNeben }), /Rahmen des OneProof Formats/)
    await assert.rejects(liesOneProofSchema(schemaText, { liesNeben: async () => ({ $id: 'urn:oneproof:format:anderes:1.0' }) }), /nicht das Schema „urn:oneproof:format:rahmen:1\.0“/)
  })

  it('names what is wrong with a schema whose references lead nowhere or in a circle, instead of failing without a word', async () => {
    const ohneZiel = JSON.parse(schemaText)
    ohneZiel.properties.fachdaten = { $ref: '#/$defs/GibtEsNicht' }
    await assert.rejects(liesOneProofSchema(JSON.stringify(ohneZiel), { liesNeben }), (fehler: unknown) => {
      assert.ok(fehler instanceof OneProofSchemaFehler)
      assert.match(fehler.message, /GibtEsNicht|führt ins Leere|nicht gefunden/)
      return true
    })

    const imKreis = JSON.parse(schemaText)
    imKreis.$defs = { ...imKreis.$defs, Kreis: { type: 'object', properties: { wieder: { $ref: '#/$defs/Kreis' } } } }
    imKreis.properties.fachdaten = { $ref: '#/$defs/Kreis' }
    await assert.rejects(liesOneProofSchema(JSON.stringify(imKreis), { liesNeben }), OneProofSchemaFehler)
  })

  it('derives a place from each section with a yes/no question, inside the entries of a person too', () => {
    const positionen = gelesen.ableitung.stellen.map(({ position }) => position)
    assert.equal(gelesen.ableitung.fragen, 33)
    assert.ok(positionen.includes('/fachdaten/personen/*/einkommen/eintraege/*'))
    assert.ok(positionen.includes('/fachdaten/vermoegen'))
    assert.ok(!positionen.includes('/fachdaten/personen/*'), 'the entry of a person is no place of its own')
    const einkommen = gelesen.ableitung.stellen.find(({ position }) => position === '/fachdaten/personen/*/einkommen/eintraege/*')
    assert.ok(einkommen)
    assert.deepEqual(einkommen.nennt, { feld: '/fachdaten/personen/*/einkommen/vorhanden', ja: ['true'], nein: ['false'] })
  })

  it('needs no binding: the format names the persons and the date', () => {
    assert.deepEqual(schlageAnbindungVor(gelesen.schema, roh).anbindung, { personen: {}, stichtag: STICHTAG_ONEPROOF })
  })

  it('read again into the profile, keeps every place and condition — those set by hand as well', () => {
    const { roh: neu, dateien } = fuegeAntragsartEin(roh, { ...gelesen, anbindung: { personen: {}, stichtag: STICHTAG_ONEPROOF }, typen: profil.typen })
    const nachher = neu.antragsarten.find(({ schema: kennung }) => kennung === ONEPROOF)
    assert.ok(nachher)
    for (const vorher of art.stellen) {
      assert.deepEqual(nachher.stellen.find(({ id }) => id === vorher.id), vorher, vorher.id)
    }
    assert.equal(nachher.stellen.length, art.stellen.length + 17, 'sections with a question the profile did not use yet')
    assert.deepEqual(Object.keys(dateien), ['schema/wohngeld-1.0.schema.json', 'schema/rahmen-1.0.schema.json'])
    assert.deepEqual(neu.personen, roh.personen, 'the binding of the FIM application types stays')
  })

  it('makes a new profile that the engine can load and that is in order', async () => {
    const { roh: neu, dateien } = fuegeAntragsartEin(neuesProfil({ id: 'probe', name: 'Probe' }), { ...gelesen, anbindung: { personen: {}, stichtag: STICHTAG_ONEPROOF }, typen: profil.typen })
    const eintrag = neu.antragsarten[0]
    assert.ok(eintrag)
    assert.equal(eintrag.format, 'oneproof')
    assert.equal(eintrag.stichtag, STICHTAG_ONEPROOF)
    assert.equal(eintrag.datei, 'schema/wohngeld-1.0.schema.json')
    const ordner = '/profile/probe/entwurf/'
    const geladen = await ladeProfil(liesMitProfil(lies, ordner, neu, { ...dateien, 'dokumenttypen.json': await lies(`${ORDNER}dokumenttypen.json`) }), ordner)
    assert.deepEqual((await validiereProfil(geladen)).fehler, [])
  })
})

describe('Sachbearbeitung: Entwurf und Version mit dem OneProof Format', () => {
  it('keeps the frame with a draft that brought the schema along', () => {
    const stand: Arbeitsstand = { basisRoh: roh, entwurf: null }
    const { roh: _neu, dateien } = fuegeAntragsartEin(roh, { ...gelesen, anbindung: { personen: {}, stichtag: STICHTAG_ONEPROOF }, typen: profil.typen })
    const neu = bearbeite(stand, (vorher) => fuegeAntragsartEin(vorher, { ...gelesen, anbindung: { personen: {}, stichtag: STICHTAG_ONEPROOF }, typen: profil.typen }).roh, dateien)
    assert.ok(neu.entwurf)
    assert.deepEqual(Object.keys(neu.entwurf.dateien).sort(), ['schema/rahmen-1.0.schema.json', 'schema/wohngeld-1.0.schema.json'])
  })

  it('counts the frame among the files of a version', async () => {
    assert.ok(!dateienDerVersion(roh).includes('schema/rahmen-1.0.schema.json'), 'without the content of the schema at hand')
    assert.ok(dateienDerVersion(roh, gelesen.dateien).includes('schema/rahmen-1.0.schema.json'))
    const alle = await alleDateienDerVersion(roh, (pfad) => lies(`${ORDNER}${pfad}`))
    assert.ok(alle.includes('schema/rahmen-1.0.schema.json'))
    assert.ok(alle.includes('schema/wohngeld-1.0.schema.json'))
  })

  it('releases a version with the frame that the engine can load', async () => {
    const index = await lies<ProfilIndex>('/profile/index.json')
    const holeDatei = (adresse: string) => leseBytes(adresse)
    const paket = await baueVersionspaket({ roh, id: 'wohngeld', version: '2026-11-16', index, alsAktuell: true, ordner: ORDNER, holeDatei })
    const namen = paket.map(({ name }) => name)
    assert.ok(namen.includes('profile/wohngeld/2026-11-16/schema/rahmen-1.0.schema.json'))
    const dateien = new Map(paket.map(({ name, inhalt }): [string, Uint8Array | string] => [`/${name}`, inhalt]))
    const leser = async (adresse: string) => {
      const inhalt = dateien.get(adresse)
      if (inhalt === undefined) throw new Error(`${adresse} fehlt`)
      return JSON.parse(typeof inhalt === 'string' ? inhalt : new TextDecoder().decode(inhalt))
    }
    const geladen = await ladeProfilNachKennung(leser, 'wohngeld', '/profile/')
    assert.equal(geladen.kennung, 'wohngeld@2026-11-16')
    assert.equal((await geladen.ladeJsonSchema(ONEPROOF))?.alle.length, 2)
  })
})
