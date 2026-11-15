import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { fehlerText, genannt, HOECHSTE_TIEFE, HOECHSTENS_FEHLER, LAENGSTER_TEXT, pruefeAntrag } from '../../src/engine/oneproof/pruefung.ts'
import type { AntragFehler } from '../../src/engine/oneproof/pruefung.ts'
import { dateiVon, kompaktesSchema, knotenNachId, ladeSchemata, pfadZu, urnTeile, verweiseVon } from '../../src/engine/oneproof/schema.ts'
import { leseText, lies } from '../hilfen/dateien.ts'

/** A person of the example application, as far as the tests change it. */
interface BeispielPerson {
  id: string
  rolle: string
  verhaeltnisZumAntragsteller?: string
  name: { vorname: string }
  kommunikation?: { telefon?: string }
}

/** An attachment of the example application, as far as the tests change it. */
interface BeispielAnlage {
  dateiname: string
  zweck: string
  dokumentart?: string
  bezuege?: { stelle: string }[]
}

/**
 * The example application as far as the tests change it; the file has more. What a test puts in
 * place of a part is mostly wrong on purpose, so such parts are plain objects.
 */
interface Beispielantrag {
  personen: BeispielPerson[]
  anlagen: BeispielAnlage[]
  fachdaten: {
    antrag: { vertretung?: object }
    wohnraum: { wohnverhaeltnis: string; eigentumMitMehrAlsZweiWohnungen?: boolean }
    haushalt: { verpflichtungserklaerung?: object }
    mietzuschuss: { vermieter?: object; zuschussDritter?: object }
    kinderUndUnterhalt: { kinderbetreuungskosten: { eintraege: { person: string }[] } }
    personen: { person: string }[]
    lastenzuschuss?: object
  }
}

const ORDNER = '/format/oneproof/'
const schemata = await ladeSchemata((datei) => lies(`${ORDNER}${datei}`), 'wohngeld-1.0.schema.json')
const kompakt = kompaktesSchema(schemata)
const beispiel = await lies<Beispielantrag>(`${ORDNER}wohngeld-1.0.beispiel.json`)

/** An entry of a list of the example; the test names one that is there. */
function eintragBei<T>(liste: T[], nummer: number): T {
  const eintrag = liste[nummer]
  assert.ok(eintrag !== undefined, `Es gibt den Eintrag ${nummer}.`)
  return eintrag
}

/** The example with one change, and the errors of the check. */
const fehlerMit = (aendere: (daten: Beispielantrag) => void): AntragFehler[] => {
  const daten = structuredClone(beispiel)
  aendere(daten)
  return pruefeAntrag(daten, schemata, kompakt)
}
const stellen = (fehler: AntragFehler[]): string[] => fehler.map(({ stelle }) => stelle)

describe('Schemas des OneProof Formats', () => {
  it('name each other by URN and lie side by side', () => {
    assert.deepEqual(urnTeile('urn:oneproof:format:wohngeld:1.0'), { name: 'wohngeld', version: '1.0' })
    assert.equal(urnTeile('urn:oneproof:format:Wohngeld:1'), null)
    assert.equal(dateiVon('urn:oneproof:format:rahmen:1.0'), 'rahmen-1.0.schema.json')
    assert.deepEqual(verweiseVon(schemata.haupt), ['urn:oneproof:format:rahmen:1.0'])
    assert.deepEqual(schemata.alle.map(({ $id }) => $id), ['urn:oneproof:format:wohngeld:1.0', 'urn:oneproof:format:rahmen:1.0'])
  })

  it('compile in the strict mode of Ajv without a single warning', () => {
    const meldungen: unknown[] = []
    const ajv = new Ajv2020({ strict: true, strictRequired: false, logger: { log() {}, warn: (m) => meldungen.push(m), error: (m) => meldungen.push(m) } })
    addFormats(ajv)
    ajv.addKeyword('x-eindeutig')
    const rahmen = schemata.alle[1]
    assert.ok(rahmen)
    ajv.addSchema(rahmen)
    assert.ok(ajv.compile(schemata.haupt))
    assert.deepEqual(meldungen, [])
  })

  it('are the same in every profile that uses them', async () => {
    for (const datei of ['rahmen-1.0.schema.json', 'wohngeld-1.0.schema.json']) {
      assert.equal(await leseText(`/profile/wohngeld/2026-11-15/schema/${datei}`), await leseText(`${ORDNER}${datei}`), datei)
    }
  })

  it('accept the example', () => {
    assert.deepEqual(pruefeAntrag(beispiel, schemata, kompakt), [])
  })
})

describe('Prüfung einer Antragsdatei', () => {
  it('wants exactly one applicant', () => {
    assert.deepEqual(stellen(fehlerMit((d) => {
      eintragBei(d.personen, 1).rolle = 'antragsteller'
      delete eintragBei(d.personen, 1).verhaeltnisZumAntragsteller
    })), ['/personen'])
  })

  it('says what is wrong with the list, not with each entry that is not the one looked for', () => {
    assert.deepEqual(fehlerMit((d) => (eintragBei(d.personen, 0).rolle = 'haushaltsmitglied')).filter(({ stelle }) => stelle !== '/personen/0/kommunikation'), [
      { stelle: '/personen', meldung: 'Genau eine Person hat die Rolle „antragsteller“.' },
    ])
    assert.deepEqual(fehlerMit((d) => d.anlagen.push({ dateiname: 'zweites.pdf', zweck: 'antragsdokument' })), [
      { stelle: '/anlagen', meldung: 'Höchstens eine Anlage ist das Antragsdokument.' },
    ])
  })

  it('allows references only to values under personen and fachdaten', () => {
    assert.deepEqual(
      stellen(fehlerMit((d) => (eintragBei(d.anlagen, 1).bezuege = [{ stelle: '/nachricht/autor' }]))),
      ['/anlagen/1/bezuege/0/stelle'],
    )
  })

  it('takes the application document for what it is: no type, no references, at most one', () => {
    assert.ok(
      fehlerMit((d) => (eintragBei(d.anlagen, 0).dokumentart = 'payslip')).some(({ stelle }) => stelle === '/anlagen/0/dokumentart'),
    )
    assert.deepEqual(stellen(fehlerMit((d) => (d.anlagen[1] = { dateiname: 'zweites.pdf', zweck: 'antragsdokument' }))), ['/anlagen'])
  })

  it('wants an owner to say whether the house has more than two flats, and nobody else', () => {
    assert.deepEqual(fehlerMit((d) => (d.fachdaten.wohnraum.wohnverhaeltnis = 'owner')), [
      { stelle: '/fachdaten/wohnraum', meldung: 'Die Angabe „eigentumMitMehrAlsZweiWohnungen“ fehlt.' },
    ])
    assert.deepEqual(fehlerMit((d) => (d.fachdaten.wohnraum.eigentumMitMehrAlsZweiWohnungen = true)), [
      { stelle: '/fachdaten/wohnraum/eigentumMitMehrAlsZweiWohnungen', meldung: 'Diese Angabe ist hier nicht zulässig.' },
    ])
    assert.deepEqual(fehlerMit((d) => Object.assign(d.fachdaten.wohnraum, { wohnverhaeltnis: 'owner', eigentumMitMehrAlsZweiWohnungen: true })), [], 'rent allowance in the own house with more than two flats')
  })

  it('names landlords, obliged persons and givers of a subsidy in parts, as a person or a body', () => {
    assert.deepEqual(fehlerMit((d) => (d.fachdaten.mietzuschuss.vermieter = { vornameOderFirma: 'Wohnbau GmbH' })), [
      { stelle: '/fachdaten/mietzuschuss/vermieter', meldung: 'Es fehlt die Angabe „familienname“ oder „organisation“.' },
      { stelle: '/fachdaten/mietzuschuss/vermieter', meldung: 'Die Angabe „vornameOderFirma“ kennt das Format hier nicht.' },
    ])
    assert.deepEqual(fehlerMit((d) => (d.fachdaten.mietzuschuss.zuschussDritter = { vorhanden: true, zuschussgeber: { vorname: 'Hanna', familienname: 'Klein' }, betragMonat: 80 })), [])
    assert.ok(fehlerMit((d) => (d.fachdaten.haushalt.verpflichtungserklaerung = { vorhanden: true, verpflichtetePerson: {} })).some(({ stelle }) => stelle === '/fachdaten/haushalt/verpflichtungserklaerung/verpflichtetePerson'))
  })

  it('takes a phone number as people write it, with at least five digits', () => {
    const telefon = (nummer: string) =>
      stellen(fehlerMit((d) => (eintragBei(d.personen, 0).kommunikation = { ...eintragBei(d.personen, 0).kommunikation, telefon: nummer })))
    assert.deepEqual(telefon('+49 (0)221 1234567'), [])
    assert.deepEqual(telefon('0221/123 45-67'), [])
    assert.deepEqual(telefon('0----'), ['/personen/0/kommunikation/telefon'])
  })

  it('ties the housing situation to rent or charges allowance', () => {
    assert.ok(fehlerMit((d) => (d.fachdaten.lastenzuschuss = { eigentumsform: 'flat' })).some(({ stelle }) => stelle === '/fachdaten/lastenzuschuss'))
    const eigentum = (mehrAlsZwei: boolean) =>
      fehlerMit((d) => {
        d.fachdaten.wohnraum.wohnverhaeltnis = 'owner'
        d.fachdaten.wohnraum.eigentumMitMehrAlsZweiWohnungen = mehrAlsZwei
      })
    assert.deepEqual(eigentum(true), [], 'an owner of a house with more than two flats gets a rent allowance')
    assert.ok(eigentum(false).some(({ stelle }) => stelle === '/fachdaten/mietzuschuss'))
  })

  it('wants the kind of representation and names in parts', () => {
    assert.ok(fehlerMit((d) => (d.fachdaten.antrag.vertretung = { vorhanden: true })).some(({ meldung }) => /„art“ fehlt/.test(meldung)))
    assert.deepEqual(fehlerMit((d) => (d.fachdaten.antrag.vertretung = { vorhanden: true, art: 'authorized_representative', vertreter: { vorname: 'Max', familienname: 'Muster' } })), [])
    assert.deepEqual(fehlerMit((d) => (d.fachdaten.antrag.vertretung = { vorhanden: true, art: 'legal_representative', vertreter: { organisation: 'Betreuungsverein Auenthal e. V.' } })), [])
  })

  it('takes no text of blanks for an answer and says so', () => {
    const [fehler] = fehlerMit((d) => (eintragBei(d.personen, 0).name.vorname = '   '))
    assert.deepEqual(fehler, { stelle: '/personen/0/name/vorname', meldung: 'Der Text besteht nur aus Leerzeichen.' })
  })

  it('names a code that is not on the list once', () => {
    assert.deepEqual(fehlerMit((d) => (eintragBei(d.anlagen, 1).dokumentart = 'erfunden')), [{ stelle: '/anlagen/1/dokumentart', meldung: 'Der Wert ist hier nicht vorgesehen.' }])
  })

  it('checks what a JSON Schema cannot say: persons, entries per person, file names, references', () => {
    // A second "p2": its own id is the error, and what referred to the lost "p3" refers to no one.
    assert.deepEqual(fehlerMit((d) => (eintragBei(d.personen, 2).id = 'p2')), [
      { stelle: '/personen/2/id', meldung: 'Die Kennung „p2“ hat schon die Person /personen/1.' },
      { stelle: '/fachdaten/personen/2/person', meldung: 'Eine Person mit der Kennung „p3“ gibt es in „personen“ nicht.' },
      { stelle: '/anlagen/7/person', meldung: 'Eine Person mit der Kennung „p3“ gibt es in „personen“ nicht.' },
    ])
    assert.deepEqual(fehlerMit((d) => (eintragBei(d.fachdaten.kinderUndUnterhalt.kinderbetreuungskosten.eintraege, 0).person = 'p9')), [
      { stelle: '/fachdaten/kinderUndUnterhalt/kinderbetreuungskosten/eintraege/0/person', meldung: 'Eine Person mit der Kennung „p9“ gibt es in „personen“ nicht.' },
    ])
    // A second entry for p1: the entry is the error, and the card of p3 now supports values of p1.
    assert.deepEqual(
      stellen(fehlerMit((d) => (eintragBei(d.fachdaten.personen, 2).person = 'p1'))),
      ['/fachdaten/personen/2/person', '/anlagen/7/bezuege/0/stelle'],
    )
    assert.deepEqual(
      stellen(fehlerMit((d) => (eintragBei(d.anlagen, 2).dateiname = eintragBei(d.anlagen, 1).dateiname))),
      ['/anlagen/2/dateiname'],
    )
    assert.deepEqual(fehlerMit((d) => (eintragBei(d.anlagen, 1).bezuege = [{ stelle: '/fachdaten/personen/0/einkommen/eintraege/5' }])), [
      { stelle: '/anlagen/1/bezuege/0/stelle', meldung: 'Die Stelle „/fachdaten/personen/0/einkommen/eintraege/5“ gibt es in dieser Datei nicht.' },
    ])
    assert.deepEqual(
      stellen(fehlerMit((d) => (eintragBei(d.anlagen, 1).bezuege = [{ stelle: '/fachdaten/personen/1/einkommen' }]))),
      ['/anlagen/1/bezuege/0/stelle'],
      'a payslip of p1 for the income of p2',
    )
  })

  it('names the first errors with their place and counts the rest', () => {
    const fehler = Array.from({ length: 7 }, (_, index) => ({ stelle: `/personen/${index}`, meldung: 'X.' }))
    assert.equal(fehlerText(fehler), '/personen/0: X. /personen/1: X. /personen/2: X. /personen/3: X. /personen/4: X. Dazu 2 weitere Fehler.')
    assert.equal(fehlerText([{ stelle: '', meldung: 'Die Angabe „standard“ fehlt.' }]), 'Datei: Die Angabe „standard“ fehlt.')
    // Thirteen persons without any data: invalid on purpose.
    const viele = fehlerMit((d) => (d.personen = Array.from({ length: 13 }, () => ({})) as never))
    assert.ok(viele.length > 0 && viele.length <= HOECHSTENS_FEHLER)
  })
})

describe('Grenzen der Prüfung', () => {
  /** `anzahl` objects nested in one another, each under the key `a`: the innermost is empty. */
  const verschachtelt = (anzahl: number): object => {
    let innen: object = {}
    for (let i = 1; i < anzahl; i++) innen = { a: innen }
    return innen
  }
  /** The time the check takes; what these tests guard against takes minutes, not seconds. */
  const dauer = <T>(arbeit: () => T): { ergebnis: T; ms: number } => {
    const start = performance.now()
    const ergebnis = arbeit()
    return { ergebnis, ms: performance.now() - start }
  }

  it('counts a list that is too long and says so once, without checking every entry against the schema', () => {
    // Twenty thousand empty persons: Ajv, which collects every error, needs a minute for them.
    const { ergebnis, ms } = dauer(() => fehlerMit((d) => (d.personen = Array.from({ length: 20_000 }, () => ({})) as never)))

    assert.deepEqual(ergebnis, [{ stelle: '/personen', meldung: 'Die Liste hat mehr als 12 Einträge.' }])
    assert.ok(ms < 5000, `${ms} ms`)
  })

  it('counts the lists inside the entries of a list as well', () => {
    const bezuege = Array.from({ length: 16_000 }, (_, nummer) => ({ stelle: `/personen/0/n${nummer}` }))
    const { ergebnis, ms } = dauer(() => fehlerMit((d) => (eintragBei(d.anlagen, 1).bezuege = bezuege)))

    assert.deepEqual(ergebnis, [{ stelle: '/anlagen/1/bezuege', meldung: 'Die Liste hat mehr als 200 Einträge.' }])
    assert.ok(ms < 5000, `${ms} ms`)
  })

  it('accepts a list with as many entries as the schema allows', () => {
    assert.deepEqual(fehlerMit((d) => (eintragBei(d.anlagen, 1).bezuege = Array.from({ length: 200 }, () => ({ stelle: '/personen/0' })))), [
      { stelle: '/anlagen/1/bezuege', meldung: 'Die Liste enthält einen Eintrag doppelt.' },
    ])
  })

  it('limits the nesting, and names the place where the limit is crossed', () => {
    // The free area is the only place that takes any depth; `erweiterungen` is the second level.
    const erlaubt = HOECHSTE_TIEFE - 1
    assert.deepEqual(fehlerMit((d) => Object.assign(d, { erweiterungen: verschachtelt(erlaubt) })), [])

    const fehler = fehlerMit((d) => Object.assign(d, { erweiterungen: verschachtelt(erlaubt + 1) }))
    assert.deepEqual(fehler, [{ stelle: `/erweiterungen${'/a'.repeat(erlaubt)}`, meldung: `Die Angaben sind hier tiefer als ${HOECHSTE_TIEFE} Ebenen verschachtelt.` }])
  })

  it('answers for a file nested a million levels deep, which no recursion would survive', () => {
    const { ergebnis, ms } = dauer(() => fehlerMit((d) => Object.assign(d, { erweiterungen: verschachtelt(1_000_000) })))

    assert.equal(ergebnis.length, 1)
    assert.ok(ms < 5000, `${ms} ms`)
  })

  it('limits the length of a text, so that no pattern is run over millions of characters', () => {
    const zuLang = 'x'.repeat(LAENGSTER_TEXT + 1)
    assert.deepEqual(fehlerMit((d) => (eintragBei(d.personen, 0).name.vorname = zuLang)), [
      { stelle: '/personen/0/name/vorname', meldung: 'Der Text ist länger als 1.000.000 Zeichen.' },
    ])
    // The pattern of `stelle` runs out of stack at some three million characters; the answer is an error, not a throw.
    const fehler = fehlerMit((d) => (eintragBei(d.anlagen, 1).bezuege = [{ stelle: `/personen${'/x'.repeat(2_000_000)}` }]))
    assert.deepEqual(stellen(fehler), ['/anlagen/1/bezuege/0/stelle'])
  })

  it('shows a name from the file shortened and without control characters', () => {
    assert.equal(genannt('p1'), 'p1')
    assert.equal(genannt('a\nb\u202ec'), 'a b c')
    assert.equal(Array.from(genannt('ä'.repeat(500))).length, 60)
    assert.ok(genannt('ä'.repeat(500)).endsWith('…'))

    const fehler = fehlerMit((d) => Object.assign(eintragBei(d.personen, 0), { [`schluessel\n\u202e${'x'.repeat(100_000)}`]: 1 }))
    assert.equal(fehler.length, 1)
    assert.match(fehler[0]?.meldung ?? '', /^Die Angabe „schluessel {2}x+…“ kennt das Format hier nicht\.$/)
    assert.ok((fehler[0]?.meldung.length ?? Infinity) < 120)
  })

  it('refuses a rule of the schema it does not know, instead of switching it off', () => {
    const kopie = structuredClone(schemata)
    const setze = (knoten: unknown): void => {
      if (Array.isArray(knoten)) return knoten.forEach(setze)
      if (typeof knoten !== 'object' || knoten === null) return
      if ('x-eindeutig' in knoten) Object.assign(knoten, { 'x-eindeutig': 'Person' })
      Object.values(knoten).forEach(setze)
    }
    setze(kopie.haupt)

    assert.throws(() => pruefeAntrag(beispiel, kopie, kompakt), /x-eindeutig|allowed values/)
  })

  it('says what to do where the Content-Security-Policy forbids the code that Ajv writes', () => {
    const kopie = structuredClone(schemata)
    const echt = Reflect.get(globalThis, 'Function')
    // What a browser does under `script-src 'self'`: `new Function` throws an EvalError.
    Reflect.set(globalThis, 'Function', class {
      constructor() {
        throw new EvalError('Evaluating a string as JavaScript violates the following Content Security Policy directive')
      }
    })
    try {
      assert.throws(() => pruefeAntrag(beispiel, kopie, kompakt), /unsafe-eval/)
    } finally {
      Reflect.set(globalThis, 'Function', echt)
    }
  })
})

describe('Kompaktes Schema', () => {
  const knoten = knotenNachId(kompakt)
  /** A node of the compact schema; the test names one that is there. */
  const knotenBei = (id: string) => {
    const gefunden = knoten.get(id)
    assert.ok(gefunden, `Es gibt den Knoten ${id}.`)
    return gefunden
  }

  it('is an application type of the engine, with every place named by its pattern', () => {
    assert.equal(kompakt.schemaId, 'oneproof:wohngeld')
    assert.equal(kompakt.version, '1.0')
    assert.equal(kompakt.format, 'oneproof')
    assert.equal(knotenBei('/fachdaten/personen/*/einkommen/eintraege/*/betrag').typ, 'num_currency')
    assert.equal(knotenBei('/fachdaten/personen/*/einkommen/eintraege/*').anzahl, '1:50')
    assert.equal(knotenBei('/personen/*/rolle').werte?.haushaltsmitglied, 'Haushaltsmitglied')
  })

  it('marks lists, sections with a yes/no question, references to persons and lists with one entry per person', () => {
    assert.equal(knotenBei('/fachdaten/personen').liste, true)
    assert.equal(knotenBei('/fachdaten/personen').eindeutig, 'person')
    assert.equal(knotenBei('/fachdaten/vermoegen').thema, true)
    assert.equal(knotenBei('/fachdaten/mietzuschuss/miete').thema, undefined)
    assert.equal(knotenBei('/fachdaten/zahlung/person').verweis, 'person')
    assert.equal(knotenBei('/fachdaten/personen/*/nsVerfolgt').typ, 'bool')
  })

  it('leaves out what a branch rules out, and finds the path to a place', () => {
    assert.equal(knoten.has('/anlagen/*/dokumentart'), true)
    const pfad = pfadZu(kompakt, '/fachdaten/vermoegen/vorhanden')
    assert.ok(pfad)
    assert.deepEqual(pfad.map(({ id }) => id), ['/fachdaten', '/fachdaten/vermoegen', '/fachdaten/vermoegen/vorhanden'])
    assert.equal(pfadZu(kompakt, '/fachdaten/gibtsnicht'), null)
  })
})
