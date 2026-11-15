// A JSON facade in the shape the FITKO sketches for the Data Consumer Adapter: the online service names person and
// evidence types, the adapter runs token, jurisdiction and evidence against the SAK and answers with the documents
// and the metadata that matter. The DCA interface is not published; paths and field names here are our own.
import { randomBytes, randomUUID } from 'node:crypto'
import type { Registry } from '../registry/load.ts'
import type { EvidenceType } from '../registry/schema.ts'
import type { Consumer, Sak } from '../sak/service.ts'
import { asString } from '../shared/input.ts'
import { Problem } from '../shared/problem.ts'
import { decodeToken, nowSeconds } from '../shared/tokens.ts'
import { buildRequest, parseResponse, SPECIFICATION } from '../xnachweis/xnachweis.ts'
import type { ParsedEvidence } from '../xnachweis/xnachweis.ts'
import type { EvidenceRequest } from './schema.ts'

export type ResultStatus =
  | 'delivered'
  | 'not_found'
  | 'ambiguous'
  | 'level_of_assurance_too_low'
  | 'registry_not_connected'
  | 'registry_unreachable'
  | 'rejected'
  | 'unknown_evidence_type'
  | 'error'

const STATUS_BY_CODE: Record<string, ResultStatus> = { '0305': 'level_of_assurance_too_low', '0402': 'ambiguous', '0403': 'not_found' }

export interface Step {
  step: string
  status: number
  dataProvider?: string
  messageType?: string
  problem?: string
}

export interface Result {
  evidenceType: { id: string; key?: string; name?: string }
  registry?: string
  status: ResultStatus
  evidence?: ParsedEvidence
  /** The complete XNachweis response, Base64. */
  xnachweis?: string
  error?: { source: string; code: string; detail: string | null }
  steps: Step[]
}

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')

export function createDca(registry: Registry, sak: Sak) {
  /** One retrieval through the steps of the SAK, with what happened at each. */
  async function retrieve(type: EvidenceType, input: EvidenceRequest, consumer: Consumer): Promise<Result> {
    const steps: Step[] = []
    const base = { evidenceType: { id: type.id, key: type.key, name: type.name }, registry: type.registry }
    const regionalKey = input.jurisdiction?.regionalKey ?? registry.jurisdiction.values.at(0)?.value
    try {
      const jurisdictionToken = await sak.jurisdiction(
        { evidence_type: type.id, ...(type.local ? { jurisdiction_value: { [registry.jurisdiction.parameter.id]: regionalKey } } : {}) },
        consumer,
      )
      // The adapter learns from the jurisdiction token which data provider is in charge.
      const jurisdiction = decodeToken(jurisdictionToken)
      const provider = { id: jurisdiction?.sub ?? '', name: asString(jurisdiction?.name) ?? '' }
      steps.push({ step: 'POST /de/jurisdiction', status: 200, dataProvider: provider.name })

      const xml = buildRequest({
        consumer,
        provider,
        type,
        person: input.subject,
        levelOfAssurance: input.levelOfAssurance,
        legalBasis: input.legalBasis,
      })
      const response = await sak.evidence(
        {
          jurisdiction_token: jurisdictionToken,
          legal_basis: input.legalBasis,
          ...(input.administrativeService ? { adm_services: [input.administrativeService] } : {}),
          evidence_request: {
            mime_type: 'application/xml',
            specification_identifier: SPECIFICATION,
            message_type: 'evidenceRequest',
            use_idnr: false,
            data: Buffer.from(xml).toString('base64'),
          },
        },
        consumer,
        input.scenario,
      )
      steps.push({ step: 'POST /de/evidence', status: 200, messageType: response.message_type })

      const parsed = parseResponse(Buffer.from(response.data, 'base64').toString('utf8'))
      if (!parsed) {
        return {
          ...base,
          status: 'error',
          error: { source: 'Data Provider', code: 'unreadable', detail: 'The registry did not answer with an XNachweis response.' },
          steps,
        }
      }
      if ('error' in parsed)
        return { ...base, status: STATUS_BY_CODE[parsed.error.code] ?? 'error', error: { source: 'Data Provider', ...parsed.error }, steps }
      return { ...base, status: 'delivered', evidence: parsed.evidence, xnachweis: response.data, steps }
    } catch (error) {
      if (!(error instanceof Problem)) throw error
      steps.push({ step: steps.length === 0 ? 'POST /de/jurisdiction' : 'POST /de/evidence', status: error.status, problem: error.urn })
      const status =
        error.type === 'no_data_provider.found' ? 'registry_not_connected' : error.status >= 500 ? 'registry_unreachable' : 'rejected'
      return { ...base, status, error: { source: error.source, code: error.urn, detail: error.detail }, steps }
    }
  }

  return {
    /** GET /dca/v1/evidence-types */
    evidenceTypes: () =>
      registry.evidenceTypes.map((type) => ({
        id: type.id,
        key: type.key,
        name: type.name,
        registry: type.registry,
        formats: [type.format],
        levelOfAssurance: type.levelOfAssurance,
        localJurisdiction: type.local,
        connected: type.provider !== null,
      })),

    /**
     * POST /dca/v1/evidence-requests — several evidence types for one person in one call. Each retrieval stands for
     * itself: one registry that is down does not take the others with it.
     */
    async requestEvidence(input: EvidenceRequest) {
      // The adapter holds the participant certificate and asks for the access token itself. The mock does not verify the seal.
      const requestToken = `${base64url({ alg: 'ES256', typ: 'JWT' })}.${base64url({
        iss: `C=DE, O=${input.dataConsumer.name}`,
        sub: input.dataConsumer.componentId ?? randomUUID(),
        aud: 'NOOTS IAM',
        iat: nowSeconds(),
        exp: nowSeconds() + 300,
        ver: 'v2',
        nonce: randomBytes(4).readUInt32BE(),
      })}.${randomBytes(32).toString('base64url')}`
      const access = await sak.token({ request_token: requestToken })
      const consumer = await sak.consumerFrom(`Bearer ${access.access_token}`)

      const results = await Promise.all(
        input.evidence.map(({ evidenceType }): Promise<Result> => {
          const type = registry.evidenceType(evidenceType)
          return type
            ? retrieve(type, input, consumer)
            : Promise.resolve({ evidenceType: { id: evidenceType }, status: 'unknown_evidence_type', steps: [] })
        }),
      )
      return {
        requestId: randomUUID(),
        timestamp: new Date().toISOString(),
        subject: input.subject,
        // Preview and takeover stay with the online service: nothing is taken into the application before the person agrees.
        takeover: 'pending',
        results,
      }
    },
  }
}

export type Dca = ReturnType<typeof createDca>
