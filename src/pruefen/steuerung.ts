/**
 * What the page does when a person presses a button — without React and without the browser.
 *
 * Everything that touches the outside (files, network, the PDF reader) is passed in, so that the
 * way from "files chosen" to "result" is tested with the same fakes as the engine itself.
 */
import { FORMAT_NAME, leseAntrag } from '../engine/antrag.ts'
import type { Antrag } from '../engine/antrag.ts'
import { PruefFehler } from '../engine/fehler.ts'
import { erzeugeIonosClient } from '../engine/ionos/client.ts'
import type { HolenFunktion, KiClient } from '../engine/ionos/client.ts'
import type { KiKonfiguration } from '../engine/ionos/modelle.ts'
import { alsPruefFehler, pruefe } from '../engine/pipeline.ts'
import type { Nachweisdatei, PruefeOptionen, Pruefergebnis } from '../engine/pipeline.ts'
import type { Profil } from '../engine/profil/laden.ts'
import { bereiteAntragVor } from '../engine/zuordnung/index.ts'
import { dateiArt } from '../pdf/art.ts'
import { groesseText } from './ansicht.ts'

/** An application is a few kilobytes of XML or JSON; more than this is not one. */
export const MAX_ANTRAG_BYTES = 5_000_000

/** Evidence: how many files, and how large each, the page accepts. */
export const MAX_NACHWEISE = 30
export const MAX_NACHWEIS_BYTES = 50_000_000

/** What the page asks of an application file: its size and its text. A `File` does. */
export type Antragsdatei = Pick<File, 'size' | 'text'>

/** What the page asks of an evidence file to take it up: name, type, size and when it was changed. A `File` does. */
export type NachweisDatei = Pick<File, 'name' | 'type' | 'size' | 'lastModified'>

/** What the check understood of an application file the moment it was chosen. */
export interface AntragErkennung {
  /** The text of the file. */
  text: string
  /** The same text, by its earlier name. */
  xml: string
  format: Antrag['format']
  /** The format in words for a person. */
  formatName: string
  /** The application type of the profile, in words. */
  name: string
  schema: string
  version: string
  /** The persons the application names. */
  personen: string[]
  /** Remarks on how the application was read. */
  hinweise: string[]
}

/** The application the person chose: the file, and — once the check has looked at it — what it is. */
export interface GewaehlterAntrag {
  datei: File
  /** `null` while the file is being looked at. */
  erkannt: AntragErkennung | null
}

/** What {@link erkenneAntrag} needs. */
export interface ErkenneAntragEingabe {
  profil: Profil
  datei: Antragsdatei
  /** For environments without one. */
  DOMParser?: typeof globalThis.DOMParser
}

/** The files a person chose, sorted. */
export interface GewaehlteNachweise<D extends NachweisDatei> {
  angenommen: D[]
  /** Messages for the person: why a file was not taken. */
  abgelehnt: string[]
}

/** The text of an application file, or why it cannot be one. */
export async function liesAntragsdatei(datei: Antragsdatei): Promise<string> {
  if (datei.size === 0) throw new PruefFehler('antrag', 'Die Antragsdatei ist leer.')
  if (datei.size > MAX_ANTRAG_BYTES) {
    throw new PruefFehler('antrag', `Die Antragsdatei ist mit ${groesseText(datei.size)} zu groß für einen Antrag.`)
  }
  try {
    return await datei.text()
  } catch (ursache) {
    throw new PruefFehler('antrag', 'Die Antragsdatei konnte nicht gelesen werden.', { ursache })
  }
}

/**
 * What can be said about an application file the moment it is chosen: which application it is and
 * whom it names. A wrong file is found here and not only after minutes of reading evidence.
 *
 * @throws {PruefFehler} if the file is no application the profile knows
 */
export async function erkenneAntrag({ profil, datei, DOMParser }: ErkenneAntragEingabe): Promise<AntragErkennung> {
  try {
    const text = await liesAntragsdatei(datei)
    const vorbereitet = await bereiteAntragVor({ profil, antrag: leseAntrag(text, { DOMParser }) })
    const { antragsart, instanz } = vorbereitet
    return {
      text,
      /** The same text, by its earlier name. */
      xml: text,
      format: instanz.format,
      formatName: FORMAT_NAME[instanz.format] ?? instanz.format,
      name: antragsart.name,
      schema: antragsart.schema,
      version: antragsart.version,
      personen: vorbereitet.personen,
      hinweise: vorbereitet.hinweise,
    }
  } catch (fehler) {
    throw alsPruefFehler(fehler)
  }
}

/**
 * Sorts the files a person chose: what the check can read, and why it does not take the rest.
 *
 * @param gewaehlt   the new files
 * @param vorhanden  the files chosen before; the same file is not taken twice
 */
export function waehleNachweise<D extends NachweisDatei>(gewaehlt: readonly D[], vorhanden: readonly D[] = []): GewaehlteNachweise<D> {
  const gleich = (a: NachweisDatei, b: NachweisDatei) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified
  const angenommen: D[] = []
  const abgelehnt: string[] = []

  for (const datei of gewaehlt) {
    if (dateiArt(datei) === null) {
      abgelehnt.push(`„${datei.name}“ wird nicht gelesen. Erlaubt sind PDF-, JPEG- und PNG-Dateien.`)
    } else if (datei.size === 0) {
      abgelehnt.push(`„${datei.name}“ ist leer.`)
    } else if (datei.size > MAX_NACHWEIS_BYTES) {
      abgelehnt.push(`„${datei.name}“ ist mit ${groesseText(datei.size)} zu groß. Erlaubt sind ${groesseText(MAX_NACHWEIS_BYTES)}.`)
    } else if ([...vorhanden, ...angenommen].some((bekannt) => gleich(bekannt, datei))) {
      // Said, so that a button that seemingly did nothing has an answer.
      abgelehnt.push(`„${datei.name}“ ist bereits ausgewählt.`)
    } else if (vorhanden.length + angenommen.length >= MAX_NACHWEISE) {
      abgelehnt.push(`„${datei.name}“ wurde nicht aufgenommen. Es sind höchstens ${MAX_NACHWEISE} Dateien möglich.`)
    } else {
      angenommen.push(datei)
    }
  }

  // Each message once: two files of one name from two folders say the same, and the page keys by it.
  return { angenommen, abgelehnt: [...new Set(abgelehnt)] }
}

/** What {@link fuehreAus} needs; `D` is the kind of file the page hands over (a `File`, or a stand-in in tests). */
export interface FuehreAusOptionen<D extends Nachweisdatei>
  extends Pick<PruefeOptionen<D>, 'profil' | 'oeffne' | 'fortschritt' | 'signal' | 'DOMParser'> {
  /** As returned by {@link erkenneAntrag}. */
  antrag: Pick<AntragErkennung, 'text' | 'xml'>
  nachweise: D[]
  konfiguration: KiKonfiguration
  /** Page texts read earlier, so that a second check does not read them again. */
  cache?: PruefeOptionen<D>['cache']
  /** Replaces the network, for tests. */
  holen?: HolenFunktion
  /** Replaces the AI client, for tests. */
  client?: KiClient
}

/** The check, from the files to the result. */
export function fuehreAus<D extends Nachweisdatei>({
  profil,
  antrag,
  nachweise,
  oeffne,
  konfiguration,
  cache,
  fortschritt,
  signal,
  holen,
  client,
  DOMParser,
}: FuehreAusOptionen<D>): Promise<Pruefergebnis> {
  // Without evidence there is nothing to read: the check then needs no access to the AI at all.
  const ki =
    nachweise.length > 0
      ? { client: client ?? erzeugeIonosClient({ basis: konfiguration.basis, ...(holen ? { fetch: holen } : {}) }), konfiguration }
      : undefined

  return pruefe({ profil, antragText: antrag.text ?? antrag.xml, nachweise, oeffne, ki, fortschritt, signal, cache, DOMParser })
}
