/**
 * Evidence from registries over the NOOTS. The page talks to `/noots/…` on its own origin, and the web server passes
 * the call on to the NOOTS mock in `backend/` (the Vite proxy in development), the same way it reaches the AI service.
 */
import type { RegisterRequirement } from './scenario.ts'

const ENDPOINT = '/noots/dca/v1/evidence-requests'

/** The authority that asks, the legal basis it asks on, and the consent given earlier in the application. */
const REQUEST = {
  dataConsumer: { name: 'Elterngeldstelle Landkreis Auenthal', componentId: '550e8400-e29b-41d4-a716-446655440000' },
  legalBasis: 'BEEG § 1',
  consent: true,
}

/** Why a registry did not deliver, in words for the applicant. */
const REASONS: Record<string, string> = {
  not_found: 'Im Register liegt dazu kein Nachweis vor.',
  ambiguous: 'Das Register konnte die Person nicht eindeutig zuordnen.',
  level_of_assurance_too_low: 'Ihre Anmeldung reicht für diese Registerabfrage nicht aus.',
  registry_not_connected: 'Dieses Register ist noch nicht an das NOOTS angeschlossen.',
  registry_unreachable: 'Das Register war nicht erreichbar.',
}
const NO_ANSWER = 'Die Registerabfrage war nicht möglich.'

const DATE = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' })
const TIME = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })

/** What the mock of the registries answers for one evidence type; `status` is the one of `backend/src/dca/service.ts`. */
export type RegisterResult =
  | {
      status: 'delivered'
      registry?: string
      evidenceType: { name?: string }
      evidence: { issuingAuthority: { name: string | null } }
    }
  | {
      status: 'not_found' | 'ambiguous' | 'level_of_assurance_too_low' | 'registry_not_connected' | 'registry_unreachable' | 'rejected' | 'unknown_evidence_type' | 'error'
    }

/** The answer of the mock to one evidence request: only what the page reads. */
interface RegisterAnswer {
  timestamp: string
  /** In the order of the evidence types asked for. */
  results: (RegisterResult | undefined)[]
}

/** What the registry made of a requirement, to be merged into its state on the page. */
export interface RegisterOutcome {
  status: 'belegt' | 'offen'
  register: 'delivered' | 'failed'
  /** Why the registry did not deliver. */
  registerNote?: string
  source?: string
  sourceDetail?: string
  evidenceType?: string
}

/** The outcome for one requirement, by its id. */
export type RegisterEntry = [id: string, outcome: RegisterOutcome]

/** The call as the page sends it, as far as a stand-in for `fetch` needs to know. */
export interface NootsFetchInit {
  method: string
  headers: Record<string, string>
  body: string
}

/** `fetch`, or a stand-in for it. */
export type NootsFetch = (url: string, init: NootsFetchInit) => Promise<Response>

/**
 * What a retrieval means for a requirement: established by the registry, or left to the applicant with the reason.
 * @param result  one entry of `results` in the answer of the mock
 * @param retrievedAt  `timestamp` of that answer
 */
export function outcomeOf(result: RegisterResult | null | undefined, retrievedAt?: string): RegisterOutcome {
  if (result?.status !== 'delivered') {
    const reason = result ? REASONS[result.status] : undefined
    return { status: 'offen', register: 'failed', registerNote: reason ?? NO_ANSWER }
  }
  const at = new Date(retrievedAt ?? '')
  return {
    status: 'belegt',
    register: 'delivered',
    source: `NOOTS-Abruf · ${result.registry}`,
    sourceDetail: `${result.evidence.issuingAuthority.name}, abgerufen am ${DATE.format(at)} um ${TIME.format(at)} Uhr`,
    evidenceType: `${result.evidenceType.name} (XNachweis 2.0)`,
  }
}

/** Where `retrieveFromRegisters` gets its `fetch` from. */
export interface NootsOptionen {
  fetch?: NootsFetch
}

/**
 * Asks the registries for every requirement that names one. One call per person, since a retrieval concerns one
 * subject. Never rejects: a requirement whose retrieval fails stays with the applicant.
 */
export async function retrieveFromRegisters(
  requirements: readonly RegisterRequirement[],
  { fetch = globalThis.fetch }: NootsOptionen = {},
): Promise<RegisterEntry[]> {
  const bySubject = new Map<string, { subject: RegisterRequirement['register']['subject']; items: RegisterRequirement[] }>()
  for (const item of requirements) {
    const key = JSON.stringify(item.register.subject)
    const group = bySubject.get(key)
    if (group) group.items.push(item)
    else bySubject.set(key, { subject: item.register.subject, items: [item] })
  }

  const groups = await Promise.all(
    [...bySubject.values()].map(async ({ subject, items }): Promise<RegisterEntry[]> => {
      try {
        const response = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...REQUEST,
            subject,
            evidence: items.map((item) => ({ evidenceType: item.register.evidenceType })),
          }),
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        // The NOOTS mock answers in the shape of `backend/src/dca/service.ts`; `RegisterAnswer` is what the page reads of it.
        const { timestamp, results } = (await response.json()) as RegisterAnswer
        return items.map((item, index): RegisterEntry => [item.id, outcomeOf(results[index], timestamp)])
      } catch {
        return items.map((item): RegisterEntry => [item.id, outcomeOf(null)])
      }
    }),
  )
  return groups.flat()
}
