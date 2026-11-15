import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ladeProfilIndex } from '../../src/engine/profil/laden.ts'
import type { Katalog, ProfilRoh } from '../../src/engine/profil/laden.ts'
import { lies } from '../hilfen/dateien.ts'

/** The catalogue of one version of a profile. */
interface KatalogEinerVersion {
  /** `id@version`. */
  kennung: string
  /** The version is the current one of its profile. */
  aktuell: boolean
  katalog: Katalog
}

// Every catalogue of every version the installation offers.
const kataloge: KatalogEinerVersion[] = []
for (const eintrag of await ladeProfilIndex(lies)) {
  for (const version of eintrag.versionen) {
    const ordner = `/profile/${eintrag.id}/${version}/`
    const roh = await lies<ProfilRoh>(`${ordner}profil.json`)
    kataloge.push({ kennung: `${eintrag.id}@${version}`, aktuell: version === eintrag.aktuell, katalog: await lies<Katalog>(`${ordner}${roh.dokumenttypen}`) })
  }
}

describe('Dokumenttypen-Katalog', () => {
  it('describes documents only: no version names the statement a type proves', () => {
    // Which statement of a benefit a document proves, with which features, is the profile's to say.
    assert.ok(kataloge.length > 0)
    for (const { kennung, katalog } of kataloge) {
      for (const [typ, eintrag] of Object.entries(katalog)) {
        for (const schluessel of ['fim', 'fim_merkmale', 'fim_fallback']) {
          assert.ok(!Object.hasOwn(eintrag, schluessel), `${kennung}: ${typ} nennt „${schluessel}“`)
        }
      }
    }
  })

  it('is worded for every benefit alike in the current version', () => {
    // A new profile starts from this catalogue. Law, agencies and purposes of one benefit belong
    // to its profile; only a document of that benefit itself (the housing benefit notice) names it.
    const wohngeld = /Wohngeld|WoGG/
    const aktuelle = kataloge.filter(({ aktuell }) => aktuell)
    assert.ok(aktuelle.length > 0)
    for (const { kennung, katalog } of aktuelle) {
      for (const [typ, eintrag] of Object.entries(katalog)) {
        if (typ === 'housing_benefit_notice') continue
        assert.doesNotMatch(JSON.stringify([eintrag.label, eintrag.description, eintrag.fields ?? {}]), wohngeld, `${kennung}: ${typ}`)
      }
    }
  })
})
