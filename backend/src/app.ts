import { join } from 'node:path'
import { apiReference } from '@scalar/express-api-reference'
import cors from 'cors'
import express from 'express'
import type { ErrorRequestHandler, Express } from 'express'
import helmet from 'helmet'
import type { Logger } from 'pino'
import { pinoHttp } from 'pino-http'
import { ROOT } from './config.ts'
import { dcaRouter } from './dca/router.ts'
import { createDca } from './dca/service.ts'
import type { Registry } from './registry/load.ts'
import { sakRouter } from './sak/router.ts'
import { createSak } from './sak/service.ts'
import type { Tokens } from './shared/tokens.ts'

export interface Dependencies {
  registry: Registry
  tokens: Tokens
  logger: Logger
}

const SAK = '/sakdc/api/v3'

export function createApp({ registry, tokens, logger }: Dependencies): Express {
  const sak = createSak(registry, tokens)
  const dca = createDca(registry, sak)
  const app = express()

  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }))
  // No CSP: the reference page loads Scalar from a CDN. No HSTS: TLS is the proxy's business.
  app.use(helmet({ contentSecurityPolicy: false, strictTransportSecurity: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }))
  app.use(
    cors({ methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['content-type', 'authorization', 'traceparent', 'x-mock-scenario'] }),
  )
  app.use(express.json({ limit: '2mb' }))

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })
  app.get('/openapi.yaml', (_req, res) => {
    res.sendFile(join(ROOT, 'openapi.yaml'))
  })
  // The reference is the front page: every operation can be sent to this mock from there. Nothing leaves for Scalar's services.
  app.get(
    '/',
    apiReference({
      url: 'openapi.yaml',
      pageTitle: 'NOOTS-Mock',
      showDeveloperTools: 'never',
      telemetry: false,
      agent: { disabled: true },
    }),
  )

  // Mock only: who the registries know. No real interface lists people.
  app.get('/mock/persons', (_req, res) => {
    res.json(
      registry.persons.map(({ givenName, familyName, dateOfBirth, ambiguous, evidence }) => ({
        givenName,
        familyName,
        dateOfBirth,
        ambiguous,
        evidence: Object.keys(evidence),
      })),
    )
  })
  app.use('/dca/v1', dcaRouter(dca))
  app.use(SAK, sakRouter(sak))

  app.use((_req, res) => {
    res.status(404).json({
      error: 'Unknown path',
      paths: ['/', '/dca/v1/evidence-types', '/dca/v1/evidence-requests', `${SAK}/token`, `${SAK}/de/jurisdiction`, `${SAK}/de/evidence`],
    })
  })

  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, next) => {
    if (res.headersSent) {
      next(error)
      return
    }
    // body-parser marks what the client got wrong with a 4xx status.
    const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined
    if (typeof status === 'number' && status >= 400 && status < 500) {
      res.status(status).json({ error: status === 413 ? 'Request too large' : 'Invalid JSON' })
      return
    }
    logger.error({ err: error }, 'Unhandled error')
    res.status(500).json({ error: 'Internal error' })
  }
  app.use(errorHandler)

  return app
}
