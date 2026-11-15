import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { baueZip, crc32 } from '../../src/sachbearbeitung/zip.ts'

/** A file of an archive as read back. */
interface GelesenerEintrag {
  name: string
  crc: number
  daten: Uint8Array
  flags: number
}

/** Reads an archive back through its directory, the way an unzip tool does. */
function liesZip(bytes: Uint8Array): GelesenerEintrag[] {
  const ansicht = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ende = bytes.length - 22
  assert.equal(ansicht.getUint32(ende, true), 0x06054b50, 'the archive ends with its directory')

  const anzahl = ansicht.getUint16(ende + 10, true)
  assert.equal(ansicht.getUint16(ende + 8, true), anzahl)
  let position = ansicht.getUint32(ende + 16, true)

  const dateien: GelesenerEintrag[] = []
  for (let i = 0; i < anzahl; i++) {
    assert.equal(ansicht.getUint32(position, true), 0x02014b50)
    const crc = ansicht.getUint32(position + 16, true)
    const groesse = ansicht.getUint32(position + 24, true)
    assert.equal(ansicht.getUint32(position + 20, true), groesse, 'stored, not compressed')
    const nameLaenge = ansicht.getUint16(position + 28, true)
    const ort = ansicht.getUint32(position + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(position + 46, position + 46 + nameLaenge))

    assert.equal(ansicht.getUint32(ort, true), 0x04034b50)
    const lokalerName = ansicht.getUint16(ort + 26, true)
    const lokalesExtra = ansicht.getUint16(ort + 28, true)
    const anfang = ort + 30 + lokalerName + lokalesExtra
    dateien.push({ name, crc, daten: bytes.subarray(anfang, anfang + groesse), flags: ansicht.getUint16(ort + 6, true) })

    position += 46 + nameLaenge + ansicht.getUint16(position + 30, true) + ansicht.getUint16(position + 32, true)
  }
  return dateien
}

describe('CRC-32', () => {
  it('matches the check value of the standard', () => {
    assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926)
  })

  it('is 0 for nothing', () => {
    assert.equal(crc32(new Uint8Array(0)), 0)
  })
})

describe('ZIP schreiben', () => {
  const jetzt = new Date(2026, 10, 7, 14, 32, 10)

  it('holds every file under its path, with its bytes and its checksum', () => {
    const dateien = [
      { name: 'profile/index.json', inhalt: '{"profile": []}\n' },
      { name: 'profile/wohngeld/2026-11-08/profil.json', inhalt: new Uint8Array([0, 1, 2, 255, 254]) },
    ]
    const gelesen = liesZip(baueZip(dateien, jetzt))

    assert.deepEqual(gelesen.map(({ name }) => name), dateien.map(({ name }) => name))
    const [erste, zweite] = gelesen
    assert.ok(erste)
    assert.ok(zweite)
    assert.equal(new TextDecoder().decode(erste.daten), '{"profile": []}\n')
    assert.deepEqual([...zweite.daten], [0, 1, 2, 255, 254])
    for (const { daten, crc } of gelesen) assert.equal(crc32(daten), crc)
  })

  it('writes names as UTF-8 and says so', () => {
    const [datei] = liesZip(baueZip([{ name: 'profile/größe/ä.json', inhalt: 'x' }], jetzt))
    assert.ok(datei)
    assert.equal(datei.name, 'profile/größe/ä.json')
    assert.equal(datei.flags & 0x0800, 0x0800)
  })

  it('writes an archive without files', () => {
    assert.deepEqual(liesZip(baueZip([], jetzt)), [])
  })

  it('stores a file of some size unchanged', () => {
    const gross = new Uint8Array(300_000).map((_, index) => (index * 31) % 251)
    const [datei] = liesZip(baueZip([{ name: 'gross.bin', inhalt: gross }], jetzt))
    assert.ok(datei)
    assert.equal(datei.daten.length, gross.length)
    assert.equal(crc32(datei.daten), crc32(gross))
    assert.deepEqual(datei.daten, gross)
  })
})
