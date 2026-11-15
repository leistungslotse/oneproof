/**
 * The demo case. All names, dates and authorities are invented — no real person,
 * municipality or customer appears here.
 *
 * A requirement is a fact that has to be established for this application, not a
 * document. That distinction is the whole point of the demo: OneProof resolves
 * facts, and a document is only one of several ways to establish one.
 */

export const APPLICANT = {
  name: 'Nora Feldmann',
  child: 'Mila Feldmann',
  birth: '2. August 2026',
  authority: 'Landkreis Auenthal',
  fileNumber: 'EG-2026-04417',
}

/** What an upload of evidence comes to, in the scripted walkthrough. */
export interface Step {
  status: 'belegt' | 'unklar'
  note: string
  /** The label of the button for the next upload. */
  action?: string
}

interface RequirementBase {
  id: string
  /** The fact to be established. */
  fact: string
  person: string
  period: string
}

/** A requirement that names a registry to ask over the NOOTS; if the registry does not deliver, it falls to the applicant. */
export interface RegisterRequirement extends RequirementBase {
  register: {
    evidenceType: string
    subject: { givenName: string; familyName: string; dateOfBirth: string }
  }
  hint: string
  steps: Step[]
  initial?: undefined
}

/** A requirement that only an upload can establish; it starts as `offen`. */
export interface UploadRequirement extends RequirementBase {
  register?: undefined
  initial: 'offen'
  hint: string
  steps: Step[]
}

/** A requirement that does not apply in this case, with the reason. */
export interface DroppedRequirement extends RequirementBase {
  register?: undefined
  initial: 'entfaellt'
  reason: string
}

export type Requirement = RegisterRequirement | UploadRequirement | DroppedRequirement

/**
 * A requirement with `register` is asked of that registry over the NOOTS when the page opens (see `noots.ts`).
 * What the registry delivers is established; what it cannot deliver falls to the applicant, with `hint` and `steps`.
 *
 * The outcomes of uploads are scripted per requirement so a walkthrough is repeatable. The
 * income requirement deliberately resolves to `unklar` first: a partial match is
 * the case that makes the difference between OneProof and a static checklist
 * visible.
 */
export const REQUIREMENTS: Requirement[] = [
  {
    id: 'geburt',
    fact: 'Geburt und Abstammung des Kindes',
    person: 'Mila Feldmann',
    period: '2. August 2026',
    register: { evidenceType: 'birthCertificate', subject: { givenName: 'Mila', familyName: 'Feldmann', dateOfBirth: '2026-08-02' } },
    hint: 'Die Geburtsurkunde Ihres Kindes.',
    steps: [{ status: 'belegt', note: 'Geburtsurkunde erkannt, die Angaben stimmen mit Ihrem Antrag überein.' }],
  },
  {
    id: 'wohnung',
    fact: 'Das Kind lebt in Ihrem Haushalt',
    person: 'Nora Feldmann, Mila Feldmann',
    period: 'seit 2. August 2026',
    register: { evidenceType: 'residenceCertificate', subject: { givenName: 'Nora', familyName: 'Feldmann', dateOfBirth: '1994-03-14' } },
    hint: 'Eine Meldebescheinigung, auf der Sie und Ihr Kind stehen.',
    steps: [{ status: 'belegt', note: 'Meldebescheinigung erkannt, Sie und Ihr Kind sind unter derselben Anschrift gemeldet.' }],
  },
  {
    id: 'idnr',
    fact: 'Steuerliche Identifikationsnummer',
    person: 'Nora Feldmann',
    period: '—',
    register: { evidenceType: 'taxIdentificationNumber', subject: { givenName: 'Nora', familyName: 'Feldmann', dateOfBirth: '1994-03-14' } },
    hint: 'Ein Schreiben des Finanzamts mit Ihrer Identifikationsnummer, zum Beispiel Ihr Steuerbescheid.',
    steps: [{ status: 'belegt', note: 'Identifikationsnummer erkannt und Ihnen zugeordnet.' }],
  },
  {
    id: 'einkommen',
    fact: 'Einkommen in den zwölf Kalendermonaten vor der Geburt',
    person: 'Nora Feldmann',
    period: 'August 2025 bis Juli 2026',
    initial: 'offen',
    hint: 'Ihre Lohn- oder Gehaltsabrechnungen. Ein Sammel-PDF mit allen Monaten genügt — die Seiten werden automatisch getrennt.',
    steps: [
      {
        status: 'unklar',
        note: 'Elf von zwölf Monaten erkannt und zugeordnet. Für März 2026 fehlt die Abrechnung.',
        action: 'Fehlenden Monat nachreichen',
      },
      {
        status: 'belegt',
        note: 'Alle zwölf Monate liegen vor und sind der Angabe zugeordnet.',
      },
    ],
  },
  {
    id: 'elternzeit',
    fact: 'Elternzeit ist beim Arbeitgeber angemeldet',
    person: 'Nora Feldmann',
    period: '2. August 2026 bis 1. August 2027',
    initial: 'offen',
    hint: 'Die Bestätigung Ihres Arbeitgebers.',
    steps: [
      {
        status: 'belegt',
        note: 'Bestätigung erkannt, Zeitraum stimmt mit Ihren Angaben überein.',
      },
    ],
  },
  {
    id: 'mutterschaft',
    fact: 'Mutterschaftsleistungen',
    person: 'Nora Feldmann',
    period: '21. Juni 2026 bis 27. September 2026',
    initial: 'offen',
    hint: 'Die Bescheinigung Ihrer Krankenkasse.',
    steps: [
      {
        status: 'belegt',
        note: 'Bescheinigung erkannt, Zeitraum vollständig abgedeckt.',
      },
    ],
  },
  {
    id: 'erwerb',
    fact: 'Erwerbstätigkeit im Bezugszeitraum',
    person: 'Nora Feldmann',
    period: 'August 2026 bis Juli 2027',
    initial: 'entfaellt',
    reason:
      'Sie haben angegeben, im Bezugszeitraum nicht zu arbeiten. Deshalb ist hier kein Nachweis nötig.',
  },
]
