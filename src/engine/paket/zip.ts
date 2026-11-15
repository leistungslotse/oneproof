/**
 * A ZIP archive, written in the browser — the package that "Antrag einreichen" hands over.
 *
 * Only what the package needs: files in one folder, stored as they are, names in UTF-8 (flag bit
 * 11, so that „Bescheid für Jürgen.pdf“ arrives as it is called). Nothing is compressed: the PDFs
 * and images that make up a package are compressed already, and the few kilobytes of XML and JSON
 * beside them are not worth a second code path. No ZIP64 either: a package is far below 4 GB and
 * 65 535 files, and a larger one is refused instead of written broken.
 */

const LOKALER_KOPF = 0x04034b50
const ZENTRALER_KOPF = 0x02014b50
const VERZEICHNIS_ENDE = 0x06054b50
const VERSION = 20
const UTF8_NAMEN = 0x0800
const GRENZE = 0xffffffff

/** A file of the archive: its name and its content (a string is written as UTF-8). */
export interface ZipEintrag {
  /** Unique within the archive, no folders. */
  name: string
  daten: Uint8Array | string
}

/** What both headers of a file say about its content. */
interface Pruefwerte {
  pruefsumme: number
  laenge: number
}

const CRC_TABELLE = (() => {
  const tabelle = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    tabelle[n] = c >>> 0
  }
  return tabelle
})()

/** CRC-32 as ZIP uses it (polynomial 0xEDB88320). */
export function crc32(daten: Uint8Array): number {
  let crc = 0xffffffff
  // An index loop, not `for…of`: the iterator is six to eight times slower, which blocks the page for
  // seconds on a package of many large originals. The index is masked to 0..255, so the table entry
  // always exists; the fallbacks are dead and only satisfy `noUncheckedIndexedAccess`.
  for (let i = 0; i < daten.length; i++) crc = (CRC_TABELLE[(crc ^ (daten[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** Date and time in the form of MS-DOS, which ZIP keeps: local time, two-second steps. */
function dosZeit(datum: Date): { zeit: number; tag: number } {
  const jahr = Math.min(Math.max(datum.getFullYear(), 1980), 2107)
  return {
    zeit: (datum.getHours() << 11) | (datum.getMinutes() << 5) | Math.floor(datum.getSeconds() / 2),
    tag: ((jahr - 1980) << 9) | ((datum.getMonth() + 1) << 5) | datum.getDate(),
  }
}

/**
 * @param eintraege  unique names, no folders
 * @param jetzt  the time written for every file
 */
export function packeZip(eintraege: readonly ZipEintrag[], jetzt = new Date()): Uint8Array<ArrayBuffer> {
  const namen = new Set<string>()
  for (const { name } of eintraege) {
    if (!name || /[\\/]/.test(name) || name === '.' || name === '..') throw new Error(`„${name}“ ist kein zulässiger Name in einem Paket.`)
    if (namen.has(name)) throw new Error(`„${name}“ steht zweimal im Paket.`)
    namen.add(name)
  }
  if (eintraege.length > 0xffff) throw new Error('Das Paket hat zu viele Dateien.')

  const kodierer = new TextEncoder()
  const { zeit, tag } = dosZeit(jetzt)
  const teile: Uint8Array[] = []
  const verzeichnis: Uint8Array<ArrayBuffer>[] = []
  let versatz = 0

  for (const eintrag of eintraege) {
    const daten = typeof eintrag.daten === 'string' ? kodierer.encode(eintrag.daten) : eintrag.daten
    const name = kodierer.encode(eintrag.name)
    const felder = { pruefsumme: crc32(daten), laenge: daten.length }
    if (daten.length > GRENZE || versatz > GRENZE) throw new Error('Das Paket ist zu groß.')

    teile.push(kopf(LOKALER_KOPF, name, felder, zeit, tag), daten)
    verzeichnis.push(kopf(ZENTRALER_KOPF, name, felder, zeit, tag, versatz))
    versatz += 30 + name.length + daten.length
  }
  if (versatz > GRENZE) throw new Error('Das Paket ist zu groß.')

  const ende = new DataView(new ArrayBuffer(22))
  ende.setUint32(0, VERZEICHNIS_ENDE, true)
  ende.setUint16(8, eintraege.length, true)
  ende.setUint16(10, eintraege.length, true)
  ende.setUint32(12, verzeichnis.reduce((summe, eintrag) => summe + eintrag.length, 0), true)
  ende.setUint32(16, versatz, true)

  return verbinde([...teile, ...verzeichnis, new Uint8Array(ende.buffer)])
}

/** The local header of a file, or (with `versatz`) its entry in the central directory. */
function kopf(
  signatur: number,
  name: Uint8Array,
  { pruefsumme, laenge }: Pruefwerte,
  zeit: number,
  tag: number,
  versatz: number | null = null,
): Uint8Array<ArrayBuffer> {
  const zentral = versatz !== null
  const groesse = zentral ? 46 : 30
  const ansicht = new DataView(new ArrayBuffer(groesse + name.length))
  let position = 0
  const u16 = (wert: number) => {
    ansicht.setUint16(position, wert, true)
    position += 2
  }
  const u32 = (wert: number) => {
    ansicht.setUint32(position, wert, true)
    position += 4
  }

  u32(signatur)
  if (zentral) u16(VERSION) // made by
  u16(VERSION) // needed to extract
  u16(UTF8_NAMEN)
  u16(0) // stored
  u16(zeit)
  u16(tag)
  u32(pruefsumme)
  u32(laenge) // compressed size
  u32(laenge)
  u16(name.length)
  u16(0) // extra field
  if (zentral) {
    u16(0) // comment
    u16(0) // disk
    u16(0) // internal attributes
    u32(0) // external attributes
    u32(versatz)
  }

  const bytes = new Uint8Array(ansicht.buffer)
  bytes.set(name, groesse)
  return bytes
}

function verbinde(teile: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const ganz = new Uint8Array(teile.reduce((summe, teil) => summe + teil.length, 0))
  let position = 0
  for (const teil of teile) {
    ganz.set(teil, position)
    position += teil.length
  }
  return ganz
}
