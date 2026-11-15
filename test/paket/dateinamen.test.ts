import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { dokumentName, eindeutig, kurzform, originalName } from '../../src/engine/paket/dateinamen.ts'

describe('Dateinamen im Paket', () => {
  it('writes German letters out and keeps only what every file system takes', () => {
    assert.equal(kurzform('Lohn-/Gehaltsabrechnung — Jürgen Groß'), 'lohn-gehaltsabrechnung-juergen-gross')
    assert.equal(kurzform('ÄRZTLICHE Bescheinigung (Öffnungszeiten)'), 'aerztliche-bescheinigung-oeffnungszeiten')
    assert.equal(kurzform('Zoë Müller-Lüdenscheidt, Dr.'), 'zoe-mueller-luedenscheidt-dr')
    assert.equal(kurzform('  ***  '), '')
    assert.ok(kurzform('x'.repeat(300)).length <= 100)
    assert.doesNotMatch(kurzform(`${'wort '.repeat(30)}ende`), /-$/)
  })

  it('names a document after its type and person', () => {
    assert.equal(dokumentName({ typLabel: 'Arbeitslosengeld-I-Bescheid', person: 'Daniel Berger' }), 'arbeitslosengeld-i-bescheid-daniel-berger.pdf')
    assert.equal(dokumentName({ typLabel: 'Mietvertrag', person: null }), 'mietvertrag.pdf')
    assert.equal(dokumentName({ typLabel: '', person: null }), 'dokument.pdf')
    assert.equal(dokumentName({ typLabel: 'Nicht erkannt', nichtZugeordnet: true }), 'nicht-zugeordnete-seiten.pdf')
  })

  it('keeps the extension of a file delivered as it was uploaded', () => {
    assert.equal(originalName('Scan vom 3.11.JPG'), 'scan-vom-3-11.jpg')
    assert.equal(originalName('ohne-endung'), 'ohne-endung')
    assert.equal(originalName('.pdf'), 'pdf')
  })

  it('numbers every name that occurs more than once, the first included', () => {
    assert.deepEqual(
      eindeutig(['lohn.pdf', 'miete.pdf', 'lohn.pdf', 'lohn.pdf']),
      ['lohn-1.pdf', 'miete.pdf', 'lohn-2.pdf', 'lohn-3.pdf'],
    )
  })

  it('never hands out a name twice, also not one that is taken already', () => {
    assert.deepEqual(eindeutig(['a.pdf', 'a.pdf', 'a-1.pdf']), ['a-2.pdf', 'a-3.pdf', 'a-1.pdf'])
    assert.deepEqual(eindeutig(['antrag.xml', 'b.pdf'], ['antrag.xml']), ['antrag-1.xml', 'b.pdf'])
    const namen = eindeutig(['x.pdf', 'x.pdf', 'x-2.pdf', 'x.pdf'])
    assert.equal(new Set(namen).size, namen.length)
  })
})
