import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { PersonQuery } from '../src/registry/schema.ts'
import { buildRequest, parseResponse, SPECIFICATION } from '../src/xnachweis/xnachweis.ts'
import { COMPONENT_ID, REQUEST_TOKEN, start } from './helpers.ts'

const MILA = { givenName: 'Mila', familyName: 'Feldmann', dateOfBirth: '2026-08-02' }
const NORA = { givenName: 'Nora', familyName: 'Feldmann', dateOfBirth: '1994-03-14' }

describe('SAK-DC Consumer API v3', () => {
  let mock: Awaited<ReturnType<typeof start>>
  let regionalKey: Record<string, string>
  before(async () => {
    mock = await start()
    const { parameter, values } = mock.registry.jurisdiction
    regionalKey = { [parameter.id]: values[0]?.value ?? '' }
  })
  after(() => mock.close())

  async function authorize() {
    const { json } = await mock.sak('POST', '/token', { request_token: REQUEST_TOKEN })
    return { authorization: `Bearer ${json.access_token}` }
  }

  async function retrieve(
    key: string,
    person: PersonQuery,
    { levelOfAssurance = 'High', scenario }: { levelOfAssurance?: string; scenario?: string } = {},
  ) {
    const headers = await authorize()
    const type = mock.type(key)
    const jurisdiction = await mock.sak(
      'POST',
      '/de/jurisdiction',
      { evidence_type: type.id, ...(type.local ? { jurisdiction_value: regionalKey } : {}) },
      headers,
    )
    const xml = buildRequest({
      consumer: { id: COMPONENT_ID, name: 'Wohngeldstelle Auenthal' },
      provider: type.provider,
      type,
      person,
      levelOfAssurance,
      legalBasis: 'WoGG § 23',
    })
    return mock.sak(
      'POST',
      '/de/evidence',
      {
        jurisdiction_token: jurisdiction.text,
        legal_basis: 'WoGG § 23',
        evidence_request: {
          mime_type: 'application/xml',
          specification_identifier: SPECIFICATION,
          message_type: 'evidenceRequest',
          use_idnr: false,
          data: Buffer.from(xml).toString('base64'),
        },
      },
      { ...headers, ...(scenario ? { 'x-mock-scenario': scenario } : {}) },
    )
  }

  it('wants a traceparent on every call', async () => {
    const without = await mock.call('POST', '/sakdc/api/v3/token', { request_token: REQUEST_TOKEN })
    assert.equal(without.status, 400)
    assert.equal(without.json.type, 'urn:noots:traceparent.missing')
    assert.match(without.contentType ?? '', /application\/problem\+json/)
    assert.equal((await mock.sak('POST', '/token', {}, { traceparent: 'x' })).json.type, 'urn:noots:traceparent.invalid')
  })

  it('issues an access token for a request token and refuses calls without one', async () => {
    const { status, json } = await mock.sak('POST', '/token', { request_token: REQUEST_TOKEN })
    assert.equal(status, 200)
    assert.deepEqual([json.token_type, json.expires_in], ['Bearer', 300])
    assert.equal((await mock.sak('POST', '/token', {})).json.type, 'urn:noots:request_token.missing')
    assert.equal((await mock.sak('POST', '/token', { request_token: 'a.b.c' })).json.type, 'urn:noots:request_token.invalid')
    const without = await mock.sak('POST', '/de/jurisdiction', { evidence_type: mock.type('birthCertificate').id })
    assert.deepEqual([without.status, without.json.type], [401, 'urn:noots:unauthorized'])
    assert.equal((await mock.sak('POST', '/de/jurisdiction', {}, { authorization: 'Bearer a.b.c' })).status, 401)
  })

  it('names the data provider in a jurisdiction token, or says there is none', async () => {
    const headers = await authorize()
    const type = mock.type('birthCertificate')
    const parameterId = Object.keys(regionalKey)[0] ?? ''
    const jurisdiction = await mock.sak('POST', '/de/jurisdiction', { evidence_type: type.id, jurisdiction_value: regionalKey }, headers)
    assert.equal(jurisdiction.status, 200)
    assert.match(jurisdiction.contentType ?? '', /application\/jwt/)
    const payload = JSON.parse(Buffer.from(jurisdiction.text.split('.')[1] ?? '', 'base64url').toString())
    assert.deepEqual([payload.name, payload.aud, payload.evidence_type.name], ['Standesamt Auenthal', COMPONENT_ID, 'Geburtsurkunde'])

    assert.equal(
      (await mock.sak('POST', '/de/jurisdiction', { evidence_type: type.id }, headers)).json.type,
      'urn:noots:jurisdictionparameters.missing',
    )
    const foreign = await mock.sak(
      'POST',
      '/de/jurisdiction',
      { evidence_type: type.id, jurisdiction_value: { [parameterId]: '000000000000' } },
      headers,
    )
    assert.deepEqual([foreign.status, foreign.json.type], [422, 'urn:noots:jurisdictionparameter_value.unknown'])
    assert.equal(
      (await mock.sak('POST', '/de/jurisdiction', { evidence_type: 'Geburtsurkunde' }, headers)).json.type,
      'urn:noots:evidencetype.invalid',
    )
    const childBenefit = await mock.sak(
      'POST',
      '/de/jurisdiction',
      { evidence_type: mock.registry.evidenceType('childBenefitNotice')?.id },
      headers,
    )
    assert.deepEqual(
      [childBenefit.status, childBenefit.json.type, childBenefit.json.error_source],
      [404, 'urn:noots:no_data_provider.found', 'RDN'],
    )
    const parameters = await mock.sak('GET', `/de/jurisdiction-parameters/${type.id}`, undefined, headers)
    assert.equal(parameters.json.jurisdiction_parameters[0].id, parameterId)
  })

  it('delivers the evidence as an XNachweis response', async () => {
    const { status, json } = await retrieve('birthCertificate', MILA)
    assert.equal(status, 200)
    assert.equal(json.message_type, 'evidenceResponse')
    const parsed = parseResponse(Buffer.from(json.data, 'base64').toString())
    assert.ok(parsed && 'evidence' in parsed)
    assert.equal(parsed.evidence.issuingAuthority.name, 'Standesamt Auenthal')
    assert.equal(parsed.evidence.format, 'application/xml')
    assert.match(parsed.evidence.content, /<sample:registerNumber>G 388\/2026</)
  })

  it('answers with an XNachweis error and HTTP 200 where the registry cannot deliver', async () => {
    const code = async (...args: Parameters<typeof retrieve>) => {
      const { status, json } = await retrieve(...args)
      assert.deepEqual([status, json.message_type], [200, 'evidenceErrorResponse'])
      const parsed = parseResponse(Buffer.from(json.data, 'base64').toString())
      assert.ok(parsed && 'error' in parsed)
      return parsed.error.code
    }
    assert.equal(await code('birthCertificate', { givenName: 'Niemand', familyName: 'Unbekannt', dateOfBirth: '1990-01-01' }), '0403')
    assert.equal(await code('residenceCertificate', { givenName: 'Alex', familyName: 'Doppelt', dateOfBirth: '1985-01-01' }), '0402')
    assert.equal(await code('incomeTaxAssessment', NORA, { levelOfAssurance: 'Substantial' }), '0305')
  })

  it('answers with an HTTP error where the way to the registry fails', async () => {
    const down = await retrieve('residenceCertificate', NORA, { scenario: 'registry-unreachable' })
    assert.deepEqual([down.status, down.json.type, down.json.error_source], [502, 'urn:noots:badgateway.unreachable', 'SAK-DP'])
    assert.equal((await retrieve('residenceCertificate', NORA, { scenario: 'timeout' })).status, 504)
  })

  it('refuses a request that is no XNachweis or asks with an identification number', async () => {
    const headers = await authorize()
    const type = mock.type('residenceCertificate')
    const jurisdictionToken = (
      await mock.sak('POST', '/de/jurisdiction', { evidence_type: type.id, jurisdiction_value: regionalKey }, headers)
    ).text
    const send = (evidence_request: object) =>
      mock.sak('POST', '/de/evidence', { jurisdiction_token: jurisdictionToken, legal_basis: 'WoGG § 23', evidence_request }, headers)
    const frame = {
      mime_type: 'application/xml',
      specification_identifier: SPECIFICATION,
      message_type: 'evidenceRequest',
      use_idnr: false,
    }

    assert.equal((await send({ ...frame, data: Buffer.from('<no-xnachweis/>').toString('base64') })).json.type, 'urn:noots:data.invalid')
    assert.equal((await send({ ...frame, use_idnr: true, data: 'eA==' })).json.type, 'urn:noots:useidnr.unavailable')
    assert.equal(
      (await mock.sak('POST', '/de/evidence', { legal_basis: 'WoGG § 23' }, headers)).json.type,
      'urn:noots:jurisdiction_token.missing',
    )
  })
})
