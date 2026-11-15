/**
 * Writes the evidence of a package into an application in the OneProof Format.
 *
 * The format has no fields for files: the application lists its files under `anlagen`, and a
 * piece of evidence names the values it supports (`bezuege`, JSON Pointers). A package names its
 * own files, so the list the application brought along is replaced as a whole — it names files the
 * package does not contain, the application document of the sending service included. Every file
 * of the package becomes an attachment:
 *
 *  - `dateiname`, `mimeType` and `hashwert` (SHA-512) of the file in the package;
 *  - `dokumentart`: the type the check recognised, where the schema of the benefit knows it;
 *  - `person`: the person of the household the document is about, unless a place it supports
 *    belongs to someone else (a cost of child care stated once for the household);
 *  - `bezuege`: every place the check filed it at, as the pointer of the value there (see `Ort` in
 *    `zugang.ts`). A place the application has no value for yet — evidence of a fact it does not
 *    state — is referred to at the nearest value above it that still belongs to it.
 *
 * Everything else of the application stays as it was. The result is checked against the schema
 * again: a package whose application the receiver would reject is not built.
 */

import { sha512Hex } from '../../pdf/hash.ts'
import { istObjekt } from '../json.ts'
import type { Json } from '../json.ts'
import type { DokumentInfo } from '../zuordnung/posten.ts'
import { haushalt, personDerStelle } from './personen.ts'
import type { JsonSchemata, OneProofSchema } from './schema.ts'
import type { Ort } from './zugang.ts'

const MIME: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic', webp: 'image/webp' }

/** The media type of a file by its name; a file the check could not open keeps the one of its upload. */
export function mimeTypVon(name: string, angegeben?: string | null): string {
  if (typeof angegeben === 'string' && /^[a-z]+\/[A-Za-z0-9.+-]+$/.test(angegeben)) return angegeben
  return MIME[String(name).split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'
}

/** At most `laenge` characters, counted as JSON Schema counts them: by code point, so no emoji is cut in half. */
const kuerze = (text: string, laenge: number): string => {
  const zeichen = Array.from(text)
  return zeichen.length <= laenge ? text : `${zeichen.slice(0, laenge - 1).join('')}…`
}

/** What the package knows of a file it was uploaded as, and could not open. */
export interface AnlagenUpload {
  name: string
  mime?: string | null
}

/** A file of the package besides the application. */
export interface AnlagenDatei {
  name: string
  /** Backed by an `ArrayBuffer`, as `crypto.subtle` wants it. */
  daten: Uint8Array<ArrayBuffer>
  /** The document the check made of it; `null` for a file that was uploaded and could not be opened. */
  dokument: Pick<DokumentInfo, 'typ' | 'typLabel' | 'person' | 'personTreffer' | 'nichtZugeordnet'> | null
  upload: AnlagenUpload | null
}

/** A reference to a file at the place the check filed it at. */
export interface AnlagenVerweis {
  datei: string
  ort: Ort
  bezeichnung: string
}

/** What `schreibeAnlagen` takes. */
export interface SchreibeAnlagenEingabe {
  /** The application as it was uploaded. */
  text: string
  /** Its JSON Schemas. */
  schemata: JsonSchemata
  /** Their compact form. */
  schema: OneProofSchema
  /** The files of the package besides the application. */
  dateien: AnlagenDatei[]
  verweise: AnlagenVerweis[]
}

/** What `schreibeAnlagen` made of the application. */
export interface SchreibeAnlagenErgebnis {
  /** The application with its list of attachments, as text. */
  inhalt: string
  geschrieben: { datei: string; bezeichnung: string; stelle: string }[]
  nichtGeschrieben: { datei: string; bezeichnung: string; grund: string }[]
  /** The attachments the application brought along, which the package replaces. */
  entfernt: { feld: string; wert: string }[]
}

/** An attachment as the package writes it. */
interface Anlage {
  dateiname: string
  zweck: string
  dokumentart?: string
  beschreibung?: string
  person?: unknown
  bezuege?: { stelle: string }[]
  mimeType: string
  hashwert?: { algorithmus: string; wert: string }
}

export async function schreibeAnlagen({ text, schemata, schema, dateien, verweise }: SchreibeAnlagenEingabe): Promise<SchreibeAnlagenErgebnis> {
  const gelesen: Json = JSON.parse(text)
  // The text is an application that was read as one: a JSON object.
  if (!istObjekt(gelesen)) throw new Error('Die Antragsdatei ist kein JSON-Objekt.')
  const daten = gelesen
  const entfernt = (Array.isArray(daten.anlagen) ? daten.anlagen : []).map((anlage, index) => ({
    feld: `/anlagen/${index}`,
    wert: istObjekt(anlage) && typeof anlage.dateiname === 'string' ? anlage.dateiname : '',
  }))

  const idVon = new Map<number, unknown>(haushalt(daten).map(({ index, id }): [number, unknown] => [index, id]))
  const dokumentarten = new Set(Object.keys(schema.kinder.find((kind) => kind.schluessel === 'anlagen')?.kinder?.[0]?.kinder?.find((kind) => kind.schluessel === 'dokumentart')?.werte ?? {}))

  const geschrieben: SchreibeAnlagenErgebnis['geschrieben'] = []
  const nichtGeschrieben: SchreibeAnlagenErgebnis['nichtGeschrieben'] = []
  const anlagen: Anlage[] = []

  for (const { name, daten: bytes, dokument, upload } of dateien) {
    const bezuege: string[] = []
    for (const verweis of verweise.filter(({ datei }) => datei === name)) {
      const stelle = verweis.ort?.stelle ?? null
      if (!stelle) {
        nichtGeschrieben.push({ datei: name, bezeichnung: verweis.bezeichnung, grund: 'Der Antrag hat zu dieser Angabe noch keinen Wert, auf den der Nachweis verweisen könnte.' })
        continue
      }
      if (!bezuege.includes(stelle)) bezuege.push(stelle)
      geschrieben.push({ datei: name, bezeichnung: verweis.bezeichnung, stelle })
    }

    const person = dokument?.personTreffer?.index ?? null
    const personId = person === null ? null : (idVon.get(person) ?? null)
    const passt = personId !== null && bezuege.every((stelle) => [null, personId].includes(personDerStelle(daten, stelle)))
    const hash = await sha512Hex(bytes)
    const beschreibung = dokument
      ? dokument.nichtZugeordnet
        ? 'Seiten, die keinem Dokument zugeordnet werden konnten'
        : [dokument.typLabel, dokument.person].filter(Boolean).join(' · ')
      : `Unverändert hochgeladene Datei „${upload?.name ?? name}“`

    anlagen.push({
      dateiname: name,
      zweck: 'nachweis',
      ...(dokument && !dokument.nichtZugeordnet && dokumentarten.has(dokument.typ) ? { dokumentart: dokument.typ } : {}),
      ...(beschreibung.trim() ? { beschreibung: kuerze(beschreibung, 255) } : {}),
      ...(passt ? { person: personId } : {}),
      ...(bezuege.length > 0 ? { bezuege: bezuege.map((stelle) => ({ stelle })) } : {}),
      mimeType: dokument ? 'application/pdf' : mimeTypVon(name, upload?.mime),
      ...(hash ? { hashwert: { algorithmus: 'sha512', wert: hash } } : {}),
    })
  }

  const neu: Record<string, unknown> = { ...daten, anlagen }
  if (anlagen.length === 0) delete neu.anlagen

  const { fehlerText, pruefeAntrag } = await import('./pruefung.ts')
  const fehler = pruefeAntrag(neu, schemata, schema)
  if (fehler.length > 0) throw new Error(`Die Antragsdatei des Pakets entspräche nicht mehr dem Schema. ${fehlerText(fehler)}`)

  return { inhalt: `${JSON.stringify(neu, null, 2)}\n`, geschrieben, nichtGeschrieben, entfernt }
}
