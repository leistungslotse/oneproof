// Reads a ZIP archive back through its central directory, the way an unzip tool does, and checks
// what an unzip tool would check: headers, sizes, CRC.
import assert from 'node:assert/strict'
import { crc32 } from '../../src/engine/paket/zip.ts'

/** A file of an archive as read back. */
export interface ZipDatei {
  name: string
  daten: Uint8Array
  /** Is the name flagged as UTF-8 (bit 11)? */
  utf8: boolean
  /** The compression method; `0` is stored. */
  methode: number
}

/** The files of an archive, in archive order. */
export function liesZip(bytes: Uint8Array): ZipDatei[] {
  const ansicht = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ende = bytes.length - 22
  assert.equal(ansicht.getUint32(ende, true), 0x06054b50, 'the archive ends with its directory')

  const anzahl = ansicht.getUint16(ende + 10, true)
  assert.equal(ansicht.getUint16(ende + 8, true), anzahl)
  let position = ansicht.getUint32(ende + 16, true)
  assert.equal(position + ansicht.getUint32(ende + 12, true), ende, 'the directory ends where its end record starts')

  const dateien: ZipDatei[] = []
  for (let i = 0; i < anzahl; i++) {
    assert.equal(ansicht.getUint32(position, true), 0x02014b50)
    const flags = ansicht.getUint16(position + 8, true)
    const methode = ansicht.getUint16(position + 10, true)
    const crc = ansicht.getUint32(position + 16, true)
    const gepackt = ansicht.getUint32(position + 20, true)
    const laenge = ansicht.getUint32(position + 24, true)
    const nameLaenge = ansicht.getUint16(position + 28, true)
    const ort = ansicht.getUint32(position + 42, true)
    const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(position + 46, position + 46 + nameLaenge))

    assert.equal(ansicht.getUint32(ort, true), 0x04034b50, `local header of ${name}`)
    assert.equal(ansicht.getUint16(ort + 6, true), flags, 'same flags in both headers')
    assert.equal(ansicht.getUint32(ort + 14, true), crc, 'same CRC in both headers')
    const anfang = ort + 30 + ansicht.getUint16(ort + 26, true) + ansicht.getUint16(ort + 28, true)
    const daten = bytes.subarray(anfang, anfang + gepackt)
    assert.equal(methode, 0, 'stored')
    assert.equal(gepackt, laenge)
    assert.equal(crc32(daten), crc, `CRC of ${name}`)

    dateien.push({ name, daten, utf8: (flags & 0x0800) !== 0, methode })
    position += 46 + nameLaenge + ansicht.getUint16(position + 30, true) + ansicht.getUint16(position + 32, true)
  }
  return dateien
}

export const alsText = (daten: Uint8Array): string => new TextDecoder().decode(daten)
