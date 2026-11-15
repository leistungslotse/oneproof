import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { describe, it } from 'node:test'
import { crc32 as crcZlib } from 'node:zlib'
import { crc32, packeZip } from '../../src/engine/paket/zip.ts'
import { alsText, liesZip } from '../hilfen/zip-lesen.ts'

describe('ZIP des Antragspakets', () => {
  it('computes the CRC-32 of the standard', () => {
    assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926)
    assert.equal(crc32(new Uint8Array()), 0)
  })

  it('agrees with zlib on any bytes, large ones too', () => {
    for (const laenge of [1, 2, 255, 256, 1999, 65_537, 5_000_000]) {
      const daten = randomBytes(laenge)
      assert.equal(crc32(daten), crcZlib(daten), `${laenge} Bytes`)
    }
  })

  it('stores every file as it is, with its name in UTF-8', () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 255, 128])
    const zip = packeZip([
      { name: 'antrag.xml', daten: '<a>Jürgen Groß</a>' },
      { name: 'bescheid-für-jürgen.pdf', daten: pdf },
      { name: 'leer.txt', daten: '' },
    ])
    const dateien = liesZip(zip)
    assert.deepEqual(dateien.map(({ name }) => name), ['antrag.xml', 'bescheid-für-jürgen.pdf', 'leer.txt'])
    assert.ok(dateien.every(({ utf8 }) => utf8))
    const [antrag, bescheid, leer] = dateien
    assert.ok(antrag && bescheid && leer)
    assert.equal(alsText(antrag.daten), '<a>Jürgen Groß</a>')
    assert.deepEqual([...bescheid.daten], [...pdf])
    assert.equal(leer.daten.length, 0)
  })

  it('writes the time of the package in the form ZIP keeps', () => {
    const zip = packeZip([{ name: 'a.txt', daten: 'a' }], new Date(2026, 10, 7, 17, 51, 33))
    const ansicht = new DataView(zip.buffer)
    assert.equal(ansicht.getUint16(10, true), (17 << 11) | (51 << 5) | 16)
    assert.equal(ansicht.getUint16(12, true), ((2026 - 1980) << 9) | (11 << 5) | 7)
  })

  it('refuses a name twice, folders and empty names', () => {
    assert.throws(() => packeZip([{ name: 'a.pdf', daten: '' }, { name: 'a.pdf', daten: '' }]), /zweimal/)
    for (const name of ['', '../a.pdf', 'ordner/a.pdf', 'a\\b.pdf', '..']) {
      assert.throws(() => packeZip([{ name, daten: '' }]), /kein zulässiger Name/, name)
    }
  })
})
