/**
 * A new application type of the OneProof Format, read from the JSON Schema of its benefit — the
 * counterpart of reading the XDF file of a FIM schema (`fim/xdf.ts`).
 *
 * The format has no file fields and no rules in words: evidence belongs to values. Where a value
 * asks for evidence follows from the structure of the schema:
 *
 *  - a section with a yes/no question of its own (`vorhanden`) asks when the answer is yes — at
 *    each entry of its list where it has one, else at the section (`herkunft: frage`);
 *  - a list of entries outside such a section asks for each entry (`herkunft: abschnitt`).
 *
 * The list of the persons and the list with one entry per person are no places of their own: a
 * place inside them is asked for every person. What a place accepts the profile decides, as for
 * FIM (`profil/antragsart.ts`).
 */

import { labelOf } from '../fim/schema.ts'
import { istObjekt } from '../json.ts'
import type { Frage } from '../profil/laden.ts'
import type { Herkunft } from '../profil/bedingungen.ts'
import { dateiVon, kompaktesSchema, ladeSchemata, RAHMEN, urnTeile } from './schema.ts'
import type { JsonSchema, JsonSchemata, OneProofKnoten, OneProofSchema } from './schema.ts'

/** Where the schemas of an application type are kept inside the folder of a version. */
export const ORDNER = 'schema'

/** The structure of a file that is no JSON Schema of the OneProof Format. */
export class OneProofSchemaFehler extends Error {
  override name = 'OneProofSchemaFehler'
}

/** What `liesOneProofSchema` needs besides the text. */
export interface LiesOneProofSchemaOptionen {
  /** Reads a schema it refers to, by file name (the frame of the format). */
  liesNeben: (datei: string) => Promise<unknown>
}

/** A new application type read from the JSON Schema of its benefit. */
export interface OneProofSchemaGelesen {
  format: 'oneproof'
  formatName: string
  schema: OneProofSchema
  schemata: JsonSchemata
  /** The schemas as files of the version, by their path (`schema/<datei>`). */
  dateien: Record<string, JsonSchema>
  /** The number of nodes of the compact schema. */
  elemente: number
  ableitung: OneProofAbleitung
}

/** Reads the JSON Schema of a benefit and the schemas it refers to. */
export async function liesOneProofSchema(text: string, { liesNeben }: LiesOneProofSchemaOptionen): Promise<OneProofSchemaGelesen> {
  let haupt: unknown
  try {
    haupt = JSON.parse(text)
  } catch {
    throw new OneProofSchemaFehler('Die Datei ist kein JSON.')
  }
  const kennung = istObjekt(haupt) && typeof haupt.$id === 'string' ? haupt.$id : ''
  const urn = urnTeile(kennung)
  const datei = dateiVon(kennung)
  if (!urn || datei === null) throw new OneProofSchemaFehler('Die Datei ist kein Schema des OneProof Formats: „$id“ fehlt oder hat nicht die Form „urn:oneproof:format:<name>:<version>“.')
  if (urn.name === RAHMEN) throw new OneProofSchemaFehler('Das ist der Rahmen des OneProof Formats. Gewählt werden muss das Schema einer Leistung, etwa „wohngeld-1.0.schema.json“.')

  let schemata: JsonSchemata
  try {
    schemata = await ladeSchemata(async (andere) => (andere === datei ? haupt : liesNeben(andere)), datei)
  } catch (grund) {
    throw new OneProofSchemaFehler(grund instanceof Error ? grund.message : 'Ein Schema, auf das die Datei verweist, konnte nicht geladen werden.')
  }

  // A reference that leads nowhere, a schema that refers to itself: the compact form says what is wrong with it.
  let schema: OneProofSchema
  let ableitung: OneProofAbleitung
  try {
    schema = kompaktesSchema(schemata)
    ableitung = leiteOneProofStellenAb(schema)
  } catch (grund) {
    throw new OneProofSchemaFehler(
      grund instanceof RangeError
        ? 'Das Schema verweist auf sich selbst oder ist zu tief verschachtelt.'
        : grund instanceof Error
          ? grund.message
          : 'Die Datei konnte nicht als Schema des OneProof Formats gelesen werden.',
    )
  }
  let elemente = 0
  const zaehle = (knoten: { kinder?: OneProofKnoten[] }): void => {
    for (const kind of knoten.kinder ?? []) {
      elemente++
      zaehle(kind)
    }
  }
  zaehle(schema)

  return {
    format: 'oneproof',
    formatName: 'OneProof Format (JSON Schema)',
    schema,
    schemata,
    dateien: Object.fromEntries(schemata.alle.map((eines): [string, JsonSchema] => [`${ORDNER}/${dateiVon(eines.$id)}`, eines])),
    elemente,
    ableitung,
  }
}

/** A place of an application in the OneProof Format that asks for evidence. */
export interface OneProofStelle {
  position: string
  titel: string
  bereich: string
  herkunft: Herkunft
  nennt?: Frage
}

/** The places of an application type in the OneProof Format and how many of each kind. */
export interface OneProofAbleitung {
  stellen: OneProofStelle[]
  /** The places that ask when a question is answered with yes. */
  fragen: number
  /** The places that ask for each entry of a list. */
  listen: number
}

/**
 * The places of an application in the OneProof Format, in the order of the schema.
 *
 * @param schema   the compact form (`kompaktesSchema`)
 */
export function leiteOneProofStellenAb(schema: OneProofSchema): OneProofAbleitung {
  const stellen: OneProofStelle[] = []
  const fachdaten = schema.kinder.find((kind) => kind.id === '/fachdaten')
  const liste = (knoten: OneProofKnoten): OneProofKnoten | null => knoten.kinder?.find((kind) => kind.schluessel === 'eintraege')?.kinder?.[0] ?? null

  const laufe = (knoten: OneProofKnoten, bereich: string | null, inFrage: boolean): void => {
    for (const kind of knoten.kinder ?? []) {
      if (!kind.kinder) continue
      const hier = bereich ?? labelOf(kind)
      if (kind.thema) {
        const feld = `${kind.id}/vorhanden`
        const eintrag = liste(kind)
        stellen.push({
          position: eintrag?.id ?? kind.id,
          titel: labelOf(kind),
          bereich: hier,
          herkunft: { art: 'frage', feld },
          nennt: { feld, ja: ['true'], nein: ['false'] },
        })
        laufe(eintrag ?? kind, hier, true)
      } else if (kind.schluessel === '*' && !inFrage && !kind.eindeutig && knoten.eindeutig !== 'person') {
        stellen.push({ position: kind.id, titel: labelOf(knoten), bereich: hier, herkunft: { art: 'abschnitt' } })
        laufe(kind, hier, inFrage)
      } else {
        laufe(kind, hier, inFrage)
      }
    }
  }
  // The persons of the application have their sections in `fachdaten/personen`, by their own name.
  for (const kind of fachdaten?.kinder ?? []) {
    if (!fachdaten || !kind.kinder) continue
    if (kind.eindeutig === 'person') laufe(kind.kinder[0] ?? kind, labelOf(kind), false)
    // Each section on its own: below `fachdaten` as if it were its only child.
    else laufe({ ...fachdaten, kinder: [kind] }, null, false)
  }

  return {
    stellen,
    fragen: stellen.filter(({ herkunft }) => herkunft.art === 'frage').length,
    listen: stellen.filter(({ herkunft }) => herkunft.art === 'abschnitt').length,
  }
}
