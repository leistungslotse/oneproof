// An owner's application for a charges allowance in the OneProof Format: what the running costs of the
// home ask for. Each kind of cost has its own place there (`aufwendung_<art>`), and the evidence is the
// document that states that kind of cost — not the one of another kind.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pruefe } from '../../src/engine/pipeline.ts'
import { ladeProfil } from '../../src/engine/profil/laden.ts'
import type { Anforderung } from '../../src/engine/zuordnung/anforderungen.ts'
import { leseText, lies } from '../hilfen/dateien.ts'
import { datei, falscheKi, oeffne } from '../hilfen/falsche-ki.ts'
import type { Regel } from '../hilfen/falsche-ki.ts'
import { DOMParser } from '../hilfen/xml.ts'

const profil = await ladeProfil(lies, '/profile/wohngeld/2026-11-15/')

/** The example application as an owner's, with these running costs. */
async function eigentuemer(laufendeKosten: Record<string, number>): Promise<string> {
  const antrag = JSON.parse(await leseText('/beispiele/wohngeld/antrag-einstein-wohngeld-oneproof.json'))
  antrag.fachdaten.wohnraum.wohnverhaeltnis = 'owner'
  antrag.fachdaten.wohnraum.eigentumMitMehrAlsZweiWohnungen = false
  delete antrag.fachdaten.mietzuschuss
  antrag.fachdaten.lastenzuschuss = { eigentumsform: 'flat', laufendeKosten }
  return JSON.stringify(antrag)
}

const regeln: Regel[] = [
  { muster: /Grundsteuerbescheid/, typ: 'property_tax_notice', person: 'Svenja Einstein' },
  { muster: /Hausgeldabrechnung/, typ: 'homeowner_fee_statement', person: 'Svenja Einstein' },
  { muster: /Erbbaurecht/, typ: 'ground_lease_proof', person: 'Svenja Einstein' },
  { muster: /Heizkosten/, typ: 'heating_statement', person: 'Svenja Einstein' },
]
const nachweise = [
  datei('grundsteuer.pdf', ['Grundsteuerbescheid 2026 für Svenja Einstein']),
  datei('hausgeld.pdf', ['Hausgeldabrechnung 2025 für Svenja Einstein']),
  datei('erbbau.pdf', ['Erbbaurechtsvertrag, Erbbauzins 1.440 EUR jährlich, Svenja Einstein']),
  datei('heizung.pdf', ['Heizkostenabrechnung Fernwärme für Svenja Einstein']),
]

/** The documents that count at a place, by their type. */
const belegtDurch = (anforderungen: Anforderung[], stelle: string): string[] =>
  anforderungen.filter(({ id }) => id.split('#')[0] === stelle).flatMap(({ belege }) => belege.map(({ typ }) => typ))

describe('Laufende Kosten im Lastenzuschuss (OneProof Format)', () => {
  it('takes the ground lease for the ground rent and the heating statement for the heating costs, not the tax notice', async () => {
    const antragText = await eigentuemer({ erbbauzinsen: 120, waermeUndWarmwasser: 80, grundsteuer: 30, verwaltungskosten: 25 })
    const { anforderungen } = await pruefe({ profil, antragText, DOMParser, oeffne, ki: falscheKi({ regeln }), nachweise })

    assert.deepEqual(belegtDurch(anforderungen, 'aufwendung_erbbauzinsen'), ['ground_lease_proof'])
    assert.deepEqual(belegtDurch(anforderungen, 'aufwendung_waermeundwarmwasser'), ['heating_statement'])
    assert.deepEqual(belegtDurch(anforderungen, 'aufwendung_grundsteuer'), ['property_tax_notice'])
    assert.deepEqual(belegtDurch(anforderungen, 'aufwendung_verwaltungskosten'), ['homeowner_fee_statement'])
    const erbbau = anforderungen.find(({ id }) => id.startsWith('aufwendung_erbbauzinsen#'))
    assert.ok(erbbau)
    assert.notEqual(erbbau.status, 'offen', 'a ground lease for ground rent leaves the place open no longer')
  })

  it('asks for the document of the kind of cost, in the words of that kind', () => {
    const stellen = profil.antragsarten.find(({ schema }) => schema === 'oneproof:wohngeld')?.stellen
    assert.ok(stellen)
    const hinweis = (id: string): string | undefined => stellen.find((stelle) => stelle.id === id)?.bedingungen[0]?.hinweis
    assert.match(hinweis('aufwendung_erbbauzinsen') ?? '', /Erbbau/)
    assert.match(hinweis('aufwendung_waermeundwarmwasser') ?? '', /Heizkosten/)
    assert.match(hinweis('aufwendung_grundsteuer') ?? '', /Grundsteuer/)
  })
})
