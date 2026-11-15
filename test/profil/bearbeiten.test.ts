import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  aenderungen,
  bestaetige,
  finde,
  geaenderteBedingungen,
  setzeHinweis,
  setzeOhne,
  setzeRolle,
  setzeZeitraum,
  setzeZurueck,
  teileDerAenderung,
  uebernimmVon,
  unterscheide,
} from '../../src/engine/profil/bearbeiten.ts'
import { uebersetze } from '../../src/engine/profil/bedingungen.ts'
import type { ProfilFormat2 } from '../../src/engine/profil/bedingungen.ts'
import { LASTENZUSCHUSS, MIETZUSCHUSS, wohngeldFormat2 } from '../hilfen/format2.ts'

const { roh, schemas } = await wohngeldFormat2()
const SCHEMA = schemas.get(MIETZUSCHUSS)
assert.ok(SCHEMA, 'Das Schema des Mietzuschusses gibt es.')
const bedingung = (profil: ProfilFormat2, schema: string, id: string) => finde(profil, schema, { bedingungId: id }).bedingung
const stelle = (profil: ProfilFormat2, schema: string, id: string) => finde(profil, schema, { stelleId: id }).stelle

/** The profile with one condition back to a proposal. */
function alsVorschlag(profil: ProfilFormat2, schema: string, id: string): ProfilFormat2 {
  const neu = structuredClone(profil)
  bedingung(neu, schema, id).status = 'vorschlag'
  return neu
}

describe('Bearbeiten: finden', () => {
  it('finds the application type, the place and the condition', () => {
    const { antragsart, stelle: gefunden, bedingung: genau } = finde(roh, MIETZUSCHUSS, { bedingungId: 'miete' })
    assert.equal(antragsart.schema, MIETZUSCHUSS)
    assert.equal(gefunden.id, 'miete')
    assert.equal(genau.id, 'miete')
  })

  it('says what it cannot find', () => {
    assert.throws(() => finde(roh, 'S0', { stelleId: 'miete' }), /Antragsart S0 gibt es im Profil nicht/)
    assert.throws(() => finde(roh, MIETZUSCHUSS, { stelleId: 'gibt_es_nicht' }), /„gibt_es_nicht“ gibt es in Wohngeld – Mietzuschuss, Erstantrag nicht/)
    assert.throws(() => finde(roh, MIETZUSCHUSS, { bedingungId: 'gibt_es_nicht' }), /gibt es in/)
  })
})

describe('Bearbeiten: Nachweise einer Bedingung', () => {
  it('sets how a type counts, and leaves the profile it got as it was', () => {
    const neu = setzeRolle(roh, MIETZUSCHUSS, 'miete', 'bank_statement', 'genuegt')
    assert.equal(bedingung(neu, MIETZUSCHUSS, 'miete').nachweise.bank_statement, 'genuegt')
    assert.equal(bedingung(roh, MIETZUSCHUSS, 'miete').nachweise.bank_statement, 'pruefen')
  })

  it('takes a type out', () => {
    const neu = setzeRolle(roh, MIETZUSCHUSS, 'miete', 'bank_statement', null)
    assert.equal(Object.hasOwn(bedingung(neu, MIETZUSCHUSS, 'miete').nachweise, 'bank_statement'), false)
  })

  it('keeps what an entry says besides its role', () => {
    const neu = setzeRolle(roh, MIETZUSCHUSS, 'einnahmen', 'payslip', 'pruefen')
    assert.deepEqual(bedingung(neu, MIETZUSCHUSS, 'einnahmen').nachweise.payslip, { rolle: 'pruefen', merkmale: { income_type: 'salary' } })
  })

  it('changes only the application type it is told', () => {
    const neu = setzeRolle(roh, MIETZUSCHUSS, 'einnahmen', 'payslip', 'pruefen')
    assert.deepEqual(bedingung(neu, LASTENZUSCHUSS, 'einnahmen'), bedingung(roh, LASTENZUSCHUSS, 'einnahmen'))
  })

  it('returns the very profile for a choice that changes nothing', () => {
    assert.equal(setzeRolle(roh, MIETZUSCHUSS, 'miete', 'rent_contract', 'genuegt'), roh)
    assert.equal(setzeRolle(roh, MIETZUSCHUSS, 'miete', 'payslip', null), roh)
  })
})

describe('Bearbeiten: Zeitraum und Hinweis', () => {
  it('sets the period, without an age that is no whole number, and each type once', () => {
    const neu = setzeZeitraum(roh, MIETZUSCHUSS, 'einnahmen', { mindestens: 6, hoechstensAlt: null, fuer: ['payslip', 'payslip'] })
    assert.deepEqual(bedingung(neu, MIETZUSCHUSS, 'einnahmen').zeitraum, { mindestens: 6, fuer: ['payslip'] })
  })

  it('keeps the age and the mark for example values', () => {
    const neu = setzeZeitraum(roh, MIETZUSCHUSS, 'miete', { mindestens: 2, hoechstensAlt: 4, fuer: [], beispiel: true })
    assert.deepEqual(bedingung(neu, MIETZUSCHUSS, 'miete').zeitraum, { mindestens: 2, hoechstensAlt: 4, fuer: [], beispiel: true })
  })

  it('takes the period away', () => {
    const neu = setzeZeitraum(roh, MIETZUSCHUSS, 'einnahmen', null)
    assert.equal(Object.hasOwn(bedingung(neu, MIETZUSCHUSS, 'einnahmen'), 'zeitraum'), false)
  })

  it('sets the text for the applicant', () => {
    assert.equal(bedingung(setzeHinweis(roh, MIETZUSCHUSS, 'miete', 'Neu'), MIETZUSCHUSS, 'miete').hinweis, 'Neu')
    assert.equal(setzeHinweis(roh, MIETZUSCHUSS, 'miete', bedingung(roh, MIETZUSCHUSS, 'miete').hinweis), roh)
  })
})

describe('Bearbeiten: Stand einer Bedingung', () => {
  it('decides a proposal as it is', () => {
    const neu = bestaetige(alsVorschlag(roh, MIETZUSCHUSS, 'miete'), MIETZUSCHUSS, 'miete')
    assert.equal(bedingung(neu, MIETZUSCHUSS, 'miete').status, 'festgelegt')
    assert.equal(bestaetige(neu, MIETZUSCHUSS, 'miete'), neu)
  })

  it('decides whatever is set', () => {
    const neu = setzeHinweis(alsVorschlag(roh, MIETZUSCHUSS, 'miete'), MIETZUSCHUSS, 'miete', 'Neu')
    assert.equal(bedingung(neu, MIETZUSCHUSS, 'miete').status, 'festgelegt')
  })

  it('resets a condition to its version, the state included', () => {
    const geaendert = setzeRolle(roh, MIETZUSCHUSS, 'miete', 'bank_statement', null)
    assert.deepEqual(bedingung(setzeZurueck(geaendert, roh, MIETZUSCHUSS, 'miete'), MIETZUSCHUSS, 'miete'), bedingung(roh, MIETZUSCHUSS, 'miete'))
    const basis = alsVorschlag(roh, MIETZUSCHUSS, 'miete')
    assert.equal(bedingung(setzeZurueck(roh, basis, MIETZUSCHUSS, 'miete'), MIETZUSCHUSS, 'miete').status, 'vorschlag')
  })

  it('leaves a condition its version does not have', () => {
    const geteilt = unterscheide(roh, SCHEMA, 'einnahmen', 'F00000000574')
    const [erste] = stelle(geteilt, MIETZUSCHUSS, 'einnahmen').bedingungen
    assert.ok(erste)
    assert.equal(setzeZurueck(geteilt, roh, MIETZUSCHUSS, erste.id), geteilt)
  })
})

describe('Bearbeiten: von einer anderen Bedingung übernehmen', () => {
  it('takes documents, period and text of the same place in another application type', () => {
    const anders = setzeHinweis(setzeRolle(roh, LASTENZUSCHUSS, 'einnahmen', 'bank_statement', 'genuegt'), LASTENZUSCHUSS, 'einnahmen', 'Aus dem Lastenzuschuss')
    const neu = uebernimmVon(alsVorschlag(anders, MIETZUSCHUSS, 'einnahmen'), MIETZUSCHUSS, 'einnahmen', { schema: LASTENZUSCHUSS, bedingungId: 'einnahmen' })
    const ziel = bedingung(neu, MIETZUSCHUSS, 'einnahmen')
    const quelle = bedingung(anders, LASTENZUSCHUSS, 'einnahmen')
    assert.deepEqual([ziel.nachweise, ziel.zeitraum, ziel.hinweis, ziel.status], [quelle.nachweise, quelle.zeitraum, 'Aus dem Lastenzuschuss', 'festgelegt'])
  })

  it('drops a link to a condition the application type does not have', () => {
    // „fremdmittel“ of the Lastenzuschuss links to „belastung“, a condition the Mietzuschuss lacks.
    const neu = uebernimmVon(roh, MIETZUSCHUSS, 'miete', { schema: LASTENZUSCHUSS, bedingungId: 'fremdmittel' })
    const ziel = bedingung(neu, MIETZUSCHUSS, 'miete')
    assert.equal(ziel.nachweise.loan_contract, 'genuegt')
    assert.equal(Object.hasOwn(ziel, 'zeitraum'), false)
  })
})

describe('Bearbeiten: nach einer Antwort unterscheiden', () => {
  const geteilt = unterscheide(roh, SCHEMA, 'einnahmen', 'F00000000574')
  const teile = stelle(geteilt, MIETZUSCHUSS, 'einnahmen').bedingungen
  const vorher = bedingung(roh, MIETZUSCHUSS, 'einnahmen')

  it('makes a condition per answer, each a proposal with the setting the place had', () => {
    assert.equal(stelle(geteilt, MIETZUSCHUSS, 'einnahmen').unterscheiden, 'F00000000574')
    assert.equal(teile.length, 20)
    for (const teil of teile) {
      assert.equal(teil.id, `einnahmen:${teil.wenn?.ja?.[0]}`)
      assert.equal(teil.wenn?.feld, 'F00000000574')
      assert.equal(teil.status, 'vorschlag')
      assert.ok(teil.titel)
      assert.deepEqual([teil.nachweise, teil.zeitraum, teil.hinweis], [vorher.nachweise, vorher.zeitraum, vorher.hinweis])
    }
  })

  it('lets the engine read each condition as a place of its own, decided by its answer', () => {
    const orte = uebersetze(geteilt).stellen.filter(({ id, antragsarten }) => antragsarten?.[0] === MIETZUSCHUSS && id.startsWith('einnahmen:'))
    assert.equal(orte.length, 20)
    assert.ok(orte.every(({ id, nennt, nurFrage }) => nurFrage && nennt === teile.find((teil) => teil.id === id)?.wenn))
  })

  it('makes one condition again — decided only where all were the same and decided', () => {
    const eins = unterscheide(geteilt, SCHEMA, 'einnahmen', '')
    const zurueck = stelle(eins, MIETZUSCHUSS, 'einnahmen')
    assert.equal(Object.hasOwn(zurueck, 'unterscheiden'), false)
    assert.deepEqual(
      zurueck.bedingungen.map(({ id, status }) => [id, status]),
      [['einnahmen', 'vorschlag']],
    )
    const alleFest = teile.reduce((profil, teil) => bestaetige(profil, MIETZUSCHUSS, teil.id), geteilt)
    assert.equal(stelle(unterscheide(alleFest, SCHEMA, 'einnahmen', ''), MIETZUSCHUSS, 'einnahmen').bedingungen[0]?.status, 'festgelegt')
  })

  it('points a link to a condition that is gone to the first new one', () => {
    // „rent_change_notice“ at „mietveraenderung“ counts at „miete“ where nothing finer is asked.
    const neu = unterscheide(roh, SCHEMA, 'miete', 'je-frage')
    const [erste] = stelle(neu, MIETZUSCHUSS, 'miete').bedingungen
    assert.ok(erste)
    assert.deepEqual(bedingung(neu, MIETZUSCHUSS, 'mietveraenderung').nachweise.rent_change_notice, { rolle: 'genuegt', ersatzweise: { bedingung: erste.id, rolle: 'pruefen' } })
  })

  it('refuses a question the section does not have, and changes nothing for the choice it has', () => {
    assert.throws(() => unterscheide(roh, SCHEMA, 'einnahmen', 'F0'), /lässt sich die Stelle nicht unterscheiden/)
    assert.equal(unterscheide(roh, SCHEMA, 'einnahmen', ''), roh)
  })
})

describe('Bearbeiten: bewusst ohne Nachweis', () => {
  it('keeps the reason, and the engine asks for nothing there', () => {
    const ohne = setzeOhne(roh, MIETZUSCHUSS, 'kinderbetreuung', '  Wird im Termin geklärt. ')
    assert.equal(stelle(ohne, MIETZUSCHUSS, 'kinderbetreuung').ohne, 'Wird im Termin geklärt.')
    const orte = uebersetze(ohne).stellen.filter(({ id, antragsarten }) => id === 'kinderbetreuung' && antragsarten?.[0] === MIETZUSCHUSS)
    assert.deepEqual(orte, [])
  })

  it('asks for evidence again: with the conditions it had, or an open one', () => {
    const zurueck = setzeOhne(setzeOhne(roh, MIETZUSCHUSS, 'kinderbetreuung', 'x'), MIETZUSCHUSS, 'kinderbetreuung', null)
    assert.deepEqual(stelle(zurueck, MIETZUSCHUSS, 'kinderbetreuung'), stelle(roh, MIETZUSCHUSS, 'kinderbetreuung'))
    const wieder = stelle(setzeOhne(roh, MIETZUSCHUSS, 'upload_od', null), MIETZUSCHUSS, 'upload_od')
    assert.equal(Object.hasOwn(wieder, 'ohne'), false)
    assert.deepEqual(wieder.bedingungen, [{ id: 'upload_od', status: 'offen', nachweise: {}, hinweis: '' }])
  })
})

describe('Was ein Entwurf ändert', () => {
  const NAME = 'Wohngeld – Mietzuschuss, Erstantrag'

  it('lists nothing for the profile as it is', () => {
    assert.deepEqual(aenderungen(roh, roh), [])
  })

  it('says where and what, per condition', () => {
    let neu = setzeRolle(roh, MIETZUSCHUSS, 'miete', 'bank_statement', null)
    neu = setzeRolle(neu, MIETZUSCHUSS, 'miete', 'payslip', 'ergaenzt')
    neu = setzeZeitraum(neu, MIETZUSCHUSS, 'einnahmen', { mindestens: 6, fuer: ['payslip'] })
    neu = setzeHinweis(neu, MIETZUSCHUSS, 'einnahmen', 'Neu')
    assert.deepEqual(aenderungen(roh, neu), [
      { schema: MIETZUSCHUSS, antragsart: NAME, stelleId: 'miete', stelle: 'Höhe der Miete', bedingungId: 'miete', bedingung: null, teile: ['2 Nachweisarten geändert'] },
      { schema: MIETZUSCHUSS, antragsart: NAME, stelleId: 'einnahmen', stelle: 'Einkommen', bedingungId: 'einnahmen', bedingung: null, teile: ['Zeitraum: 3 Monate → 6 Monate', 'Hinweistext geändert'] },
    ])
  })

  it('says that a proposal was taken as it is, and ignores spaces around a text', () => {
    assert.deepEqual(teileDerAenderung({ status: 'vorschlag', nachweise: { a: 'genuegt' } }, { status: 'festgelegt', nachweise: { a: 'genuegt' } }), ['als „Festgelegt“ übernommen'])
    assert.deepEqual(teileDerAenderung({ status: 'festgelegt', hinweis: 'Text' }, { status: 'festgelegt', hinweis: ' Text ' }), [])
  })

  it('takes a place told apart, a new application type and one that is gone as one change each', () => {
    const geteilt = unterscheide(roh, SCHEMA, 'einnahmen', 'F00000000574')
    assert.deepEqual(
      aenderungen(roh, geteilt).map(({ stelleId, teile }) => [stelleId, teile]),
      [['einnahmen', ['20 Bedingungen statt 1']]],
    )
    const ohneErste = { ...roh, antragsarten: roh.antragsarten.slice(1) }
    assert.deepEqual(
      aenderungen(roh, ohneErste).map(({ schema, teile }) => [schema, teile]),
      [[MIETZUSCHUSS, ['entfernt']]],
    )
    assert.deepEqual(
      aenderungen(ohneErste, roh).map(({ schema, teile }) => [schema, teile]),
      [[MIETZUSCHUSS, ['neu angelegt']]],
    )
    assert.equal(aenderungen(null, roh).length, 6, 'a new profile: every application type is new')
  })

  it('names the conditions a draft changes — all of a place changed as a whole', () => {
    const neu = setzeHinweis(unterscheide(roh, SCHEMA, 'einnahmen', 'F00000000574'), MIETZUSCHUSS, 'miete', 'x')
    const ids = geaenderteBedingungen(aenderungen(roh, neu), neu)
    assert.equal(ids.size, 21)
    assert.ok(ids.has(`${MIETZUSCHUSS}|miete`))
    for (const teil of stelle(neu, MIETZUSCHUSS, 'einnahmen').bedingungen) assert.ok(ids.has(`${MIETZUSCHUSS}|${teil.id}`))
  })
})
