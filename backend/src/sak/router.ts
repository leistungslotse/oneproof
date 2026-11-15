import { Router } from 'express'
import type { ErrorRequestHandler } from 'express'
import { assertTraceparent, Problem } from '../shared/problem.ts'
import type { Sak } from './service.ts'

export function sakRouter(sak: Sak): Router {
  const router = Router()

  router.use((req, _res, next) => {
    assertTraceparent(req.get('traceparent'))
    next()
  })

  router.post('/token', async (req, res) => {
    res.json(await sak.token(req.body))
  })

  router.get('/de/jurisdiction-parameters/:evidenceType', async (req, res) => {
    await sak.consumerFrom(req.get('authorization'))
    res.json(sak.jurisdictionParameters(req.params.evidenceType))
  })

  router.post('/de/jurisdiction', async (req, res) => {
    const consumer = await sak.consumerFrom(req.get('authorization'))
    res.type('application/jwt').send(await sak.jurisdiction(req.body, consumer))
  })

  router.post('/de/evidence', async (req, res) => {
    const consumer = await sak.consumerFrom(req.get('authorization'))
    res.json(await sak.evidence(req.body, consumer, req.get('x-mock-scenario')))
  })

  // NOOTS errors leave as RFC 9457 problem details; `instance` is the path as the SAK itself would name it.
  const problemHandler: ErrorRequestHandler = (error: unknown, req, res, next) => {
    if (!(error instanceof Problem)) {
      next(error)
      return
    }
    res
      .status(error.status)
      .type('application/problem+json')
      .json(error.body(`/api/v3${req.path}`, req.get('traceparent')))
  }
  router.use(problemHandler)

  return router
}
