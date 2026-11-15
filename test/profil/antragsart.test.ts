import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { XdfError } from '../../src/engine/fim/xdf.ts'
import { fuegeAntragsartEin, katalogVorschlag, liesAntragsart, neuesProfil, schlageAnbindungVor, waehleAnbindung, zaehleAntragsart } from '../../src/engine/profil/antragsart.ts'
import { setzeRolle } from '../../src/engine/profil/bearbeiten.ts'
import type { ProfilFormat2, StelleFormat2 } from '../../src/engine/profil/bedingungen.ts'
import { liesMitProfil } from '../../src/engine/profil/entwurf.ts'
import { ladeProfil } from '../../src/engine/profil/laden.ts'
import { validiereProfil } from '../../src/engine/profil/validieren.ts'
import { fixture, lies, WOHNGELD } from '../hilfen/dateien.ts'
import { MIETZUSCHUSS, wohngeldFormat2 } from '../hilfen/format2.ts'
import { DOMParser } from '../hilfen/xml.ts'

const TEXT = await fixture('xdf3-wohnhilfe.xml')
const gelesen = liesAntragsart(TEXT, { DOMParser })
const { roh: wohngeld, typen } = await wohngeldFormat2()
const SCHEMA = 'S99000000001'

const neu = () => neuesProfil({ id: 'wohnhilfe', name: 'Wohnhilfe' })
const anbindungFuer = (roh: ProfilFormat2) => schlageAnbindungVor(gelesen.xdf.schema, roh).anbindung
const fuegeEin = (roh: ProfilFormat2) => fuegeAntragsartEin(roh, { ...gelesen, anbindung: anbindungFuer(roh), typen })

describe('Antragsart: die XDF-Datei lesen', () => {
  it('reads the schema and counts what it holds', () => {
    const { format, schema, zahlen } = gelesen.xdf
    assert.equal(format, 'XDF3')
    assert.deepEqual([schema.schemaId, schema.version, schema.name], [SCHEMA, '1.0.0', 'Wohnhilfe – Erstantrag'])
    assert.deepEqual(zahlen, { elemente: 20, gruppen: 7, felder: 13 })
  })

  it('finds every place of evidence, with where its condition comes from', () => {
    const { stellen, nachweisfelder } = gelesen.ableitung
    assert.equal(nachweisfelder, 4)
    assert.deepEqual(
      stellen.map(({ titel, herkunft }) => [titel, herkunft.art]),
      [
        ['Mietvertrag', 'regel'],
        ['Einkommen', 'abschnitt'],
        ['Nachweis Schwerbehinderung', 'regelFremd'],
        ['Unterschrift', 'immer'],
      ],
    )
  })

  it('takes the question of a rule it understands, with the answers that say no', () => {
    const miete = gelesen.ableitung.stellen[0]
    assert.ok(miete)
    assert.deepEqual(miete.nennt, { feld: 'F99000000030', ja: ['001'], nein: ['002', '003'] })
    assert.equal(miete.nurFrage, true)
    assert.equal(miete.herkunft.regeln?.[0]?.id, 'R99000000001')
  })

  it('names a field that only says "Nachweis" after its section', () => {
    assert.equal(gelesen.ableitung.stellen[1]?.feld, 'Nachweis')
    assert.equal(gelesen.ableitung.stellen[1]?.titel, 'Einkommen')
  })

  it('lists the rules it cannot read, and whether they concern evidence', () => {
    const { gesamt, ausgewertet, nichtAusgewertet } = gelesen.ableitung.regeln
    assert.deepEqual([gesamt, ausgewertet], [3, 1])
    assert.deepEqual(
      nichtAusgewertet.map(({ id, beiNachweis }) => [id, beiNachweis]),
      [
        ['R99000000002', true],
        ['R99000000003', false],
      ],
    )
  })

  it('refuses what is not a schema of the FIM portal', () => {
    assert.throws(() => liesAntragsart('', { DOMParser }), XdfError)
    assert.throws(() => liesAntragsart('<a><b/></a>', { DOMParser }), /kein FIM-Datenschema/)
    assert.throws(() => liesAntragsart('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e "x">]><x/>', { DOMParser }), /Dokumenttyp-Deklaration/)
    assert.throws(() => liesAntragsart('<x', { DOMParser }), XdfError)
  })
})

describe('Antragsart: technische Anbindung', () => {
  it('proposes the persons and the date by their names in the schema', () => {
    const { passt, anbindung, kandidaten } = schlageAnbindungVor(gelesen.xdf.schema, neu())
    assert.equal(passt, false)
    assert.deepEqual(anbindung.personen.antragsteller, {
      gruppe: 'G99000000001',
      name: { pfad: [], nachname: 'F99000000010', vorname: 'F99000000011', geburtsname: 'F99000000012' },
      bezeichnung: 'antragstellende Person',
    })
    assert.equal(anbindung.personen.mitglieder?.gruppe, 'G99000000002')
    assert.equal(anbindung.stichtag, 'F99000000002')
    assert.deepEqual(
      kandidaten.mitglieder.map(({ id }) => id),
      ['G99000000002'],
    )
  })

  it('keeps the binding of the profile where the schema has its groups and fields', async () => {
    const { schemas } = await wohngeldFormat2()
    const schema = schemas.get(MIETZUSCHUSS)
    assert.ok(schema)
    const { passt, anbindung } = schlageAnbindungVor(schema, wohngeld)
    assert.equal(passt, true)
    assert.deepEqual(anbindung, { personen: wohngeld.personen, stichtag: wohngeld.stichtag })
  })

  it('lets a group or field be chosen, or none', () => {
    const anbindung = anbindungFuer(neu())
    const ohne = waehleAnbindung(gelesen.xdf.schema, anbindung, 'mitglieder', null)
    assert.equal(Object.hasOwn(ohne.personen, 'mitglieder'), false)
    assert.equal(waehleAnbindung(gelesen.xdf.schema, anbindung, 'stichtag', '').stichtag, null)
    // A group without name fields is no person.
    assert.equal(Object.hasOwn(waehleAnbindung(gelesen.xdf.schema, anbindung, 'antragsteller', 'G99000000003').personen, 'antragsteller'), false)
  })
})

describe('Antragsart: Vorschläge aus dem Katalog', () => {
  it('proposes the types whose name fits the place', () => {
    assert.ok(katalogVorschlag({ titel: 'Mietvertrag' }, typen).includes('rent_contract'))
    assert.deepEqual(katalogVorschlag({ titel: 'Nachweis Schwerbehinderung' }, typen), ['disability_notice'])
    assert.deepEqual(katalogVorschlag({ titel: 'Rente' }, typen), ['pension_notice'])
  })

  it('does not take a shared beginning of words for the same meaning', () => {
    assert.deepEqual(katalogVorschlag({ titel: 'Unterschrift' }, typen), [], '„Unter…“ is not „Unterhalt“')
    assert.deepEqual(katalogVorschlag({ titel: 'Nachweis' }, typen), [], 'a word that says nothing')
  })
})

describe('Antragsart einfügen', () => {
  it('makes a new profile with the application type, its places and the binding', () => {
    const { roh, datei, zahlen } = fuegeEin(neu())
    assert.equal(roh.antragsarten.length, 1)
    const [art] = roh.antragsarten
    assert.ok(art)
    assert.deepEqual([art.schema, art.version, art.name, art.datei], [SCHEMA, '1.0.0', 'Wohnhilfe – Erstantrag', 'schema/S99000000001V1.0.0.json'])
    assert.equal(datei.pfad, art.datei)
    assert.equal(datei.inhalt, gelesen.xdf.schema)
    assert.equal(roh.personen?.antragsteller?.gruppe, 'G99000000001', 'a new profile takes the binding for itself')
    assert.equal(roh.stichtag, 'F99000000002')
    assert.equal(Object.hasOwn(art, 'personen'), false)
    assert.deepEqual(zahlen, { stellen: 4, ohne: 0, bedingungen: 4, festgelegt: 0, vorschlag: 3, offen: 1 })
  })

  it('proposes from the catalogue, or leaves the condition open', () => {
    const [art] = fuegeEin(neu()).roh.antragsarten
    assert.ok(art)
    const vonStelle = (titel: string) => art.stellen.find((stelle) => stelle.titel === titel)?.bedingungen[0]
    assert.equal(vonStelle('Nachweis Schwerbehinderung')?.status, 'vorschlag')
    assert.deepEqual(vonStelle('Nachweis Schwerbehinderung')?.nachweise, { disability_notice: 'pruefen' })
    assert.deepEqual(vonStelle('Unterschrift'), { id: 'unterschrift', status: 'offen', nachweise: {}, hinweis: '' })
    assert.deepEqual(art.stellen[0]?.nennt, gelesen.ableitung.stellen[0]?.nennt, 'the condition of the rule')
  })

  it('adds it to a profile that has others, with a binding of its own where the profile has another', () => {
    const { roh } = fuegeEin(wohngeld)
    assert.equal(roh.antragsarten.length, wohngeld.antragsarten.length + 1)
    const art = roh.antragsarten.at(-1)
    assert.ok(art)
    assert.equal(art.personen?.antragsteller?.gruppe, 'G99000000001')
    assert.equal(art.stichtag, 'F99000000002')
    assert.deepEqual(roh.personen, wohngeld.personen, 'the profile keeps its own')
    assert.deepEqual(roh.antragsarten.slice(0, -1), wohngeld.antragsarten, 'the others stay as they are')
    assert.equal(wohngeld.antragsarten.length, 6, 'the profile handed in is not changed')
  })

  it('makes a profile the engine can load, consistent with its schemas', async () => {
    const { roh, datei } = fuegeEin(wohngeld)
    const profil = await ladeProfil(liesMitProfil(lies, WOHNGELD, roh, { [datei.pfad]: datei.inhalt }), WOHNGELD)
    const { fehler } = await validiereProfil(profil)
    assert.deepEqual(fehler, [])
    assert.equal(profil.anbindungFuer(SCHEMA).personen.antragsteller?.gruppe, 'G99000000001')
    assert.deepEqual(profil.anbindungFuer(MIETZUSCHUSS).personen, wohngeld.personen)
    assert.ok((profil.verwendungenFuer(SCHEMA).get('disability_notice')?.length ?? 0) > 0)
  })

  it('keeps what is decided when the schema is read again, with the ids and the order', () => {
    const eins = fuegeEin(neu()).roh
    const entschieden = setzeRolle(eins, SCHEMA, 'unterschrift', 'other_document', 'genuegt')
    const zwei = fuegeEin(entschieden).roh
    assert.equal(zwei.antragsarten.length, 1)
    assert.deepEqual(
      zwei.antragsarten[0]?.stellen.map(({ id }) => id),
      eins.antragsarten[0]?.stellen.map(({ id }) => id),
    )
    const unterschrift = zwei.antragsarten[0]?.stellen.find(({ id }) => id === 'unterschrift')?.bedingungen[0]
    assert.ok(unterschrift)
    assert.deepEqual([unterschrift.status, unterschrift.nachweise], ['festgelegt', { other_document: 'genuegt' }])
  })

  it('counts places and conditions by their state', () => {
    const [art] = fuegeEin(neu()).roh.antragsarten
    assert.ok(art)
    const ohneNachweis: StelleFormat2 = {
      id: 'x',
      position: '/F1',
      titel: 'X',
      bereich: 'Allgemein',
      herkunft: { art: 'immer' },
      ohne: 'Grund',
      bedingungen: [],
    }
    const mitOhne = { ...art, stellen: [...art.stellen, ohneNachweis] }
    assert.deepEqual(zaehleAntragsart(mitOhne), { stellen: 4, ohne: 1, bedingungen: 4, festgelegt: 0, vorschlag: 3, offen: 1 })
  })
})
