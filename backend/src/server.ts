import { pino } from 'pino'
import { createApp } from './app.ts'
import { readConfig } from './config.ts'
import { loadRegistry } from './registry/load.ts'
import { createTokens } from './shared/tokens.ts'

const config = readConfig()
const logger = pino({ level: config.LOG_LEVEL, redact: ['req.headers.authorization', 'req.headers.cookie'] })

const registry = await loadRegistry(config.DATA_DIR)
const app = createApp({ registry, tokens: await createTokens(), logger })

const server = app.listen(config.PORT, (error) => {
  if (error) throw error
  logger.info({ port: config.PORT, persons: registry.persons.length, evidenceTypes: registry.evidenceTypes.length }, 'NOOTS mock listening')
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    logger.info({ signal }, 'Shutting down')
    server.close(() => process.exit(0))
    server.closeIdleConnections()
  })
}
