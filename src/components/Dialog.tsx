import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'

export interface DialogProps {
  offen: boolean
  titel: string
  onSchliessen: () => void
  /** The buttons; the last one is the one that goes on. */
  fuss?: ReactNode
  children: ReactNode
}

/**
 * A KERN dialog on the native `<dialog>` element: the browser keeps the focus inside while it is
 * open, closes it on Escape and gives the focus back to what opened it.
 *
 * What it holds is only rendered while it is open, so a long list costs nothing before.
 */
export default function Dialog({ offen, titel, onSchliessen, fuss = null, children }: DialogProps) {
  const element = useRef<HTMLDialogElement>(null)
  const titelId = useId()

  useEffect(() => {
    const dialog = element.current
    if (!dialog) throw new Error('Der Dialog ist nicht eingehängt.')
    if (offen && !dialog.open) dialog.showModal()
    else if (!offen && dialog.open) dialog.close()
  }, [offen])

  return (
    <dialog ref={element} className="kern-dialog op-dialog" aria-labelledby={titelId} onClose={onSchliessen}>
      <div className="kern-dialog__header">
        <h2 className="kern-title" id={titelId}>
          {titel}
        </h2>
        <button type="button" className="kern-btn kern-btn--tertiary kern-btn--small" onClick={onSchliessen}>
          <span className="kern-icon kern-icon--close" aria-hidden="true" />
          <span className="kern-sr-only">Schließen</span>
        </button>
      </div>
      <div className="kern-dialog__body">{offen ? children : null}</div>
      {offen && fuss ? <div className="kern-dialog__footer">{fuss}</div> : null}
    </dialog>
  )
}
