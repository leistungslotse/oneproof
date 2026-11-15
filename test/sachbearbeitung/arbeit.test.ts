import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { neuesProfil } from '../../src/engine/profil/antragsart.ts'
import { finde, setzeHinweis, setzeRolle } from '../../src/engine/profil/bearbeiten.ts'
import type { AntragsartFormat2, ProfilFormat2 } from '../../src/engine/profil/bedingungen.ts'
import { arbeitsprofil, bearbeite, waehleBasis } from '../../src/sachbearbeitung/arbeit.ts'
import type { Arbeitsstand } from '../../src/sachbearbeitung/arbeit.ts'
import { MIETZUSCHUSS, wohngeldFormat2 } from '../hilfen/format2.ts'

const { roh: basisRoh } = await wohngeldFormat2()
const miete = (roh: ProfilFormat2) => finde(roh, MIETZUSCHUSS, { bedingungId: 'miete' }).bedingung

/** The draft of a state that has one. */
function entwurfVon(stand: Arbeitsstand) {
  assert.ok(stand.entwurf)
  return stand.entwurf
}

describe('Welche Version öffnen', () => {
  const eintrag = { aktuell: '2026-11-07', versionen: ['2026-05-01', '2026-11-07'] }

  it('opens the current version if nothing else is asked for', () => {
    assert.deepEqual(waehleBasis({ eintrag, entwurf: null }), { version: '2026-11-07', neuere: null, verwaist: false })
  })

  it('opens the version that is asked for', () => {
    assert.equal(waehleBasis({ eintrag, gewuenscht: '2026-05-01', entwurf: null }).version, '2026-05-01')
  })

  it('opens the current one for a version the profile does not have', () => {
    assert.equal(waehleBasis({ eintrag, gewuenscht: '2020-01-01', entwurf: null }).version, '2026-11-07')
    assert.equal(waehleBasis({ eintrag, gewuenscht: '', entwurf: null }).version, '2026-11-07')
  })

  it('opens a draft on the version it was made from, whatever is asked for', () => {
    const ergebnis = waehleBasis({ eintrag, gewuenscht: '2026-11-07', entwurf: { basis: '2026-05-01' } })
    assert.deepEqual(ergebnis, { version: '2026-05-01', neuere: '2026-11-07', verwaist: false })
  })

  it('does not call a draft out of date that starts from the current version', () => {
    assert.equal(waehleBasis({ eintrag, entwurf: { basis: '2026-11-07' } }).neuere, null)
  })

  it('does not call a draft out of date for a current version that is older', () => {
    // The newest version may not be the current one (it was entered without becoming current).
    const alt = { aktuell: '2026-05-01', versionen: ['2026-05-01', '2026-11-07'] }
    assert.equal(waehleBasis({ eintrag: alt, entwurf: { basis: '2026-11-07' } }).neuere, null)
  })

  it('says if the version of the draft is gone, and opens the current one', () => {
    const ergebnis = waehleBasis({ eintrag, entwurf: { basis: '2025-01-01' } })
    assert.deepEqual(ergebnis, { version: '2026-11-07', neuere: null, verwaist: true })
  })
})

describe('Bearbeiten', () => {
  const stand: Arbeitsstand = { basisRoh, entwurf: null }
  const einTyp = (roh: ProfilFormat2) => setzeRolle(roh, MIETZUSCHUSS, 'miete', 'rent_contract', 'ergaenzt')

  it('makes the draft with the first change, marked as a draft', () => {
    const neu = bearbeite(stand, einTyp)
    assert.equal(entwurfVon(neu).basis, '2026-11-07')
    assert.equal(entwurfVon(neu).profil.version, '2026-11-07-entwurf')
    assert.equal(miete(entwurfVon(neu).profil).nachweise.rent_contract, 'ergaenzt')
    assert.equal(neu.basisRoh, basisRoh, 'the released version is not touched')
    assert.equal(miete(basisRoh).nachweise.rent_contract, 'genuegt')
  })

  it('makes no draft for a choice that changes nothing', () => {
    const gleich = bearbeite(stand, (roh) => setzeRolle(roh, MIETZUSCHUSS, 'miete', 'rent_contract', 'genuegt'))
    assert.equal(gleich, stand)
    assert.equal(gleich.entwurf, null)
  })

  it('continues the draft with the next change', () => {
    const eins = bearbeite(stand, einTyp)
    const zwei = bearbeite(eins, (roh) => setzeHinweis(roh, MIETZUSCHUSS, 'miete', 'Neu'))
    assert.equal(miete(entwurfVon(zwei).profil).nachweise.rent_contract, 'ergaenzt', 'the first change is kept')
    assert.equal(miete(entwurfVon(zwei).profil).hinweis, 'Neu')
    assert.equal(entwurfVon(zwei).basis, entwurfVon(eins).basis)
    assert.notEqual(zwei.entwurf, eins.entwurf, 'a new draft, the old one is not changed in place')
    assert.equal(miete(entwurfVon(eins).profil).hinweis, miete(basisRoh).hinweis)
  })

  it('keeps the draft if a later change changes nothing', () => {
    const eins = bearbeite(stand, einTyp)
    assert.equal(bearbeite(eins, einTyp), eins)
  })

  it('shows the draft if there is one, else the released version', () => {
    assert.equal(arbeitsprofil(stand), basisRoh)
    const neu = bearbeite(stand, einTyp)
    assert.equal(arbeitsprofil(neu), entwurfVon(neu).profil)
  })

  it('passes on what an edit refuses', () => {
    assert.throws(() => bearbeite(stand, (roh) => setzeRolle(roh, MIETZUSCHUSS, 'gibt_es_nicht', 'rent_contract', 'genuegt')), /„gibt_es_nicht“ gibt es in/)
  })

  it('keeps the files of the draft its profile uses, and only those', () => {
    const schema = { schemaId: 'S99000000001', version: '1.0.0', kinder: [] }
    const pfad = 'schema/S99000000001V1.0.0.json'
    const art: AntragsartFormat2 = { schema: 'S99000000001', version: '1.0.0', name: 'Wohnhilfe', datei: pfad, stellen: [] }
    const mitArt = bearbeite(stand, (roh) => ({ ...roh, antragsarten: [...roh.antragsarten, art] }), { [pfad]: schema })
    assert.deepEqual(entwurfVon(mitArt).dateien, { [pfad]: schema })
    assert.deepEqual(entwurfVon(bearbeite(stand, einTyp, { 'schema/S1V1.json': schema })).dateien, {}, 'a file the profile does not use')
    const ohneArt = bearbeite(mitArt, (roh) => ({ ...roh, antragsarten: roh.antragsarten.slice(0, -1) }))
    assert.deepEqual(entwurfVon(ohneArt).dateien, {}, 'gone with its application type')
  })

  it('continues a new profile, which has no version yet', () => {
    const neu: Arbeitsstand = { basisRoh: null, entwurf: { basis: null, profil: neuesProfil({ id: 'wohnhilfe', name: 'Wohnhilfe' }), dateien: {} } }
    const umbenannt = bearbeite(neu, (roh) => ({ ...roh, name: 'Wohnhilfe Nord' }))
    assert.equal(entwurfVon(umbenannt).profil.name, 'Wohnhilfe Nord')
    assert.equal(entwurfVon(umbenannt).basis, null)
  })

  it('refuses a change where there is neither a draft nor a version', () => {
    assert.throws(() => bearbeite({ basisRoh: null, entwurf: null }, einTyp), /weder einen Entwurf noch eine Version/)
  })
})
