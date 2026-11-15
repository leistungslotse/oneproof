import { useEffect, useRef, useState } from 'react'
import type { Fortschrittsereignis, Phase } from '../engine/pipeline.ts'
import type { Profil } from '../engine/profil/laden.ts'
import { kriechen, schritteFuer, schrittStaende } from './ansicht.ts'
import Seite from './Seite.tsx'

/** How often the bar is brought up to date while the check waits for an answer. */
const TAKT_MS = 250

/** The last report of the check, and when it came in. */
interface LetzterStand {
  phase: Phase | undefined
  anteil: number
  bis: number
  /** `Date.now()` when the report came in. */
  seit: number
}

export interface FortschrittProps {
  profil: Pick<Profil, 'name'>
  /** The last event of the check; `null` before the first. */
  fortschritt: Fortschrittsereignis | null
  mitNachweisen: boolean
  /** The check is a repeated one. */
  erneut: boolean
  onAbbrechen: () => void
}

/**
 * The view while the check runs: a bar, the step it is at, and a way out.
 *
 * The bar is the share the check reports, and only moves forward. In the one step that has no
 * measurable progress — the language model orders the pages and reasons for a while — it creeps
 * towards the end of the step, so that the page does not look stuck.
 */
export default function Fortschritt({ profil, fortschritt, mitNachweisen, erneut, onAbbrechen }: FortschrittProps) {
  const [angezeigt, setAngezeigt] = useState(0)
  const letztes = useRef<LetzterStand>({ phase: undefined, anteil: 0, bis: 0, seit: 0 })

  // Each report starts the creeping anew from where it says the check is.
  useEffect(() => {
    if (fortschritt) letztes.current = { ...fortschritt, seit: Date.now() }
  }, [fortschritt])

  useEffect(() => {
    const takt = setInterval(() => {
      const { phase, anteil, bis, seit } = letztes.current
      const ziel = phase === 'gruppieren' ? kriechen(anteil, bis, Date.now() - seit) : anteil
      setAngezeigt((vorher) => Math.max(vorher, ziel))
    }, TAKT_MS)
    return () => clearInterval(takt)
  }, [])

  const prozent = Math.min(100, Math.round(Math.max(angezeigt, fortschritt?.anteil ?? 0) * 100))
  const schritte = schrittStaende(schritteFuer(mitNachweisen), fortschritt?.phase)
  const text = fortschritt?.text ?? 'Die Prüfung beginnt …'

  return (
    <Seite titel={`${profil.name} beantragen`}>
      <p className="kern-preline">Nachweisprüfung · Schritt 1 von 2</p>
      <h1 id="seitenueberschrift" tabIndex={-1} className="kern-heading-x-large">
        {erneut ? 'Ihre Unterlagen werden erneut geprüft' : 'Ihre Unterlagen werden geprüft'}
      </h1>
      <p className="kern-body mt-4!">
        {mitNachweisen
          ? 'Die Seiten werden gelesen, zu Dokumenten geordnet und den Angaben in Ihrem Antrag zugeordnet. Das kann einige Minuten dauern. Bitte lassen Sie dieses Fenster geöffnet.'
          : 'Ihr Antrag wird gelesen und es wird geprüft, welche Nachweise nötig sind.'}
      </p>

      <div className="kern-progress mt-8">
        <label className="kern-label" htmlFor="pruefung-fortschritt">
          Fortschritt der Prüfung
        </label>
        <progress id="pruefung-fortschritt" max="100" value={prozent} aria-valuetext={`${prozent} Prozent`}>
          {prozent} %
        </progress>
        <p className="kern-body kern-body--small kern-body--muted" aria-hidden="true">
          {prozent} %
        </p>
      </div>

      {/* The only part that is announced: the sentence says what is happening now. */}
      <p className="kern-body mt-6!" role="status" aria-live="polite">
        {text}
      </p>

      <ol className="op-schritte mt-6!" aria-label="Schritte der Prüfung">
        {schritte.map((schritt, index) => (
          <li key={schritt.phase} className={`op-schritt op-schritt--${schritt.stand}`} aria-current={schritt.stand === 'laeuft' ? 'step' : undefined}>
            {schritt.stand === 'fertig' ? (
              <span className="kern-icon kern-icon--success" aria-hidden="true" />
            ) : schritt.stand === 'laeuft' ? (
              <span className="kern-icon kern-icon--autorenew op-schritt__dreht" aria-hidden="true" />
            ) : (
              <span className="kern-number" aria-hidden="true">
                {index + 1}
              </span>
            )}
            <span className={`kern-body ${schritt.stand === 'wartet' ? 'kern-body--muted' : ''}`}>
              {schritt.titel}
              <span className="kern-sr-only">
                {schritt.stand === 'fertig' ? ' – erledigt' : schritt.stand === 'laeuft' ? ' – läuft gerade' : ' – folgt noch'}
              </span>
            </span>
          </li>
        ))}
      </ol>

      <div className="kern-btn-wrapper mt-8">
        <button type="button" className="kern-btn kern-btn--secondary" onClick={onAbbrechen}>
          <span className="kern-icon kern-icon--close" aria-hidden="true" />
          <span className="kern-label">Prüfung abbrechen</span>
        </button>
      </div>
    </Seite>
  )
}
