import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { finde, setzeRolle, unterscheide } from '../../src/engine/profil/bearbeiten.ts'
import type { Bedingung, ProfilFormat2 } from '../../src/engine/profil/bedingungen.ts'
import { ROLLE } from '../../src/engine/profil/laden.ts'
import {
  bedingungsText,
  filtereZeilen,
  giltWenn,
  gruppiereStellen,
  jePerson,
  kurznamen,
  liesMonate,
  merkmalText,
  nachweisText,
  NICHT_ZUGELASSEN,
  offenImProfil,
  passtZumFilter,
  pfadText,
  rollenSatz,
  satzText,
  satzVon,
  vorlagenFuer,
  vorschauQuellen,
  WAHL,
  wahlFuer,
  wahlZuWert,
  zaehleBedingungen,
  zaehltJeMonat,
  zeilenFuer,
  zeitraumText,
} from '../../src/sachbearbeitung/ansicht.ts'
import { LASTENZUSCHUSS, MIETZUSCHUSS, wohngeldFormat2 } from '../hilfen/format2.ts'

const { roh, schemas, typen } = await wohngeldFormat2()
const SCHEMA = schemas.get(MIETZUSCHUSS)
const mietzuschuss = roh.antragsarten.find(({ schema }) => schema === MIETZUSCHUSS)
assert.ok(SCHEMA)
assert.ok(mietzuschuss)
const stelle = (profil: ProfilFormat2, id: string, schema = MIETZUSCHUSS) => finde(profil, schema, { stelleId: id }).stelle
const bedingung = (profil: ProfilFormat2, id: string, schema = MIETZUSCHUSS) => finde(profil, schema, { bedingungId: id }).bedingung

/** The first of a list that has one. */
function ersten<T>(liste: readonly T[]): T {
  const [erstes] = liste
  assert.ok(erstes !== undefined)
  return erstes
}

describe('Auswahl je Nachweis', () => {
  it('offers every role the engine knows, strongest first, and "not accepted" last', () => {
    assert.deepEqual(
      WAHL.map(({ rolle }) => rolle),
      [ROLLE.GENUEGT, ROLLE.PRUEFEN, ROLLE.ERGAENZT, null],
    )
    assert.deepEqual(
      WAHL.map(({ folge }) => folge),
      ['belegt', 'unklar', 'offen', null],
      'the state the statement can reach',
    )
    assert.equal(new Set(WAHL.map(({ wert }) => wert)).size, WAHL.length, 'a value for each choice, none twice')
    for (const wahl of WAHL) assert.ok(wahl.titel && wahl.beschreibung, wahl.wert)
  })

  it('carries every choice as text, because a select does', () => {
    for (const { wert } of WAHL) assert.equal(typeof wert, 'string')
    assert.equal(wahlZuWert(NICHT_ZUGELASSEN)?.rolle, null)
  })

  it('finds the choice of a role, and of none', () => {
    assert.equal(wahlFuer('genuegt').titel, 'Genügt')
    assert.equal(wahlFuer('pruefen').titel, 'Kann genügen')
    assert.equal(wahlFuer('ergaenzt').titel, 'Ergänzt nur')
    assert.equal(wahlFuer(null).titel, 'Nicht zugelassen')
    assert.equal(wahlFuer(undefined).titel, 'Nicht zugelassen')
  })

  it('does not take a value that is none of the choices for "not accepted"', () => {
    assert.equal(wahlZuWert('genuegt')?.rolle, 'genuegt')
    assert.equal(wahlZuWert('irgendwas'), undefined)
    assert.equal(wahlZuWert(''), undefined)
    assert.equal(wahlZuWert(undefined), undefined)
  })
})

describe('Gilt, wenn', () => {
  it('reads the question of a place with the answers that ask for evidence', () => {
    const { saetze, art } = giltWenn(stelle(roh, 'miete'), SCHEMA)
    assert.equal(art, null)
    assert.equal(saetze.length, 1)
    assert.equal(saetze[0]?.frage, 'Ich bin', 'without the question mark')
    assert.deepEqual(saetze[0]?.antworten.slice(0, 2), ['Hauptmieter/Hauptmieterin', 'Untermieter/Untermieterin'])
  })

  it('names a yes/no answer, and a field that only has to be filled in', () => {
    assert.deepEqual(giltWenn(stelle(roh, 'mietveraenderung'), SCHEMA).saetze[0]?.antworten, ['Ja'])
    const flaeche = giltWenn(stelle(roh, 'wohnflaeche', LASTENZUSCHUSS), schemas.get(LASTENZUSCHUSS)).saetze[0]
    assert.ok(flaeche)
    assert.deepEqual(flaeche, { frage: 'Wie groß ist der Wohnraum in m²', antworten: [], gefuellt: true })
    assert.equal(satzText(flaeche), '„Wie groß ist der Wohnraum in m²“ ist ausgefüllt')
  })

  it('goes by the section where no question decides, or by the place itself', () => {
    assert.deepEqual(giltWenn(stelle(roh, 'einnahmen'), SCHEMA), { saetze: [], art: 'abschnitt' })
    assert.deepEqual(giltWenn(stelle(roh, 'sorgerecht'), SCHEMA), { saetze: [], art: 'immer' })
    assert.deepEqual(giltWenn({ position: 'G1/F1', nennt: 'immer' }, SCHEMA), { saetze: [], art: 'immer' })
  })

  it('says it in one line, for the place or for a condition of its own', () => {
    assert.equal(bedingungsText(stelle(roh, 'einnahmen'), bedingung(roh, 'einnahmen'), SCHEMA), 'der Abschnitt im Antrag ausgefüllt ist')
    assert.equal(bedingungsText(stelle(roh, 'sorgerecht'), bedingung(roh, 'sorgerecht'), SCHEMA), 'der Antrag diese Stelle enthält')
    assert.match(bedingungsText(stelle(roh, 'miete'), bedingung(roh, 'miete'), SCHEMA), /^Ich bin = „Hauptmieter\/Hauptmieterin“ oder „Untermieter\/Untermieterin“ oder /)

    const geteilt = unterscheide(roh, SCHEMA, 'einnahmen', 'F00000000574')
    const [erste] = stelle(geteilt, 'einnahmen').bedingungen
    assert.ok(erste)
    assert.ok(erste.wenn)
    assert.match(bedingungsText(stelle(geteilt, 'einnahmen'), erste, SCHEMA), /^.+ = „.+“$/)
    assert.equal(bedingungsText(stelle(geteilt, 'einnahmen'), erste, SCHEMA), satzText(satzVon(erste.wenn, SCHEMA)))
  })

  it('keeps the code of an answer, and the field, the schema does not name', () => {
    assert.deepEqual(satzVon({ feld: 'F0', ja: ['001', '001', 'true'] }, SCHEMA), { frage: 'F0', antworten: ['001', 'Ja'], gefuellt: false })
    assert.equal(satzText(satzVon({ feld: 'F0', ja: ['001', '002'] }, null)), 'F0 = „001“ oder „002“')
  })
})

describe('Wo die Stelle im Antrag steht', () => {
  it('names the groups down to the field', () => {
    assert.equal(pfadText(stelle(roh, 'einnahmen'), SCHEMA), 'Details zur antragstellenden Person › Einnahmen › Angaben zu Einnahmen und enthaltene Werbungskosten › Art und Höhe der Einnahmen › Nachweis')
    assert.equal(pfadText(stelle(roh, 'upload_od'), SCHEMA), 'Upload OD', 'a field at the top')
    assert.equal(pfadText(stelle(roh, 'miete'), null), null, 'nothing without the schema')
  })

  it('knows a place that is asked for every person', () => {
    const anbindung = { personen: roh.personen }
    assert.equal(jePerson(stelle(roh, 'einnahmen'), anbindung, SCHEMA), true)
    assert.equal(jePerson(stelle(roh, 'miete'), anbindung, SCHEMA), false)
    assert.equal(jePerson(stelle(roh, 'einnahmen'), {}, SCHEMA), false, 'not without a binding')
  })
})

describe('Stellen und Bedingungen zählen', () => {
  it('groups the places by section, in the order of the application, and those without evidence apart', () => {
    const { bereiche, ohne } = gruppiereStellen(mietzuschuss)
    assert.deepEqual(
      bereiche.map(({ bereich }) => bereich),
      ['Wohnen', 'Einkommen', 'Vermögen', 'Haushalt', 'Besondere Umstände'],
    )
    assert.deepEqual(
      bereiche[0]?.stellen.map(({ id }) => id),
      ['miete', 'heimvertrag', 'mietveraenderung', 'mitbewohner'],
    )
    assert.deepEqual(
      ohne.map(({ id }) => id),
      ['upload_od', 'angaben_zur_aufforderung_wohngeldbeantra'],
    )
    // The place has no section (an empty one counts as none).
    assert.equal(gruppiereStellen({ stellen: [{ id: 'x', position: '', titel: '', bereich: '', herkunft: { art: 'immer' }, bedingungen: [] }] }).bereiche[0]?.bereich, 'Allgemein')
  })

  it('counts the conditions by their state, and those a draft changes', () => {
    assert.deepEqual(zaehleBedingungen(mietzuschuss), { gesamt: 20, festgelegt: 20, vorschlag: 0, offen: 0, geaendert: 0 })
    const geteilt = unterscheide(roh, SCHEMA, 'einnahmen', 'F00000000574')
    const art = geteilt.antragsarten.find(({ schema }) => schema === MIETZUSCHUSS)
    const geaendert = new Set([`${MIETZUSCHUSS}|miete`, `${LASTENZUSCHUSS}|miete`])
    assert.deepEqual(zaehleBedingungen(art, geaendert), { gesamt: 39, festgelegt: 19, vorschlag: 20, offen: 0, geaendert: 1 })
  })

  it('filters by state, or by what changed', () => {
    const vorschlag: Pick<Bedingung, 'status'> = { status: 'vorschlag' }
    assert.equal(passtZumFilter('alle', vorschlag, false), true)
    assert.equal(passtZumFilter('vorschlag', vorschlag, false), true)
    assert.equal(passtZumFilter('offen', vorschlag, true), false)
    assert.equal(passtZumFilter('geaendert', vorschlag, true), true)
    assert.equal(passtZumFilter('geaendert', vorschlag, false), false)
  })

  it('lists the open conditions of the whole profile, and counts the proposals', () => {
    assert.deepEqual(offenImProfil(roh), { offen: [], vorschlaege: 0 })
    const geteilt = unterscheide(roh, SCHEMA, 'einnahmen', 'F00000000574')
    const mitOffener = structuredClone(geteilt)
    ersten(stelle(mitOffener, 'einnahmen').bedingungen).status = 'offen'
    ersten(stelle(mitOffener, 'vollmacht').bedingungen).status = 'offen'
    const { offen, vorschlaege } = offenImProfil(mitOffener)
    assert.equal(vorschlaege, 19)
    assert.deepEqual(
      offen.map(({ stelle: titel, bedingung: teil }) => [titel, teil]),
      [
        ['Einkommen', ersten(stelle(geteilt, 'einnahmen').bedingungen).titel],
        ['Vollmacht', null],
      ],
    )
  })
})

describe('Namen der Antragsarten', () => {
  it('leaves out what all names begin with, up to a separator', () => {
    assert.deepEqual(
      [...kurznamen(roh.antragsarten).values()],
      ['Mietzuschuss, Erstantrag', 'Mietzuschuss, Weiterleistungsantrag', 'Mietzuschuss, Erhöhungsantrag', 'Lastenzuschuss, Erstantrag', 'Lastenzuschuss, Weiterleistungsantrag', 'Lastenzuschuss, Erhöhungsantrag'],
    )
    const zwei = [
      { schema: 'A', name: 'Wohngeld – Mietzuschuss, Erstantrag' },
      { schema: 'B', name: 'Wohngeld – Mietzuschuss, Weiterleistungsantrag' },
    ]
    assert.deepEqual([...kurznamen(zwei).values()], ['Erstantrag', 'Weiterleistungsantrag'])
  })

  it('keeps a name whole where it stands alone or nothing would remain', () => {
    assert.deepEqual([...kurznamen([{ schema: 'A', name: 'Wohngeld – Mietzuschuss' }]).values()], ['Wohngeld – Mietzuschuss'])
    assert.deepEqual([...kurznamen([{ schema: 'A', name: 'Antrag' }, { schema: 'B', name: 'Antrag' }]).values()], ['Antrag', 'Antrag'])
    assert.deepEqual([...kurznamen([{ schema: 'S1' }]).values()], ['S1'], 'the schema where there is no name')
  })
})

describe('Übernehmen von', () => {
  it('offers the same place in the other application types', () => {
    const vorlagen = vorlagenFuer(roh, MIETZUSCHUSS, stelle(roh, 'einnahmen'), 'einnahmen')
    assert.equal(vorlagen.length, 5)
    assert.deepEqual(vorlagen[0], { schema: 'S01000000124', bedingungId: 'einnahmen', text: 'Mietzuschuss, Weiterleistungsantrag › Einkommen' })
    assert.ok(vorlagen.every(({ schema }) => schema !== MIETZUSCHUSS))
  })

  it('offers the other conditions of a place told apart, not the condition itself', () => {
    const geteilt = unterscheide(roh, SCHEMA, 'einnahmen', 'F00000000574')
    const [erste, zweite] = stelle(geteilt, 'einnahmen').bedingungen
    assert.ok(erste)
    assert.ok(zweite)
    const vorlagen = vorlagenFuer(geteilt, MIETZUSCHUSS, stelle(geteilt, 'einnahmen'), erste.id)
    const eigene = vorlagen.filter(({ schema }) => schema === MIETZUSCHUSS)
    assert.equal(eigene.length, 19)
    assert.deepEqual(eigene[0], { schema: MIETZUSCHUSS, bedingungId: zweite.id, text: zweite.titel })
    assert.ok(!eigene.some(({ bedingungId }) => bedingungId === erste.id))
  })
})

describe('Nachweise einer Bedingung in Worten', () => {
  it('counts the accepted documents by role', () => {
    assert.equal(nachweisText(bedingung(roh, 'miete')), '2 genügen · 2 können genügen · 3 ergänzen nur')
    assert.equal(nachweisText({ nachweise: { a: 'genuegt', b: { rolle: 'pruefen' } } }), '1 genügt · 1 kann genügen')
    assert.equal(nachweisText({ nachweise: {} }), 'noch keine Nachweise zugelassen')
  })

  it('says in a sentence what counts, and that nothing is asked for while nothing is accepted', () => {
    assert.equal(rollenSatz({ nachweise: { a: 'genuegt', b: 'genuegt', c: 'pruefen' } }), '2 Nachweisarten genügen allein und 1 kann genügen. Alle anderen zählen hier nicht.')
    assert.equal(rollenSatz({ nachweise: { a: 'ergaenzt' } }), 'Keine Nachweisart genügt allein und 1 ergänzt nur. Alle anderen zählen hier nicht.')
    assert.match(rollenSatz({ nachweise: {} }), /verlangt die Prüfung hier nichts/)
  })

  it('says the period', () => {
    assert.equal(zeitraumText(bedingung(roh, 'einnahmen').zeitraum), 'mindestens 3 Monate, höchstens 6 Monate alt')
    assert.equal(zeitraumText({ mindestens: 1, fuer: [] }), 'mindestens 1 Monat')
    assert.equal(zeitraumText(undefined), null)
  })

  it('shows the applicant the accepted documents by name', () => {
    const quellen = vorschauQuellen(bedingung(roh, 'miete'), typen)
    assert.equal(quellen.length, 7)
    assert.deepEqual(quellen[0], { typ: 'heating_statement', label: 'Heizkosten-/Warmwasserabrechnung', rolle: 'ergaenzt' })
    assert.deepEqual(
      quellen.map(({ label }) => label),
      quellen.map(({ label }) => label).toSorted((a, b) => a.localeCompare(b, 'de')),
    )
  })

  it('knows a document that is counted month by month', () => {
    assert.equal(zaehltJeMonat(typen.get('payslip')), true)
    assert.equal(zaehltJeMonat(typen.get('rent_contract')), false)
    assert.equal(zaehltJeMonat(undefined), false)
  })
})

describe('Zeilen einer Bedingung', () => {
  const miete = bedingung(roh, 'miete')

  it('has a row for every document type of the catalogue, and the types it names first', () => {
    const zeilen = zeilenFuer(miete, miete, typen)
    assert.equal(zeilen.length, typen.size)
    const vorgesehen = zeilen.filter((zeile) => zeile.vorgesehen)
    assert.equal(vorgesehen.length, 7)
    assert.deepEqual(
      zeilen.slice(0, 7).map(({ rolle }) => rolle),
      ['genuegt', 'genuegt', 'pruefen', 'pruefen', 'ergaenzt', 'ergaenzt', 'ergaenzt'],
      'strongest first',
    )
    assert.ok(zeilen.slice(7).every(({ rolle, vorgesehen: genannt }) => rolle === null && !genannt))
  })

  it('keeps a row where it was while it is set, and says how it counted before', () => {
    const geaendert = setzeRolle(setzeRolle(roh, MIETZUSCHUSS, 'miete', 'rent_contract', 'ergaenzt'), MIETZUSCHUSS, 'miete', 'payslip', 'genuegt')
    const zeilen = zeilenFuer(bedingung(geaendert, 'miete'), miete, typen, miete)
    const vertrag = zeilen.find(({ typ }) => typ === 'rent_contract')
    assert.ok(vertrag)
    assert.deepEqual([vertrag.rolle, vertrag.vorher], ['ergaenzt', 'genuegt'])
    assert.ok(zeilen.indexOf(vertrag) < 2, 'still among the first')
    const lohn = zeilen.find(({ typ }) => typ === 'payslip')
    assert.ok(lohn)
    assert.deepEqual([lohn.rolle, lohn.vorher, lohn.vorgesehen], ['genuegt', null, false])
  })

  it('has no "before" for a condition its version does not have', () => {
    assert.ok(zeilenFuer(miete, null, typen).every(({ vorher }) => vorher === undefined))
  })

  it('carries the conditions of a line, and keeps a type the catalogue does not know', () => {
    const lohn = zeilenFuer(bedingung(roh, 'einnahmen'), null, typen).find(({ typ }) => typ === 'payslip')
    assert.ok(lohn)
    assert.deepEqual(lohn.merkmale, { income_type: 'salary' })
    const fremd = zeilenFuer({ nachweise: { gibt_es_nicht: 'genuegt' } }, null, typen)
    assert.deepEqual(fremd[0], { typ: 'gibt_es_nicht', label: 'gibt_es_nicht', rolle: 'genuegt', merkmale: {}, ersatzweise: null, vorher: undefined, vorgesehen: true, unbekannt: true })
  })
})

describe('Zeilen suchen', () => {
  const zeilen = zeilenFuer(bedingung(roh, 'miete'), null, typen)
  const typenVon = (gefiltert: readonly { typ: string }[]) => gefiltert.map(({ typ }) => typ)

  it('finds by what is written, in any case', () => {
    assert.ok(typenVon(filtereZeilen(zeilen, 'MIETVERTRAG')).includes('rent_contract'))
    assert.ok(typenVon(filtereZeilen(zeilen, 'mietvertrag')).includes('rent_contract'))
  })

  it('finds by the key of the type as well', () => {
    assert.deepEqual(typenVon(filtereZeilen(zeilen, 'rent_contract')), ['rent_contract'])
  })

  it('needs every word, in any order', () => {
    const treffer = typenVon(filtereZeilen(zeilen, 'vertrag miet'))
    assert.ok(treffer.includes('rent_contract'))
    assert.ok(treffer.every((typ) => /miet|rent/i.test(`${typen.get(typ)?.label} ${typ}`)))
    assert.deepEqual(filtereZeilen(zeilen, 'mietvertrag xyzxyz'), [])
  })

  it('does not mind accents, nor the sharp s', () => {
    const rows = [{ typ: 'a', label: 'Bescheinigung über Straße', rolle: null }]
    assert.equal(filtereZeilen(rows, 'uber strasse').length, 1)
    assert.equal(filtereZeilen(rows, 'über straße').length, 1)
    assert.equal(filtereZeilen([{ typ: 'b', label: 'Ubersicht', rolle: null }], 'übersicht').length, 1)
  })

  it('shows everything for an empty search, or spaces', () => {
    assert.equal(filtereZeilen(zeilen).length, zeilen.length)
    assert.equal(filtereZeilen(zeilen, '   ').length, zeilen.length)
  })
})

describe('Bedingungen einer Zeile in Worten', () => {
  const tabellen = roh.wertetabellen

  it('names what a line is limited to', () => {
    assert.equal(merkmalText({ income_type: 'alimony' }, tabellen), 'Gilt nur für: Unterhalt / Unterhaltsvorschuss')
    assert.equal(merkmalText({ income_type: 'interest' }, tabellen), 'Gilt nur für: Kapitalvermögen')
  })

  it('lists every kind of income a value stands for, and takes a list of values', () => {
    assert.equal(merkmalText({ income_type: 'salary' }, tabellen), 'Gilt nur für: Lohn / Gehalt, Ausbildungsvergütung und Kurzarbeitergeld')
    assert.equal(merkmalText({ income_type: ['alimony', 'interest'] }, tabellen), 'Gilt nur für: Unterhalt / Unterhaltsvorschuss und Kapitalvermögen')
  })

  it('says nothing it cannot put in words', () => {
    assert.equal(merkmalText({ income_type: 'unbekannt' }, tabellen), null)
    assert.equal(merkmalText({}, tabellen), null)
    assert.equal(merkmalText(undefined, tabellen), null)
    assert.equal(merkmalText({ income_type: 'alimony' }, undefined), null)
  })

  it('says it for the lines of the profile that carry a condition', () => {
    const zeile = zeilenFuer(bedingung(roh, 'einnahmen'), null, typen).find(({ typ }) => typ === 'maintenance_payment_proof')
    assert.ok(zeile)
    assert.equal(merkmalText(zeile.merkmale, tabellen), 'Gilt nur für: Unterhalt / Unterhaltsvorschuss')
  })
})

describe('Zeitraum lesen', () => {
  it('takes a whole number of months from 1 on', () => {
    assert.equal(liesMonate('3'), 3)
    assert.equal(liesMonate(' 12 '), 12)
    assert.equal(liesMonate('120'), 120)
    assert.equal(liesMonate(6), 6)
  })

  it('takes nothing else', () => {
    for (const falsch of ['', ' ', '0', '-2', '1.5', '1,5', 'drei', '3 Monate', '1e2', '+3', '1000']) {
      assert.equal(liesMonate(falsch), null, JSON.stringify(falsch))
    }
    assert.equal(liesMonate(undefined), null)
    assert.equal(liesMonate(null), null)
  })
})
