import { STATUS } from '../status.ts'
import type { StatusSchluessel } from '../status.ts'

export interface BadgeProps {
  status: StatusSchluessel
}

/** The state of a requirement as a KERN badge. */
export default function Badge({ status }: BadgeProps) {
  const { label, badge, icon } = STATUS[status]
  return (
    <span className={`kern-badge ${badge}`}>
      <span className={`kern-icon ${icon}`} aria-hidden="true" />
      {label}
    </span>
  )
}
