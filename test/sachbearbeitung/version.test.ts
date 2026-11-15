import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fuegeAntragsartEin, liesAntragsart, neuesProfil, schlageAnbindungVor } from '../../src/engine/profil/antragsart.ts'
import { finde, setzeHinweis, setzeRolle } from '../../src/engine/profil/bearbeiten.ts'
import type { ProfilFormat2 } from '../../src/engine/profil/bedingungen.ts'
import { ladeProfilNachKennung } from '../../src/engine/profil/laden.ts'
import type { Katalog, ProfilFormat1 } from '../../src/engine/profil/laden.ts'
import { validiereProfil } from '../../src/engine/profil/validieren.ts'
import {
  baueVersionspaket,
  dateienDerVersion,
  formatiereIndex,
  formatiereJson,
  fuerVersion,
  indexMitVersion,
  pruefeVersion,
  schlageVersionVor,
} from '../../src/sachbearbeitung/version.ts'
import type { ProfilIndex, VersionspaketEingabe } from '../../src/sachbearbeitung/version.ts'
import type { ZipDatei } from '../../src/sachbearbeitung/zip.ts'
import { fixture, leseBytes, leseText, lies, WOHNGELD } from '../hilfen/dateien.ts'
import { MIETZUSCHUSS, wohngeldFormat2 } from '../hilfen/format2.ts'
import { DOMParser } from '../hilfen/xml.ts'

const roh = await lies<ProfilFormat1>(`${WOHNGELD}profil.json`)
// The index as it stood when the profile had its first version. A fixture and not
// `public/profile/index.json`: once a department has published a version, that file is no longer
// this — and what is tested here, entering a version into an index, does not depend on what the
// installation has published since. (`WOHNGELD` is safe: a version's folder is never changed.)
const index: ProfilIndex = { profile: [{ id: 'wohngeld', name: 'Wohngeld', aktuell: '2026-11-07', versionen: ['2026-11-07'] }] }
// The released version is in format 1; the page saves every new version in format 2.
const { roh: roh2, typen } = await wohngeldFormat2()
const bedingung = (profil: ProfilFormat2, id: string) => finde(profil, MIETZUSCHUSS, { bedingungId: id }).bedingung

describe('Welche Version vorschlagen', () => {
  it('proposes today', () => {
    assert.equal(schlageVersionVor([], new Date(2026, 10, 7, 23, 59)), '2026-11-07')
    assert.equal(schlageVersionVor(['2026-10-01'], new Date(2026, 10, 7)), '2026-11-07')
  })

  it('proposes the next day if there is a version of today', () => {
    assert.equal(schlageVersionVor(['2026-11-07'], new Date(2026, 10, 7)), '2026-11-08')
    assert.equal(schlageVersionVor(['2026-11-30'], new Date(2026, 10, 30)), '2026-12-01')
    assert.equal(schlageVersionVor(['2026-12-31'], new Date(2026, 11, 31)), '2027-01-01')
  })

  it('proposes the day after a version that lies in the future', () => {
    assert.equal(schlageVersionVor(['2026-11-07', '2026-12-24'], new Date(2026, 10, 7)), '2026-12-25')
  })
})

describe('Version prüfen', () => {
  it('accepts a day that is free', () => {
    assert.equal(pruefeVersion('2026-11-08', ['2026-11-07']), null)
    assert.equal(pruefeVersion('2028-02-29', []), null)
  })

  it('asks for a date', () => {
    for (const falsch of ['', 'morgen', '2026-1-8', '08.11.2026', '2026-11-08 ', '2026-13-01', '2026-02-30', '2027-02-29']) {
      assert.match(pruefeVersion(falsch, []) ?? '', /Bitte ein Datum/, falsch)
    }
  })

  it('refuses a version that exists', () => {
    assert.match(pruefeVersion('2026-11-07', ['2026-11-07']) ?? '', /gibt es schon/)
  })
})

describe('Index fortschreiben', () => {
  it('enters the version and makes it the current one', () => {
    const neu = indexMitVersion(index, 'wohngeld', '2026-11-08', true)
    assert.deepEqual(neu.profile[0], { id: 'wohngeld', name: 'Wohngeld', aktuell: '2026-11-08', versionen: ['2026-11-07', '2026-11-08'] })
  })

  it('leaves the current one if asked to', () => {
    const neu = indexMitVersion(index, 'wohngeld', '2026-11-08', false)
    assert.equal(neu.profile[0]?.aktuell, '2026-11-07')
    assert.deepEqual(neu.profile[0]?.versionen, ['2026-11-07', '2026-11-08'])
  })

  it('keeps the versions in order and the other profiles as they are', () => {
    // Typed entries have a name, which the original fixture lacked.
    const zwei: ProfilIndex = { profile: [{ id: 'a', name: 'A', aktuell: '2026-01-01', versionen: ['2026-01-01'] }, ...index.profile] }
    const neu = indexMitVersion(zwei, 'wohngeld', '2026-06-01', false)
    assert.deepEqual(neu.profile[1]?.versionen, ['2026-06-01', '2026-11-07'])
    assert.deepEqual(neu.profile[0], zwei.profile[0])
  })

  it('does not change its input', () => {
    const vorher = JSON.stringify(index)
    indexMitVersion(index, 'wohngeld', '2026-11-08', true)
    assert.equal(JSON.stringify(index), vorher)
  })

  it('refuses an unknown profile and a version it has', () => {
    assert.throws(() => indexMitVersion(index, 'elterngeld', '2026-11-08', true), /„elterngeld“ steht nicht im Index/)
    assert.throws(() => indexMitVersion(index, 'wohngeld', '2026-11-07', true), /Version 2026-11-07 steht schon im Index/)
  })
})

describe('Dateien schreiben, wie sie im Repository stehen', () => {
  it('writes profil.json as it is — a version differs from the last in what changed, not in how it is written', async () => {
    assert.equal(formatiereJson(roh), await leseText(`${WOHNGELD}profil.json`))
  })

  it('writes index.json as it is, with a list of versions on one line', async () => {
    // The file as it stands: with one version, or with several after a release.
    assert.equal(formatiereIndex(await lies<ProfilIndex>('/profile/index.json')), await leseText('/profile/index.json'))
  })

  it('keeps that for a list of several versions', () => {
    const text = formatiereIndex(indexMitVersion(index, 'wohngeld', '2026-11-08', true))
    assert.match(text, /"aktuell": "2026-11-08",\n {6}"versionen": \["2026-11-07", "2026-11-08"\]\n/)
    const gelesen: ProfilIndex = JSON.parse(text)
    assert.deepEqual(gelesen.profile[0]?.versionen, ['2026-11-07', '2026-11-08'])
  })

  it('does not fold a list that is not made of names', () => {
    assert.equal(formatiereIndex({ profile: [], x: [1, 2] }), '{\n  "profile": [],\n  "x": [\n    1,\n    2\n  ]\n}\n')
  })
})

describe('Entwurf als Version', () => {
  it('sets the version and leaves the draft alone', () => {
    const entwurf = { ...roh2, version: '2026-11-07-entwurf' }
    const vorher = JSON.stringify(entwurf)
    assert.equal(fuerVersion(entwurf, '2026-11-08').version, '2026-11-08')
    assert.equal(JSON.stringify(entwurf), vorher)
  })

  it('writes the texts for the applicant without the spaces they were typed with', () => {
    const entwurf = setzeHinweis(setzeHinweis(roh2, MIETZUSCHUSS, 'miete', '  Bitte den Vertrag.  \n'), MIETZUSCHUSS, 'mitbewohner', '   ')
    const version = fuerVersion(entwurf, '2026-11-08')
    assert.equal(bedingung(version, 'miete').hinweis, 'Bitte den Vertrag.')
    assert.equal(Object.hasOwn(bedingung(version, 'mitbewohner'), 'hinweis'), false)
  })

  it('is the profile as it was, if nothing was changed', () => {
    assert.deepEqual(fuerVersion(roh2, roh2.version), roh2)
    assert.deepEqual(fuerVersion(roh, roh.version), roh, 'also a profile in format 1')
  })
})

/** The text of a file of a package: a string as it is, bytes as UTF-8. */
const inhaltText = (inhalt: Uint8Array | string): string => (typeof inhalt === 'string' ? inhalt : new TextDecoder().decode(inhalt))

describe('Versionspaket', () => {
  const holeDatei = (adresse: string) => leseBytes(adresse)
  const entwurf = setzeRolle(roh2, MIETZUSCHUSS, 'miete', 'bank_statement', 'genuegt')
  const paketVon = (eingabe: Partial<VersionspaketEingabe> = {}) => baueVersionspaket({ roh: entwurf, id: 'wohngeld', version: '2026-11-08', index, alsAktuell: true, ordner: WOHNGELD, holeDatei, ...eingabe })

  /** Reads from a package as the page reads from the server. */
  const leserFuer = (paket: ZipDatei[]) => {
    const dateien = new Map(paket.map(({ name, inhalt }): [string, Uint8Array | string] => [`/${name}`, inhalt]))
    return async (adresse: string) => {
      const inhalt = dateien.get(adresse)
      assert.ok(inhalt !== undefined, `${adresse} is not in the package`)
      return JSON.parse(typeof inhalt === 'string' ? inhalt : new TextDecoder().decode(inhalt))
    }
  }

  it('names the files of a version besides profil.json', async () => {
    const dateien = dateienDerVersion(roh2)
    assert.equal(dateien.length, 13)
    assert.deepEqual(dateien, dateienDerVersion(roh), 'the same in both formats')
    assert.ok(dateien.includes('dokumenttypen.json'))
    assert.ok(dateien.includes('schema/S01000000123V1.7.0.json'))
    assert.ok(dateien.includes('abbildung/S01000000128_1.6.1_nach_1.7.0.json'))
    for (const pfad of dateien) assert.ok(await leseBytes(WOHNGELD + pfad), pfad)
  })

  it('holds the complete folder of the new version and the updated index', async () => {
    const namen = (await paketVon()).map(({ name }) => name)
    assert.equal(namen[0], 'profile/wohngeld/2026-11-08/profil.json')
    assert.equal(namen.at(-1), 'profile/index.json')
    assert.equal(namen.length, 15)
    assert.ok(namen.every((name) => name.startsWith('profile/')))
    assert.ok(namen.includes('profile/wohngeld/2026-11-08/schema/S01000000126V1.7.0.json'))
  })

  it('takes the other files over unchanged, byte for byte', async () => {
    const paket = await paketVon()
    for (const pfad of dateienDerVersion(roh2)) {
      const datei = paket.find(({ name }) => name === `profile/wohngeld/2026-11-08/${pfad}`)
      assert.ok(datei, pfad)
      assert.deepEqual(datei.inhalt, await leseBytes(WOHNGELD + pfad), pfad)
    }
  })

  it('makes a profile in format 2 the engine can load and that is in order', async () => {
    const geladen = await ladeProfilNachKennung(leserFuer(await paketVon()), 'wohngeld', '/profile/')
    assert.equal(geladen.kennung, 'wohngeld@2026-11-08', 'the index names it as the current one')
    assert.equal(geladen.roh.format, 2)
    const fuerMiete = geladen
      .verwendungenFuer(MIETZUSCHUSS)
      .get('bank_statement')
      ?.find(({ art }) => geladen.nachweisarten[art]?.titel === 'Höhe der Miete')
    assert.ok(fuerMiete)
    assert.equal(fuerMiete.rolle, 'genuegt')
    assert.deepEqual((await validiereProfil(geladen)).fehler, [])
  })

  it('takes a file of the draft instead of the one of the version', async () => {
    const katalog = { ...(await lies<Katalog>(`${WOHNGELD}dokumenttypen.json`)) }
    const paket = await paketVon({ dateien: { 'dokumenttypen.json': katalog, 'schema/gibt-es-nicht.json': {} } })
    const datei = paket.find(({ name }) => name === 'profile/wohngeld/2026-11-08/dokumenttypen.json')
    assert.ok(datei)
    assert.equal(datei.inhalt, formatiereJson(katalog))
    assert.equal(paket.length, 15, 'a file the profile does not name stays out')
  })

  it('makes the first version of a new profile from the files of the draft alone', async () => {
    const gelesen = liesAntragsart(await fixture('xdf3-wohnhilfe.xml'), { DOMParser })
    const leer = neuesProfil({ id: 'wohnhilfe', name: 'Wohnhilfe' })
    const { roh: neu, datei } = fuegeAntragsartEin(leer, { ...gelesen, anbindung: schlageAnbindungVor(gelesen.xdf.schema, leer).anbindung, typen })
    const paket = await baueVersionspaket({
      roh: neu,
      id: 'wohnhilfe',
      version: '2026-11-08',
      index,
      alsAktuell: true,
      ordner: null,
      holeDatei: async (adresse) => assert.fail(`fetches ${adresse}`),
      dateien: { 'dokumenttypen.json': await lies<Katalog>(`${WOHNGELD}dokumenttypen.json`), [datei.pfad]: datei.inhalt },
    })

    assert.deepEqual(
      paket.map(({ name }) => name),
      ['profile/wohnhilfe/2026-11-08/profil.json', 'profile/wohnhilfe/2026-11-08/dokumenttypen.json', 'profile/wohnhilfe/2026-11-08/schema/S99000000001V1.0.0.json', 'profile/index.json'],
    )
    const letzte = paket.at(-1)
    assert.ok(letzte)
    const neuerIndex: ProfilIndex = JSON.parse(inhaltText(letzte.inhalt))
    assert.deepEqual(neuerIndex.profile, [...index.profile, { id: 'wohnhilfe', name: 'Wohnhilfe', aktuell: '2026-11-08', versionen: ['2026-11-08'] }])

    const geladen = await ladeProfilNachKennung(leserFuer(paket), 'wohnhilfe', '/profile/')
    assert.equal(geladen.kennung, 'wohnhilfe@2026-11-08')
    assert.deepEqual((await validiereProfil(geladen)).fehler, [])
  })

  it('leaves the current version where it is if asked to', async () => {
    const letzte = (await paketVon({ alsAktuell: false })).at(-1)
    assert.ok(letzte)
    const neuerIndex: ProfilIndex = JSON.parse(inhaltText(letzte.inhalt))
    assert.equal(neuerIndex.profile[0]?.aktuell, '2026-11-07')
  })

  it('asks for nothing it cannot get', async () => {
    await assert.rejects(
      paketVon({
        holeDatei: async () => {
          throw new Error('nicht da')
        },
      }),
      /nicht da/,
    )
  })
})
