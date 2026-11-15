/**
 * Brings an application into the schema version the profile is written against.
 *
 * The profile addresses positions by the ids of the current schema version. An application in an
 * older version is read through the dictionary the publisher of the schema delivers for it
 * (here: 1.6.1 → 1.7.0, "Mapping" of the FIM Wohngeld standard). The nesting is the same in both
 * versions for every application the dictionary covers; the check in `test/fim/` verifies this
 * with a real application.
 */

import type { Antragsart, Profil } from '../profil/laden.ts'
import { InstanceError, renameIds } from './instanz.ts'
import type { Instance, Node } from './instanz.ts'
import type { Schema } from './schema.ts'

/** An application in the schema version of the profile, with the application type and schema it belongs to. */
export interface InSchemaVersionErgebnis {
  instanz: Instance
  antragsart: Antragsart
  schema: Schema
  hinweise: string[]
}

export async function inSchemaVersion(instanz: Instance, profil: Profil): Promise<InSchemaVersionErgebnis> {
  const antragsart = profil.antragsarten.find((kandidat) => kandidat.schema === instanz.schemaId)
  if (!antragsart) {
    const bekannt = profil.antragsarten.map((kandidat) => kandidat.schema).join(', ')
    throw new InstanceError(
      `Die Antragsdaten gehören zum Schema ${instanz.schemaId}. Das Profil „${profil.name}“ deckt ${bekannt} ab.`,
    )
  }

  const schema = await profil.ladeSchema(antragsart.schema)
  // Cannot happen: the profile has the application type, as the search above found it.
  if (!schema) throw new Error(`Das Schema der Antragsart ${antragsart.schema} fehlt.`)
  const hinweise: string[] = []

  if (instanz.version === antragsart.version) {
    return { instanz, antragsart, schema, hinweise }
  }

  const abbildung = await profil.ladeAbbildung(antragsart.schema, instanz.version)
  if (!abbildung) {
    const unterstuetzt = [antragsart.version, ...Object.keys(antragsart.abbildungen ?? {})].join(' und ')
    throw new InstanceError(
      `Die Antragsdaten liegen in Version ${instanz.version} des Schemas ${instanz.schemaId} vor. ` +
        `Unterstützt werden die Versionen ${unterstuetzt}.`,
    )
  }

  hinweise.push(
    `Die Antragsdaten liegen in Version ${instanz.version} vor und wurden mit der Abbildung des Herausgebers ` +
      `in Version ${antragsart.version} gelesen.`,
  )

  const umbenannt = renameIds(instanz.root, abbildung)
  const werte = profil.werteAbbildung?.(instanz.version) ?? {}

  return {
    instanz: {
      ...instanz,
      root: Object.keys(werte).length > 0 ? mitNeuenWerten(umbenannt, werte) : umbenannt,
      version: antragsart.version,
      urspruenglicheVersion: instanz.version,
    },
    antragsart,
    schema,
    hinweise,
  }
}

/**
 * Translates the values of fields whose code list changed between the versions (the dictionary of
 * the publisher renames fields only): `{F60000000352: {"04": "004"}}`. Applied after renaming, so
 * the profile names the field by its current id.
 */
export function mitNeuenWerten(knoten: Node, werte: Record<string, Record<string, string>>): Node {
  const tabelle = werte[knoten.id]
  const text = (knoten.children.length === 0 && tabelle && Object.hasOwn(tabelle, knoten.text) ? tabelle[knoten.text] : undefined) ?? knoten.text
  return { ...knoten, text, children: knoten.children.map((kind) => mitNeuenWerten(kind, werte)) }
}
