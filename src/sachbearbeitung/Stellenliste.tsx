import { useId } from 'react'
import type { ReactNode } from 'react'
import type { Bedingung, StelleFormat2 } from '../engine/profil/bedingungen.ts'
import { zaehle } from '../pruefen/ansicht.ts'
import { passtZumFilter } from './ansicht.ts'
import type { Filter, Stellengruppen } from './ansicht.ts'

interface StandProps {
  stelle: StelleFormat2
  istGeaendert: (bedingung: Bedingung) => boolean
}

/** How far a place is: something open, something to check, or all decided — and what the draft changes. */
function Stand({ stelle, istGeaendert }: StandProps) {
  const offen = stelle.bedingungen.filter((bedingung) => bedingung.status === 'offen').length
  const vorschlag = stelle.bedingungen.filter((bedingung) => bedingung.status === 'vorschlag').length
  const geaendert = stelle.bedingungen.filter(istGeaendert).length
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="kern-body kern-body--small kern-body--muted">{zaehle(stelle.bedingungen.length, 'Bedingung', 'Bedingungen')}</span>
      {offen > 0 ? (
        <span className="kern-badge kern-badge--warning">{offen} offen</span>
      ) : vorschlag > 0 ? (
        <span className="kern-badge kern-badge--info">{vorschlag} zu prüfen</span>
      ) : (
        <span className="kern-badge kern-badge--success">festgelegt</span>
      )}
      {geaendert > 0 && <span className="kern-body kern-body--small">{stelle.bedingungen.length === 1 ? 'geändert' : `${geaendert} geändert`}</span>}
    </span>
  )
}

interface EintragProps {
  stelle: StelleFormat2
  gewaehlt: string | null
  children: ReactNode
}

function Eintrag({ stelle, gewaehlt, children }: EintragProps) {
  return (
    <li>
      <a className="op-angabe" href={`#${encodeURIComponent(stelle.id)}`} aria-current={stelle.id === gewaehlt ? 'true' : undefined}>
        <span className="kern-body kern-body--bold">{stelle.titel}</span>
        {children}
      </a>
    </li>
  )
}

export interface StellenlisteProps {
  gruppen: Stellengruppen
  gewaehlt: string | null
  filter: Filter
  istGeaendert: (bedingung: Bedingung) => boolean
}

/**
 * The places of an application type where evidence can be asked for, by section — those the
 * filter leaves —, and those that knowingly ask for none.
 */
export default function Stellenliste({ gruppen, gewaehlt, filter, istGeaendert }: StellenlisteProps) {
  const id = useId()
  const anzahl = gruppen.bereiche.reduce((summe, { stellen }) => summe + stellen.length, 0) + gruppen.ohne.length
  const passt = (stelle: StelleFormat2) => stelle.bedingungen.some((bedingung) => passtZumFilter(filter, bedingung, istGeaendert(bedingung)))
  const sichtbar = gruppen.bereiche.map(({ bereich, stellen }) => ({ bereich, stellen: stellen.filter(passt) })).filter(({ stellen }) => stellen.length > 0)

  return (
    <nav aria-labelledby={`${id}-titel`} className="flex flex-col gap-6">
      <div>
        <h2 className="kern-title kern-title--small" id={`${id}-titel`}>
          Wo der Antrag Nachweise verlangt
        </h2>
        <p className="kern-body kern-body--small kern-body--muted mt-1!">{zaehle(anzahl, 'Stelle', 'Stellen')}, aus dem Schema gelesen</p>
      </div>

      {sichtbar.map(({ bereich, stellen }) => (
        <section key={bereich} aria-label={bereich}>
          <h3 className="kern-title kern-title--small">{bereich}</h3>
          <ul className="op-angaben mt-2">
            {stellen.map((stelle) => (
              <Eintrag key={stelle.id} stelle={stelle} gewaehlt={gewaehlt}>
                <Stand stelle={stelle} istGeaendert={istGeaendert} />
              </Eintrag>
            ))}
          </ul>
        </section>
      ))}
      {sichtbar.length === 0 && <p className="kern-body">Keine Stelle passt zum Filter.</p>}

      {gruppen.ohne.length > 0 && (
        <details className="kern-details" open={gruppen.ohne.some((stelle) => stelle.id === gewaehlt) || undefined}>
          <summary className="kern-details__header">
            <span className="kern-body">
              Bewusst ohne Nachweis <span className="kern-body--muted">({gruppen.ohne.length})</span>
            </span>
          </summary>
          <div className="kern-details__body">
            <ul className="op-angaben">
              {gruppen.ohne.map((stelle) => (
                <Eintrag key={stelle.id} stelle={stelle} gewaehlt={gewaehlt}>
                  <span className="kern-body kern-body--small kern-body--muted">{stelle.ohne}</span>
                </Eintrag>
              ))}
            </ul>
          </div>
        </details>
      )}
    </nav>
  )
}
