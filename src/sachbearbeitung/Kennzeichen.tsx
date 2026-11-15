import type { ReactNode } from 'react'
import type { Herkunft, Status } from '../engine/profil/bedingungen.ts'
import { HERKUNFT, STAND } from './ansicht.ts'

const ICON = { success: 'success', info: 'info', warning: 'warning' }

export interface StandBadgeProps {
  status: Status
}

/** How far a condition is decided: festgelegt, Vorschlag, offen. */
export function StandBadge({ status }: StandBadgeProps) {
  const { titel, badge } = STAND[status] ?? STAND.offen
  return (
    <span className={`kern-badge kern-badge--${badge}`}>
      <span className={`kern-icon kern-icon--${ICON[badge]}`} aria-hidden="true" />
      {titel}
    </span>
  )
}

export interface HerkunftChipProps {
  art: Herkunft['art']
}

/** Where the condition of a place comes from: the step of the ladder, or the profile before. */
export function HerkunftChip({ art }: HerkunftChipProps) {
  const { nr, titel, klasse } = HERKUNFT[art] ?? HERKUNFT.immer
  return (
    <span className={`op-herkunft op-herkunft--${klasse}`}>
      {nr !== null && (
        <span className="op-herkunft__nr" aria-hidden="true">
          {nr}
        </span>
      )}
      {titel}
    </span>
  )
}

export interface HinweisProps {
  art?: 'info' | 'success' | 'warning' | 'danger'
  titel: string
  children?: ReactNode
}

/** A short alert of KERN: a title and a few words. */
export function Hinweis({ art = 'info', titel, children }: HinweisProps) {
  return (
    <div className={`kern-alert kern-alert--${art} w-full`} role={art === 'danger' ? 'alert' : 'status'}>
      <div className="kern-alert__header">
        <span className={`kern-icon kern-icon--${art}`} aria-hidden="true" />
        <span className="kern-title">{titel}</span>
      </div>
      {children && <div className="kern-alert__body">{children}</div>}
    </div>
  )
}
