import { useEffect, useId, useRef, useState } from 'react'

/** How long to wait after the last key before the text is taken over. */
const FRIST_MS = 500

export interface HinweisFeldProps {
  /** The text of the draft. */
  wert: string
  /** The text of the released version; `null` where it has none. */
  basisWert: string | null
  onAendern: (text: string) => void
}

/**
 * The text an applicant reads at a statement that still lacks evidence.
 *
 * What is typed is taken over a moment after the last key, when the field is left, and when the
 * statement is switched — so that the draft is not rewritten with every letter and nothing typed
 * is lost.
 */
export default function HinweisFeld({ wert, basisWert, onAendern }: HinweisFeldProps) {
  const id = useId()
  const [getippt, setGetippt] = useState<string | null>(null)
  const frist = useRef(0)
  const neuester = useRef({ getippt, onAendern })

  useEffect(() => {
    neuester.current = { getippt, onAendern }
  })

  const uebernehmen = () => {
    window.clearTimeout(frist.current)
    const { getippt: text, onAendern: weiter } = neuester.current
    if (text === null) return
    setGetippt(null)
    weiter(text)
  }

  // Leaving the statement takes over what is still waiting.
  useEffect(
    () => () => {
      window.clearTimeout(frist.current)
      const { getippt: text, onAendern: weiter } = neuester.current
      if (text !== null) weiter(text)
    },
    [],
  )

  const angezeigt = getippt ?? wert
  const abweichend = basisWert !== null && angezeigt.trim() !== basisWert.trim()

  return (
    <section>
      <div className="kern-form-input">
        <label className="kern-label" htmlFor={id}>
          Hinweis für Antragstellende <span className="kern-label__optional">(optional)</span>
        </label>
        <p className="kern-hint" id={`${id}-hinweis`}>
          Der Text steht bei der Angabe, solange noch ein Nachweis fehlt. Er sollte sagen, was die Person tun kann.
        </p>
        <textarea
          id={id}
          className="kern-form-input__input"
          rows={3}
          value={angezeigt}
          aria-describedby={`${id}-hinweis`}
          onChange={(ereignis) => {
            setGetippt(ereignis.target.value)
            window.clearTimeout(frist.current)
            frist.current = window.setTimeout(uebernehmen, FRIST_MS)
          }}
          onBlur={uebernehmen}
        />
      </div>
      {abweichend && (
        <button
          type="button"
          className="kern-btn kern-btn--tertiary kern-btn--small mt-2"
          onClick={() => {
            window.clearTimeout(frist.current)
            setGetippt(null)
            onAendern(basisWert)
          }}
        >
          <span className="kern-label">Text der Version wiederherstellen</span>
        </button>
      )}
    </section>
  )
}
