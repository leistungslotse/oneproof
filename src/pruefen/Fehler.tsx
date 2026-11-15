import type { PruefFehler } from '../engine/fehler.ts'
import type { Profil } from '../engine/profil/laden.ts'
import { empfehlungZu, ueberschriftZu } from './ansicht.ts'
import Seite from './Seite.tsx'

export interface FehlerProps {
  profil: Pick<Profil, 'name'>
  fehler: PruefFehler
  /** Checks the same files once more. */
  onErneut: () => void
  onZurueck: () => void
}

/**
 * The view after a check that failed. The files stay chosen: a person never has to pick them again.
 */
export default function Fehler({ profil, fehler, onErneut, onZurueck }: FehlerProps) {
  const empfehlung = empfehlungZu(fehler)

  return (
    <Seite titel={`${profil.name} beantragen`}>
      <p className="kern-preline">Nachweisprüfung</p>
      <h1 id="seitenueberschrift" tabIndex={-1} className="kern-heading-x-large">
        Die Prüfung ist nicht gelungen
      </h1>

      <div className="kern-alert kern-alert--danger mt-6" role="alert">
        <div className="kern-alert__header">
          <span className="kern-icon kern-icon--danger" aria-hidden="true" />
          <span className="kern-title">{ueberschriftZu(fehler)}</span>
        </div>
        <div className="kern-alert__body">
          <p className="kern-body">{fehler.message}</p>
          {empfehlung && <p className="kern-body mt-3!">{empfehlung}</p>}
        </div>
      </div>

      <div className="kern-btn-wrapper mt-8">
        {fehler.wiederholbar && (
          <button type="button" className="kern-btn kern-btn--primary" onClick={onErneut}>
            <span className="kern-icon kern-icon--autorenew" aria-hidden="true" />
            <span className="kern-label">Erneut versuchen</span>
          </button>
        )}
        <button type="button" className={`kern-btn ${fehler.wiederholbar ? 'kern-btn--secondary' : 'kern-btn--primary'}`} onClick={onZurueck}>
          <span className="kern-icon kern-icon--arrow-back" aria-hidden="true" />
          <span className="kern-label">Zurück</span>
        </button>
      </div>
    </Seite>
  )
}
