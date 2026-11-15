import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { setzeRolle } from '../../src/engine/profil/bearbeiten.ts'
import { neuesProfil } from '../../src/engine/profil/antragsart.ts'
import {
  entwurfsVersion,
  ladeEntwurf,
  ladeEntwurfAlsProfil,
  liesMitProfil,
  neueProfileIm,
  neuerEntwurf,
  ordnerDesEntwurfs,
  speichereEntwurf,
  verwerfeEntwurf,
} from '../../src/engine/profil/entwurf.ts'
import { ProfilError } from '../../src/engine/profil/laden.ts'
import type { Katalog } from '../../src/engine/profil/laden.ts'
import { lies, WOHNGELD } from '../hilfen/dateien.ts'
import { LASTENZUSCHUSS, MIETZUSCHUSS, speicher, wohngeldFormat2 } from '../hilfen/format2.ts'

const { roh, roh1, schemas } = await wohngeldFormat2()

/** A storage that refuses, as a browser does in a private window or when it is full. */
const verweigernd = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> => ({
  getItem: () => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
  removeItem: () => {
    throw new Error('SecurityError')
  },
})

describe('Entwurf anlegen', () => {
  it('is a copy of the released profile that is not taken for it', () => {
    const entwurf = neuerEntwurf(roh)
    assert.equal(entwurf.basis, '2026-11-07')
    assert.equal(entwurf.profil.version, entwurfsVersion('2026-11-07'))
    assert.equal(entwurf.profil.version, '2026-11-07-entwurf')
    assert.deepEqual({ ...entwurf.profil, version: roh.version }, roh)
    assert.deepEqual(entwurf.dateien, {})
    assert.notEqual(entwurf.profil.antragsarten, roh.antragsarten, 'not the same object')
    assert.equal(roh.version, '2026-11-07', 'the released profile is not touched')
  })
})

describe('Entwurf aufbewahren', () => {
  it('keeps a draft and gives it back with the version it was made from', () => {
    const lager = speicher()
    const entwurf = neuerEntwurf(roh)
    assert.equal(speichereEntwurf(lager, 'wohngeld', entwurf, new Date('2026-11-07T14:32:00Z')), true)

    const geladen = ladeEntwurf(lager, 'wohngeld')
    assert.deepEqual(geladen, { ...entwurf, gespeichertAm: '2026-11-07T14:32:00.000Z' })
  })

  it('keeps one draft per profile', () => {
    const lager = speicher()
    speichereEntwurf(lager, 'wohngeld', neuerEntwurf(roh))
    assert.equal(ladeEntwurf(lager, 'elterngeld'), null)
    speichereEntwurf(lager, 'wohngeld', { basis: '2026-11-07', profil: { ...neuerEntwurf(roh).profil, name: 'Zweiter Stand' }, dateien: {} })
    assert.equal(ladeEntwurf(lager, 'wohngeld')?.profil.name, 'Zweiter Stand')
    assert.equal(lager.inhalt.size, 1)
  })

  it('forgets a draft that is discarded', () => {
    const lager = speicher()
    speichereEntwurf(lager, 'wohngeld', neuerEntwurf(roh))
    verwerfeEntwurf(lager, 'wohngeld')
    assert.equal(ladeEntwurf(lager, 'wohngeld'), null)
  })

  it('has no draft where none was made', () => {
    assert.equal(ladeEntwurf(speicher(), 'wohngeld'), null)
  })

  it('does not take what is in the storage for a draft unless it is one', () => {
    const lager = speicher()
    const schluessel = 'oneproof.entwurf.wohngeld'
    const gut = { format: 2, basis: '2026-11-07', gespeichertAm: '2026-11-07T10:00:00Z', profil: neuerEntwurf(roh).profil, dateien: {} }

    for (const kaputt of [
      'kein json',
      '[]',
      JSON.stringify({ ...gut, format: 3 }),
      JSON.stringify({ ...gut, format: 1, basis: null }),
      JSON.stringify({ ...gut, basis: 20261107 }),
      JSON.stringify({ ...gut, gespeichertAm: undefined }),
      JSON.stringify({ ...gut, profil: { ...gut.profil, id: 'elterngeld' } }),
      JSON.stringify({ ...gut, profil: { id: 'wohngeld' } }),
      JSON.stringify({ ...gut, profil: null }),
    ]) {
      lager.inhalt.set(schluessel, kaputt)
      assert.equal(ladeEntwurf(lager, 'wohngeld'), null, kaputt.slice(0, 40))
    }

    lager.inhalt.set(schluessel, JSON.stringify(gut))
    assert.ok(ladeEntwurf(lager, 'wohngeld'))
  })

  it('still reads a draft kept before there were files, in the format of its profile', () => {
    const lager = speicher()
    const alt = { format: 1, basis: '2026-11-07', gespeichertAm: '2026-11-07T10:00:00Z', profil: { ...roh1, version: '2026-11-07-entwurf' } }
    lager.inhalt.set('oneproof.entwurf.wohngeld', JSON.stringify(alt))
    const geladen = ladeEntwurf(lager, 'wohngeld')
    assert.ok(geladen)
    assert.equal(geladen.profil.format, 1)
    assert.deepEqual(geladen.dateien, {})
  })

  it('knows the profiles that exist only as a draft', () => {
    const lager = speicher()
    speichereEntwurf(lager, 'wohngeld', neuerEntwurf(roh))
    speichereEntwurf(lager, 'jagdschein', { basis: null, profil: neuesProfil({ id: 'jagdschein', name: 'Jagdschein' }), dateien: {} })
    lager.setItem('etwas.anderes', '{}')
    assert.deepEqual(neueProfileIm(lager), [{ id: 'jagdschein', name: 'Jagdschein' }])
    assert.deepEqual(neueProfileIm(null), [])
  })

  it('says if the browser will not keep it, and does not fall over', () => {
    assert.equal(speichereEntwurf(verweigernd(), 'wohngeld', neuerEntwurf(roh)), false)
    assert.equal(speichereEntwurf(null, 'wohngeld', neuerEntwurf(roh)), false)
    assert.equal(ladeEntwurf(verweigernd(), 'wohngeld'), null)
    assert.equal(ladeEntwurf(null, 'wohngeld'), null)
    assert.doesNotThrow(() => verwerfeEntwurf(verweigernd(), 'wohngeld'))
    assert.doesNotThrow(() => verwerfeEntwurf(null, 'wohngeld'))
  })
})

describe('Profil mit ausgetauschter Datei lesen', () => {
  it('serves the given profile in place of the file of that folder, everything else as it is', async () => {
    const gelesen: string[] = []
    const leser = liesMitProfil(async (adresse) => (gelesen.push(adresse), { aus: adresse }), '/profile/x/1/', { ersatz: true })
    assert.deepEqual(await leser('/profile/x/1/profil.json'), { ersatz: true })
    assert.deepEqual(await leser('/profile/x/1/dokumenttypen.json'), { aus: '/profile/x/1/dokumenttypen.json' })
    assert.deepEqual(await leser('/profile/x/2/profil.json'), { aus: '/profile/x/2/profil.json' }, 'another folder is another profile')
    assert.equal(gelesen.length, 2)
  })

  it('serves the files of a draft in place of those of the folder', async () => {
    const leser = liesMitProfil(async (adresse) => ({ aus: adresse }), '/profile/x/1/', { ersatz: true }, { 'schema/S1V1.json': { schema: 'neu' } })
    assert.deepEqual(await leser('/profile/x/1/schema/S1V1.json'), { schema: 'neu' })
    assert.deepEqual(await leser('/profile/x/1/schema/S2V1.json'), { aus: '/profile/x/1/schema/S2V1.json' })
  })
})

describe('Entwurf als Profil laden', () => {
  it('loads the draft with the catalogue and schemas of the version it was made from', async () => {
    const lager = speicher()
    const entwurf = neuerEntwurf(setzeRolle(roh, MIETZUSCHUSS, 'miete', 'rent_contract', null))
    speichereEntwurf(lager, 'wohngeld', entwurf)

    const { profil, entwurf: geladen } = await ladeEntwurfAlsProfil(lies, lager, 'wohngeld')
    assert.equal(geladen.basis, '2026-11-07')
    assert.equal(profil.kennung, 'wohngeld@2026-11-07-entwurf', 'a result made with it can be told from a released one')
    assert.equal(profil.typen.size, 76)
    const artDerMiete = (schema: string) =>
      profil.stellen.find((stelle) => stelle.id === 'miete' && stelle.antragsarten?.includes(schema))?.art
    const nimmt = (schema: string, typ: string) =>
      profil.verwendungenFuer(schema).get(typ)?.some((verwendung) => verwendung.art === artDerMiete(schema))
    assert.equal(nimmt(MIETZUSCHUSS, 'rent_contract'), false, 'not at the rent of this application type')
    assert.equal(nimmt(MIETZUSCHUSS, 'rent_certificate'), true)
    assert.equal(nimmt('S01000000124', 'rent_contract'), true, 'still at the rent of another one')
    assert.equal(artDerMiete(LASTENZUSCHUSS), undefined, 'an owner pays no rent')
    assert.equal(profil.ordner, WOHNGELD)
    assert.ok(await profil.ladeSchema(MIETZUSCHUSS))
  })

  it('loads a new profile with the catalogue and schema it brings along', async () => {
    const lager = speicher()
    const katalog = await lies<Katalog>(`${WOHNGELD}dokumenttypen.json`)
    const [mietzuschuss] = roh.antragsarten
    assert.ok(mietzuschuss)
    const neu = { ...neuesProfil({ id: 'mietzuschuss', name: 'Mietzuschuss' }), antragsarten: [mietzuschuss], personen: roh.personen, stichtag: roh.stichtag }
    neu.antragsarten[0] = { ...mietzuschuss, abbildungen: undefined }
    speichereEntwurf(lager, 'mietzuschuss', { basis: null, profil: neu, dateien: { 'dokumenttypen.json': katalog, [mietzuschuss.datei]: schemas.get(MIETZUSCHUSS) } })

    const { profil, entwurf } = await ladeEntwurfAlsProfil(async () => {
      throw new Error('nothing is read from the server')
    }, lager, 'mietzuschuss')
    assert.equal(entwurf.basis, null)
    assert.equal(profil.kennung, 'mietzuschuss@entwurf')
    assert.equal(profil.ordner, ordnerDesEntwurfs('mietzuschuss', null))
    assert.equal(profil.typen.size, 76)
    assert.ok(await profil.ladeSchema(MIETZUSCHUSS))
  })

  it('says so if there is no draft', async () => {
    await assert.rejects(ladeEntwurfAlsProfil(lies, speicher(), 'wohngeld'), (fehler: unknown) => {
      assert.ok(fehler instanceof ProfilError)
      assert.match(fehler.message, /Für „wohngeld“ liegt in diesem Browser kein Entwurf/)
      return true
    })
  })
})
