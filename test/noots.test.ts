import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { outcomeOf, retrieveFromRegisters } from '../src/noots.ts'
import type { NootsFetchInit, RegisterResult } from '../src/noots.ts'
import { REQUIREMENTS } from '../src/scenario.ts'
import type { RegisterRequirement } from '../src/scenario.ts'

const REGISTER = REQUIREMENTS.filter((item): item is RegisterRequirement => item.register !== undefined)

/** What the page sends for one call: only what these tests read. */
interface Abruf {
  subject: { givenName: string }
  consent: boolean
  evidence: { evidenceType: string }[]
}

/** An answer of the mock for one call, with the given status for every evidence type asked for. */
const answer = (status: RegisterResult['status']) => async (_url: string, { body }: NootsFetchInit): Promise<Response> => {
  const { evidence }: Abruf = JSON.parse(body)
  const results = evidence.map(({ evidenceType }) => ({
    evidenceType: { key: evidenceType, name: 'Meldebescheinigung' },
    registry: 'Melderegister',
    status,
    evidence: { issuingAuthority: { name: 'Meldebehörde Auenthal' } },
  }))
  return new Response(JSON.stringify({ timestamp: '2026-11-15T16:42:00.000Z', results }), { status: 200 })
}

describe('NOOTS-Abruf im Dummy', () => {
  it('turns a delivered evidence into an established requirement with its source', () => {
    const outcome = outcomeOf(
      { status: 'delivered', registry: 'Melderegister', evidenceType: { name: 'Meldebescheinigung' }, evidence: { issuingAuthority: { name: 'Meldebehörde Auenthal' } } },
      '2026-11-15T16:42:00.000Z',
    )
    assert.deepEqual(outcome, {
      status: 'belegt',
      register: 'delivered',
      source: 'NOOTS-Abruf · Melderegister',
      sourceDetail: 'Meldebehörde Auenthal, abgerufen am 15. November 2026 um 17:42 Uhr',
      evidenceType: 'Meldebescheinigung (XNachweis 2.0)',
    })
  })

  it('leaves a requirement with the applicant where the registry does not deliver, and says why', () => {
    assert.deepEqual(outcomeOf({ status: 'ambiguous' }), { status: 'offen', register: 'failed', registerNote: 'Das Register konnte die Person nicht eindeutig zuordnen.' })
    assert.equal(outcomeOf({ status: 'registry_not_connected' }).registerNote, 'Dieses Register ist noch nicht an das NOOTS angeschlossen.')
    assert.equal(outcomeOf(null).registerNote, 'Die Registerabfrage war nicht möglich.')
  })

  it('asks once per person and answers for every requirement that names a registry', async () => {
    const calls: [string, Abruf][] = []
    const fetch = (url: string, init: NootsFetchInit): Promise<Response> => {
      calls.push([url, JSON.parse(init.body)])
      return answer('delivered')(url, init)
    }
    const outcomes = await retrieveFromRegisters(REGISTER, { fetch })

    assert.deepEqual(outcomes.map(([id, outcome]) => [id, outcome.status]), [
      ['geburt', 'belegt'],
      ['wohnung', 'belegt'],
      ['idnr', 'belegt'],
    ])
    assert.deepEqual(
      calls.map(([url, body]) => [url, body.subject.givenName, body.consent, body.evidence.map((entry) => entry.evidenceType)]),
      [
        ['/noots/dca/v1/evidence-requests', 'Mila', true, ['birthCertificate']],
        ['/noots/dca/v1/evidence-requests', 'Nora', true, ['residenceCertificate', 'taxIdentificationNumber']],
      ],
    )
  })

  it('never rejects: without a backend every requirement falls to the applicant', async () => {
    const down = await retrieveFromRegisters(REGISTER, { fetch: () => Promise.reject(new TypeError('fetch failed')) })
    assert.deepEqual(down.map(([, outcome]) => outcome.register), ['failed', 'failed', 'failed'])
    const refused = await retrieveFromRegisters(REGISTER, { fetch: async () => new Response('', { status: 502 }) })
    assert.ok(refused.every(([, outcome]) => outcome.status === 'offen'))
  })

  it('gives every such requirement a hint and a step for the upload that then replaces the registry', () => {
    for (const item of REGISTER) assert.ok(item.hint && item.steps?.length > 0, item.id)
  })
})
