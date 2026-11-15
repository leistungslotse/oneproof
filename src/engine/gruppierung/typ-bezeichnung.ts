/**
 * Display names of document types.
 *
 * Port of app/Support/Evidence/EvidenceTypeLabel.php. The catalog (`katalog`, the parsed
 * dokumenttypen.json, key = type) is always handed in, never imported or fetched here.
 *
 * Differences from PHP:
 * - for() reads config('evidence_templates.<type>.label'), here it reads `katalog[typ].label`.
 *   The fallback for a type the catalog does not know is Laravel's
 *   `Str::of($type)->replace('_', ' ')->ucfirst()`, rebuilt one to one without Laravel.
 * - incomeType() is NOT ported: it asks Laravel's translator (`__()`) for the label of an income
 *   type in the citizen form, and those translations do not exist here.
 */

/**
 * A rule of `confusions` in the catalog: a document of the type it stands under is really `type`
 * if its text mentions a keyword from `requires` and none from `unless` (see typ-korrektur.ts).
 */
export interface Verwechslung {
  /** The type the document really is */
  type: string
  requires?: string[]
  unless?: string[]
}

/** What the grouping reads of the entry of a document type in the catalog. */
export interface Katalogeintrag {
  /** German display name */
  label?: string
  /** What the model is told about the type */
  description?: string
  /** What is read per part; a type without fields forms no series */
  fields?: Record<string, string> | string[]
  confusions?: Verwechslung[]
}

/** The catalog (parsed dokumenttypen.json): document type key -> entry. */
export type Katalog = Record<string, Katalogeintrag>

/**
 * The catch-all type: the genus for everything the catalog has no genus for. It is the only
 * type whose documents may carry a name of their own (`typeLabel`), and the only one that is
 * never merged into a series.
 */
export const AUFFANGTYP = 'other_document'

/**
 * Short names for badges, references and narrow columns, where the long catalog name (which
 * lists every kind a type covers because it briefs the model) does not fit. Display only: the
 * catalog name stays untouched. Types without an entry here use their catalog name.
 */
export const KURZBEZEICHNUNGEN: Readonly<Record<string, string>> = Object.freeze({
  citizen_benefit_notice: 'Grundsicherungsbescheid (SGB II)',
  maintenance_title: 'Unterhaltstitel',
  maintenance_payment_proof: 'Zahlungsnachweis Unterhalt',
  disability_notice: 'Schwerbehinderung/Pflegegrad',
  loan_payment_proof: 'Zahlungsnachweis Darlehen',
  loan_contract: 'Darlehensvertrag',
  loan_amortization_plan: 'Tilgungsplan',
  special_payment_proof: 'Sonderzahlungsnachweis',
  bafoeg_notice: 'BAföG-Bescheid',
  bab_notice: 'BAB-Bescheid',
  employment_termination: 'Kündigung/Vertragsänderung',
  rent_payment_proof: 'Mietzahlungsnachweis',
  birth_custody_certificate: 'Geburtsurkunde/Sorgerecht',
  parking_service_proof: 'Stellplatznachweis',
  parking_rental_contract: 'Stellplatzvermietung',
  ns_persecution_proof: 'NS-Verfolgtennachweis',
  public_grant_proof: 'Kostenübernahme/Zuschuss',
  housing_benefit_notice: 'Wohngeldbescheid',
  ground_lease_proof: 'Erbbaurecht/Erbbauzins',
  wage_replacement_notice: 'Lohnersatzbescheid',
  bvg_assistance_notice: 'Lebensunterhalt SGB XIV/BVG',
  youth_welfare_notice: 'Jugendhilfebescheid',
  registration_certificate: 'Meldebescheinigung',
  residence_permit: 'Aufenthaltstitel',
  homeowner_fee_statement: 'Hausgeldabrechnung',
  care_home_contract: 'Heimvertrag',
  insurance_contribution_proof: 'Beitragsnachweis Vorsorge',
  third_party_support_proof: 'Zuwendungen Dritter',
  request_to_apply: 'Aufforderung zum Antrag',
})

/**
 * The name of a type IN ITS ROLE: group -> type -> name. The same document is called
 * differently depending on the evidence group it proves. Maintenance paid is a deduction
 * (§ 18 WoGG), maintenance received is income (§ 14 WoGG); the catalog name must keep both
 * directions open because it briefs the model. Display only.
 */
export const GRUPPENBEZEICHNUNGEN: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  'benefit:maintenance_payment_proof': Object.freeze({
    maintenance_payment_proof: 'Einnahmen aus Unterhalt',
  }),
  alimony_proof: Object.freeze({
    maintenance_payment_proof: 'Zahlungsnachweis Unterhalt',
  }),
  single_payment_proof: Object.freeze({
    special_payment_proof: 'Nachweis der Einmalzahlung',
  }),
  other_income_proof: Object.freeze({
    other_document: 'Nachweis sonstiger Einnahmen',
  }),
  building_contract_proof: Object.freeze({
    asset_proof: 'Jahresauszug Bausparvertrag',
    other_document: 'Unterlagen der Personenversicherung',
  }),
  ground_lease_proof: Object.freeze({
    ground_lease_proof: 'Erbbaurechtsvertrag/Erbbauzins',
  }),
  other_charges_proof: Object.freeze({
    other_document: 'Nachweis weiterer Belastungen',
  }),
})

const hasOwn = (object: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key)

/**
 * The catalog entry of a type, or null. Only own keys count, so a type string such as
 * "constructor" cannot reach into Object.prototype. Shared by the other grouping steps.
 */
export function katalogEintrag(typ: string | null | undefined, katalog: Katalog | null | undefined): Katalogeintrag | null {
  if (katalog === null || typeof katalog !== 'object') return null

  const key = String(typ ?? '')

  return hasOwn(katalog, key) ? (katalog[key] ?? null) : null
}

/** PHP Str::of($type)->replace('_', ' ')->ucfirst(): first CHARACTER upper case, not first byte. */
function humanisiert(typ: string): string {
  const text = typ.replace(/_/g, ' ')
  const [first = ''] = text

  return first.toUpperCase() + text.slice(first.length)
}

/**
 * German display name of a type key: the catalog label, or a humanised form of the key when the
 * type is not in the catalog (an invented type becomes e.g. "Gesellschaftsvertrag").
 */
export function bezeichnungFuer(typ: string | null | undefined, katalog: Katalog | null | undefined): string {
  const label = katalogEintrag(typ, katalog)?.label

  return typeof label === 'string' && label !== '' ? label : humanisiert(String(typ ?? ''))
}

/** The short name of a type (KURZBEZEICHNUNGEN), without an entry the full name. */
export function kurzbezeichnungFuer(typ: string | null | undefined, katalog: Katalog | null | undefined): string {
  const key = String(typ ?? '')
  const kurz = hasOwn(KURZBEZEICHNUNGEN, key) ? KURZBEZEICHNUNGEN[key] : undefined

  return kurz ?? bezeichnungFuer(typ, katalog)
}

/** The role name of a type in an evidence group, or null when the group has none for it. */
function rollenname(gruppe: string, typ: string | null | undefined): string | null {
  const group = String(gruppe)
  const key = String(typ ?? '')
  const namen = hasOwn(GRUPPENBEZEICHNUNGEN, group) ? GRUPPENBEZEICHNUNGEN[group] : undefined

  if (namen === undefined || !hasOwn(namen, key)) return null

  return namen[key] ?? null
}

/** The name of a type inside an evidence group (GRUPPENBEZEICHNUNGEN), without an entry the full name. */
export function bezeichnungInGruppe(gruppe: string, typ: string | null | undefined, katalog: Katalog | null | undefined): string {
  return rollenname(gruppe, typ) ?? bezeichnungFuer(typ, katalog)
}

/** Like bezeichnungInGruppe, but the fallback is the short name: the role name is already the shorter one. */
export function kurzbezeichnungInGruppe(gruppe: string, typ: string | null | undefined, katalog: Katalog | null | undefined): string {
  return rollenname(gruppe, typ) ?? kurzbezeichnungFuer(typ, katalog)
}
