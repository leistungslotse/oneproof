import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fuegeSeitenZusammen, teileInSeiten } from '../../src/engine/ocr/seiten.ts'

describe('Seiten eines Dateitexts', () => {
  it('splits at the page markers', () => {
    const seiten = teileInSeiten('# Seite 1\n\nErste\nSeite\n\n# Seite 2\n\nZweite')
    assert.deepEqual([...seiten], [[1, 'Erste\nSeite'], [2, 'Zweite']])
  })

  it('takes text without a marker as the single page 1', () => {
    assert.deepEqual([...teileInSeiten('  Nur ein Bild  ')], [[1, 'Nur ein Bild']])
    assert.deepEqual([...teileInSeiten('')], [[1, '']])
    assert.deepEqual([...teileInSeiten(null)], [[1, '']])
  })

  it('does not take a marker in the middle of a line for a page break', () => {
    const seiten = teileInSeiten('# Seite 1\n\nSiehe # Seite 2 im Vertrag')
    assert.equal(seiten.size, 1)
  })

  it('keeps the page numbers of the markers, also if they skip', () => {
    const seiten = teileInSeiten('# Seite 2\n\nB\n\n# Seite 5\n\nE')
    assert.deepEqual([...seiten.keys()], [2, 5])
  })

  it('is the inverse of joining the pages', () => {
    const seiten = new Map([[1, 'A\nzwei Zeilen'], [2, ''], [3, 'C']])
    assert.deepEqual([...teileInSeiten(fuegeSeitenZusammen(seiten))], [...seiten])
  })

  it('writes a single image without a marker', () => {
    assert.equal(fuegeSeitenZusammen([[1, 'Text']], false), 'Text')
    assert.equal(fuegeSeitenZusammen([], false), '')
  })

  it('orders the pages by number', () => {
    assert.equal(fuegeSeitenZusammen([[2, 'B'], [1, 'A']]), '# Seite 1\n\nA\n\n# Seite 2\n\nB')
  })
})
