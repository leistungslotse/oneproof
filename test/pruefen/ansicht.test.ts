import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pruefe } from '../../src/engine/pipeline.ts'
import { ladeProfil } from '../../src/engine/profil/laden.ts'
import type { Anforderung } from '../../src/engine/zuordnung/anforderungen.ts'
import {
  aufzaehlung,
  belegZeilen,
  dauerText,
  dokumentZeilen,
  einreichenText,
  eingangsText,
  groesseText,
  infoText,
  kriechen,
  quellenNachRolle,
  schritteFuer,
  seitenZahl,
  schrittStaende,
  teileAuf,
  unterschiede,
  zaehle,
  zaehlungen,
  zusammenhalten,
} from '../../src/pruefen/ansicht.ts'
import type { DokumentZeile, Pruefstand } from '../../src/pruefen/ansicht.ts'
import { fixture, lies, WOHNGELD } from '../hilfen/dateien.ts'
import { datei, falscheKi, oeffne } from '../hilfen/falsche-ki.ts'
import type { Regel, Testdatei } from '../hilfen/falsche-ki.ts'
import { DOMParser } from '../hilfen/xml.ts'

const profil = await ladeProfil(lies, WOHNGELD)
const antragXml = await fixture('antrag-mietzuschuss-1.7.0.xml')

const lauf = (nachweise: Testdatei[], regeln: Regel[]) => pruefe({ profil, antragXml, DOMParser, oeffne, ki: falscheKi({ regeln }), nachweise })

const ergebnis = await lauf(
  [
    datei('mietvertrag.pdf', ['Mietvertrag über die Wohnung', 'Unterschriften zum Mietvertrag']),
    datei('verdienst-silvia.pdf', ['Verdienstbescheinigung Silvia']),
    datei('konto.pdf', ['Kontoauszug 10/2026']),
    datei('ausweis.jpg', ['Personalausweis Svenja Einstein'], { mime: 'image/jpeg' }),
  ],
  [
    { muster: /Mietvertrag/, typ: 'rent_contract' },
    { muster: /Verdienstbescheinigung/, typ: 'income_certificate', person: 'Einstein, Silvia' },
    { muster: /Kontoauszug/, typ: 'bank_statement' },
    { muster: /Personalausweis/, typ: 'identity_document', person: 'Svenja Einstein' },
  ],
)
const anforderung = (id: string): Anforderung => {
  const gefunden = ergebnis.anforderungen.find((kandidat) => kandidat.id === id)
  assert.ok(gefunden, `Die Anforderung ${id} fehlt.`)
  return gefunden
}

describe('Zählen und Aufzählen', () => {
  it('keeps a page number with its word', () => {
    assert.equal(zusammenhalten('Seiten 1–2'), 'Seiten\u00a01–2')
    assert.equal(zusammenhalten('ohne Leerzeichen'), 'ohne\u00a0Leerzeichen')
  })

  it('uses the singular for one', () => {
    assert.equal(zaehle(1, 'Angabe', 'Angaben'), '1 Angabe')
    assert.equal(zaehle(0, 'Angabe', 'Angaben'), '0 Angaben')
    assert.equal(zaehle(7, 'Angabe', 'Angaben'), '7 Angaben')
  })

  it('lists with "und"', () => {
    assert.equal(aufzaehlung(['A']), 'A')
    assert.equal(aufzaehlung(['A', 'B']), 'A und B')
    assert.equal(aufzaehlung(['A', 'B', 'C']), 'A, B und C')
  })

  it('writes sizes the way a file manager does', () => {
    assert.equal(groesseText(512), '512 Byte')
    assert.equal(groesseText(18_969), '19 KB')
    assert.equal(groesseText(6_766_949), '6,8 MB')
  })

  it('writes a duration', () => {
    assert.equal(dauerText(300), '1 Sekunde')
    assert.equal(dauerText(42_000), '42 Sekunden')
    assert.equal(dauerText(125_000), '2 Min. 5 Sek.')
  })
})

describe('Ergebnis aufteilen', () => {
  const gruppen = teileAuf(ergebnis.anforderungen)

  it('puts every requirement into exactly one group', () => {
    assert.equal(gruppen.zuTun.length + gruppen.belegt.length + gruppen.entfaellt.length, ergebnis.anforderungen.length)
    assert.ok(gruppen.zuTun.every(({ status }) => status === 'offen' || status === 'unklar'))
    assert.ok(gruppen.belegt.every(({ status }) => status === 'belegt'))
    assert.ok(gruppen.entfaellt.every(({ status }) => status === 'entfaellt'))
  })

  it('keeps the order of the application within a group', () => {
    const ids = ergebnis.anforderungen.map(({ id }) => id)
    for (const gruppe of Object.values(gruppen)) {
      const positionen = gruppe.map(({ id }) => ids.indexOf(id))
      assert.deepEqual(positionen, [...positionen].sort((a, b) => a - b))
    }
  })

  it('agrees with the counts of the check', () => {
    const z = zaehlungen(ergebnis.zusammenfassung)
    assert.equal(gruppen.belegt.length, z.belegt)
    assert.equal(gruppen.entfaellt.length, z.entfaellt)
    assert.equal(gruppen.zuTun.length, z.nochOffen)
    assert.equal(z.zuBelegen, z.belegt + z.nochOffen)
  })
})

describe('Seitenzahl', () => {
  it('counts every page of every file', () => {
    assert.equal(seitenZahl(ergebnis), 5)
    assert.equal(seitenZahl({ seiten: {} }), 0)
  })
})

describe('Texte zur Zählung', () => {
  it('names what is proven, what does not apply and what is missing', () => {
    assert.equal(
      infoText({ belegt: 2, offen: 1, unklar: 3, entfaellt: 13 }),
      '2 Angaben sind durch Ihre Unterlagen belegt. 13 Angaben sind in Ihrem Fall nicht erforderlich. Für 1 Angabe fehlt noch eine Unterlage. Bei 3 Angaben reicht die vorhandene Unterlage noch nicht aus.',
    )
  })

  it('uses the singular where there is one', () => {
    assert.equal(
      infoText({ belegt: 1, offen: 0, unklar: 1, entfaellt: 1 }),
      '1 Angabe ist durch Ihre Unterlagen belegt. 1 Angabe ist in Ihrem Fall nicht erforderlich. Bei 1 Angabe reicht die vorhandene Unterlage noch nicht aus.',
    )
  })

  it('says so if nothing is missing', () => {
    assert.match(infoText({ belegt: 4, offen: 0, unklar: 0, entfaellt: 0 }), /Es fehlt nichts\.$/)
  })

  it('lets the application be submitted whatever is open', () => {
    assert.match(einreichenText(0), /Alle Angaben sind belegt/)
    assert.match(einreichenText(1), /^1 Angabe ist noch offen\. Sie können den Antrag trotzdem absenden/)
    assert.match(einreichenText(4), /^4 Angaben sind noch offen\./)
    assert.match(eingangsText(0), /nichts nachreichen/)
    assert.match(eingangsText(2), /^2 Angaben sind noch offen\. Sie können die Nachweise jederzeit nachreichen/)
  })
})

describe('Unterschiede zwischen zwei Prüfungen', () => {
  it('names the requirements whose state changed', () => {
    const vorher: Pruefstand = { anforderungen: [{ id: 'a', status: 'offen' }, { id: 'b', status: 'belegt' }, { id: 'c', status: 'unklar' }] }
    const nachher: Pruefstand = { anforderungen: [{ id: 'a', status: 'belegt' }, { id: 'b', status: 'belegt' }, { id: 'c', status: 'unklar' }, { id: 'd', status: 'offen' }] }
    assert.deepEqual([...unterschiede(vorher, nachher)], ['a'])
  })

  it('has nothing to compare with after the first check', () => {
    assert.equal(unterschiede(null, ergebnis).size, 0)
  })
})

describe('Welche Unterlagen genügen', () => {
  it('groups the kinds of document by what they can do for a statement', () => {
    const gruppen = quellenNachRolle(anforderung('miete#p-#1').quellen)
    assert.deepEqual(
      gruppen.map(({ rolle }) => rolle),
      ['genuegt', 'pruefen', 'ergaenzt'],
    )
    const genuegt = gruppen.find(({ rolle }) => rolle === 'genuegt')
    assert.ok(genuegt)
    assert.ok(genuegt.arten.includes('Mietvertrag'))
    assert.ok(genuegt.arten.includes('Vermieter-/Mietbescheinigung'))
    // A payment shows the amount, not what it is made of; a rent change notice may show the new rent.
    const pruefen = gruppen.find(({ rolle }) => rolle === 'pruefen')
    assert.ok(pruefen)
    assert.deepEqual(pruefen.arten.sort(), [
      'Kontoauszug',
      'Mietzahlungsnachweis / Dauerauftrag / Mietquittung',
      'Mietänderungs-/Mieterhöhungsschreiben',
    ])
  })

  it('leaves out a role nothing is accepted for', () => {
    assert.deepEqual(quellenNachRolle([{ label: 'X', rolle: 'genuegt' }]).map(({ rolle }) => rolle), ['genuegt'])
    assert.deepEqual(quellenNachRolle([]), [])
  })
})

describe('Belege einer Angabe', () => {
  it('lists the documents with their files and pages, and what each can do', () => {
    const zeilen = belegZeilen(anforderung('miete#p-#1').belege)
    const vertrag = zeilen.find(({ art }) => art === 'Mietvertrag')
    assert.ok(vertrag)
    assert.deepEqual(vertrag.dateien, [{ schluessel: 'f1', name: 'mietvertrag.pdf', seiten: 'Seiten 1–2' }])
    assert.equal(vertrag.rolle, null)
    const kontoauszug = zeilen.find(({ art }) => art === 'Kontoauszug')
    assert.ok(kontoauszug)
    assert.equal(kontoauszug.rolle, 'reicht allein nicht aus')
  })
})

describe('Erkannte Unterlagen', () => {
  const zeilen = dokumentZeilen(ergebnis)
  const zeile = (art: string): DokumentZeile => {
    const gefunden = zeilen.find((kandidat) => kandidat.art === art)
    assert.ok(gefunden, `Das Dokument ${art} fehlt.`)
    return gefunden
  }

  it('shows every document once', () => {
    assert.equal(zeilen.length, ergebnis.dokumente.length)
    assert.equal(new Set(zeilen.map(({ id }) => id)).size, zeilen.length)
  })

  it('names the file and the pages of a document', () => {
    assert.deepEqual(zeile('Mietvertrag').dateien, [{ schluessel: 'f1', name: 'mietvertrag.pdf', seiten: 'Seiten 1–2' }])
  })

  it('says what a document is used for', () => {
    assert.deepEqual(zeile('Mietvertrag').verwendetFuer, ['Höhe der Miete'])
  })

  it('says why a document is not used', () => {
    const ausweis = zeile('Ausweisdokument')
    assert.deepEqual(ausweis.verwendetFuer, [])
    assert.equal(ausweis.grund, 'Für diesen Antrag ist kein Nachweis dieser Art vorgesehen.')
    assert.equal(ausweis.person, 'Svenja Einstein')
  })
})

describe('Fortschritt', () => {
  it('leaves out the steps for evidence if there is none', () => {
    assert.deepEqual(schritteFuer(false).map(({ phase }) => phase), ['antrag', 'zuordnen'])
    assert.deepEqual(schritteFuer(true).map(({ phase }) => phase), ['antrag', 'oeffnen', 'lesen', 'gruppieren', 'zuordnen'])
  })

  it('marks what is done, what runs and what waits', () => {
    const staende = schrittStaende(schritteFuer(true), 'lesen')
    assert.deepEqual(staende.map(({ stand }) => stand), ['fertig', 'fertig', 'laeuft', 'wartet', 'wartet'])
  })

  it('lets everything wait before the first event', () => {
    assert.ok(schrittStaende(schritteFuer(true), undefined).every(({ stand }) => stand === 'wartet'))
  })

  it('creeps towards the end of a phase and never reaches it', () => {
    assert.equal(kriechen(0.68, 0.93, 0), 0.68)
    let letzter = 0.68
    for (const sekunden of [5, 30, 60, 120, 600, 36_000]) {
      const wert = kriechen(0.68, 0.93, sekunden * 1000)
      assert.ok(wert > letzter && wert <= 0.93, `${sekunden} s: ${wert}`)
      letzter = wert
    }
    assert.ok(kriechen(0.68, 0.93, 120_000) < 0.93)
  })

  it('does not run backwards for a clock that does', () => {
    assert.equal(kriechen(0.68, 0.93, -5000), 0.68)
  })
})
