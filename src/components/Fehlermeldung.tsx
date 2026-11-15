import type { ReactNode } from 'react'

export interface FehlermeldungProps {
  id: string
  children: ReactNode
}

/** The message under a field, in the form KERN gives it. */
export default function Fehlermeldung({ id, children }: FehlermeldungProps) {
  return (
    <p id={id} className="kern-error" role="alert">
      <span className="kern-icon kern-icon--danger" aria-hidden="true" />
      <span className="kern-body">{children}</span>
    </p>
  )
}
