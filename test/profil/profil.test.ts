import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { liesMitProfil } from '../../src/engine/profil/entwurf.ts'
import { ladeProfil, ladeProfilIndex, ladeProfilNachKennung, ProfilError, quellenJeArt, ROLLE } from '../../src/engine/profil/laden.ts'
import type { Abdeckung, Katalog, Nachweisart, ProfilFormat1 } from '../../src/engine/profil/laden.ts'
import { validiereProfil } from '../../src/engine/profil/validieren.ts'
import { lies, WOHNGELD } from '../hilfen/dateien.ts'

const profil = await ladeProfil(lies, WOHNGELD)
const roh = await lies<ProfilFormat1>(`${WOHNGELD}profil.json`)

/** The entry of a map; the test names one that is there. */
function ausKarte<K, V>(karte: ReadonlyMap<K, V>, schluessel: K): V {
  const wert = karte.get(schluessel)
  assert.ok(wert !== undefined, `Es gibt einen Eintrag für ${String(schluessel)}.`)
  return wert
}

/** A statement of the profile; the test names one that is there. */
function nachweisart(arten: Record<string, Nachweisart>, name: string): Nachweisart {
  const gefunden = arten[name]
  assert.ok(gefunden, `Es gibt die Nachweisart ${name}.`)
  return gefunden
}

/** The profile as the engine loads it from a `profil.json` that differs from the file. */
const mit = async (aendere: (arten: Record<string, Nachweisart>) => void) => {
  const kopie = structuredClone(roh)
  aendere(kopie.nachweisarten)
  return ladeProfil(liesMitProfil(lies, WOHNGELD, kopie), WOHNGELD)
}

/** The profile as the engine loads it with a catalogue that differs from the file. */
const mitKatalog = (aendere: (katalog: Katalog) => void) =>
  ladeProfil(async (pfad) => {
    if (!pfad.endsWith(roh.dokumenttypen)) return lies(pfad)
    const kopie = structuredClone(await lies<Katalog>(pfad))
    aendere(kopie)
    return kopie
  }, WOHNGELD)

describe('Wohngeld-Profil', () => {
  it('is consistent with its schemas and the document catalogue', async () => {
    const { fehler, warnungen } = await validiereProfil(profil)
    assert.deepEqual(fehler, [])
    assert.deepEqual(warnungen, [])
  })

  it('checks the mappings of the code lists of older versions, which a loaded profile keeps in its raw form', async () => {
    const kopie = structuredClone(roh)
    kopie.werteAbbildungen = { '1.6.1': { F60000000352: { '01': 'gibtsnicht' }, F99999999999: { '01': '001' } } }

    const { fehler, warnungen } = await validiereProfil(await ladeProfil(liesMitProfil(lies, WOHNGELD, kopie), WOHNGELD))

    assert.deepEqual(fehler, [])
    assert.deepEqual(warnungen, [
      'Werteabbildung 1.6.1: „F60000000352“ kennt den Wert „gibtsnicht“ nicht.',
      'Werteabbildung 1.6.1: das Feld „F99999999999“ steht in keinem Schema.',
    ])
  })

  it('names the profile with id and version', () => {
    assert.equal(profil.kennung, 'wohngeld@2026-11-07')
    assert.equal(profil.antragsarten.length, 6)
  })

  it('accepts a rental contract, a landlord certificate and a bank statement for the rent — in different roles', () => {
    const rolle = (typ: string) => ausKarte(profil.verwendungen, typ).find((verwendung) => verwendung.art === 'miete_hoehe')?.rolle
    assert.equal(rolle('rent_contract'), ROLLE.GENUEGT)
    assert.equal(rolle('rent_certificate'), ROLLE.GENUEGT)
    assert.equal(rolle('bank_statement'), ROLLE.PRUEFEN)
    assert.equal(rolle('utility_statement'), ROLLE.ERGAENZT)
  })

  it('says itself which statement a type proves, with its features — the catalogue does not', () => {
    assert.deepEqual(profil.verwendungen.get('disability_notice'), [
      { art: 'schwerbehinderung', rolle: ROLLE.GENUEGT, merkmale: {}, groebere: null, rolleGroeber: ROLLE.ERGAENZT },
    ])
    assert.deepEqual(ausKarte(profil.verwendungen, 'payslip')[0]?.merkmale, { income_type: 'salary' })
    assert.deepEqual(nachweisart(roh.nachweisarten, 'einnahmen').quellen.payslip, {
      rolle: ROLLE.GENUEGT,
      merkmale: { income_type: 'salary' },
    })
  })

  it('uses a type exactly as the profile states it', () => {
    // The profile puts a rent change notice at the change of the rent and keeps the rent as the
    // coarser place, where it only may suffice.
    assert.deepEqual(profil.verwendungen.get('rent_change_notice'), [
      { art: 'mietveraenderung', rolle: ROLLE.GENUEGT, merkmale: {}, groebere: 'miete_hoehe', rolleGroeber: ROLLE.PRUEFEN },
    ])
  })

  it('lets a document at the coarser art only support it, unless the profile says otherwise', () => {
    const darlehen = ausKarte(profil.verwendungen, 'loan_contract').find((verwendung) => verwendung.art === 'fremdmittel')
    assert.equal(darlehen?.groebere, 'belastung')
    assert.equal(darlehen?.rolleGroeber, ROLLE.ERGAENZT)
    const steuer = ausKarte(profil.verwendungen, 'property_tax_notice').find((verwendung) => verwendung.art === 'aufwendung')
    assert.deepEqual(steuer?.merkmale, { aufwendungsart: '003' }, 'the code of the application stands in the profile')
    assert.equal(steuer?.rolleGroeber, ROLLE.ERGAENZT)
  })

  it('does not let a business registration or a contract prove an income on its own', () => {
    const rolle = (typ: string) => ausKarte(profil.verwendungen, typ).find((verwendung) => verwendung.art === 'einnahmen')?.rolle
    assert.equal(rolle('business_registration'), ROLLE.ERGAENZT)
    assert.equal(rolle('employment_contract'), ROLLE.PRUEFEN)
    assert.equal(rolle('payslip'), ROLLE.GENUEGT)
  })

  it('keeps every use of a type the profile names twice', () => {
    const arten = (typ: string) => ausKarte(profil.verwendungen, typ).map((verwendung) => verwendung.art).sort()
    assert.deepEqual(arten('maintenance_payment_proof'), ['einnahmen', 'unterhalt'])
    assert.deepEqual(arten('citizen_benefit_notice'), ['einnahmen', 'transferleistung'])
    assert.deepEqual(arten('asset_proof'), ['einnahmen', 'vermoegen'])
  })

  it('anchors every file field of every schema, or says why not', async () => {
    const { warnungen } = await validiereProfil(profil)
    assert.ok(!warnungen.some((warnung) => /keine Stelle/.test(warnung)))
    assert.ok(Object.keys(profil.bekanntOffen).length > 0)
  })

  it('lists for every art which document types are accepted', () => {
    const miete = ausKarte(quellenJeArt(profil.verwendungen, profil.typen), 'miete_hoehe')
    const typen = miete.map((quelle) => quelle.typ)
    assert.ok(typen.includes('rent_contract'))
    assert.ok(typen.includes('rent_change_notice'), 'a coarser use counts for the coarser art')
    assert.ok(typen.includes('bank_statement'))
    assert.equal(miete.find((quelle) => quelle.typ === 'rent_change_notice')?.genau, false)
  })

  it('leaves types without any use unplaced', () => {
    assert.deepEqual(profil.verwendungen.get('identity_document'), [])
  })
})

describe('Was das Profil nicht nennt', () => {
  it('does not accept a type the profile no longer names — nothing comes back from the catalogue', async () => {
    const ohne = await mit((arten) => {
      delete nachweisart(arten, 'miete_hoehe').quellen.rent_contract
    })
    assert.ok(!ausKarte(ohne.verwendungen, 'rent_contract').some(({ art }) => art === 'miete_hoehe'))
    assert.ok(!ausKarte(ohne.quellenJeArt, 'miete_hoehe').some(({ typ }) => typ === 'rent_contract'))
  })

  it('leaves a type taken off at one statement what it is at the others', async () => {
    const ohne = await mit((arten) => {
      delete nachweisart(arten, 'einnahmen').quellen.bank_statement
    })
    assert.deepEqual(ausKarte(ohne.verwendungen, 'bank_statement').map(({ art }) => art).sort(), ['miete_hoehe', 'unterhalt', 'vermoegen'])
  })

  it('reads no statement from the catalogue, and warns where a catalogue still names one', async () => {
    const alt = await mitKatalog((katalog) => {
      const ausweis = katalog.identity_document
      assert.ok(ausweis)
      // The old keys are no part of the catalogue any more: that is what the check warns about.
      Object.assign(ausweis, { fim: 'einnahmen', fim_merkmale: { income_type: 'salary' } })
    })
    assert.deepEqual(alt.verwendungen.get('identity_document'), [])
    const { fehler, warnungen } = await validiereProfil(alt)
    assert.deepEqual(fehler, [])
    assert.deepEqual(warnungen, [
      'Der Katalog nennt beim Dokumenttyp „identity_document“ eine Nachweisart (fim, fim_merkmale, fim_fallback). Die Engine wertet das nicht aus: Welche Angabe ein Typ belegt, sagt allein das Profil.',
    ])
  })

  it('rejects a role nobody knows — "ausgeschlossen" included, which only took a type off the catalogue', async () => {
    for (const rolle of ['ausgeschloßen', 'ausgeschlossen']) {
      const schlecht = await mit((arten) => {
        // An unknown role, invalid on purpose.
        nachweisart(arten, 'miete_hoehe').quellen.rent_contract = rolle as never
      })
      const [erster] = (await validiereProfil(schlecht)).fehler
      assert.ok(erster)
      assert.match(erster, new RegExp(`Rolle „${rolle}“ ist unbekannt`))
    }
  })
})

describe('Zeitraum prüfen', () => {
  const fehlerMit = async (aendere: (abdeckung: Abdeckung) => void) =>
    (
      await validiereProfil(
        await mit((arten) => {
          const abdeckung = nachweisart(arten, 'einnahmen').abdeckung
          assert.ok(abdeckung)
          aendere(abdeckung)
        }),
      )
    ).fehler

  /** The first error the check finds; the test expects one. */
  const ersterFehler = async (aendere: (abdeckung: Abdeckung) => void): Promise<string> => {
    const [erster] = await fehlerMit(aendere)
    assert.ok(erster, 'Die Prüfung findet einen Fehler.')
    return erster
  }

  it('accepts the period of the profile', async () => {
    assert.deepEqual(await fehlerMit(() => {}), [])
  })

  it('wants whole months from 1 on', async () => {
    assert.match(await ersterFehler((abdeckung) => (abdeckung.mindestens = 0)), /„mindestens“ der Abdeckung muss eine ganze Zahl ab 1 sein/)
    assert.match(await ersterFehler((abdeckung) => (abdeckung.mindestens = 2.5)), /„mindestens“/)
    // A number as text, invalid on purpose.
    assert.match(await ersterFehler((abdeckung) => (abdeckung.mindestens = '3' as never)), /„mindestens“/)
    assert.match(
      await ersterFehler((abdeckung) => (abdeckung.hoechstensAlt = 0)),
      /„hoechstensAlt“ der Abdeckung muss eine ganze Zahl ab 1 sein/,
    )
  })

  it('does not need an age limit', async () => {
    assert.deepEqual(await fehlerMit((abdeckung) => delete abdeckung.hoechstensAlt), [])
  })

  it('knows only months, and needs the types that count per month', async () => {
    // A unit nobody knows, and a list that is missing: invalid on purpose.
    assert.match(await ersterFehler((abdeckung) => (abdeckung.einheit = 'woche' as never)), /Einheit „woche“ der Abdeckung ist unbekannt/)
    assert.match(await ersterFehler((abdeckung) => Reflect.deleteProperty(abdeckung, 'fuer')), /braucht unter „fuer“ eine Liste/)
  })
})

describe('Profile finden', () => {
  it('lists the profiles of the installation, each with its current version among its versions', async () => {
    const index = await ladeProfilIndex(lies)
    assert.ok(index.some((eintrag) => eintrag.id === 'wohngeld'))
    for (const eintrag of index) {
      assert.ok(eintrag.versionen.includes(eintrag.aktuell), `${eintrag.id}: die aktuelle Version steht nicht unter den Versionen`)
    }
  })

  it('loads the current version by the name alone', async () => {
    // Whatever the index says is current: a new version, published from the department's page, must
    // not turn this red.
    const eintrag = (await ladeProfilIndex(lies)).find((kandidat) => kandidat.id === 'wohngeld')
    assert.ok(eintrag)
    const profil = await ladeProfilNachKennung(lies, 'wohngeld')
    assert.equal(profil.kennung, `wohngeld@${eintrag.aktuell}`)
  })

  it('loads a given version', async () => {
    const profil = await ladeProfilNachKennung(lies, 'wohngeld@2026-11-07')
    assert.equal(profil.version, '2026-11-07')
  })

  it('rejects a profile or a version that does not exist', async () => {
    await assert.rejects(ladeProfilNachKennung(lies, 'elterngeld'), (fehler: unknown) => {
      assert.ok(fehler instanceof ProfilError)
      assert.match(fehler.message, /„elterngeld“ gibt es nicht/)
      return true
    })
    await assert.rejects(ladeProfilNachKennung(lies, 'wohngeld@1999-01-01'), /nicht in der Version 1999-01-01/)
  })

  it('rejects an index that is no list', async () => {
    await assert.rejects(ladeProfilIndex(async () => ({ profile: 'x' })), ProfilError)
  })

  it('has an index entry whose folder holds the profile it names', async () => {
    for (const eintrag of await ladeProfilIndex(lies)) {
      for (const version of eintrag.versionen) {
        const profil = await ladeProfilNachKennung(lies, `${eintrag.id}@${version}`)
        assert.equal(profil.id, eintrag.id)
        assert.equal(profil.version, version)
        assert.equal(profil.name, eintrag.name)
      }
    }
  })

  it('has no error in any version the index lists — also one the department published', async () => {
    for (const eintrag of await ladeProfilIndex(lies)) {
      for (const version of eintrag.versionen) {
        const { fehler } = await validiereProfil(await ladeProfilNachKennung(lies, `${eintrag.id}@${version}`))
        assert.deepEqual(fehler, [], `${eintrag.id}@${version}`)
      }
    }
  })
})
