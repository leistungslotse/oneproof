// The Einstein case twice: once as a FIM instance, once in the OneProof Format. Both name the same
// household and the same facts, so the check must come to the same result — up to what the two
// formats say differently (see docs/oneproof-format.md, "Unterschiede zu FIM").
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import { pruefeAntrag } from '../../src/engine/oneproof/pruefung.ts'
import { istOneProofSchema } from '../../src/engine/oneproof/schema.ts'
import { ANTRAG_DATEIEN, bauePaket } from '../../src/engine/paket/paket.ts'
import { pruefe } from '../../src/engine/pipeline.ts'
import { ladeProfil } from '../../src/engine/profil/laden.ts'
import type { Anforderung } from '../../src/engine/zuordnung/anforderungen.ts'
import type { Seite } from '../../src/engine/zuordnung/posten.ts'
import { leseText, lies } from '../hilfen/dateien.ts'
import { datei, falscheKi, oeffne } from '../hilfen/falsche-ki.ts'
import type { Regel } from '../hilfen/falsche-ki.ts'
import { DOMParser, XMLSerializer } from '../hilfen/xml.ts'
import { alsText, liesZip } from '../hilfen/zip-lesen.ts'

const profil = await ladeProfil(lies, '/profile/wohngeld/2026-11-15/')

const regeln: Regel[] = [
  { muster: /Verdienstbescheinigung.*Albert/, typ: 'income_certificate', person: 'Albert Einstein' },
  { muster: /Verdienstbescheinigung.*Silvia/, typ: 'income_certificate', person: 'Silvia Einstein' },
  { muster: /Kontoauszug/, typ: 'bank_statement', person: 'Svenja Einstein' },
  { muster: /Vermögen/, typ: 'asset_proof', person: 'Svenja Einstein' },
]
const nachweise = [
  datei('verdienst-albert.pdf', ['Verdienstbescheinigung des Arbeitgebers für Albert Einstein, brutto 477,00 EUR monatlich']),
  datei('verdienst-silvia.pdf', ['Verdienstbescheinigung des Arbeitgebers für Silvia Einstein']),
  datei('kontoauszug.pdf', ['Kontoauszug Svenja Einstein, Miete Physikweg 13 -950,00']),
  datei('vermoegen.pdf', ['Vermögens- und Kapitalertragsnachweis Svenja Einstein']),
]
const pruefeText = (antragText: string) => pruefe({ profil, antragText, DOMParser, oeffne, ki: falscheKi({ regeln }), nachweise })

const fimText = await leseText('/beispiele/wohngeld/antrag-einstein-wohngeld-1.7.0.xml')
const oneproofText = await leseText('/beispiele/wohngeld/antrag-einstein-wohngeld-oneproof.json')
const fim = await pruefeText(fimText)
const oneproof = await pruefeText(oneproofText)

/** A requirement without the person where the formats place it differently. */
const kurz = ({ id, status, belege }: Anforderung): string => `${id.split('#')[0]} ${status} [${belege.map(({ typ }) => typ).join(',')}]`
const jePerson = ({ id, person, status, belege }: Anforderung): string => `${id.split('#')[0]} ${person ?? '–'} ${status} [${belege.map(({ typ }) => typ).join(',')}]`

describe('Einstein als FIM-Instanz und im OneProof Format', () => {
  it('reads the same household from both', () => {
    assert.deepEqual(oneproof.antrag.personen, fim.antrag.personen)
    assert.equal(oneproof.antrag.format, 'oneproof')
    assert.equal(oneproof.antrag.stichtag, fim.antrag.stichtag)
  })

  it('comes to the same requirements with the same evidence', () => {
    assert.deepEqual(new Set(oneproof.anforderungen.map(kurz)), new Set(fim.anforderungen.map(kurz)))
  })

  it('differs only where FIM states for each person what the OneProof Format states for the household', () => {
    const nurFim = fim.anforderungen.map(jePerson).filter((eintrag) => !oneproof.anforderungen.map(jePerson).includes(eintrag))
    const haushaltsweit = new Set(nurFim.map((eintrag) => eintrag.split(' ')[0]))
    assert.deepEqual([...haushaltsweit].sort(), ['einmalige_einnahmen', 'einnahmen_veraenderung', 'unterhalt', 'vermoegen', 'verpflichtungserklaerung'])
    for (const id of haushaltsweit) {
      assert.ok(oneproof.anforderungen.some((anforderung) => anforderung.id.startsWith(`${id}#p-`)), `${id} once for the household`)
    }
  })
})

const setzeZusammen = async (seiten: readonly Seite[]) => new TextEncoder().encode(`%PDF ${seiten.map(({ fileId, page }) => `${fileId}:${page}`).join(',')}`)
const original = async (fileId: string) => new TextEncoder().encode(`ORIGINAL ${fileId}`)
const eingang = { aktenzeichen: 'WG-2026-00815', fallId: 'f_einstein' }
const paket = await bauePaket({ ergebnis: oneproof, antragText: oneproofText, profil, eingang, setzeZusammen, original, jetzt: () => new Date(2026, 10, 15, 12) })
const dateien = liesZip(paket.daten)
const inhaltVon = (name: string): Uint8Array | undefined => dateien.find((kandidat) => kandidat.name === name)?.daten
const bytesVon = (name: string): Uint8Array => {
  const daten = inhaltVon(name)
  assert.ok(daten, `${name} is in the package`)
  return daten
}

/** An attachment of the application in the package, as far as the tests look at it. */
interface Anlage {
  dateiname: string
  zweck: string
  dokumentart?: string
  person?: string
  beschreibung?: string
  mimeType?: string
  hashwert?: { algorithmus: string; wert: string }
  bezuege?: { stelle: string }[]
}

const antrag: { anlagen: Anlage[] } = JSON.parse(alsText(bytesVon('antrag.json')))
const anlage = (name: string): Anlage => {
  const gefunden = antrag.anlagen.find(({ dateiname }) => dateiname === name)
  assert.ok(gefunden, `${name} is an attachment`)
  return gefunden
}

describe('Antragspaket im OneProof Format', () => {

  it('holds the application as antrag.json, and no antrag.xml', () => {
    assert.equal(paket.antragsdatei, ANTRAG_DATEIEN.oneproof)
    assert.deepEqual(dateien.slice(0, 3).map(({ name }) => name), ['antrag.json', 'oneproof-manifest.json', 'inhalt.txt'])
    assert.equal(inhaltVon('antrag.xml'), undefined)
  })

  it('keeps the application as it was and lists the files of the package as its attachments', async () => {
    const vorher: object = JSON.parse(oneproofText)
    assert.deepEqual({ ...antrag, anlagen: undefined }, { ...vorher, anlagen: undefined })
    assert.deepEqual(
      antrag.anlagen.map(({ dateiname }) => dateiname),
      dateien.slice(3).map(({ name }) => name),
    )
    assert.ok(antrag.anlagen.every(({ zweck }) => zweck === 'nachweis'))
    const schemata = await profil.ladeJsonSchema('oneproof:wohngeld')
    const kompakt = await profil.ladeSchema('oneproof:wohngeld')
    assert.ok(schemata)
    assert.ok(kompakt && istOneProofSchema(kompakt))
    assert.deepEqual(pruefeAntrag(antrag, schemata, kompakt), [])
  })

  it('names for each file the values it supports, its type, its person and its hash', () => {
    const konto = anlage('kontoauszug-svenja-einstein.pdf')
    assert.deepEqual(konto.bezuege, [{ stelle: '/fachdaten/mietzuschuss/miete' }, { stelle: '/fachdaten/personen/0/einkommen/eintraege/0' }, { stelle: '/fachdaten/vermoegen' }])
    assert.equal(konto.dokumentart, 'bank_statement')
    assert.equal(konto.person, 'p1')
    assert.equal(konto.beschreibung, 'Kontoauszug · Svenja Einstein')
    assert.equal(konto.mimeType, 'application/pdf')
    const bytes = bytesVon('kontoauszug-svenja-einstein.pdf')
    assert.deepEqual(konto.hashwert, { algorithmus: 'sha512', wert: createHash('sha512').update(bytes).digest('hex') })

    const albert = anlage('verdienstbescheinigung-des-arbeitgebers-albert-einstein.pdf')
    assert.deepEqual([albert.person, albert.bezuege], ['p2', [{ stelle: '/fachdaten/personen/1/einkommen/eintraege/0' }]])
  })

  it('lists a document in the name of someone outside the household without person and without reference', () => {
    const silvia = anlage('verdienstbescheinigung-des-arbeitgebers-silvia-einstein.pdf')
    assert.equal(silvia.person, undefined)
    assert.equal(silvia.bezuege, undefined)
    assert.equal(silvia.dokumentart, 'income_certificate')
  })

  it('says in inhalt.txt what the attachments are and which ones of the upload were dropped', () => {
    const inhalt = alsText(bytesVon('inhalt.txt'))
    assert.match(inhalt, /Die Antragsdaten im OneProof Format \(oneproof:wohngeld, Version 1\.0\) mit den Nachweisen als Anlagen\./)
    assert.match(inhalt, /Ersetzt: 2 Anlagen des hochgeladenen Antrags \(.+\); an ihrer Stelle stehen die Dateien dieses Pakets\./)
    assert.match(inhalt, /Verweis im Antrag: Vermögen\n {6}\/fachdaten\/vermoegen/)
  })

  it('names in the manifest where each fact stands in the application', () => {
    const eintrag = (id: string) => paket.manifest.eintraege.find(({ anforderungId }) => anforderungId === id)
    assert.equal(eintrag('einnahmen#p1#1')?.stelle, '/fachdaten/personen/1/einkommen/eintraege/0')
    assert.equal(eintrag('vermoegen#p-#1')?.stelle, '/fachdaten/vermoegen')
  })
})

describe('Antragspaket aus einer FIM-Instanz', () => {
  it('stays as it was: antrag.xml, no pointers in the manifest', async () => {
    const paket = await bauePaket({
      ergebnis: fim,
      antragText: fimText,
      profil,
      eingang: { aktenzeichen: 'WG-2026-00816', fallId: 'f_einstein_fim' },
      setzeZusammen: async () => new Uint8Array([37]),
      original: async () => new Uint8Array([37]),
      DOMParser,
      XMLSerializer,
    })
    assert.equal(paket.antragsdatei, 'antrag.xml')
    assert.equal(liesZip(paket.daten)[0]?.name, 'antrag.xml')
    assert.ok(paket.manifest.eintraege.every((eintrag) => !('stelle' in eintrag)))
  })
})
