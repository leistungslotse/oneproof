import type { ReactNode } from 'react'

export interface MetaProps {
  pairs: readonly (readonly [key: string, value: ReactNode])[]
}

/** Key/value pairs on one line, for requirements that need no further action. */
export default function Meta({ pairs }: MetaProps) {
  return (
    <dl className="kern-description-list op-meta">
      {pairs.map(([key, value]) => (
        <div key={key} className="kern-description-list-item">
          <dt className="kern-description-list-item__key">{key}</dt>
          <dd className="kern-description-list-item__value">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
