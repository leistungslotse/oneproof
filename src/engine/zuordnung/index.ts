/**
 * The deterministic half of the check: grouped documents + application → requirements.
 *
 * Everything before this step reads (OCR) and judges (the model groups pages into documents);
 * everything in here only applies rules, so the same documents and the same application always give
 * the same result. It runs without a network and is covered by tests.
 */

import { inSchemaVersion } from '../fim/abbildung.ts'
import type { Instance, Node } from '../fim/instanz.ts'
import type { Schema } from '../fim/schema.ts'
import { fimZugang } from '../fim/zugang.ts'
import type { Document } from '../gruppierung/dokument.ts'
import { inProfil } from '../oneproof/lesen.ts'
import type { OneProofAntrag } from '../oneproof/lesen.ts'
import { wertBei } from '../oneproof/zeiger.ts'
import { oneProofZugang } from '../oneproof/zugang.ts'
import type { Antragsart, Profil } from '../profil/laden.ts'
import { bewerteAnforderungen } from './anforderungen.ts'
import type { AnforderungenErgebnis, Dateinamen } from './anforderungen.ts'
import { personDirectory } from './personen.ts'
import type { PersonDirectory } from './personen.ts'
import { place } from './platzierung.ts'
import type { Plan } from './platzierung.ts'
import { baueItems } from './posten.ts'
import type { DokumentInfo, MonateJeSeite } from './posten.ts'
import { baueZiele } from './ziele.ts'
import type { Zielableitung, Zugang } from './ziele.ts'

/** An application as it enters the check: in FIM or in the OneProof Format. */
export type Antrag = Instance | OneProofAntrag

/** What {@link bereiteAntragVor} needs. */
export interface BereiteAntragVorEingabe {
  profil: Profil
  antrag: Antrag
}

/** What the application says before any document is looked at. */
export interface VorbereiteterAntrag {
  /** The application, in the schema version of the profile. */
  instanz: Antrag
  schema: Schema
  /** The application type of the profile the application belongs to. */
  antragsart: Antragsart
  /** Remarks on how the application was read (a schema version it was brought into, …). */
  hinweise: string[]
  /** The places in the application a document can belong to. */
  ziele: Zielableitung
  /** The persons of the application, to match the names on documents with. */
  verzeichnis: PersonDirectory
  /** Names of the persons for display: the name from the application, otherwise the role. */
  personen: string[]
  /** The day the application dates from, if it says so (see the profile's `stichtag`). */
  stichtag: Date | null
}

/** The application as the result states it. */
export interface AntragInfo {
  schema: string
  version: string
  /** The version the application was written in, if it was brought into another one. */
  urspruenglicheVersion: string | null
  name: string
  format: Antrag['format']
  personen: string[]
  /** The day recency is measured from, as `JJJJ-MM-TT`, and where it comes from. */
  stichtag: string
  /** The day comes from the application, not from the caller or the day of the check. */
  stichtagAusAntrag: boolean
}

/** What {@link ordneZu} needs: either `antrag` or the result of {@link bereiteAntragVor}. */
export interface OrdneZuEingabe {
  profil: Profil
  antrag?: Antrag
  vorbereitet?: VorbereiteterAntrag
  dokumente: Document[]
  monateJeSeite?: MonateJeSeite
  dateien?: Dateinamen
  /** The day the evidence must be current at (default: the date of the application, otherwise today). */
  stichtag?: Date
}

/** The result of the check: requirements with their status, where every document went, and the plan. */
export interface Zuordnung extends AnforderungenErgebnis {
  antrag: AntragInfo
  dokumente: DokumentInfo[]
  hinweise: string[]
  plan: Plan
}

/**
 * Reads the application and derives everything the later steps need from it: the schema version
 * the profile knows, the targets (the places in the application a document can belong to) and the
 * persons. Split off from {@link ordneZu} because the grouping model needs the persons before it
 * can name them on a document.
 *
 * An application in FIM is brought into the schema version of the profile; one in the OneProof
 * Format is checked against the JSON Schema of its benefit and version first and not read at all
 * if it does not hold.
 */
export async function bereiteAntragVor({ profil, antrag }: BereiteAntragVorEingabe): Promise<VorbereiteterAntrag> {
  const { instanz, schema, antragsart, hinweise, zugang } = await leseAntrag(profil, antrag)
  const ziele = baueZiele({ profil, schema, zugang })
  const verzeichnis = personDirectory(ziele.namensteile, { nebenpersonen: ziele.nebenpersonen })

  return {
    instanz,
    schema,
    antragsart,
    hinweise,
    ziele,
    verzeichnis,
    /** Names of the persons for display: the name from the application, otherwise the role. */
    personen: ziele.personen.map((name, index) => name ?? verzeichnis.label(index)),
    /** The day the application dates from, if it says so (see the profile's `stichtag`). */
    stichtag: stichtagVon(profil, schema, instanz),
  }
}

/** The application read in the schema version of the profile, with the access to it. */
async function leseAntrag(
  profil: Profil,
  antrag: Antrag,
): Promise<{ instanz: Antrag; schema: Schema; antragsart: Antragsart; hinweise: string[]; zugang: Zugang }> {
  if (antrag.format === 'oneproof') {
    const { instanz, schema, antragsart, hinweise } = await inProfil(antrag, profil)
    return { instanz, schema, antragsart, hinweise, zugang: oneProofZugang({ profil, schema, antrag: instanz }) }
  }
  const { instanz, schema, antragsart, hinweise } = await inSchemaVersion(antrag, profil)
  return { instanz, schema, antragsart, hinweise, zugang: fimZugang({ profil, schema, wurzel: instanz.root }) }
}

function stichtagVon(profil: Profil, schema: Schema, instanz: Antrag): Date | null {
  const feld = profil.anbindungFuer ? profil.anbindungFuer(schema.schemaId).stichtag : profil.stichtag
  if (!feld) return null
  return datumAus(instanz.format === 'oneproof' ? wertBei(instanz.daten, feld) : ersterText(instanz.root, feld))
}

const alsTag = (datum: Date): string =>
  `${datum.getFullYear()}-${String(datum.getMonth() + 1).padStart(2, '0')}-${String(datum.getDate()).padStart(2, '0')}`

/** The text of the first element with this id, depth first. */
function ersterText(knoten: Node, id: string): string | null {
  if (knoten.id === id && knoten.text !== '') return knoten.text
  for (const kind of knoten.children) {
    const text = ersterText(kind, id)
    if (text !== null) return text
  }
  return null
}

/**
 * A date as applications write it: `13.08.2026`, `13.08.2026 09:09:46` or ISO `2026-08-13…`.
 * Only the day counts; anything else is no date.
 *
 * @returns noon of that day, local time
 */
export function datumAus(text: unknown): Date | null {
  const wert = String(text ?? '').trim()
  const deutsch = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\D|$)/.exec(wert)
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:\D|$)/.exec(wert)
  const [jahr, monat, tag] = deutsch ? [deutsch[3], deutsch[2], deutsch[1]] : iso ? [iso[1], iso[2], iso[3]] : []
  if (!jahr) return null

  const datum = new Date(Number(jahr), Number(monat) - 1, Number(tag), 12)
  return datum.getMonth() === Number(monat) - 1 && datum.getDate() === Number(tag) ? datum : null
}

/**
 * Places the documents at the application and states what is established: the requirements with
 * their status, where every document went and which documents have no place. Takes either the
 * application or the result of {@link bereiteAntragVor}.
 */
export async function ordneZu({
  profil,
  antrag,
  vorbereitet,
  dokumente,
  monateJeSeite,
  dateien,
  stichtag,
}: OrdneZuEingabe): Promise<Zuordnung> {
  let vorab = vorbereitet
  if (!vorab) {
    if (!antrag) throw new Error('Weder ein Antrag noch der vorbereitete Antrag wurde übergeben.')
    vorab = await bereiteAntragVor({ profil, antrag })
  }
  const { instanz, antragsart, hinweise, ziele, verzeichnis, personen, stichtag: antragsdatum } = vorab
  const bezug = stichtag ?? antragsdatum ?? new Date()

  const { items, posten, dokumente: dokumentInfos } = baueItems({ dokumente, profil, verzeichnis, monateJeSeite, schemaId: antragsart.schema })
  const plan = place(items, ziele.ziele)

  const ergebnis = bewerteAnforderungen({ profil, ziele, plan, posten, dokumente: dokumentInfos, dateien, stichtag: bezug })

  return {
    ...ergebnis,
    antrag: {
      schema: antragsart.schema,
      version: antragsart.version,
      // only an application in FIM is read through the dictionary of another schema version
      urspruenglicheVersion: instanz.format === 'oneproof' ? null : (instanz.urspruenglicheVersion ?? null),
      name: antragsart.name,
      format: instanz.format,
      personen,
      /** The day recency is measured from, as `JJJJ-MM-TT`, and where it comes from. */
      stichtag: alsTag(bezug),
      stichtagAusAntrag: !stichtag && antragsdatum !== null && antragsdatum !== undefined,
    },
    dokumente: dokumentInfos,
    hinweise,
    plan,
  }
}
