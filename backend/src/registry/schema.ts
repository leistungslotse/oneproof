import { z } from 'zod'

export const LEVELS = ['Low', 'Substantial', 'High'] as const
export const LevelOfAssuranceSchema = z.enum(LEVELS)

const PartySchema = z.strictObject({ id: z.guid(), name: z.string().min(1) })
const Localized = z.strictObject({ de: z.string().min(1), en: z.string().min(1) })

/** `provider: null` stands for a registry that is not connected to the NOOTS yet. */
export const EvidenceTypeSchema = z.strictObject({
  id: z.guid(),
  key: z.string().regex(/^[a-z][A-Za-z0-9]*$/),
  name: z.string().min(1),
  registry: z.string().min(1),
  levelOfAssurance: LevelOfAssuranceSchema,
  format: z.enum(['application/xml', 'application/json']),
  local: z.boolean(),
  provider: PartySchema.nullable(),
})

/** The jurisdiction parameter of evidence types with `local: true`, and the values the registry data navigation knows. */
export const JurisdictionSchema = z.strictObject({
  parameter: z.strictObject({ id: z.guid(), name: Localized, description: Localized }),
  values: z.array(z.strictObject({ value: z.string().regex(/^\d{12}$/), name: z.string().min(1) })).min(1),
})

/** One person and what the registries hold on them, keyed by `key` of the evidence type. */
export const PersonSchema = z.strictObject({
  givenName: z.string().min(1),
  familyName: z.string().min(1),
  dateOfBirth: z.iso.date(),
  ambiguous: z.boolean().default(false),
  evidence: z.record(z.string(), z.record(z.string(), z.json())).default({}),
})

export type LevelOfAssurance = z.infer<typeof LevelOfAssuranceSchema>
/** An authority by its component id and name. */
export type Party = z.infer<typeof PartySchema>
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>
export type Jurisdiction = z.infer<typeof JurisdictionSchema>
export type Person = z.infer<typeof PersonSchema>
export type EvidenceData = Person['evidence'][string]
export type Json = EvidenceData[string]
export interface PersonQuery {
  givenName: string
  familyName: string
  dateOfBirth: string
}
