import { z } from 'zod'
import { LevelOfAssuranceSchema } from '../registry/schema.ts'
import { SCENARIOS } from '../sak/service.ts'

/** What the online service sends for one retrieval. */
export const EvidenceRequestSchema = z.object({
  dataConsumer: z.object({ name: z.string().min(1).default('Data Consumer'), componentId: z.guid().optional() }),
  administrativeService: z.object({ id: z.string().min(1), name: z.string().min(1) }).optional(),
  legalBasis: z.string().trim().min(2),
  consent: z.boolean(),
  levelOfAssurance: LevelOfAssuranceSchema.default('High'),
  subject: z.object({ givenName: z.string().min(1), familyName: z.string().min(1), dateOfBirth: z.iso.date() }),
  jurisdiction: z.object({ regionalKey: z.string().min(1) }).optional(),
  evidence: z.array(z.object({ evidenceType: z.string().min(1) })).min(1),
  scenario: z.enum(SCENARIOS).optional(),
})

export type EvidenceRequest = z.infer<typeof EvidenceRequestSchema>
