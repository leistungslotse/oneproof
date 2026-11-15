import type { Validierung } from '../engine/profil/validieren.ts'
import { zaehle } from '../pruefen/ansicht.ts'

/** What the page knows of the check of the draft: what it found, or why it could not be made. */
export type Pruefung = Validierung | { meldung: string }

export interface PruefmeldungenProps {
  pruefung: Pruefung | null
}

/**
 * What the consistency check says about the draft (`validiereProfil`): errors that make a version
 * unusable, and warnings about something that is probably not meant.
 */
export default function Pruefmeldungen({ pruefung }: PruefmeldungenProps) {
  if (!pruefung) return null

  if ('meldung' in pruefung) {
    return (
      <div className="kern-alert kern-alert--warning w-full" role="status">
        <div className="kern-alert__header">
          <span className="kern-icon kern-icon--warning" aria-hidden="true" />
          <span className="kern-title">Der Entwurf konnte nicht geprüft werden</span>
        </div>
        <div className="kern-alert__body">
          <p className="kern-body">{pruefung.meldung}</p>
        </div>
      </div>
    )
  }

  const { fehler, warnungen } = pruefung
  return (
    <>
      {fehler.length > 0 && (
        <div className="kern-alert kern-alert--danger w-full" role="alert">
          <div className="kern-alert__header">
            <span className="kern-icon kern-icon--danger" aria-hidden="true" />
            <span className="kern-title">{zaehle(fehler.length, 'Fehler', 'Fehler')} im Entwurf</span>
          </div>
          <div className="kern-alert__body">
            <p className="kern-body">Eine neue Version lässt sich erst veröffentlichen, wenn das behoben ist.</p>
            <ul className="kern-list kern-list--bullet mt-2">
              {fehler.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {warnungen.length > 0 && (
        <div className="kern-alert kern-alert--warning w-full" role="status">
          <div className="kern-alert__header">
            <span className="kern-icon kern-icon--warning" aria-hidden="true" />
            <span className="kern-title">{zaehle(warnungen.length, 'Hinweis', 'Hinweise')} zum Entwurf</span>
          </div>
          <div className="kern-alert__body">
            <ul className="kern-list kern-list--bullet">
              {warnungen.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  )
}
