// The Consumer API of a Secure Access Node (SAK-DC), v3, for a national retrieval. Requests, responses and problem types
// follow the OpenAPI file and the error catalogue the BVA publishes (gitlab.opencode.de/noots/public/ad-noots/sak-apis).
import { randomUUID } from 'node:crypto'
import type { Registry } from '../registry/load.ts'
import { LEVELS } from '../registry/schema.ts'
import type { EvidenceType } from '../registry/schema.ts'
import { asObject, asString } from '../shared/input.ts'
import { Problem } from '../shared/problem.ts'
import { decodeToken, nowSeconds } from '../shared/tokens.ts'
import type { Tokens } from '../shared/tokens.ts'
import { buildErrorResponse, buildResponse, parseRequest, SPECIFICATION } from '../xnachweis/xnachweis.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MESSAGE_TYPES = ['evidenceRequest', 'DE.EvidenceRequest.0101', 'DE.EvidenceRequest.0301']
const TTL_SECONDS = 300

/** Failures on the way to the registry that a caller of the mock can force. */
export const SCENARIOS = ['registry-unreachable', 'timeout'] as const

/** The data consumer behind an access token. */
export interface Consumer {
  id: string
  name: string
}

export interface EvidenceResponse {
  mime_type: 'application/xml'
  specification_identifier: string
  message_type: 'evidenceResponse' | 'evidenceErrorResponse'
  data: string
}

const rank = (level: string | null) => (LEVELS as readonly string[]).indexOf(level ?? '')
const envelope = (message_type: EvidenceResponse['message_type'], xml: string): EvidenceResponse => ({
  mime_type: 'application/xml',
  specification_identifier: SPECIFICATION,
  message_type,
  data: Buffer.from(xml).toString('base64'),
})

export function createSak(registry: Registry, tokens: Tokens) {
  const { parameter, values } = registry.jurisdiction

  function evidenceTypeFor(id: unknown): EvidenceType {
    if (id === undefined || id === null || id === '') throw new Problem('evidencetype.missing')
    if (typeof id !== 'string' || !UUID.test(id)) {
      throw new Problem('evidencetype.invalid', 'SAK-DC', [
        { path: 'evidence_type', text: 'Übermittelter Nachweistyp', params: { evidence_type: JSON.stringify(id) } },
      ])
    }
    const type = registry.evidenceType(id)
    if (!type) throw new Problem('evidencetype.notfound', 'RDN')
    return type
  }

  return {
    /** POST /token — the request token of the data consumer is read, not verified: the mock has no trust anchor. */
    async token(body: unknown) {
      const requestToken = asObject(body).request_token
      if (requestToken === undefined || requestToken === null || requestToken === '') throw new Problem('request_token.missing')
      const payload = typeof requestToken === 'string' ? decodeToken(requestToken) : null
      if (!payload?.sub || !UUID.test(payload.sub) || payload.aud !== 'NOOTS IAM') throw new Problem('request_token.invalid')
      const access_token = await tokens.sign({
        iss: 'C=DE, O=NOOTS-Mock, CN=IAM fuer Behoerden',
        sub: payload.sub,
        name: /(?:^|,\s*)O=([^,]+)/.exec(payload.iss ?? '')?.[1] ?? 'Data Consumer',
        aud: 'NOOTS',
        iat: nowSeconds(),
        exp: nowSeconds() + TTL_SECONDS,
        ver: 'v2',
        jti: randomUUID(),
      })
      return { access_token, token_type: 'Bearer', expires_in: TTL_SECONDS }
    },

    /** The data consumer behind the `Authorization` header, if it carries an access token of this mock. */
    async consumerFrom(authorization: string | undefined): Promise<Consumer> {
      const token = /^Bearer (.+)$/.exec(authorization ?? '')?.[1]
      const access = token ? await tokens.verify(token) : null
      if (!access?.sub || access.aud !== 'NOOTS') throw new Problem('unauthorized')
      return { id: access.sub, name: asString(access.name) ?? 'Data Consumer' }
    },

    /** GET /de/jurisdiction-parameters/{evidence-type} */
    jurisdictionParameters(evidenceTypeId: unknown) {
      if (!evidenceTypeFor(evidenceTypeId).local) return { jurisdiction_parameters: [], jurisdiction_values: [] }
      return {
        jurisdiction_parameters: [parameter],
        jurisdiction_values: values.map(({ value, name }) => ({
          [parameter.id]: { parameter_value: value, name: { de: name, en: name } },
        })),
      }
    },

    /** POST /de/jurisdiction — the data provider in charge, as a jurisdiction token sealed by the registry data navigation. */
    async jurisdiction(body: unknown, consumer: Consumer): Promise<string> {
      const input = asObject(body)
      const type = evidenceTypeFor(input.evidence_type)
      if (!type.provider) throw new Problem('no_data_provider.found', 'RDN')
      const value = asString(asObject(input.jurisdiction_value)[parameter.id])
      if (type.local) {
        if (!value) throw new Problem('jurisdictionparameters.missing', 'RDN')
        if (!values.some((known) => known.value === value)) throw new Problem('jurisdictionparameter_value.unknown', 'RDN')
      }
      return tokens.sign({
        exp: nowSeconds() + TTL_SECONDS,
        iat: nowSeconds(),
        iss: 'C=DE, O=NOOTS-Mock, CN=Registerdatennavigation',
        aud: consumer.id,
        sub: type.provider.id,
        name: type.provider.name,
        jti: randomUUID(),
        ver: 'v2',
        dp_ta: 'DataProvider',
        evidence_type: { id: type.id, name: type.name, required_level_of_assurance: type.levelOfAssurance },
        ...(type.local ? { jurisdiction_value: { [parameter.id]: value } } : {}),
        supported_subject_id_usage: [],
        supported_xnachweis_versions: [SPECIFICATION],
        supported_evidence_formats: [{ oots_media_type: type.format }],
      })
    },

    /**
     * POST /de/evidence — the response of the registry. A registry that cannot deliver answers with HTTP 200 and an
     * XNachweis error; only what goes wrong on the way is an HTTP error. `scenario` forces such a failure on the way.
     */
    async evidence(body: unknown, consumer: Consumer, scenario?: string): Promise<EvidenceResponse> {
      const input = asObject(body)
      const jurisdictionToken = asString(input.jurisdiction_token)
      if (!jurisdictionToken) throw new Problem('jurisdiction_token.missing')
      const jurisdiction = await tokens.verify(jurisdictionToken)
      const type = registry.evidenceType(asString(asObject(jurisdiction?.evidence_type).id) ?? '')
      if (!type?.provider || jurisdiction?.aud !== consumer.id) throw new Problem('jurisdiction_token.invalid', 'RDN')
      const provider = type.provider
      if ((asString(input.legal_basis)?.trim().length ?? 0) < 2) throw new Problem('abstract_authorization', 'VS')

      const request = asObject(input.evidence_request)
      if (request.mime_type !== 'application/xml') throw new Problem('mime_type.invalid')
      if (request.specification_identifier !== SPECIFICATION) throw new Problem('specification_identifier.invalid')
      if (!MESSAGE_TYPES.includes(asString(request.message_type) ?? '')) throw new Problem('message_type.invalid')
      if (request.use_idnr !== false) throw new Problem('useidnr.unavailable', 'IDM-P')
      const data = asString(request.data)
      if (!data) throw new Problem('data.empty')

      const parsed = parseRequest(Buffer.from(data, 'base64').toString('utf8'))
      const { givenName, familyName, dateOfBirth } = parsed?.person ?? {}
      if (!parsed?.messageId || !givenName || !familyName || !dateOfBirth) throw new Problem('data.invalid')
      if (parsed.evidenceType !== type.id) throw new Problem('data.inconsistency')

      if (scenario === 'registry-unreachable') throw new Problem('badgateway.unreachable', 'SAK-DP')
      if (scenario === 'timeout')
        throw new Problem('gatewaytimeout', 'SAK-DC', [{ text: 'Client-Timeout in Sekunden', params: { timeout: '4' } }])

      const context = {
        messageId: parsed.messageId,
        consumer: { id: consumer.id, name: parsed.consumer.name ?? consumer.name },
        levelOfAssurance: parsed.levelOfAssurance ?? type.levelOfAssurance,
      }
      const person = registry.findPerson({ givenName, familyName, dateOfBirth })
      const evidenceData = person?.evidence[type.key]
      const code = rank(parsed.levelOfAssurance) < rank(type.levelOfAssurance) ? '0305' : person?.ambiguous ? '0402' : null
      if (code || !person || !evidenceData)
        return envelope('evidenceErrorResponse', buildErrorResponse({ context, provider, code: code ?? '0403' }))
      return envelope('evidenceResponse', buildResponse({ context, type, provider, person, data: evidenceData }))
    },
  }
}

export type Sak = ReturnType<typeof createSak>
