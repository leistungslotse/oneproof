import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { EvidenceTypeSchema, JurisdictionSchema, PersonSchema } from './schema.ts'
import type { EvidenceType, Jurisdiction, Person, PersonQuery } from './schema.ts'

export interface Registry {
  readonly evidenceTypes: readonly EvidenceType[]
  readonly jurisdiction: Jurisdiction
  readonly persons: readonly Person[]
  /** An evidence type by id or by `key`. */
  evidenceType(idOrKey: string): EvidenceType | undefined
  /** The person a request names: family name, given name and date of birth must all match. */
  findPerson(query: PersonQuery): Person | undefined
}

async function read<T>(file: string, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    throw new Error(`${file}: not readable (${error instanceof Error ? error.message : String(error)})`, { cause: error })
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) throw new Error(`${file}:\n${z.prettifyError(parsed.error)}`)
  return parsed.data
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Reads `evidence-types.json`, `jurisdiction.json` and every file in `persons/`. A file that does not fit stops the start. */
export async function loadRegistry(dir: string): Promise<Registry> {
  const evidenceTypes = await read(join(dir, 'evidence-types.json'), z.array(EvidenceTypeSchema).min(1))
  const jurisdiction = await read(join(dir, 'jurisdiction.json'), JurisdictionSchema)
  const files = (await readdir(join(dir, 'persons'))).filter((file) => file.endsWith('.json')).sort()
  const keys = new Set(evidenceTypes.map((type) => type.key))

  const persons: Person[] = []
  for (const file of files) {
    const person = await read(join(dir, 'persons', file), PersonSchema)
    const unknown = Object.keys(person.evidence).filter((key) => !keys.has(key))
    if (unknown.length > 0) throw new Error(`persons/${file}: unknown evidence type ${unknown.join(', ')} (known: ${[...keys].join(', ')})`)
    persons.push(person)
  }

  return {
    evidenceTypes,
    jurisdiction,
    persons,
    evidenceType: (idOrKey) => evidenceTypes.find((type) => type.id === idOrKey || type.key === idOrKey),
    findPerson: ({ givenName, familyName, dateOfBirth }) =>
      persons.find((p) => same(p.familyName, familyName) && same(p.givenName, givenName) && p.dateOfBirth === dateOfBirth.slice(0, 10)),
  }
}
