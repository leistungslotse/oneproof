export interface StatusDarstellung {
  label: string
  /** The KERN class of the badge. */
  badge: string
  /** The KERN class of the icon. */
  icon: string
  explanation: string
}

/**
 * Every state a requirement can be in, plus how it presents itself.
 *
 * Shared by the dummy and by the evidence check: both show the same five states in the same way,
 * and the states are the ones of `Status` in `public/openapi.yaml` (plus `pruefung`, which only
 * exists while a page is waiting for a result).
 */
export const STATUS = {
  belegt: {
    label: 'belegt',
    badge: 'kern-badge--success',
    icon: 'kern-icon--success',
    explanation: 'Diese Angabe ist nachgewiesen. Sie müssen nichts weiter tun.',
  },
  offen: {
    label: 'offen',
    badge: 'kern-badge--warning',
    icon: 'kern-icon--warning',
    explanation: 'Für diese Angabe fehlt noch ein Nachweis.',
  },
  unklar: {
    label: 'unklar',
    badge: 'kern-badge--info',
    icon: 'kern-icon--info',
    explanation: 'Der Nachweis liegt vor, deckt die Angabe aber noch nicht vollständig ab.',
  },
  pruefung: {
    label: 'wird geprüft',
    badge: 'kern-badge--info',
    icon: 'kern-icon--autorenew',
    explanation: 'Der Nachweis wird gerade gelesen und der Angabe zugeordnet.',
  },
  entfaellt: {
    label: 'nicht erforderlich',
    badge: 'kern-badge--small',
    icon: 'kern-icon--check',
    explanation: 'Diese Angabe ist in Ihrem Fall nicht zu belegen.',
  },
} satisfies Record<string, StatusDarstellung>

/** The states a requirement can be shown in. */
export type StatusSchluessel = keyof typeof STATUS
