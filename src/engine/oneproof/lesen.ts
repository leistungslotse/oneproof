/**
 * Reads an application in the OneProof Format (JSON).
 *
 * Reading only takes in what tells the benefit and the version: `standard`, `leistung.art` and
 * `version`. Whether the file is valid is decided against the schema of exactly that benefit and
 * version, which the profile holds ({@link inProfil}, with `pruefung.ts`).
 */

import { InstanceError } from '../fim/instanz.ts'
import type { Anhang } from '../fim/instanz.ts'
import { istObjekt } from '../json.ts'
import type { Json, JsonObjekt } from '../json.ts'
import type { Antragsart, Profil } from '../profil/laden.ts'
import { antragsartVon, istOneProofSchema } from './schema.ts'
import type { OneProofSchema } from './schema.ts'

export const STANDARD = 'oneproof-format'

export interface OneProofAntrag {
  format: 'oneproof'
  /** The application type: `oneproof:<leistung>`. */
  schemaId: string
  /** `wohngeld`. */
  leistung: string
  /** Of the schema of the benefit, `1.0`. */
  version: string
  /** The file, parsed. */
  daten: JsonObjekt
  /** The files the application announces (`anlagen`). */
  anhaenge: Anhang[]
}

/** Does the text look like JSON (and not like XML)? */
export const istJson = (text: string): boolean => /^\s*[{[]/.test(String(text ?? ''))

export function leseOneProofAntrag(text: string): OneProofAntrag {
  let daten: Json
  try {
    daten = JSON.parse(text)
  } catch {
    throw new InstanceError('Die Antragsdaten sind kein gültiges JSON.')
  }
  if (!istObjekt(daten)) {
    throw new InstanceError('Die Antragsdaten sind kein JSON-Objekt.')
  }
  if (daten.standard !== STANDARD) {
    throw new InstanceError(
      `Die JSON-Datei ist keine Antragsdatei im OneProof Format: „standard“ ist ${daten.standard === undefined ? 'nicht angegeben' : `„${daten.standard}“`}, erwartet wird „${STANDARD}“.`,
    )
  }
  const leistungRoh = daten.leistung
  const leistung = istObjekt(leistungRoh) ? leistungRoh.art : undefined
  if (typeof leistung !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(leistung)) {
    throw new InstanceError('Die Antragsdatei nennt unter „leistung.art“ keine Leistung.')
  }
  if (typeof daten.version !== 'string' || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(daten.version)) {
    throw new InstanceError('Die Antragsdatei nennt unter „version“ keine Version wie „1.0“.')
  }

  const anhaenge: Anhang[] = []
  for (const anlage of Array.isArray(daten.anlagen) ? daten.anlagen : []) {
    if (!istObjekt(anlage) || typeof anlage.dateiname !== 'string') continue
    anhaenge.push({
      id: anlage.dateiname,
      name: anlage.dateiname,
      contentType: typeof anlage.mimeType === 'string' ? anlage.mimeType : '',
      length: null,
    })
  }

  return { format: 'oneproof', schemaId: antragsartVon(leistung), leistung, version: daten.version, daten, anhaenge }
}

/** An application in the OneProof Format as the profile reads it: its application type and the compact schema. */
export interface InProfilErgebnis {
  instanz: OneProofAntrag
  antragsart: Antragsart
  schema: OneProofSchema
  hinweise: string[]
}

/**
 * The application type of the profile an application in the OneProof Format belongs to, and its
 * schema — if the file is valid against it. A file with errors is not read at all.
 */
export async function inProfil(antrag: OneProofAntrag, profil: Profil): Promise<InProfilErgebnis> {
  const antragsart = profil.antragsarten.find((kandidat) => kandidat.schema === antrag.schemaId)
  if (!antragsart) {
    const bekannt = profil.antragsarten.map((kandidat) => kandidat.schema).join(', ')
    throw new InstanceError(`Die Antragsdatei ist ein Antrag auf „${antrag.leistung}“ im OneProof Format. Das Profil „${profil.name}“ deckt ${bekannt} ab.`)
  }
  if (antrag.version !== antragsart.version) {
    throw new InstanceError(
      `Die Antragsdatei liegt in Version ${antrag.version} des OneProof Formats für „${antrag.leistung}“ vor. Unterstützt wird die Version ${antragsart.version}.`,
    )
  }

  const [schemata, schema] = await Promise.all([profil.ladeJsonSchema(antragsart.schema), profil.ladeSchema(antragsart.schema)])
  // Cannot happen: the application type exists, and it is one of the OneProof Format if the profile loads its JSON Schema.
  if (!schemata || !schema || !istOneProofSchema(schema)) throw new Error(`Das Schema der Antragsart ${antragsart.schema} liegt nicht im OneProof Format vor.`)
  // Loaded with the first application in this format: the check brings Ajv, which is more than the
  // rest of the check page together, and an application in FIM never needs it.
  const { fehlerText, pruefeAntrag } = await import('./pruefung.ts')
  const fehler = pruefeAntrag(antrag.daten, schemata, schema)
  if (fehler.length > 0) {
    const meldung = new InstanceError(`Die Antragsdatei entspricht nicht dem Schema „${schemata.haupt.$id}“. ${fehlerText(fehler)}`)
    meldung.fehler = fehler
    throw meldung
  }
  return { instanz: antrag, antragsart, schema, hinweise: [] }
}
