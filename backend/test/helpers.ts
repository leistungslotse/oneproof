import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { pino } from 'pino'
import { createApp } from '../src/app.ts'
import { ROOT } from '../src/config.ts'
import { loadRegistry } from '../src/registry/load.ts'
import type { EvidenceType, Party } from '../src/registry/schema.ts'
import { createTokens } from '../src/shared/tokens.ts'

export const DATA = join(ROOT, 'data')
export const TRACE = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'
export const COMPONENT_ID = '550e8400-e29b-41d4-a716-446655440000'

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
/** A request token as a data consumer would send it. The mock reads it without verifying the seal. */
export const REQUEST_TOKEN = `${base64url({ alg: 'ES256', typ: 'JWT' })}.${base64url({ iss: 'C=DE, O=Landkreis Auenthal, OU=Wohngeldstelle', sub: COMPONENT_ID, aud: 'NOOTS IAM', ver: 'v2', nonce: 1 })}.c2VhbA`

export interface Reply {
  status: number
  contentType: string | null
  text: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any
}

/** The mock on a free port, with the registries from `dir`. */
export async function start(dir = DATA) {
  const registry = await loadRegistry(dir)
  const app = createApp({ registry, tokens: await createTokens(), logger: pino({ level: 'silent' }) })
  const server = app.listen(0)
  await new Promise((done) => server.once('listening', done))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> => {
    const response = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await response.text()
    return {
      status: response.status,
      contentType: response.headers.get('content-type'),
      text,
      json: /^[{[]/.test(text) ? JSON.parse(text) : null,
    }
  }

  return {
    base,
    registry,
    call,
    /** A call of the SAK API, with the trace header it demands. */
    sak: (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
      call(method, `/sakdc/api/v3${path}`, body, { traceparent: TRACE, ...headers }),
    /** An evidence type whose registry is connected. */
    type(key: string): EvidenceType & { provider: Party } {
      const type = registry.evidenceType(key)
      if (!type?.provider) throw new Error(`No connected evidence type ${key}`)
      return { ...type, provider: type.provider }
    },
    close: () => new Promise((done) => server.close(done)),
  }
}
