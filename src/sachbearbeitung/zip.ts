/**
 * A ZIP archive of a few files, written without a library.
 *
 * The files are stored, not compressed: a version of a profile is a few hundred kilobytes of JSON
 * that is delivered once, and a writer that only stores is short enough to be read in full. Names
 * are UTF-8. Every unzip tool opens the result.
 */

const KOPF_LOKAL = 0x04034b50
const KOPF_ZENTRAL = 0x02014b50
const ENDE = 0x06054b50
/** Bit 11 of the flags: the names are UTF-8. */
const UTF8 = 0x0800
/** "Made by Unix", version 2.0 — so that the permission bits below are read. */
const ERSTELLT_UNIX_2_0 = (3 << 8) | 20
/** A regular file, rw-r--r--. */
const DATEIRECHTE = (0o100644 << 16) >>> 0

const CRC_TABELLE = (() => {
  const tabelle = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    tabelle[n] = c >>> 0
  }
  return tabelle
})()

/** The CRC-32 of the bytes, as an unsigned number. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  // The index is masked to 0..255, so the entry always exists; the fallback is dead.
  for (const byte of bytes) crc = (CRC_TABELLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** The date and time the way ZIP keeps them (MS-DOS, two-second steps, from 1980). */
function dosZeit(datum: Date): { zeit: number; datum: number } {
  const jahr = Math.max(1980, datum.getFullYear())
  return {
    zeit: (datum.getHours() << 11) | (datum.getMinutes() << 5) | (datum.getSeconds() >> 1),
    datum: ((jahr - 1980) << 9) | ((datum.getMonth() + 1) << 5) | datum.getDate(),
  }
}

/** A file of the archive: its path inside it and its content (a string is written as UTF-8). */
export interface ZipDatei {
  name: string
  inhalt: Uint8Array | string
}

/**
 * @param dateien   `name` is the path inside the archive
 * @param jetzt   the time written for every file
 */
export function baueZip(dateien: readonly ZipDatei[], jetzt = new Date()): Uint8Array<ArrayBuffer> {
  const kodierer = new TextEncoder()
  const { zeit, datum } = dosZeit(jetzt)

  const eintraege = dateien.map(({ name, inhalt }) => {
    const bytes = typeof inhalt === 'string' ? kodierer.encode(inhalt) : inhalt
    return { name: kodierer.encode(name), bytes, crc: crc32(bytes) }
  })

  const groesse =
    eintraege.reduce((summe, { name, bytes }) => summe + 30 + name.length + bytes.length + 46 + name.length, 0) + 22
  const ausgabe = new Uint8Array(groesse)
  const ansicht = new DataView(ausgabe.buffer)
  let position = 0

  const schreibe16 = (wert: number) => {
    ansicht.setUint16(position, wert, true)
    position += 2
  }
  const schreibe32 = (wert: number) => {
    ansicht.setUint32(position, wert, true)
    position += 4
  }
  const schreibeBytes = (bytes: Uint8Array) => {
    ausgabe.set(bytes, position)
    position += bytes.length
  }

  // Each file: its header, then its bytes.
  const orte: number[] = []
  for (const { name, bytes, crc } of eintraege) {
    orte.push(position)
    schreibe32(KOPF_LOKAL)
    schreibe16(20) // version needed
    schreibe16(UTF8)
    schreibe16(0) // stored
    schreibe16(zeit)
    schreibe16(datum)
    schreibe32(crc)
    schreibe32(bytes.length) // compressed size
    schreibe32(bytes.length)
    schreibe16(name.length)
    schreibe16(0) // no extra field
    schreibeBytes(name)
    schreibeBytes(bytes)
  }

  // Then the directory of them all.
  const verzeichnisStart = position
  eintraege.forEach(({ name, bytes, crc }, index) => {
    schreibe32(KOPF_ZENTRAL)
    schreibe16(ERSTELLT_UNIX_2_0)
    schreibe16(20)
    schreibe16(UTF8)
    schreibe16(0)
    schreibe16(zeit)
    schreibe16(datum)
    schreibe32(crc)
    schreibe32(bytes.length)
    schreibe32(bytes.length)
    schreibe16(name.length)
    schreibe16(0) // extra field
    schreibe16(0) // comment
    schreibe16(0) // disk
    schreibe16(0) // internal attributes
    schreibe32(DATEIRECHTE)
    // One offset was written for every entry; the fallback is dead.
    schreibe32(orte[index] ?? 0)
    schreibeBytes(name)
  })
  const verzeichnisGroesse = position - verzeichnisStart

  schreibe32(ENDE)
  schreibe16(0) // this disk
  schreibe16(0) // disk of the directory
  schreibe16(eintraege.length)
  schreibe16(eintraege.length)
  schreibe32(verzeichnisGroesse)
  schreibe32(verzeichnisStart)
  schreibe16(0) // no comment

  return ausgabe
}
