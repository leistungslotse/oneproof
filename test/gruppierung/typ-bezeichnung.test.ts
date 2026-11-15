import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import {
  AUFFANGTYP,
  GRUPPENBEZEICHNUNGEN,
  KURZBEZEICHNUNGEN,
  bezeichnungFuer,
  bezeichnungInGruppe,
  katalogEintrag,
  kurzbezeichnungFuer,
  kurzbezeichnungInGruppe,
} from '../../src/engine/gruppierung/typ-bezeichnung.ts'
import type { Katalog } from '../../src/engine/gruppierung/typ-bezeichnung.ts'

// Trusted test data: the catalog as the profile ships it.
const katalog: Katalog = JSON.parse(
  readFileSync(new URL('../../public/profile/wohngeld/2026-11-15/dokumenttypen.json', import.meta.url), 'utf8'),
)

/** The label the catalog gives a type; the catalog has one for each type. */
function labelVon(typ: string): string {
  const label = katalog[typ]?.label
  assert.ok(label !== undefined, `${typ} has a label`)
  return label
}

describe('AUFFANGTYP', () => {
  it('ist der Auffangtyp des Katalogs', () => {
    assert.equal(AUFFANGTYP, 'other_document')
    assert.equal(katalog[AUFFANGTYP]?.label, 'Sonstiger Nachweis')
  })
})

describe('bezeichnungFuer', () => {
  it('liefert den Anzeigenamen aus dem Katalog', () => {
    assert.equal(bezeichnungFuer('payslip', katalog), 'Lohn-/Gehaltsabrechnung')
    assert.equal(bezeichnungFuer('identity_document', katalog), 'Ausweisdokument')
    assert.equal(bezeichnungFuer('registration_certificate', katalog), 'Meldebescheinigung / Haushaltsbescheinigung')
    assert.equal(bezeichnungFuer(AUFFANGTYP, katalog), 'Sonstiger Nachweis')
  })

  it('kennt zu jedem Typ des Katalogs seinen Namen', () => {
    for (const [type, entry] of Object.entries(katalog)) {
      assert.equal(bezeichnungFuer(type, katalog), entry.label, type)
    }
  })

  it('macht aus einem Typ außerhalb des Katalogs eine lesbare Bezeichnung', () => {
    // The invented type of the model becomes the name of the document ("Gesellschaftsvertrag").
    assert.equal(bezeichnungFuer('gesellschaftsvertrag', katalog), 'Gesellschaftsvertrag')
    assert.equal(bezeichnungFuer('not_a_real_type', katalog), 'Not a real type')
    assert.equal(bezeichnungFuer('sterbe_urkunde_neu', katalog), 'Sterbe urkunde neu')
    assert.equal(bezeichnungFuer('Gewerbe_Anmeldung', katalog), 'Gewerbe Anmeldung')
  })

  it('setzt den ersten BUCHSTABEN groß, nicht das erste Byte', () => {
    assert.equal(bezeichnungFuer('über_x', katalog), 'Über x')
    assert.equal(bezeichnungFuer('ärztliches_attest', katalog), 'Ärztliches attest')
    assert.equal(bezeichnungFuer('ßx', katalog), 'SSx')
    assert.equal(bezeichnungFuer('😀_x', katalog), '😀 x')
  })

  it('gibt für einen leeren Typ eine leere Bezeichnung', () => {
    assert.equal(bezeichnungFuer('', katalog), '')
    assert.equal(bezeichnungFuer(undefined, katalog), '')
    assert.equal(bezeichnungFuer(null, katalog), '')
  })

  it('fällt auf den Schlüssel zurück, wenn der Katalog keinen brauchbaren Namen hat', () => {
    // invalid on purpose: labels that are no text, entries that are no objects
    const eigener = { leer: { label: '' }, zahl: { label: 7 }, ohne: {}, nichts: null } as never

    assert.equal(bezeichnungFuer('leer', eigener), 'Leer')
    assert.equal(bezeichnungFuer('zahl', eigener), 'Zahl')
    assert.equal(bezeichnungFuer('ohne', eigener), 'Ohne')
    assert.equal(bezeichnungFuer('nichts', eigener), 'Nichts')
  })

  it('verträgt einen fehlenden Katalog', () => {
    // invalid on purpose
    for (const missing of [undefined, null, 'kein Katalog', 7]) {
      assert.equal(bezeichnungFuer('payslip', missing as never), 'Payslip')
    }
  })

  it('greift nicht in Object.prototype', () => {
    assert.equal(bezeichnungFuer('constructor', katalog), 'Constructor')
    // Humanised like any unknown key: the underscores become spaces.
    assert.equal(bezeichnungFuer('__proto__', katalog), '  proto  ')
    assert.equal(bezeichnungFuer('toString', katalog), 'ToString')
    assert.equal(katalogEintrag('constructor', katalog), null)
    assert.equal(katalogEintrag('payslip', katalog), katalog.payslip)
    assert.equal(katalogEintrag('unbekannt', katalog), null)
  })
})

describe('Kurzbezeichnungen', () => {
  it('führen nur Typen des Katalogs und sind kürzer als dessen Namen', () => {
    for (const [type, short] of Object.entries(KURZBEZEICHNUNGEN)) {
      assert.ok(Object.hasOwn(katalog, type), `${type} is in the catalog`)
      assert.ok(short.length <= labelVon(type).length, `${type}: "${short}" is not longer than "${labelVon(type)}"`)
    }
  })

  it('geben die Kurzform, ohne Eintrag den Katalognamen', () => {
    assert.equal(kurzbezeichnungFuer('registration_certificate', katalog), 'Meldebescheinigung')
    assert.equal(kurzbezeichnungFuer('maintenance_title', katalog), 'Unterhaltstitel')
    assert.equal(kurzbezeichnungFuer('payslip', katalog), 'Lohn-/Gehaltsabrechnung')
    assert.equal(kurzbezeichnungFuer('gesellschaftsvertrag', katalog), 'Gesellschaftsvertrag')
    assert.equal(kurzbezeichnungFuer('constructor', katalog), 'Constructor')
  })

  it('kürzen jeden Katalognamen, der sonst die schmale Spalte sprengt', () => {
    // The long names list every genus a type covers because they brief the model. At a badge the
    // genus is enough. The guard of the PHP suite: every long catalog name has a short form.
    const longNames = Object.keys(katalog).filter((type) => labelVon(type).length > 50)

    assert.ok(longNames.length > 0)
    for (const type of longNames) {
      assert.ok(type in KURZBEZEICHNUNGEN, `${type} ("${labelVon(type)}") has a short form`)
    }
  })
})

describe('Bezeichnungen in der Rolle einer Nachweisgruppe', () => {
  it('heißt dieselbe Urkunde je nach Gruppe verschieden', () => {
    // Maintenance as INCOME (§ 14 WoGG) against maintenance as a DEDUCTION (§ 18 WoGG).
    assert.equal(bezeichnungInGruppe('benefit:maintenance_payment_proof', 'maintenance_payment_proof', katalog), 'Einnahmen aus Unterhalt')
    assert.equal(bezeichnungInGruppe('alimony_proof', 'maintenance_payment_proof', katalog), 'Zahlungsnachweis Unterhalt')
    assert.equal(bezeichnungInGruppe('building_contract_proof', 'asset_proof', katalog), 'Jahresauszug Bausparvertrag')
    assert.equal(bezeichnungInGruppe('building_contract_proof', AUFFANGTYP, katalog), 'Unterlagen der Personenversicherung')
    assert.equal(bezeichnungInGruppe('other_income_proof', AUFFANGTYP, katalog), 'Nachweis sonstiger Einnahmen')
  })

  it('nehmen ohne Eintrag den Katalognamen', () => {
    assert.equal(bezeichnungInGruppe('alimony_proof', 'payslip', katalog), 'Lohn-/Gehaltsabrechnung')
    assert.equal(bezeichnungInGruppe('unbekannte_gruppe', 'maintenance_payment_proof', katalog), labelVon('maintenance_payment_proof'))
    assert.equal(bezeichnungInGruppe('constructor', 'name', katalog), 'Name')
    // invalid on purpose
    assert.equal(bezeichnungInGruppe(undefined as never, 'payslip', katalog), 'Lohn-/Gehaltsabrechnung')
  })

  it('nehmen in der Kurzform zuerst den Namen der Gruppe, dann die Kurzform', () => {
    assert.equal(kurzbezeichnungInGruppe('benefit:maintenance_payment_proof', 'maintenance_payment_proof', katalog), 'Einnahmen aus Unterhalt')
    // No role name: the short form.
    assert.equal(kurzbezeichnungInGruppe('alimony_proof', 'registration_certificate', katalog), 'Meldebescheinigung')
    assert.equal(kurzbezeichnungInGruppe('unbekannte_gruppe', 'payslip', katalog), 'Lohn-/Gehaltsabrechnung')
  })

  it('führen nur Typen des Katalogs', () => {
    for (const [group, names] of Object.entries(GRUPPENBEZEICHNUNGEN)) {
      for (const type of Object.keys(names)) {
        assert.ok(Object.hasOwn(katalog, type), `${group}: ${type} is in the catalog`)
      }
    }
  })
})
