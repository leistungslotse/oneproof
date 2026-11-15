import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sha512Hex } from '../../src/pdf/hash.ts'
import { einpassen, MAX_RASTER_KANTE, RASTER_DPI, rasterSkala } from '../../src/pdf/masse.ts'

describe('Rastergröße einer PDF-Seite', () => {
  it('renders an A4 page at 200 dpi', () => {
    const skala = rasterSkala(595, 842)
    assert.ok(Math.abs(skala - RASTER_DPI / 72) < 1e-9)
    assert.equal(Math.round(595 * skala), 1653)
    assert.equal(Math.round(842 * skala), 2339)
  })

  it('lowers the resolution for a page far larger than paper', () => {
    const skala = rasterSkala(5000, 3000)
    assert.ok(skala < RASTER_DPI / 72)
    assert.equal(Math.round(5000 * skala), MAX_RASTER_KANTE)
  })

  it('does not choke on a page without a size', () => {
    assert.equal(rasterSkala(0, 0), RASTER_DPI / 72)
    assert.equal(rasterSkala(Number.NaN, Number.NaN), RASTER_DPI / 72)
  })
})

describe('Bild einpassen', () => {
  it('shrinks the longer side to the limit and keeps the proportions', () => {
    assert.deepEqual(einpassen(4000, 3000), { breite: 2000, hoehe: 1500 })
    assert.deepEqual(einpassen(1653, 2339), { breite: 1413, hoehe: 2000 })
  })

  it('never enlarges', () => {
    assert.deepEqual(einpassen(800, 600), { breite: 800, hoehe: 600 })
  })

  it('never returns a side of zero', () => {
    assert.deepEqual(einpassen(100000, 1), { breite: 2000, hoehe: 1 })
  })
})

describe('SHA-512', () => {
  it('matches the known value for "abc"', async () => {
    const hash = await sha512Hex(new TextEncoder().encode('abc'))
    assert.equal(
      hash,
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    )
  })

  it('returns null where the browser offers no crypto', async () => {
    const vorher = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
    assert.ok(vorher)
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true })
    try {
      assert.equal(await sha512Hex(new Uint8Array([1])), null)
    } finally {
      Object.defineProperty(globalThis, 'crypto', vorher)
    }
  })
})
