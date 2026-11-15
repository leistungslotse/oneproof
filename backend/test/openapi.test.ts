import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { parse } from 'yaml'
import { ROOT } from '../src/config.ts'
import { parseResponse } from '../src/xnachweis/xnachweis.ts'
import { start, TRACE } from './helpers.ts'

/** What each example of `POST /dca/v1/evidence-requests` must lead to: the HTTP status, or the outcome per evidence type. */
const EXPECTED: Record<string, number | string[]> = {
  delivered: ['delivered', 'delivered', 'registry_not_connected'],
  pension: ['delivered', 'delivered'],
  ambiguous: ['ambiguous'],
  notFound: ['not_found'],
  levelOfAssuranceTooLow: ['level_of_assurance_too_low'],
  registryUnreachable: ['registry_unreachable'],
  noConsent: 409,
}

describe('Examples in openapi.yaml', () => {
  let mock: Awaited<ReturnType<typeof start>>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let document: any
  const requestBody = (path: string) => document.paths[path].post.requestBody.content['application/json']

  before(async () => {
    mock = await start()
    document = parse(await readFile(join(ROOT, 'openapi.yaml'), 'utf8'))
  })
  after(() => mock.close())

  it('lead the facade to the outcome their title promises', async () => {
    const examples = requestBody('/dca/v1/evidence-requests').examples
    assert.deepEqual(Object.keys(examples).sort(), Object.keys(EXPECTED).sort())
    for (const [name, expected] of Object.entries(EXPECTED)) {
      const { status, json } = await mock.call('POST', '/dca/v1/evidence-requests', examples[name].value)
      if (typeof expected === 'number') assert.equal(status, expected, name)
      else assert.deepEqual([status, json.results.map((result: { status: string }) => result.status)], [200, expected], name)
    }
  })

  it('run the three steps of the SAK API one after the other', async () => {
    const access = await mock.sak('POST', '/token', requestBody('/sakdc/api/v3/token').example)
    assert.equal(access.status, 200)
    const headers = { authorization: `Bearer ${access.json.access_token}` }

    const examples = requestBody('/sakdc/api/v3/de/jurisdiction').examples
    const jurisdiction = await mock.sak('POST', '/de/jurisdiction', examples.residenceCertificate.value, headers)
    assert.equal(jurisdiction.status, 200)
    assert.equal((await mock.sak('POST', '/de/jurisdiction', examples.pensionStatement.value, headers)).status, 200)
    assert.equal((await mock.sak('POST', '/de/jurisdiction', examples.notConnected.value, headers)).status, 404)

    const request = { ...requestBody('/sakdc/api/v3/de/evidence').example, jurisdiction_token: jurisdiction.text }
    const evidence = await mock.sak('POST', '/de/evidence', request, headers)
    assert.deepEqual([evidence.status, evidence.json.message_type], [200, 'evidenceResponse'])
    const parsed = parseResponse(Buffer.from(evidence.json.data, 'base64').toString())
    assert.ok(parsed && 'evidence' in parsed)
    assert.match(parsed.evidence.content, /Lindenweg 12/)
  })

  it('name a traceparent the SAK API accepts and only paths the mock serves', async () => {
    assert.equal(document.components.parameters.traceparent.example, TRACE)
    for (const [path, methods] of Object.entries(document.paths)) {
      if (!('get' in (methods as object)) || path.includes('{')) continue
      assert.equal((await mock.call('GET', path)).status, 200, path)
    }
  })
})
