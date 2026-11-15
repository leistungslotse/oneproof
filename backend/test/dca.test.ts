import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { COMPONENT_ID, start } from './helpers.ts'

const REQUEST = {
  dataConsumer: { name: 'Wohngeldstelle Auenthal', componentId: COMPONENT_ID },
  administrativeService: { id: '99107023000000', name: 'Wohngeld beantragen' },
  legalBasis: 'WoGG § 23',
  consent: true,
  subject: { givenName: 'Nora', familyName: 'Feldmann', dateOfBirth: '1994-03-14' },
  evidence: [
    { evidenceType: 'residenceCertificate' },
    { evidenceType: 'incomeTaxAssessment' },
    { evidenceType: 'childBenefitNotice' },
    { evidenceType: 'pensionStatement' },
  ],
}

describe('DCA facade', () => {
  let mock: Awaited<ReturnType<typeof start>>
  before(async () => {
    mock = await start()
  })
  after(() => mock.close())

  it('lists the evidence types and whether their registry is connected', async () => {
    const { json } = await mock.call('GET', '/dca/v1/evidence-types')
    assert.equal(json.length, 6)
    assert.equal(json.find((type: { key: string }) => type.key === 'childBenefitNotice').connected, false)
  })

  it('retrieves several evidence types in one call, each with its own outcome', async () => {
    const { status, json } = await mock.call('POST', '/dca/v1/evidence-requests', REQUEST)
    assert.equal(status, 200)
    assert.deepEqual(
      json.results.map((result: { status: string }) => result.status),
      ['delivered', 'delivered', 'registry_not_connected', 'not_found'],
    )
    assert.match(json.results[0].evidence.content, /<sample:street>Lindenweg 12</)
    assert.equal(json.results[0].steps[0].dataProvider, 'Meldebehörde Auenthal')
    assert.equal(json.results[1].evidence.issuingAuthority.name, 'Finanzamt Auenthal')
    assert.equal(JSON.parse(json.results[1].evidence.content).assessmentYear, 2025)
    assert.equal(json.results[3].error.code, '0403')
    assert.equal(json.takeover, 'pending')
  })

  it('retrieves nothing without consent or with fields missing', async () => {
    assert.equal((await mock.call('POST', '/dca/v1/evidence-requests', { ...REQUEST, consent: false })).status, 409)
    const empty = await mock.call('POST', '/dca/v1/evidence-requests', { subject: { givenName: 'Nora' } })
    assert.equal(empty.status, 422)
    assert.ok(empty.json.fields.includes('subject.dateOfBirth'))
  })

  it('reports a registry that is down for that retrieval only', async () => {
    const { json } = await mock.call('POST', '/dca/v1/evidence-requests', {
      ...REQUEST,
      scenario: 'registry-unreachable',
      evidence: [{ evidenceType: 'residenceCertificate' }],
    })
    assert.deepEqual([json.results[0].status, json.results[0].error.code], ['registry_unreachable', 'urn:noots:badgateway.unreachable'])
  })

  it('names an evidence type it does not know', async () => {
    const { json } = await mock.call('POST', '/dca/v1/evidence-requests', { ...REQUEST, evidence: [{ evidenceType: 'drivingLicence' }] })
    assert.equal(json.results[0].status, 'unknown_evidence_type')
  })
})

describe('HTTP', () => {
  let mock: Awaited<ReturnType<typeof start>>
  before(async () => {
    mock = await start()
  })
  after(() => mock.close())

  it('serves health, the reference page and the OpenAPI file', async () => {
    assert.deepEqual((await mock.call('GET', '/health')).json, { status: 'ok' })
    const page = await mock.call('GET', '/')
    assert.match(page.contentType ?? '', /text\/html/)
    assert.match(page.text, /openapi\.yaml/)
    assert.match((await mock.call('GET', '/openapi.yaml')).text, /^openapi: 3\.1\.0/)
  })

  it('answers unknown paths, a missing body and broken JSON with a clear error', async () => {
    assert.equal((await mock.call('GET', '/does-not-exist')).status, 404)
    assert.equal((await mock.call('POST', '/dca/v1/evidence-requests')).status, 422)
    const broken = await fetch(`${mock.base}/dca/v1/evidence-requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{no json',
    })
    assert.equal(broken.status, 400)
    assert.deepEqual(await broken.json(), { error: 'Invalid JSON' })
  })
})
