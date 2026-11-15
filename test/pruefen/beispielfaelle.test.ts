import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ladeProfilNachKennung } from '../../src/engine/profil/laden.ts'
import { ladeBeispielBeschreibung, ladeBeispielDateien } from '../../src/pruefen/beispiel.ts'
import { dateiArt } from '../../src/pdf/art.ts'
import { erkenneAntrag } from '../../src/pruefen/steuerung.ts'
import { leseBytes, lies } from '../hilfen/dateien.ts'
import { DOMParser } from '../hilfen/xml.ts'

/** The site as the page sees it: the files below `public/`. */
async function holen(adresse: string): Promise<Response> {
  try {
    const bytes = await leseBytes(decodeURI(adresse))
    const json = adresse.endsWith('.json')
    // The copy is backed by a plain `ArrayBuffer`, as a response body has to be.
    return new Response(new Uint8Array(bytes), { headers: json ? { 'content-type': 'application/json' } : {} })
  } catch {
    return new Response('nicht da', { status: 404 })
  }
}

// The page offers the examples with the current profile.
const profil = await ladeProfilNachKennung(lies, 'wohngeld')
const katalog = await ladeBeispielBeschreibung('wohngeld', { holen, ordner: '/beispiele/' })

describe('Beispielfälle des Wohngeld-Profils', () => {
  it('offers several cases', () => {
    assert.ok(katalog, 'the catalogue can be read')
    assert.deepEqual(
      katalog.beispiele.map(({ id }) => id),
      ['berger', 'yilmaz', 'schmidt', 'einstein', 'einstein-oneproof'],
    )
    for (const { titel, beschreibung } of katalog.beispiele) {
      assert.notEqual(titel, 'Beispielfall')
      assert.ok(beschreibung.length > 40)
    }
  })

  for (const beispiel of katalog?.beispiele ?? []) {
    it(`${beispiel.id}: every file is there, the application is one the profile knows, the evidence one the check reads`, async () => {
      const { antrag, nachweise } = await ladeBeispielDateien('wohngeld', beispiel, { holen, ordner: '/beispiele/' })
      const erkannt = await erkenneAntrag({ profil, datei: antrag, DOMParser })
      assert.ok(erkannt.personen.length > 0, 'the application names its persons')
      assert.equal(nachweise.length, beispiel.nachweise.length)
      for (const datei of nachweise) {
        assert.notEqual(dateiArt(datei), null, `${datei.name} is a PDF, JPEG or PNG`)
        assert.ok(datei.size > 0, `${datei.name} is not empty`)
      }
    })
  }
})
