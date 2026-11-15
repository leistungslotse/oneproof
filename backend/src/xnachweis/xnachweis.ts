// XNachweis 2 messages of a national retrieval, in the shape of the examples the BVA publishes with the SAK APIs.
import { randomUUID } from 'node:crypto'
import { XMLParser } from 'fast-xml-parser'
import type { EvidenceData, EvidenceType, Json, Party, PersonQuery } from '../registry/schema.ts'
import { asObject, asString } from '../shared/input.ts'

export const SPECIFICATION = 'urn:xoev-de:bva:standard:xnachweis_2'

const NAMESPACES = `xmlns:xn-de="urn:xoev-de:bva:standard:xnachweis:schema:nachrichtentypen.de_2"
    xmlns:xn-bk="urn:xoev-de:bva:standard:xnachweis:schema:baukasten.de_2"
    xmlns:bn-g2g="http://xoev.de/schemata/basisnachricht/g2g/1_1"
    xmlns:ns0="http://xoev.de/schemata/basisnachricht/behoerde/1_1"
    xmlns:xn-edm="urn:xoev-de:bva:standard:xnachweis:schema:baukasten.edm_2"
    xmlns:xn-bdt="urn:xoev-de:bva:standard:xnachweis:schema:basisdatentypen_2"`
const LANGUAGE = '<xn-bdt:lang listVersionID="urn:xoev-de:xnachweis:codeliste:sprachen-iso-639-1_2023-12"><code>de</code></xn-bdt:lang>'
const PARTY_SCHEME = 'urn:oasis:names:tc:ebcore:partyid-type:unregistered:DE'
const PRODUCT =
  'produkt="NOOTS-Mock" produkthersteller="LeistungsLotse" produktversion="0.1.0" standard="urn:xoev-de:bva:standard:xnachweis" version="2"'

/** Error codes of a data provider, in German as a registry sends them. `0402` and `0403` follow the NOOTS code list, the wording of `0305` is our own. */
export const NOOTS_ERRORS = {
  '0305': 'Das Vertrauensniveau der Authentifizierung reicht für diesen Nachweistyp nicht aus.',
  '0402': 'Das Nachweissubjekt konnte im Register nicht eindeutig identifiziert werden.',
  '0403': 'Im Register konnte kein entsprechender Nachweis erstellt werden.',
} as const
export type ErrorCode = keyof typeof NOOTS_ERRORS

/** What a response refers to: the request, who asked, and how the person had signed in. */
export interface ResponseContext {
  messageId: string
  consumer: Party
  levelOfAssurance: string
}

const escape = (value: string | number | boolean | null) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
const timestamp = (now: Date) => now.toISOString().replace(/\.\d+Z$/, 'Z')
const day = (now: Date) => timestamp(now).slice(0, 10)

const authority = ({ id, name }: Party) =>
  `<ns0:verzeichnisdienst listVersionID="urn:xoev-de:kosit:codeliste:verzeichnisdienst_4"><code>IAM-FB</code></ns0:verzeichnisdienst><ns0:kennung>${escape(id)}</ns0:kennung><ns0:name>${escape(name)}</ns0:name>`
const header = (messageType: string, now: Date, reader: Party, author: Party) => `<xn-bk:nachrichtenkopf>
    <xn-bk:identifikation.nachricht>
      <xn-bk:nachrichtenUUID>${randomUUID()}</xn-bk:nachrichtenUUID>
      <xn-bk:nachrichtentyp><code>${messageType}</code></xn-bk:nachrichtentyp>
      <xn-bk:erstellungszeitpunkt>${timestamp(now)}</xn-bk:erstellungszeitpunkt>
    </xn-bk:identifikation.nachricht>
    <bn-g2g:leser>${authority(reader)}</bn-g2g:leser>
    <bn-g2g:autor>${authority(author)}</bn-g2g:autor>
  </xn-bk:nachrichtenkopf>`
const party = (element: string, { id, name }: Party) =>
  `<xn-bk:${element}><xn-bk:Identifier schemeID="${PARTY_SCHEME}">${escape(id)}</xn-bk:Identifier><xn-bk:Name><xn-bdt:value>${escape(name)}</xn-bdt:value>${LANGUAGE}</xn-bk:Name></xn-bk:${element}>`
const naturalPerson = (
  person: PersonQuery,
  levelOfAssurance: string,
) => `<xn-edm:DateOfBirth>${escape(person.dateOfBirth)}</xn-edm:DateOfBirth>
          <xn-edm:FamilyName>${escape(person.familyName)}</xn-edm:FamilyName>
          <xn-edm:GivenName>${escape(person.givenName)}</xn-edm:GivenName>
          <xn-edm:LevelOfAssurance listVersionID="urn:xoev-de:xnachweis:codeliste:loa_1.0.0"><code>${escape(levelOfAssurance)}</code></xn-edm:LevelOfAssurance>`

export interface RequestInput {
  consumer: Party
  provider: Party
  type: EvidenceType
  person: PersonQuery
  levelOfAssurance?: string
  legalBasis: string
  /** Purpose of processing, free text as the standard wants it. */
  purpose?: string
  now?: Date
}

/** The request a data consumer sends: who asks whom, for which person and evidence type, on which legal basis. */
export function buildRequest({
  consumer,
  provider,
  type,
  person,
  levelOfAssurance = 'High',
  legalBasis,
  purpose = 'Bescheiderstellung',
  now = new Date(),
}: RequestInput): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<xn-de:evidenceRequest ${PRODUCT}
    ${NAMESPACES}>
  ${header('evidenceRequest', now, provider, consumer)}
  <xn-bk:SpecificationIdentifier>${SPECIFICATION}</xn-bk:SpecificationIdentifier>
  <xn-bk:IssueDateTime>${timestamp(now)}</xn-bk:IssueDateTime>
  <xn-bk:lang listVersionID="urn:xoev-de:xnachweis:codeliste:sprachen-iso-639-1_2023-12"><code>de</code></xn-bk:lang>
  ${party('DataProvider', provider)}
  ${party('DataConsumer', consumer)}
  <xn-de:Verarbeitungszweck>${escape(purpose)}</xn-de:Verarbeitungszweck>
  <xn-de:Rechtsgrundlage>${escape(legalBasis)}</xn-de:Rechtsgrundlage>
  <xn-de:Query>
    <xn-edm:QueryDefinition>DocumentQuery</xn-edm:QueryDefinition>
    <xn-edm:LegalOrNaturalPerson>
      <xn-edm:NaturalPerson>
          ${naturalPerson(person, levelOfAssurance)}
      </xn-edm:NaturalPerson>
    </xn-edm:LegalOrNaturalPerson>
    <xn-edm:RequestedEvidenceType>
      <xn-edm:Title><xn-bdt:value>${escape(type.name)}</xn-bdt:value>${LANGUAGE}</xn-edm:Title>
      <xn-edm:Identifier>${type.id}</xn-edm:Identifier>
      <xn-edm:DistributedAs><xn-edm:Format listVersionID="urn:xoev-de:xnachweis:codeliste:ootsmediatypes_1.0.0"><code>${type.format}</code></xn-edm:Format></xn-edm:DistributedAs>
    </xn-edm:RequestedEvidenceType>
  </xn-de:Query>
</xn-de:evidenceRequest>`
}

// Prefixes are dropped, attributes ignored, values stay strings: an error code "0403" must not become the number 403.
const parser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true, parseTagValue: false, ignoreDeclaration: true })

/** The root element of a message, or null if there is none of that name. A DOCTYPE is refused. */
function root(xml: string, name: string): unknown {
  if (/<!DOCTYPE/i.test(xml)) return null
  try {
    return asObject(parser.parse(xml))[name] ?? null
  } catch {
    return null
  }
}
const node = (start: unknown, ...names: string[]): unknown => names.reduce<unknown>((current, name) => asObject(current)[name], start)
const value = (start: unknown, ...names: string[]): string | null => {
  const content = asString(node(start, ...names))?.trim()
  return content === undefined || content === '' ? null : content
}

export interface ParsedRequest {
  messageId: string | null
  consumer: { id: string | null; name: string | null }
  legalBasis: string | null
  purpose: string | null
  person: { givenName: string | null; familyName: string | null; dateOfBirth: string | null }
  levelOfAssurance: string | null
  evidenceType: string | null
}

/** What the mock needs from a request. `null` if it is no XNachweis evidence request. */
export function parseRequest(xml: string): ParsedRequest | null {
  const message = root(xml, 'evidenceRequest')
  if (message === null) return null
  const person = node(message, 'Query', 'LegalOrNaturalPerson', 'NaturalPerson')
  return {
    messageId: value(message, 'nachrichtenkopf', 'identifikation.nachricht', 'nachrichtenUUID'),
    consumer: { id: value(message, 'DataConsumer', 'Identifier'), name: value(message, 'DataConsumer', 'Name', 'value') },
    legalBasis: value(message, 'Rechtsgrundlage'),
    purpose: value(message, 'Verarbeitungszweck'),
    person: {
      givenName: value(person, 'GivenName'),
      familyName: value(person, 'FamilyName'),
      dateOfBirth: value(person, 'DateOfBirth')?.slice(0, 10) ?? null,
    },
    levelOfAssurance: value(person, 'LevelOfAssurance', 'code'),
    evidenceType: value(message, 'Query', 'RequestedEvidenceType', 'Identifier'),
  }
}

const elementName = (name: string) => name.replace(/[^\w.-]/g, '_').replace(/^(?![A-Za-z_])/, '_')

function element(name: string, content: Json, depth: number): string {
  const indent = '  '.repeat(depth)
  const tag = `sample:${elementName(name)}`
  if (typeof content !== 'object' || content === null) return `${indent}<${tag}>${escape(content)}</${tag}>`
  const children = Array.isArray(content)
    ? content.map((item) => element('item', item, depth + 1))
    : Object.entries(content).map(([key, child]) => element(key, child, depth + 1))
  return `${indent}<${tag}>\n${children.join('\n')}\n${indent}</${tag}>`
}

/**
 * The evidence itself, as the registry would issue it. Its content comes from the person's JSON file; the format is
 * invented (`sample`), no sector standard such as XPersonenstand or XMeld.
 */
export function evidenceDocument(type: EvidenceType, provider: Party, person: PersonQuery, data: EvidenceData, now = new Date()): string {
  const content = {
    issuingAuthority: provider.name,
    person: `${person.givenName} ${person.familyName}`,
    dateOfBirth: person.dateOfBirth,
    issuedOn: day(now),
    ...data,
  }
  if (type.format === 'application/json') return JSON.stringify({ sample: true, evidenceType: type.name, ...content }, null, 2)
  const name = `sample:${type.key.charAt(0).toUpperCase()}${type.key.slice(1)}`
  const children = Object.entries(content).map(([key, child]) => element(key, child, 1))
  return `<?xml version="1.0" encoding="UTF-8"?>\n<${name} xmlns:sample="urn:noots-mock:sample:${type.key}" sample="true">\n${children.join('\n')}\n</${name}>`
}

export interface ResponseInput {
  context: ResponseContext
  type: EvidenceType
  provider: Party
  person: PersonQuery
  data: EvidenceData
  now?: Date
}

/** The response with the evidence: metadata around the document, the document itself Base64-coded in `RepositoryItem`. */
export function buildResponse({ context, type, provider, person, data, now = new Date() }: ResponseInput): string {
  const document = evidenceDocument(type, provider, person, data, now)
  return `<?xml version="1.0" encoding="UTF-8"?>
<xn-de:evidenceResponse ${PRODUCT}
    requestid="urn:uuid:${escape(context.messageId)}"
    ${NAMESPACES}>
  ${header('evidenceResponse', now, context.consumer, provider)}
  <xn-bk:Status listVersionID="urn:xoev-de:xnachweis:codeliste:responsestatustype"><code>Success</code></xn-bk:Status>
  <xn-bk:SpecificationIdentifier>${SPECIFICATION}</xn-bk:SpecificationIdentifier>
  <xn-bk:IssueDateTime>${timestamp(now)}</xn-bk:IssueDateTime>
  ${party('DataProvider', provider)}
  ${party('DataConsumer', context.consumer)}
  <xn-de:EvidenceAvailabilityPerEvidenceProvider>
    <xn-de:EvidenceAvailability>
      <xn-de:Evidence>
        <xn-bk:Identifier><xn-bdt:value>${type.id}</xn-bdt:value><xn-bdt:schemeID listVersionID="urn:xoev-de:xnachweis:codeliste:identifierschemes_1.0.0"><code>BusinessCode</code></xn-bdt:schemeID></xn-bk:Identifier>
        <xn-bk:IsConformantTo><xn-edm:Title><xn-bdt:value>${escape(type.name)}</xn-bdt:value>${LANGUAGE}</xn-edm:Title></xn-bk:IsConformantTo>
        <xn-bk:LegalOrNaturalPerson>
          <xn-bk:NaturalPerson>
          ${naturalPerson(person, context.levelOfAssurance)}
          </xn-bk:NaturalPerson>
        </xn-bk:LegalOrNaturalPerson>
        ${party('IssuingAuthority', provider)}
        <xn-bk:IssuingDate>${day(now)}</xn-bk:IssuingDate>
        <xn-bk:RegistryObject>
          <xn-bk:id>urn:uuid:${randomUUID()}</xn-bk:id>
          <xn-bk:Distribution><xn-edm:Format listVersionID="urn:xoev-de:xnachweis:codeliste:ootsmediatypes_1.0.0"><code>${type.format}</code></xn-edm:Format></xn-bk:Distribution>
          <xn-bk:RepositoryItem>${Buffer.from(document).toString('base64')}</xn-bk:RepositoryItem>
        </xn-bk:RegistryObject>
      </xn-de:Evidence>
    </xn-de:EvidenceAvailability>
  </xn-de:EvidenceAvailabilityPerEvidenceProvider>
</xn-de:evidenceResponse>`
}

export interface ErrorResponseInput {
  context: ResponseContext
  provider: Party
  code: ErrorCode
  now?: Date
}

/** The response of a registry that cannot deliver: an error code of the NOOTS code list, sent with HTTP 200. */
export function buildErrorResponse({ context, provider, code, now = new Date() }: ErrorResponseInput): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<xn-de:evidenceErrorResponse ${PRODUCT}
    requestid="urn:uuid:${escape(context.messageId)}"
    ${NAMESPACES}>
  ${header('evidenceErrorResponse', now, context.consumer, provider)}
  <xn-bk:Status listVersionID="urn:xoev-de:xnachweis:codeliste:responsestatustype_2024-05"><code>Failure</code></xn-bk:Status>
  <xn-bk:SpecificationIdentifier>${SPECIFICATION}</xn-bk:SpecificationIdentifier>
  <xn-bk:IssueDateTime>${timestamp(now)}</xn-bk:IssueDateTime>
  ${party('ErrorProvider', provider)}
  ${party('DataConsumer', context.consumer)}
  <xn-bk:Exception>
    <xn-bk:Error_NOOTS listVersionID="urn:xoev-de:xnachweis:codeliste:nootserrorcodes_2026-01"><code>${code}</code></xn-bk:Error_NOOTS>
    <xn-bk:Detail>${escape(NOOTS_ERRORS[code])}</xn-bk:Detail>
    <xn-bk:Timestamp>${timestamp(now)}</xn-bk:Timestamp>
    <xn-bk:Severity>urn:oasis:names:tc:ebxmlregrep:ErrorSeverityType:Error</xn-bk:Severity>
  </xn-bk:Exception>
</xn-de:evidenceErrorResponse>`
}

export interface ParsedEvidence {
  id: string | null
  issuingAuthority: { id: string | null; name: string | null }
  issuedOn: string | null
  format: string | null
  content: string
}
export type ParsedResponse = { error: { code: string; detail: string | null } } | { evidence: ParsedEvidence } | null

/** What a response says: the evidence with its metadata, or the error code. `null` if it is neither. */
export function parseResponse(xml: string): ParsedResponse {
  const exception = node(root(xml, 'evidenceErrorResponse'), 'Exception')
  const code = value(exception, 'Error_NOOTS', 'code')
  if (code) return { error: { code, detail: value(exception, 'Detail') } }
  const evidence = node(root(xml, 'evidenceResponse'), 'EvidenceAvailabilityPerEvidenceProvider', 'EvidenceAvailability', 'Evidence')
  if (evidence === undefined) return null
  return {
    evidence: {
      id: value(evidence, 'RegistryObject', 'id'),
      issuingAuthority: {
        id: value(evidence, 'IssuingAuthority', 'Identifier'),
        name: value(evidence, 'IssuingAuthority', 'Name', 'value'),
      },
      issuedOn: value(evidence, 'IssuingDate'),
      format: value(evidence, 'RegistryObject', 'Distribution', 'Format', 'code'),
      content: Buffer.from(value(evidence, 'RegistryObject', 'RepositoryItem') ?? '', 'base64').toString('utf8'),
    },
  }
}
