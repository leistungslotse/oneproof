import { Router } from 'express'
import { EvidenceRequestSchema } from './schema.ts'
import type { Dca } from './service.ts'

export function dcaRouter(dca: Dca): Router {
  const router = Router()

  router.get('/evidence-types', (_req, res) => {
    res.json(dca.evidenceTypes())
  })

  router.post('/evidence-requests', async (req, res) => {
    const parsed = EvidenceRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))]
      res.status(422).json({ error: 'Required fields are missing or invalid', fields })
      return
    }
    if (!parsed.data.consent) {
      res.status(409).json({ error: 'No evidence is retrieved without the consent of the applicant.', fields: ['consent'] })
      return
    }
    res.json(await dca.requestEvidence(parsed.data))
  })

  return router
}
