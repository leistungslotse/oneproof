import { useId, useState } from 'react'
import Fehlermeldung from '../components/Fehlermeldung.tsx'
import type { Zeitraum } from '../engine/profil/bedingungen.ts'
import { liesMonate } from './ansicht.ts'

interface MonateProps {
  label: string
  hinweis: string
  optional?: boolean
  wert: number | null | undefined
  /** The number of months; `null` where an optional field was left empty. */
  onWert: (monate: number | null) => void
}

/**
 * A number of months. What is typed is only taken over once it is a whole number from 1 on; until
 * then the field says what is expected and the draft keeps its last good value.
 */
function Monate({ label, hinweis, optional = false, wert, onWert }: MonateProps) {
  const id = useId()
  const [getippt, setGetippt] = useState<string | null>(null)

  const angezeigt = getippt ?? (wert == null ? '' : String(wert))
  const leer = angezeigt.trim() === ''
  const fehler = getippt !== null && !(optional && leer) && liesMonate(angezeigt) === null

  return (
    <div className={`kern-form-input ${fehler ? 'kern-form-input--error' : ''}`}>
      <label className="kern-label" htmlFor={id}>
        {label} {optional && <span className="kern-label__optional">(optional)</span>}
      </label>
      <p className="kern-hint" id={`${id}-hinweis`}>
        {hinweis}
      </p>
      <input
        id={id}
        className={`kern-form-input__input kern-form-input__input--width-4 ${fehler ? 'kern-form-input__input--error' : ''}`}
        inputMode="numeric"
        autoComplete="off"
        value={angezeigt}
        aria-invalid={fehler ? 'true' : undefined}
        aria-describedby={`${id}-hinweis${fehler ? ` ${id}-fehler` : ''}`}
        onChange={(ereignis) => {
          const text = ereignis.target.value
          setGetippt(text)
          if (optional && text.trim() === '') onWert(null)
          else if (liesMonate(text) !== null) onWert(liesMonate(text))
        }}
        onBlur={() => {
          if (!fehler) setGetippt(null)
        }}
      />
      {fehler && <Fehlermeldung id={`${id}-fehler`}>Bitte eine ganze Zahl ab 1 eingeben{optional ? ' oder das Feld leer lassen' : ''}.</Fehlermeldung>}
    </div>
  )
}

/** A document type that can prove the condition. */
export interface ZugelassenerTyp {
  typ: string
  label: string
  /** The catalogue counts it by month. */
  monatlich: boolean
}

export interface ZeitraumFeldProps {
  zeitraum: Zeitraum | null
  /** The types that can prove the condition. */
  zugelassen: ZugelassenerTyp[]
  onAendern: (zeitraum: Zeitraum | null) => void
  onAnlegen: () => void
}

/**
 * The period a condition asks for: how many months the documents have to cover, how old they may
 * be, and which of the accepted types each stand for one month.
 */
export default function ZeitraumFeld({ zeitraum, zugelassen, onAendern, onAnlegen }: ZeitraumFeldProps) {
  const id = useId()
  // Types counted by month, and those ticked when the condition was opened, come first; the others
  // wait folded below. Taken once, so that a box does not move away while it is ticked.
  const [vorneAnfangs] = useState(() => new Set(zeitraum?.fuer ?? []))
  const [weitereOffen, setWeitereOffen] = useState(false)

  if (!zeitraum) {
    return (
      <section aria-labelledby={`${id}-titel`}>
        <h3 className="kern-title kern-title--small" id={`${id}-titel`}>
          Zeitraum
        </h3>
        <p className="kern-body mt-2!">Kein Zeitraum: Ein Nachweis genügt, gleich für welchen Monat.</p>
        <button type="button" className="kern-btn kern-btn--secondary kern-btn--small mt-3" onClick={onAnlegen}>
          <span className="kern-label">Zeitraum festlegen</span>
        </button>
      </section>
    )
  }

  const setze = (aenderung: Partial<Zeitraum>) => onAendern({ ...zeitraum, ...aenderung })
  const fuer = new Set(zeitraum.fuer ?? [])
  const vorne = zugelassen.filter(({ typ, monatlich }) => monatlich || vorneAnfangs.has(typ))
  const weitere = zugelassen.filter((eintrag) => !vorne.includes(eintrag))
  const kreuz = ({ typ, label }: ZugelassenerTyp) => (
    <div className="kern-form-check" key={typ}>
      <input
        id={`${id}-${typ}`}
        className="kern-form-check__checkbox"
        type="checkbox"
        checked={fuer.has(typ)}
        onChange={(ereignis) => setze({ fuer: zugelassen.map((eintrag) => eintrag.typ).filter((kandidat) => (kandidat === typ ? ereignis.target.checked : fuer.has(kandidat))) })}
      />
      <label className="kern-label" htmlFor={`${id}-${typ}`}>
        {label}
      </label>
    </div>
  )

  return (
    <section aria-labelledby={`${id}-titel`}>
      <h3 className="kern-title kern-title--small" id={`${id}-titel`}>
        Zeitraum
      </h3>
      <p className="kern-body mt-2!">Unterlagen, die je einen Monat belegen, müssen zusammen mehrere Monate abdecken. Eine Unterlage, die einen Zeitraum selbst bescheinigt, genügt ohne diese Prüfung.</p>

      <div className="op-filter mt-4">
        <Monate
          label="Mindestens so viele Monate"
          hinweis="So viele verschiedene Monate müssen belegt sein."
          wert={zeitraum.mindestens}
          onWert={(monate) => {
            // A field that is not optional only reports a number.
            if (monate !== null) setze({ mindestens: monate })
          }}
        />
        <Monate
          label="Höchstens so alt (Monate)"
          hinweis="Gerechnet ab dem Tag des Antrags."
          optional
          wert={zeitraum.hoechstensAlt}
          onWert={(monate) => setze({ hoechstensAlt: monate })}
        />
      </div>

      <fieldset className="kern-fieldset mt-6">
        <legend className="kern-label">Diese Unterlagen belegen je einen Monat</legend>
        <div className="kern-fieldset__body">
          {zugelassen.length === 0 && <p className="kern-hint">Noch ist keine Unterlage zugelassen, die genügt.</p>}
          {vorne.map(kreuz)}
          {weitere.length > 0 && (
            <details className="kern-details" open={weitereOffen || vorne.length === 0} onToggle={(ereignis) => setWeitereOffen(ereignis.currentTarget.open)}>
              <summary className="kern-details__header">
                <span className="kern-label">
                  Weitere zugelassene Unterlagen <span className="kern-body--muted">({weitere.length})</span>
                </span>
              </summary>
              <div className="kern-details__body">{weitere.map(kreuz)}</div>
            </details>
          )}
        </div>
      </fieldset>
      {zugelassen.length > 0 && fuer.size === 0 && <p className="kern-body kern-body--small mt-2!">Solange keine angekreuzt ist, wird der Zeitraum nicht geprüft.</p>}

      <div className="kern-form-check mt-4">
        <input id={`${id}-beispiel`} className="kern-form-check__checkbox" type="checkbox" checked={zeitraum.beispiel === true} onChange={(ereignis) => setze({ beispiel: ereignis.target.checked })} />
        <label className="kern-label" htmlFor={`${id}-beispiel`}>
          Beispielwerte, noch nicht mit der zuständigen Behörde abgestimmt
        </label>
      </div>

      <button type="button" className="kern-btn kern-btn--tertiary kern-btn--small mt-3" onClick={() => onAendern(null)}>
        <span className="kern-label">Keinen Zeitraum verlangen</span>
      </button>
    </section>
  )
}
