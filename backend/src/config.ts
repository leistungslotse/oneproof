import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

/** Project root: one level above `src/` and above `dist/` alike. */
export const ROOT = fileURLToPath(new URL('../', import.meta.url))

const Environment = z.object({
  PORT: z.coerce.number().int().min(0).max(65535).default(8787),
  DATA_DIR: z.string().min(1).default(join(ROOT, 'data')),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
})

export type Config = z.infer<typeof Environment>

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Environment.safeParse(env)
  if (!parsed.success) throw new Error(`Invalid environment variables:\n${z.prettifyError(parsed.error)}`)
  return parsed.data
}
