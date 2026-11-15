import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PruefFehler } from '../../src/engine/fehler.ts'
import { mitStandard } from '../../src/engine/ionos/modelle.ts'
import type { Phase } from '../../src/engine/pipeline.ts'
import { ladeProfil } from '../../src/engine/profil/laden.ts'
import { ladeKonfiguration } from '../../src/pruefen/konfiguration.ts'
import type { KonfigurationsAntwort } from '../../src/pruefen/konfiguration.ts'
import {
  erkenneAntrag,
  fuehreAus,
  liesAntragsdatei,
  MAX_ANTRAG_BYTES,
  MAX_NACHWEIS_BYTES,
  MAX_NACHWEISE,
  waehleNachweise,
} from '../../src/pruefen/steuerung.ts'
import { fixture, lies, WOHNGELD } from '../hilfen/dateien.ts'
import { datei, falscheKi, oeffne } from '../hilfen/falsche-ki.ts'
import type { Regel } from '../hilfen/falsche-ki.ts'
import { DOMParser } from '../hilfen/xml.ts'

const profil = await ladeProfil(lies, WOHNGELD)
const xml = await fixture('antrag-mietzuschuss-1.7.0.xml')

/** A stand-in for a `File`: all the page asks of one. */
const datei_ = (name: string, inhalt = 'x', optionen: { size?: number; type?: string; lastModified?: number } = {}) => ({
  name,
  size: optionen.size ?? inhalt.length,
  type: optionen.type ?? '',
  lastModified: optionen.lastModified ?? 1,
  text: async () => inhalt,
})

describe('Antragsdatei lesen', () => {
  it('returns the text', async () => {
    assert.equal(await liesAntragsdatei(datei_('a.xml', '<a/>')), '<a/>')
  })

  it('rejects an empty file', async () => {
    await assert.rejects(liesAntragsdatei(datei_('a.xml', '', { size: 0 })), { bereich: 'antrag', message: 'Die Antragsdatei ist leer.' })
  })

  it('rejects a file too large for an application, naming its size', async () => {
    await assert.rejects(liesAntragsdatei(datei_('a.xml', 'x', { size: MAX_ANTRAG_BYTES + 1 })), (fehler: unknown) => {
      assert.ok(fehler instanceof PruefFehler)
      assert.equal(fehler.bereich, 'antrag')
      assert.match(fehler.message, /zu groß/)
      return true
    })
  })

  it('reports a file that cannot be read', async () => {
    const kaputt = { ...datei_('a.xml'), text: async () => { throw new Error('boom') } }
    await assert.rejects(liesAntragsdatei(kaputt), { bereich: 'antrag', message: 'Die Antragsdatei konnte nicht gelesen werden.' })
  })
})

describe('Antrag erkennen', () => {
  it('names the application, its version and its persons', async () => {
    const erkannt = await erkenneAntrag({ profil, datei: datei_('antrag.xml', xml), DOMParser })

    assert.equal(erkannt.name, 'Wohngeld – Mietzuschuss, Erstantrag')
    assert.equal(erkannt.schema, 'S01000000123')
    assert.equal(erkannt.version, '1.7.0')
    assert.deepEqual(erkannt.personen, ['Svenja Einstein', 'Albert Einstein'])
    assert.equal(erkannt.xml, xml)
  })

  it('says if the application was written in an older version', async () => {
    const alt = await fixture('antrag-mietzuschuss-1.6.1.xml')
    const erkannt = await erkenneAntrag({ profil, datei: datei_('antrag.xml', alt), DOMParser })

    assert.equal(erkannt.version, '1.7.0')
    assert.ok(erkannt.hinweise.some((hinweis) => /1\.6\.1/.test(hinweis)), erkannt.hinweise.join(' | '))
  })

  it('rejects a file that is no XML, with a message for a person', async () => {
    await assert.rejects(erkenneAntrag({ profil, datei: datei_('a.xml', 'kein xml'), DOMParser }), (fehler: unknown) => {
      assert.ok(fehler instanceof PruefFehler)
      assert.equal(fehler.bereich, 'antrag')
      assert.match(fehler.message, /kein gültiges XML/)
      return true
    })
  })

  it('rejects an application of a schema the profile does not know', async () => {
    const fremd = xml.replaceAll('S01000000123', 'S09999999999')
    await assert.rejects(erkenneAntrag({ profil, datei: datei_('a.xml', fremd), DOMParser }), { bereich: 'antrag' })
  })
})

describe('Nachweise wählen', () => {
  const pdf = (name: string, optionen?: { size?: number; lastModified?: number }) => datei_(name, 'x', { type: 'application/pdf', ...optionen })

  it('takes PDF, JPEG and PNG', () => {
    const { angenommen, abgelehnt } = waehleNachweise([pdf('a.pdf'), datei_('b.jpg', 'x', { type: 'image/jpeg' }), datei_('c.png', 'x', { type: 'image/png' })])
    assert.deepEqual(angenommen.map(({ name }) => name), ['a.pdf', 'b.jpg', 'c.png'])
    assert.deepEqual(abgelehnt, [])
  })

  it('recognises a file by its ending if the browser names no type', () => {
    assert.equal(waehleNachweise([datei_('Scan.PDF')]).angenommen.length, 1)
  })

  it('declines another kind of file and says which are allowed', () => {
    const { angenommen, abgelehnt } = waehleNachweise([datei_('vertrag.docx', 'x', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })])
    assert.equal(angenommen.length, 0)
    assert.deepEqual(abgelehnt, ['„vertrag.docx“ wird nicht gelesen. Erlaubt sind PDF-, JPEG- und PNG-Dateien.'])
  })

  it('declines an empty file and an oversized one', () => {
    const { angenommen, abgelehnt } = waehleNachweise([pdf('leer.pdf', { size: 0 }), pdf('riesig.pdf', { size: MAX_NACHWEIS_BYTES + 1 })])
    assert.equal(angenommen.length, 0)
    assert.equal(abgelehnt.length, 2)
    assert.match(abgelehnt[0] ?? '', /ist leer/)
    assert.match(abgelehnt[1] ?? '', /zu groß/)
  })

  it('does not take the same file twice, whether chosen now or before', () => {
    const vorhanden = [pdf('a.pdf')]
    const { angenommen, abgelehnt } = waehleNachweise([pdf('a.pdf'), pdf('b.pdf'), pdf('b.pdf')], vorhanden)
    assert.deepEqual(angenommen.map(({ name }) => name), ['b.pdf'])
    assert.deepEqual(abgelehnt, ['„a.pdf“ ist bereits ausgewählt.', '„b.pdf“ ist bereits ausgewählt.'])
  })

  it('takes files of the same name if they differ', () => {
    const { angenommen } = waehleNachweise([pdf('a.pdf', { size: 5 })], [pdf('a.pdf', { size: 9 })])
    assert.equal(angenommen.length, 1)
  })

  it('stops at the limit and says so', () => {
    const viele = Array.from({ length: MAX_NACHWEISE + 2 }, (_, i) => pdf(`n${i}.pdf`))
    const { angenommen, abgelehnt } = waehleNachweise(viele)
    assert.equal(angenommen.length, MAX_NACHWEISE)
    assert.equal(abgelehnt.length, 2)
    assert.match(abgelehnt[0] ?? '', new RegExp(`höchstens ${MAX_NACHWEISE} Dateien`))
  })
})

describe('Prüfung ausführen', () => {
  const konfiguration = mitStandard({})
  const regeln: Regel[] = [{ muster: /Mietvertrag/, typ: 'rent_contract' }]
  const mietvertrag = datei('mietvertrag.pdf', ['Mietvertrag über die Wohnung', 'Unterschriften zum Mietvertrag'])

  it('reads the files and returns the result', async () => {
    const antrag = await erkenneAntrag({ profil, datei: datei_('a.xml', xml), DOMParser })
    const ergebnis = await fuehreAus({
      profil,
      antrag,
      nachweise: [mietvertrag],
      oeffne,
      konfiguration,
      client: falscheKi({ regeln }).client,
      DOMParser,
    })

    assert.equal(ergebnis.anforderungen.find(({ id }) => id === 'miete#p-#1')?.status, 'belegt')
  })

  it('asks the AI under the configured address', async () => {
    const antrag = await erkenneAntrag({ profil, datei: datei_('a.xml', xml), DOMParser })
    const adressen: string[] = []
    const holen = async (url: string) => {
      adressen.push(url)
      return new Response('{"data":[]}', { status: 200, headers: { 'content-type': 'application/json' } })
    }

    // The service lists no models, so the check stops at the first question: that is all this shows.
    await assert.rejects(
      fuehreAus({ profil, antrag, nachweise: [mietvertrag], oeffne, konfiguration: mitStandard({ ionos: { basis: '/mein/ionos/v1' } }), holen, DOMParser }),
      { bereich: 'ki', art: 'modell' },
    )
    assert.deepEqual(adressen, ['/mein/ionos/v1/models'])
  })

  it('needs no AI access if there is no evidence', async () => {
    const antrag = await erkenneAntrag({ profil, datei: datei_('a.xml', xml), DOMParser })
    const holen = async () => assert.fail('nothing to ask the AI')
    const ergebnis = await fuehreAus({ profil, antrag, nachweise: [], oeffne, konfiguration, holen, DOMParser })

    assert.equal(ergebnis.zusammenfassung.belegt, 0)
    assert.equal(ergebnis.ki.versuche, 0)
  })

  it('reports progress', async () => {
    const antrag = await erkenneAntrag({ profil, datei: datei_('a.xml', xml), DOMParser })
    const phasen: Phase[] = []
    await fuehreAus({ profil, antrag, nachweise: [], oeffne, konfiguration, fortschritt: ({ phase }) => phasen.push(phase), DOMParser })
    assert.deepEqual([...new Set(phasen)], ['antrag', 'zuordnen'])
  })
})

describe('Konfiguration laden', () => {
  const antwort = (koerper: unknown, { ok = true, typ = 'application/json' }: { ok?: boolean; typ?: string } = {}): KonfigurationsAntwort => ({
    ok,
    headers: new Headers({ 'content-type': typ }),
    json: async (): Promise<unknown> => (typeof koerper === 'string' ? JSON.parse(koerper) : koerper),
  })
  const stumm = () => {}

  it('uses the defaults without a file', async () => {
    const konfiguration = await ladeKonfiguration({ holen: async () => antwort({}, { ok: false }), warnen: stumm })
    assert.deepEqual(konfiguration, mitStandard({}))
  })

  it('does not take the start page of a server for the file', async () => {
    const konfiguration = await ladeKonfiguration({ holen: async () => antwort('{ kaputt', { typ: 'text/html' }), warnen: stumm })
    assert.deepEqual(konfiguration, mitStandard({}))
  })

  it('applies what the file names, and keeps the defaults for the rest', async () => {
    const konfiguration = await ladeKonfiguration({
      holen: async () => antwort({ ionos: { text: { modell: 'meta/llama' } }, ocr: { parallel: 5 } }),
      warnen: stumm,
    })
    assert.equal(konfiguration.text.modell, 'meta/llama')
    assert.deepEqual(konfiguration.text.suche, mitStandard({}).text.suche)
    assert.deepEqual(konfiguration.ocr, mitStandard({}).ocr)
    assert.equal(konfiguration.parallel, 5)
  })

  it('falls back to the defaults, and warns, if the file is broken', async () => {
    const warnungen: unknown[][] = []
    const konfiguration = await ladeKonfiguration({
      holen: async () => antwort('{ kaputt'),
      warnen: (...argumente) => warnungen.push(argumente),
    })
    assert.deepEqual(konfiguration, mitStandard({}))
    assert.equal(warnungen.length, 1)
  })

  it('falls back to the defaults if the request fails', async () => {
    const konfiguration = await ladeKonfiguration({
      holen: async () => {
        throw new TypeError('offline')
      },
      warnen: stumm,
    })
    assert.deepEqual(konfiguration, mitStandard({}))
  })

  it('asks for the file next to the page', async () => {
    let gefragt: string | undefined
    await ladeKonfiguration({
      basis: '/oneproof/',
      holen: async (url) => {
        gefragt = url
        return antwort({}, { ok: false })
      },
      warnen: stumm,
    })
    assert.equal(gefragt, '/oneproof/konfiguration.json')
  })
})
