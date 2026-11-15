// Problem types of the SAK Consumer API. Titles and details are the German wording of the error catalogue the BVA publishes with it.
const PROBLEMS = {
  'traceparent.missing': [
    400,
    "Parameter 'traceparent' fehlt",
    "Der HTTP-Header-Parameter 'traceparent' zur Verfolgung von Nachrichten fehlt.",
  ],
  'traceparent.invalid': [
    400,
    "Fehlerhafter Parameter 'traceparent'",
    "Der HTTP-Parameter 'traceparent' zur Verfolgung von Nachrichten ist syntaktisch falsch",
  ],
  'request_token.missing': [400, 'Request Token fehlt', 'Der Request Token des Data Consumers fehlt.'],
  'request_token.invalid': [
    400,
    'Fehlerhafter Request Token',
    'Der Request Token, der die Komponenten-ID des Data Consumer enthält, ist fehlerhaft.',
  ],
  unauthorized: [
    401,
    'Authentifizierungsfehler',
    'Die Authentifizierung ist fehlgeschlagen. Aus Sicherheitsgründen werden keine weiteren Details zur Fehlerursache bereitgestellt.',
  ],
  'evidencetype.missing': [400, 'Nachweistyp fehlt', 'Der Nachweistyp fehlt.'],
  'evidencetype.invalid': [400, 'Fehlerhafter Nachweistyp', 'Der Nachweistyp entspricht nicht dem Format einer gültigen UUID.'],
  'evidencetype.notfound': [404, 'Nachweistyp nicht gefunden', 'Der Nachweistyp wurde nicht gefunden.'],
  'jurisdictionparameters.missing': [400, 'Zuständigkeitsparameter fehlen', 'Zuständigkeitsparameter fehlen zum Nachweistyp'],
  'jurisdictionparameter_value.unknown': [
    422,
    'Unbekannter Wert für Zuständigkeitsparameter',
    'Der Wert für die Zuständigkeitsparameter ist in der Registerdatennavigation nicht vorhanden.',
  ],
  'no_data_provider.found': [
    404,
    'Kein zuständiger Data Provider gefunden',
    'Zu den Eingabedaten konnte in der RDN kein zuständiger Data Provider ermittelt werden.',
  ],
  'jurisdiction_token.missing': [
    400,
    'Zuständigkeitstoken fehlt',
    'Der Zuständigkeitstoken, der den zuständigen Data Provider enthält, fehlt.',
  ],
  'jurisdiction_token.invalid': [
    400,
    'Fehlerhafter Zuständigkeitstoken',
    'Der Zuständigkeitstoken, der den zuständigen Data Provider enthält, ist fehlerhaft.',
  ],
  'mime_type.invalid': [400, 'Fehlerhafter MimeType', 'Der MimeType ist syntaktisch falsch oder wird nicht unterstützt.'],
  'specification_identifier.invalid': [
    400,
    "Fehlerhafter 'SpecificationIdentifier'",
    "Der 'SpecificationIdentifier' ist syntaktisch falsch oder wird nicht unterstützt.",
  ],
  'message_type.invalid': [400, 'Fehlerhafter Nachrichtentyp', 'Der Nachrichtentyp ist syntaktisch falsch oder wird nicht unterstützt.'],
  'data.empty': [400, 'Keine Inhaltsdaten', 'Inhaltsdaten fehlen'],
  'data.invalid': [400, 'Verarbeitungsfehler: Fehlerhafte Daten', "Es sind Fehler beim Parsen von 'data' aufgetreten"],
  'data.inconsistency': [400, 'Eingangsdaten nicht konsistent', 'Die Eingangsdaten sind nicht konsistent.'],
  'useidnr.unavailable': [
    400,
    'Nachweisabruf mit IdNr nicht möglich',
    'Der Nachweisabruf mit IdNr ist in diesem Mock nicht möglich: Die SAK-API verlangt derzeit use_idnr = false.',
  ],
  abstract_authorization: [403, 'Keine abstrakte Berechtigung', 'Die abstrakte Berechtigungsprüfung ist fehlgeschlagen.'],
  'badgateway.unreachable': [502, 'Nachgelagerte IT-Komponente nicht erreichbar', 'Die nachgelagerte IT-Komponente ist nicht erreichbar.'],
  gatewaytimeout: [
    504,
    'Zeitüberschreitung',
    'Der Service hat innerhalb eines definierten Zeitraums keine rechtzeitige Antwort von einer nachgelagerten IT-Komponente erhalten.',
  ],
} as const satisfies Record<string, readonly [status: number, title: string, detail: string]>

export type ProblemType = keyof typeof PROBLEMS
export type ErrorSource = 'SAK-DC' | 'SAK-DP' | 'IAM' | 'IDM-P' | 'RDN' | 'VS' | 'DP'
export interface ProblemMessage {
  path?: string
  text: string
  params?: Record<string, string>
}

const TRACEPARENT = /^[0-9a-f]{2}-(?!0{32})[0-9a-f]{32}-(?!0{16})[0-9a-f]{16}-[0-9a-f]{2}$/

/** A NOOTS error: an HTTP status with details after RFC 9457. */
export class Problem extends Error {
  readonly type: ProblemType
  readonly status: number
  readonly title: string
  readonly detail: string
  readonly source: ErrorSource
  readonly messages: ProblemMessage[] | undefined

  constructor(type: ProblemType, source: ErrorSource = 'SAK-DC', messages?: ProblemMessage[]) {
    super(type)
    const [status, title, detail] = PROBLEMS[type]
    this.name = 'Problem'
    this.type = type
    this.status = status
    this.title = title
    this.detail = detail
    this.source = source
    this.messages = messages
  }

  get urn(): string {
    return `urn:noots:${this.type}`
  }

  body(instance: string, traceparent?: string) {
    return {
      type: this.urn,
      title: this.title,
      status: this.status,
      detail: this.detail,
      instance,
      timestamp: new Date().toISOString(),
      ...(traceparent && TRACEPARENT.test(traceparent) ? { trace_id: traceparent.split('-')[1] } : {}),
      error_source: this.source,
      ...(this.messages ? { messages: this.messages } : {}),
    }
  }
}

/** W3C Trace Context: every call of the SAK API must carry it. */
export function assertTraceparent(value: string | undefined): void {
  if (!value) throw new Problem('traceparent.missing')
  if (!TRACEPARENT.test(value)) throw new Problem('traceparent.invalid')
}
