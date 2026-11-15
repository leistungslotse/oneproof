import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { endeteInWiederholung, entdopple, ohnePromptEcho } from '../../src/engine/ocr/bereinigen.ts'

describe('Prompt-Echo', () => {
  it('drops lines that carry the marker word of the instruction', () => {
    const text = 'Mietvertrag\nGib jede Checkbox/jedes Ankreuzkästchen IMMER aus\nMiete 950 €'
    assert.equal(ohnePromptEcho(text), 'Mietvertrag\nMiete 950 €')
  })

  it('leaves a text without the marker alone', () => {
    assert.equal(ohnePromptEcho('a\nb'), 'a\nb')
    assert.equal(ohnePromptEcho(null), '')
  })
})

describe('Entdopplung', () => {
  it('lets a line follow itself twice and cuts the rest', () => {
    assert.equal(entdopple('a\na\na\na\nb'), 'a\na\nb')
  })

  it('does not let blank lines break a chain of repeats', () => {
    assert.equal(entdopple('a\n\na\n\na\nb'), 'a\n\na\nb')
  })

  it('removes a block that repeats three times or more', () => {
    const block = ['Name: Max', 'Betrag: 10']
    const text = ['Kopf', ...block, ...block, ...block, ...block, 'Fuß'].join('\n')
    assert.equal(entdopple(text), ['Kopf', ...block, 'Fuß'].join('\n'))
  })

  it('keeps a block that appears only twice', () => {
    const text = ['x', 'Name: Max', 'Betrag: 10', 'Name: Max', 'Betrag: 10', 'y'].join('\n')
    assert.equal(entdopple(text), text)
  })

  it('leaves normal text unchanged', () => {
    const text = 'Lohnabrechnung\nJanuar 2026\nBrutto 1.789,00\nNetto 1.200,00'
    assert.equal(entdopple(text), text)
  })

  it('copes with a model that wrote the same line a thousand times', () => {
    const text = ['Anfang', ...Array.from({ length: 2000 }, () => 'Zeile'), 'Ende'].join('\n')
    const bereinigt = entdopple(text)
    assert.ok(bereinigt.length < 40, bereinigt)
    assert.ok(bereinigt.startsWith('Anfang'))
  })
})

describe('Wiederholungsschleife am Token-Limit', () => {
  it('recognises a loop by how much the cleaning took out', () => {
    const roh = ['Anfang', ...Array.from({ length: 400 }, () => 'immer wieder dieselbe Zeile')].join('\n')
    assert.equal(endeteInWiederholung(roh, entdopple(roh)), true)
  })

  it('does not take a full page for a loop', () => {
    const roh = Array.from({ length: 80 }, (_, i) => `Zeile ${i} mit echtem Inhalt und Zahlen ${i * 7}`).join('\n')
    assert.equal(endeteInWiederholung(roh, entdopple(roh)), false)
  })

  it('needs both enough characters and a large enough share', () => {
    assert.equal(endeteInWiederholung('x'.repeat(1000), 'x'.repeat(900)), false) // 100 removed
    assert.equal(endeteInWiederholung('x'.repeat(5000), 'x'.repeat(4000)), false) // 20 %
    assert.equal(endeteInWiederholung('', ''), false)
  })
})
