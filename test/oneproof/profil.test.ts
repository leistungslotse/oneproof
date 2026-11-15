import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AntragsartFormat2, ProfilFormat2, StelleFormat2 } from '../../src/engine/profil/bedingungen.ts'
import { liesMitProfil } from '../../src/engine/profil/entwurf.ts'
import { formatVon, ladeProfil, ladeProfilNachKennung } from '../../src/engine/profil/laden.ts'
import type { Katalog } from '../../src/engine/profil/laden.ts'
import { validiereProfil } from '../../src/engine/profil/validieren.ts'
import { lies } from '../hilfen/dateien.ts'

const ORDNER = '/profile/wohngeld/2026-11-15/'
const profil = await ladeProfil(lies, ORDNER)
const roh = await lies<ProfilFormat2>(`${ORDNER}profil.json`)

/** The profile with its OneProof application type changed. */
const mitOneProof = async (aendere: (art: AntragsartFormat2) => void) => {
  const kopie = structuredClone(roh)
  const art = kopie.antragsarten.find((kandidat) => kandidat.format === 'oneproof')
  assert.ok(art, 'Das Profil hat eine Antragsart im OneProof Format.')
  aendere(art)
  return ladeProfil(liesMitProfil(lies, ORDNER, kopie), ORDNER)
}

/** A place of an application type; the test names one that is there. */
const stelleMit = (art: AntragsartFormat2, id: string): StelleFormat2 => {
  const gefunden = art.stellen.find((kandidat) => kandidat.id === id)
  assert.ok(gefunden, `Es gibt die Stelle ${id}.`)
  return gefunden
}

describe('Wohngeld-Profil 2026-11-15 mit dem OneProof Format', () => {
  it('is the current version and consistent with its schemas and the document catalogue', async () => {
    assert.equal((await ladeProfilNachKennung(lies, 'wohngeld')).kennung, 'wohngeld@2026-11-15')
    assert.deepEqual(await validiereProfil(profil), { fehler: [], warnungen: [] })
  })

  it('knows the six FIM application types and one in the OneProof Format', () => {
    assert.deepEqual(profil.antragsarten.map(formatVon), ['fim', 'fim', 'fim', 'fim', 'fim', 'fim', 'oneproof'])
    const art = profil.antragsarten.at(-1)
    assert.ok(art)
    assert.equal(art.schema, 'oneproof:wohngeld')
    assert.equal(art.version, '1.0')
    assert.deepEqual(profil.anbindungFuer('oneproof:wohngeld').personen, {})
    assert.equal(profil.anbindungFuer('oneproof:wohngeld').stichtag, '/antragstellung/zeitpunkt')
  })

  it('loads the schema of the benefit together with the frame it builds on', async () => {
    const schemata = await profil.ladeJsonSchema('oneproof:wohngeld')
    assert.ok(schemata)
    const { haupt, alle } = schemata
    assert.equal(haupt.$id, 'urn:oneproof:format:wohngeld:1.0')
    assert.deepEqual(alle.map(({ $id }) => $id), ['urn:oneproof:format:wohngeld:1.0', 'urn:oneproof:format:rahmen:1.0'])
    const schema = await profil.ladeSchema('oneproof:wohngeld')
    assert.ok(schema)
    assert.equal('format' in schema ? schema.format : undefined, 'oneproof')
  })

  it('finds a place that is not in the schema, a placeholder that leads nowhere and a code that does not exist', async () => {
    const falsch = await mitOneProof((art) => {
      stelleMit(art, 'miete').position = '/fachdaten/mietzuschuss/kaltmiete'
      stelleMit(art, 'einnahmen').aussage = '{/fachdaten/personen/*/einkommen/eintraege/*/brutto|eur}'
      const fragen = stelleMit(art, 'vollmacht').nennt
      assert.ok(Array.isArray(fragen))
      const [erste] = fragen
      assert.ok(erste)
      erste.ja = ['generalvollmacht']
    })
    const { fehler, warnungen } = await validiereProfil(falsch)
    assert.deepEqual(fehler, ['Wohngeld – Miet- und Lastenzuschuss, OneProof Format › Höhe der Miete: die Position „/fachdaten/mietzuschuss/kaltmiete“ gibt es im Schema nicht.'])
    assert.ok(warnungen.some((meldung) => meldung.includes('der Platzhalter „/fachdaten/personen/*/einkommen/eintraege/*/brutto“ steht in keinem Schema')), warnungen.join('\n'))
    assert.ok(warnungen.some((meldung) => meldung.includes('kennt den Wert „generalvollmacht“ aus „ja“ nicht')), warnungen.join('\n'))
  })

  it('wants the schema file to be the benefit and version the application type names', async () => {
    const { fehler } = await validiereProfil(await mitOneProof((art) => (art.version = '1.1')))
    assert.deepEqual(fehler, ['Antragsart oneproof:wohngeld: „schema/wohngeld-1.0.schema.json“ ist das Schema „oneproof:wohngeld“ in Version 1.0, die Antragsart nennt „oneproof:wohngeld“ in Version 1.1.'])
  })

  it('names a type of the catalogue that the schema cannot give an attachment', async () => {
    const katalog: Katalog = {
      ...(await lies<Katalog>(`${ORDNER}dokumenttypen.json`)),
      parking_permit: { label: 'Parkausweis', description: 'Ein Typ, den das Schema nicht kennt.' },
    }
    const mehr = await ladeProfil(liesMitProfil(lies, ORDNER, roh, { 'dokumenttypen.json': katalog }), ORDNER)
    const { fehler, warnungen } = await validiereProfil(mehr)
    assert.deepEqual(fehler, [])
    assert.deepEqual(warnungen, ['Wohngeld – Miet- und Lastenzuschuss, OneProof Format: das Schema kennt die Dokumentarten „parking_permit“ des Katalogs nicht. Anlagen dieser Typen stehen im Antragspaket ohne Dokumentart.'])
  })
})
