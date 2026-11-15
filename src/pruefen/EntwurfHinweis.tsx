import type { Entwurf } from '../engine/profil/entwurf.ts'
import type { Profil } from '../engine/profil/laden.ts'

export interface EntwurfHinweisProps {
  profil: Pick<Profil, 'id' | 'name'>
  /** `basis` is the version it was made from; `null` for a new profile. */
  entwurf: Pick<Entwurf, 'basis'>
}

/**
 * The note that this check does not run against a released profile. A result made this way carries
 * the draft's own version (`…-entwurf`) and must not be taken for one made against the release.
 */
export default function EntwurfHinweis({ profil, entwurf }: EntwurfHinweisProps) {
  return (
    <div className="kern-alert kern-alert--warning mb-6 w-full" role="status">
      <div className="kern-alert__header">
        <span className="kern-icon kern-icon--warning" aria-hidden="true" />
        <span className="kern-title">Entwurf der Fachabteilung</span>
      </div>
      <div className="kern-alert__body">
        <p className="kern-body">
          {entwurf.basis
            ? `Sie prüfen mit einem Entwurf des Profils „${profil.name}“, gemacht aus der Version ${entwurf.basis}.`
            : `Sie prüfen mit dem Entwurf des neuen Profils „${profil.name}“.`}{' '}
          Der Entwurf ist nicht veröffentlicht und liegt nur in diesem Browser. Das Ergebnis gilt zum Ausprobieren.
        </p>
        <p className="kern-body mt-2!">
          <a
            className="kern-link"
            href={`/sachbearbeitung.html?profil=${encodeURIComponent(entwurf.basis ? `${profil.id}@${entwurf.basis}` : profil.id)}`}
          >
            Zurück zur Profilverwaltung
          </a>
          {entwurf.basis && (
            <>
              {' · '}
              <a className="kern-link" href={`?profil=${encodeURIComponent(profil.id)}`}>
                Mit der veröffentlichten Version prüfen
              </a>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
