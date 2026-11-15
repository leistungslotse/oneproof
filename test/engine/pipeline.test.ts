import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PruefFehler } from '../../src/engine/fehler.ts'
import { IonosFehler } from '../../src/engine/ionos/client.ts'
import type { SeitenText } from '../../src/engine/ocr/lesen.ts'
import { ABSCHNITT, MAX_SEITEN, pruefe } from '../../src/engine/pipeline.ts'
import type { Fortschrittsereignis, Pruefergebnis } from '../../src/engine/pipeline.ts'
import { ladeProfil } from '../../src/engine/profil/laden.ts'
import type { Profil } from '../../src/engine/profil/laden.ts'
import type { Anforderung } from '../../src/engine/zuordnung/anforderungen.ts'
import { fixture, lies, WOHNGELD } from '../hilfen/dateien.ts'
import { datei, FEHLERSEITE, falscheKi, oeffne } from '../hilfen/falsche-ki.ts'
import type { FalscheKi, Testdatei } from '../hilfen/falsche-ki.ts'
import { DOMParser } from '../hilfen/xml.ts'

const profil = await ladeProfil(lies, WOHNGELD)
const antragXml = await fixture('antrag-mietzuschuss-1.7.0.xml')

const regeln = [
  { muster: /Mietvertrag/, typ: 'rent_contract' },
  { muster: /Verdienstbescheinigung.*Albert/s, typ: 'income_certificate', person: 'Einstein, Albert' },
  { muster: /Personalausweis/, typ: 'identity_document', person: 'Svenja Einstein' },
]

const mietvertrag = datei('mietvertrag.pdf', ['Mietvertrag über die Wohnung, Miete 950 €', 'Unterschriften zum Mietvertrag'])
const verdienst = datei('verdienst-albert.pdf', ['Verdienstbescheinigung für Albert Einstein, Brutto 1.789,00 €'])
const ausweis = datei('ausweis.jpg', ['Personalausweis Svenja Einstein'], { mime: 'image/jpeg' })

/** What the tests change of a check: everything else is the same for all of them. */
interface LaufOptionen {
  profil?: Profil
  antragXml?: string
  nachweise?: Testdatei[]
  ki?: FalscheKi
  cache?: Map<string, SeitenText>
  signal?: AbortSignal
}

/** A check that has been started: its result to come, the events it reported, and the fake AI it ran on. */
interface Lauf<K extends FalscheKi | undefined> {
  ergebnis: Promise<Pruefergebnis>
  ereignisse: Fortschrittsereignis[]
  ki: K
}

function lauf(optionen: LaufOptionen & { ki: undefined }): Lauf<undefined>
function lauf(optionen?: LaufOptionen): Lauf<FalscheKi>
function lauf(optionen: LaufOptionen = {}): Lauf<FalscheKi | undefined> {
  const ki = 'ki' in optionen ? optionen.ki : falscheKi({ regeln })
  const ereignisse: Fortschrittsereignis[] = []
  const ergebnis = pruefe({
    profil,
    antragXml,
    DOMParser,
    oeffne,
    ki,
    fortschritt: (ereignis) => ereignisse.push(ereignis),
    ...optionen,
  })
  return { ergebnis, ereignisse, ki }
}

const anforderung = (ergebnis: Pruefergebnis, id: string): Anforderung => {
  const gefunden = ergebnis.anforderungen.find((eintrag) => eintrag.id === id)
  assert.ok(gefunden, `${id} is a requirement of the result`)
  return gefunden
}

describe('Prüfung ohne Nachweise', () => {
  it('needs no AI access and lists what is needed', async () => {
    const { ergebnis, ki } = lauf({ nachweise: [], ki: undefined })
    const aufgabe = await ergebnis

    assert.equal(aufgabe.zusammenfassung.belegt, 0)
    assert.ok(aufgabe.zusammenfassung.offen >= 5)
    assert.equal(aufgabe.ki.versuche, 0)
    assert.equal(aufgabe.ki.ocrModell, null)
    assert.deepEqual(aufgabe.dateien, [])
    assert.equal(ki, undefined)
  })

  it('names the application, its persons and the profile', async () => {
    const aufgabe = await lauf({ ki: undefined }).ergebnis
    assert.equal(aufgabe.antrag.schema, 'S01000000123')
    assert.deepEqual(aufgabe.antrag.personen, ['Svenja Einstein', 'Albert Einstein'])
    assert.equal(aufgabe.profil.kennung, 'wohngeld@2026-11-07')
  })

  it('stays a plain, serialisable value', async () => {
    const aufgabe = await lauf({ ki: undefined }).ergebnis
    assert.deepEqual(JSON.parse(JSON.stringify(aufgabe)), aufgabe)
  })
})

describe('Prüfung mit Nachweisen', () => {
  it('reads every page, groups them and places the documents', async () => {
    const { ergebnis, ki } = lauf({ nachweise: [mietvertrag, verdienst, ausweis] })
    const aufgabe = await ergebnis

    assert.equal(ki.protokoll.ocr.length, 4)
    assert.equal(ki.protokoll.gruppierungen.length, 1)
    assert.equal(ki.protokoll.modellListen, 1)

    assert.equal(anforderung(aufgabe, 'miete#p-#1').status, 'belegt')
    assert.equal(anforderung(aufgabe, 'einnahmen#p1#1').status, 'belegt')
    assert.equal(anforderung(aufgabe, 'einnahmen#p0#1').status, 'offen')
    assert.equal(anforderung(aufgabe, 'werbungskosten#p0#1').status, 'offen')

    const miete = anforderung(aufgabe, 'miete#p-#1')
    assert.deepEqual(miete.belege.map((beleg) => beleg.typ), ['rent_contract'])
    assert.equal(miete.belege[0]?.dateien[0]?.name, 'mietvertrag.pdf')
    assert.equal(miete.belege[0]?.dateien[0]?.seitenText, 'Seiten 1–2')
  })

  it('puts a document the application has no place for among the unassigned, with the reason', async () => {
    const aufgabe = await lauf({ nachweise: [ausweis] }).ergebnis
    const ausweisEintrag = aufgabe.nichtZugeordnet.find((eintrag) => eintrag.dateien[0]?.name === 'ausweis.jpg')
    assert.ok(ausweisEintrag)
    assert.match(ausweisEintrag.grund, /Nachweis|Stelle/)
  })

  it('reports the models and the page states', async () => {
    const aufgabe = await lauf({ nachweise: [mietvertrag] }).ergebnis
    assert.equal(aufgabe.ki.ocrModell, 'lightonai/LightOnOCR-2-1B')
    assert.equal(aufgabe.ki.textModell, 'Qwen/Qwen3.8-27B')
    assert.equal(aufgabe.ki.versuche, 1)
    assert.deepEqual(Object.values(aufgabe.seiten.f1 ?? {}).map((seite) => seite.status), ['gelesen', 'gelesen'])
    assert.deepEqual(aufgabe.dateien[0], { id: 'f1', name: 'mietvertrag.pdf', mime: 'application/pdf', groesse: mietvertrag.texte.join('').length, seiten: 2, hash: 'hash-mietvertrag.pdf' })
  })

  it('does not call the grouping model if no page has any text', async () => {
    const leer = datei('leer.pdf', ['', '  '])
    const { ergebnis, ki } = lauf({ nachweise: [leer] })
    const aufgabe = await ergebnis

    assert.equal(ki.protokoll.gruppierungen.length, 0)
    assert.equal(aufgabe.nichtZugeordnet.length, 1)
    assert.equal(aufgabe.nichtZugeordnet[0]?.grund, 'Auf diesen Seiten wurde kein Text erkannt.')
  })

  it('accounts for every page', async () => {
    const aufgabe = await lauf({ nachweise: [mietvertrag, verdienst, ausweis] }).ergebnis
    const zugeordnet = aufgabe.dokumente.flatMap((dokument) => dokument.seiten.map(({ fileId, page }) => `${fileId}:${page}`)).sort()
    assert.deepEqual(zugeordnet, ['f1:1', 'f1:2', 'f2:1', 'f3:1'])
  })

  it('reuses what was read before', async () => {
    const cache = new Map()
    const erster = lauf({ nachweise: [mietvertrag], cache })
    await erster.ergebnis
    assert.equal(erster.ki.protokoll.ocr.length, 2)

    const zweiter = lauf({ nachweise: [mietvertrag], cache })
    await zweiter.ergebnis
    assert.equal(zweiter.ki.protokoll.ocr.length, 0)
    assert.equal(zweiter.ki.protokoll.gruppierungen.length, 1)
  })

  it('closes the files afterwards, also after an error', async () => {
    oeffne.geschlossen = []
    await lauf({ nachweise: [mietvertrag] }).ergebnis
    assert.deepEqual(oeffne.geschlossen, ['mietvertrag.pdf'])

    oeffne.geschlossen = []
    await assert.rejects(lauf({ nachweise: [mietvertrag], antragXml: 'kein xml' }).ergebnis)
    assert.deepEqual(oeffne.geschlossen, [])

    const ki = falscheKi({ regeln })
    ki.client.chat = async () => {
      throw new IonosFehler('auth', 'Token')
    }
    await assert.rejects(lauf({ nachweise: [mietvertrag], ki }).ergebnis)
    assert.deepEqual(oeffne.geschlossen, ['mietvertrag.pdf'])
  })
})

describe('Dateien schließen', () => {
  it('still returns the result if a file cannot be closed', async () => {
    const sperrig = datei('sperrig.pdf', ['Mietvertrag über die Wohnung'], { schliessenWirft: true })
    const aufgabe = await lauf({ nachweise: [sperrig] }).ergebnis
    assert.equal(anforderung(aufgabe, 'miete#p-#1').status, 'belegt')
  })

  it('does not hide the real error behind one from closing', async () => {
    const sperrig = datei('sperrig.pdf', ['Mietvertrag'], { schliessenWirft: true })
    const ki = falscheKi({ regeln })
    ki.client.chat = async () => {
      throw new IonosFehler('auth', 'Der KI-Zugang wurde abgelehnt (HTTP 401).')
    }
    // The file is open when the AI refuses; closing it then fails as well.
    await assert.rejects(lauf({ nachweise: [sperrig], ki }).ergebnis, { bereich: 'ki', art: 'auth' })
  })
})

describe('Fortschritt', () => {
  it('only moves forward, starts at the beginning and ends at the end', async () => {
    const { ergebnis, ereignisse } = lauf({ nachweise: [mietvertrag, verdienst] })
    await ergebnis

    const anteile = ereignisse.map((ereignis) => ereignis.anteil)
    assert.deepEqual([...anteile].sort((a, b) => a - b), anteile)
    assert.equal(anteile[0], 0)
    assert.equal(anteile.at(-1), 1)
    assert.ok(ereignisse.every((ereignis) => ereignis.text !== ''))
  })

  it('counts the pages while reading', async () => {
    const { ergebnis, ereignisse } = lauf({ nachweise: [mietvertrag, verdienst] })
    await ergebnis

    const lesen = ereignisse.filter((ereignis) => ereignis.phase === 'lesen')
    assert.deepEqual(lesen.map((ereignis) => ereignis.text), [
      '0 von 3 Seiten gelesen',
      '1 von 3 Seiten gelesen',
      '2 von 3 Seiten gelesen',
      '3 von 3 Seiten gelesen',
    ])
    assert.equal(lesen.at(-1)?.anteil, ABSCHNITT.lesen[1])
  })

  it('announces the grouping as a phase with an end to creep towards', async () => {
    const { ergebnis, ereignisse } = lauf({ nachweise: [mietvertrag] })
    await ergebnis
    const gruppieren = ereignisse.find((ereignis) => ereignis.phase === 'gruppieren')
    assert.ok(gruppieren)
    assert.equal(gruppieren.anteil, ABSCHNITT.gruppieren[0])
    assert.equal(gruppieren.bis, ABSCHNITT.gruppieren[1])
  })

  it('covers the whole bar with its phases', () => {
    const grenzen = Object.values(ABSCHNITT)
    assert.equal(grenzen[0]?.[0], 0)
    assert.equal(grenzen.at(-1)?.[1], 1)
    grenzen.slice(1).forEach(([von], i) => assert.equal(von, grenzen[i]?.[1]))
  })
})

describe('Was schiefgehen kann', () => {
  it('rejects application data that is no XML, naming the application', async () => {
    await assert.rejects(lauf({ antragXml: 'kein xml' }).ergebnis, (fehler) => {
      assert.ok(fehler instanceof PruefFehler)
      assert.equal(fehler.bereich, 'antrag')
      assert.match(fehler.message, /kein gültiges XML/)
      return true
    })
  })

  it('rejects an application of a schema the profile does not know', async () => {
    const fremd = antragXml.replaceAll('S01000000123', 'S09999999999')
    await assert.rejects(lauf({ antragXml: fremd }).ergebnis, { bereich: 'antrag' })
  })

  it('stops with a clear message if the AI access is refused', async () => {
    const ki = falscheKi({ regeln })
    ki.client.chat = async () => {
      throw new IonosFehler('auth', 'Der KI-Zugang wurde abgelehnt (HTTP 401).')
    }
    await assert.rejects(lauf({ nachweise: [mietvertrag], ki }).ergebnis, (fehler) => {
      assert.ok(fehler instanceof PruefFehler)
      assert.equal(fehler.bereich, 'ki')
      assert.equal(fehler.art, 'auth')
      assert.equal(fehler.wiederholbar, false)
      assert.match(fehler.message, /abgelehnt/)
      return true
    })
  })

  it('stops early if a model does not exist, before reading anything', async () => {
    const ki = falscheKi({ regeln, modelle: ['nur/ein-anderes-Modell'] })
    await assert.rejects(lauf({ nachweise: [mietvertrag], ki }).ergebnis, { bereich: 'ki', art: 'modell' })
    assert.equal(ki.protokoll.ocr.length, 0)
  })

  it('needs the AI access as soon as there is something to read', async () => {
    await assert.rejects(lauf({ nachweise: [mietvertrag], ki: undefined }).ergebnis, { bereich: 'ki', art: 'nicht-eingerichtet' })
  })

  it('refuses more pages than it reads in one go, before calling the AI', async () => {
    const zuViele = datei('ordner.pdf', Array.from({ length: MAX_SEITEN + 1 }, (_, i) => `Seite ${i + 1}`))
    const ki = falscheKi({ regeln })

    await assert.rejects(lauf({ nachweise: [zuViele], ki }).ergebnis, (fehler) => {
      assert.ok(fehler instanceof PruefFehler)
      assert.equal(fehler.bereich, 'nachweise')
      assert.equal(fehler.wiederholbar, false)
      assert.match(fehler.message, new RegExp(`zusammen ${MAX_SEITEN + 1} Seiten`))
      return true
    })
    assert.equal(ki.protokoll.ocr.length, 0)
  })

  it('reads exactly as many pages as the limit allows', async () => {
    const genau = datei('ordner.pdf', Array.from({ length: MAX_SEITEN }, (_, i) => `Seite ${i + 1}`))
    const aufgabe = await lauf({ nachweise: [genau] }).ergebnis
    assert.equal(aufgabe.dateien[0]?.seiten, MAX_SEITEN)
  })

  it('goes on without a page that cannot be read, and says so', async () => {
    const teils = datei('teils.pdf', ['Mietvertrag Seite eins', FEHLERSEITE])
    const aufgabe = await lauf({ nachweise: [teils] }).ergebnis

    assert.equal(aufgabe.seiten.f1?.[1]?.status, 'gelesen')
    assert.equal(aufgabe.seiten.f1?.[2]?.status, 'fehler')
    assert.ok(aufgabe.hinweise.some((hinweis) => /Seite 2 von „teils\.pdf“ konnte nicht gelesen werden/.test(hinweis)))
    assert.equal(anforderung(aufgabe, 'miete#p-#1').status, 'belegt')
    assert.equal(aufgabe.nichtZugeordnet[0]?.grund, 'Diese Seiten konnten nicht gelesen werden.')
  })

  it('fails, and may be tried again, if no page can be read at all', async () => {
    const kaputt = datei('kaputt.pdf', [FEHLERSEITE, FEHLERSEITE])
    await assert.rejects(lauf({ nachweise: [kaputt] }).ergebnis, (fehler) => {
      assert.ok(fehler instanceof PruefFehler)
      assert.equal(fehler.bereich, 'ki')
      assert.equal(fehler.wiederholbar, true)
      assert.match(fehler.message, /Keine Seite/)
      return true
    })
  })

  it('fails, and names the reason, if the only file cannot be opened', async () => {
    const beschaedigt = datei('beschaedigt.pdf', ['x'], { kaputt: true })
    await assert.rejects(lauf({ nachweise: [beschaedigt] }).ergebnis, (fehler) => {
      assert.ok(fehler instanceof PruefFehler)
      assert.equal(fehler.bereich, 'nachweise')
      assert.equal(fehler.wiederholbar, false)
      assert.equal(fehler.message, '„beschaedigt.pdf“ konnte nicht geöffnet werden: Die Datei ist beschädigt.')
      return true
    })
  })

  it('fails, and says it once, if none of several files can be opened', async () => {
    const a = datei('a.pdf', ['x'], { kaputt: true })
    const b = datei('b.pdf', ['x'], { kaputt: true })
    await assert.rejects(lauf({ nachweise: [a, b] }).ergebnis, (fehler) => {
      assert.ok(fehler instanceof PruefFehler)
      assert.equal(fehler.bereich, 'nachweise')
      assert.equal(fehler.message, 'Keine der 2 Dateien konnte geöffnet werden: Die Datei ist beschädigt.')
      return true
    })
  })

  it('does not ask the AI when no file could be opened', async () => {
    const beschaedigt = datei('beschaedigt.pdf', ['x'], { kaputt: true })
    const { ergebnis, ki } = lauf({ nachweise: [beschaedigt] })
    await assert.rejects(ergebnis)
    assert.deepEqual(ki.protokoll, { modellListen: 0, ocr: [], gruppierungen: [] })
  })

  it('goes on without a file it cannot open, and says so', async () => {
    const beschaedigt = datei('beschaedigt.pdf', ['x'], { kaputt: true })
    const aufgabe = await lauf({ nachweise: [beschaedigt, mietvertrag] }).ergebnis

    assert.ok(aufgabe.hinweise.some((hinweis) => /„beschaedigt\.pdf“ konnte nicht geöffnet werden: Die Datei ist beschädigt\./.test(hinweis)))
    assert.equal(anforderung(aufgabe, 'miete#p-#1').status, 'belegt')
    assert.deepEqual(aufgabe.dateien.map((eintrag) => [eintrag.id, eintrag.name, 'fehler' in eintrag]), [
      ['f2', 'mietvertrag.pdf', false],
      ['f1', 'beschaedigt.pdf', true],
    ])
  })

  it('goes on without the grouping if the model keeps answering unreadably, and says so', async () => {
    const ki = falscheKi({ regeln, gruppierungsAntworten: ['Kann ich nicht.', 'Auch nicht.'] })
    const aufgabe = await lauf({ nachweise: [mietvertrag], ki }).ergebnis

    assert.deepEqual(aufgabe.ki.gruppierung.status, 'fehlgeschlagen')
    assert.equal(aufgabe.ki.gruppierung.art, 'antwort')
    assert.match(aufgabe.ki.gruppierung.hinweis, /^Die KI konnte die gelesenen Seiten nicht zu Dokumenten ordnen\./)
    assert.match(aufgabe.ki.gruppierung.hinweis, /nicht noch einmal gelesen/)
    assert.ok(!aufgabe.hinweise.some((hinweis) => /nicht zu Dokumenten ordnen/.test(hinweis)), 'said once, on its own')
    // What the application needs is still listed; the pages wait unassigned.
    assert.equal(anforderung(aufgabe, 'miete#p-#1').status, 'offen')
    assert.deepEqual(aufgabe.nichtZugeordnet.map(({ grund }) => grund), ['Die KI konnte diese Seiten nicht zuordnen. Prüfen Sie erneut.'])
  })

  it('stops reading when the service fails page after page', async () => {
    const viele = datei('viele.pdf', ['Seite 1', 'Seite 2', 'Seite 3', 'Seite 4', 'Seite 5', 'Seite 6'])
    const ki = falscheKi({ regeln })
    let aufrufe = 0
    ki.client.chat = async () => {
      aufrufe++
      throw new IonosFehler('server', 'IONOS antwortet mit Status 503.')
    }
    await assert.rejects(lauf({ nachweise: [viele], ki }).ergebnis, (fehler) => {
      assert.ok(fehler instanceof PruefFehler)
      assert.equal(fehler.bereich, 'ki')
      assert.equal(fehler.wiederholbar, true)
      assert.match(fehler.message, /^Der Lesedienst ist gerade nicht verfügbar/)
      return true
    })
    assert.ok(aufrufe < 6, `${aufrufe} Seiten versucht`)
  })

  it('stops at once when the service asks for a long pause', async () => {
    const ki = falscheKi({ regeln })
    ki.client.chat = async () => {
      throw new IonosFehler('ratenlimit', 'Zu viele Anfragen.', { warteSekunden: 600 })
    }
    await assert.rejects(lauf({ nachweise: [mietvertrag], ki }).ergebnis, /Lesedienst ist gerade nicht verfügbar: Zu viele Anfragen\./)
  })

  it('measures how recent evidence is from the date of the application', async () => {
    const aufgabe = await lauf({ nachweise: [mietvertrag] }).ergebnis
    assert.equal(aufgabe.antrag.stichtag, '2026-08-13')
    assert.equal(aufgabe.antrag.stichtagAusAntrag, true)
  })

  it('stops when the user cancels', async () => {
    const steuerung = new AbortController()
    const ki = falscheKi({ regeln })
    const chat = ki.client.chat
    ki.client.chat = async (eingabe) => {
      steuerung.abort()
      return chat(eingabe)
    }
    await assert.rejects(lauf({ nachweise: [mietvertrag], ki, signal: steuerung.signal }).ergebnis, { bereich: 'abbruch' })
  })

  it('turns an unexpected error into one a person can read', async () => {
    const kaputtesProfil = { ...profil, ladeSchema: async () => { throw new TypeError('kaputt') } }
    await assert.rejects(lauf({ profil: kaputtesProfil }).ergebnis, (fehler) => {
      assert.ok(fehler instanceof PruefFehler)
      assert.equal(fehler.bereich, 'intern')
      assert.match(fehler.message, /unerwartet fehlgeschlagen: kaputt/)
      return true
    })
  })
})

describe('Ein Beleg ohne Hash', () => {
  it('is still read and cached by name and size', async () => {
    const cache = new Map()
    const ohneHash = datei('ohne-hash.pdf', ['Mietvertrag'], { hash: null })
    await lauf({ nachweise: [ohneHash], cache }).ergebnis
    assert.ok([...cache.keys()].every((schluessel) => schluessel.startsWith('ohne-hash.pdf:')))
  })
})
