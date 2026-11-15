import { useRef } from 'react'
import type { ReactNode } from 'react'
import Badge from '../components/Badge.tsx'
import Meta from '../components/Meta.tsx'
import type { Anforderung } from '../engine/zuordnung/anforderungen.ts'
import { belegZeilen, quellenNachRolle, zusammenhalten } from './ansicht.ts'
import type { QuelleZeile } from './ansicht.ts'

const NACHWEIS_ENDUNGEN = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'

/** The title of a card: the fact, and which of several entries of the same kind it is. */
function Titel({ angabe, klein = false }: { angabe: Pick<Anforderung, 'fact' | 'von' | 'eintrag'>; klein?: boolean }) {
  const mehrere = angabe.von !== null && angabe.von > 1
  return (
    <h3 className={`kern-title ${klein ? 'kern-title--small' : ''}`}>
      {angabe.fact}
      {mehrere && <span className="kern-body kern-body--muted"> ({angabe.eintrag}. von {angabe.von})</span>}
    </h3>
  )
}

/** The documents that prove a statement: what they are, which file and which pages. */
function Belege({ belege }: { belege: Anforderung['belege'] }) {
  return (
    <ul className="op-belege">
      {belegZeilen(belege).map((zeile) => (
        <li key={zeile.schluessel}>
          <span className="kern-body">
            {zeile.art}
            {zeile.rolle && <span className="kern-body--small kern-body--muted"> — {zeile.rolle}</span>}
          </span>
          <span className="kern-body kern-body--small kern-body--muted block">
            {zeile.dateien.map(({ schluessel, name, seiten }) => (
              <span key={schluessel} className="block">
                {name}, {zusammenhalten(seiten)}
              </span>
            ))}
            {zeile.person && <span className="block">Lautet auf: {zeile.person}</span>}
            {zeile.monate.length > 0 && <span className="block">Abrechnungsmonate: {zeile.monate.join(', ')}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** The rows of a card: whom it concerns, what the application says, what proves it. */
function zeilenVon(angabe: Pick<Anforderung, 'person' | 'aussage' | 'belege'>): [string, ReactNode][] {
  const zeilen: ([string, ReactNode] | null)[] = [
    angabe.person ? ['Betrifft', angabe.person] : null,
    angabe.aussage ? ['Ihre Angabe', angabe.aussage] : null,
    angabe.belege.length > 0 ? ['Beleg', <Belege key="belege" belege={angabe.belege} />] : null,
  ]
  return zeilen.filter((zeile) => zeile !== null)
}

export interface WelcheUnterlagenProps {
  /** The kinds of document the profile accepts for the statement. */
  quellen: readonly QuelleZeile[]
  /** Shows the list unfolded. */
  offen?: boolean
}

/**
 * Which documents the profile accepts for a statement — the answer to "does a bank statement do?"
 * `offen` shows the list unfolded; the department's preview shows it as the applicant sees it.
 */
export function WelcheUnterlagen({ quellen, offen = false }: WelcheUnterlagenProps) {
  const gruppen = quellenNachRolle(quellen)
  if (gruppen.length === 0) return null

  return (
    // `self-stretch`: KERN lays a card body out as a column with its items at the start, so a list inside
    // would grow to the width of its longest line and push a phone-sized page sideways.
    <details className="kern-details mt-2 self-stretch" open={offen || undefined}>
      <summary className="kern-details__header">
        <span className="kern-title kern-title--small">Welche Unterlagen genügen?</span>
      </summary>
      <div className="kern-details__body">
        {gruppen.map(({ rolle, titel, arten }) => (
          <div key={rolle} className="mb-3">
            <p className="kern-body kern-body--bold">{titel}</p>
            <ul className="kern-list kern-list--bullet">
              {arten.map((art) => (
                <li key={art}>{art}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  )
}

export interface OffeneAngabeProps {
  angabe: Anforderung
  /** The status changed in the last check: the card lights up. */
  gerade: boolean
  /** More evidence for this statement: read it and check again. */
  onNachweise: (dateien: File[]) => void
}

/**
 * A statement of the application that still needs something from the person: open, or with a
 * document that does not yet prove it.
 */
export function OffeneAngabe({ angabe, gerade, onNachweise }: OffeneAngabeProps) {
  const feld = useRef<HTMLInputElement>(null)
  // The button opens the file chooser; an action that asks to check something is a heading, not its label.
  const hochladen = /hinzufügen$/.test(angabe.action ?? '')

  return (
    <div className={`kern-card kern-card--hug kern-card--small ${gerade ? 'op-settled' : ''}`}>
      <div className="kern-card__container">
        <div className="kern-card__header flex-row! items-center! justify-between! gap-4!">
          <Titel angabe={angabe} />
          <Badge status={angabe.status} />
        </div>

        <div className="kern-card__body">
          <Meta pairs={zeilenVon(angabe)} />

          {angabe.status === 'offen' && angabe.hint && <p className="kern-hint">{angabe.hint}</p>}

          {angabe.note && (
            <div className="kern-alert kern-alert--info mt-2 w-full">
              <div className="kern-alert__header">
                <span className="kern-icon kern-icon--info" aria-hidden="true" />
                <span className="kern-title">{hochladen || !angabe.action ? 'Es fehlt noch etwas' : angabe.action}</span>
              </div>
              <div className="kern-alert__body">
                <p className="kern-body">{angabe.note}</p>
              </div>
            </div>
          )}

          {angabe.anmerkungen.map((anmerkung) => (
            <p key={anmerkung} className="kern-body kern-body--small kern-body--muted">
              {anmerkung}
            </p>
          ))}

          <WelcheUnterlagen quellen={angabe.quellen} />
        </div>

        <div className="kern-card__footer op-actions">
          <button type="button" className="kern-btn kern-btn--secondary kern-btn--small" onClick={() => feld.current?.click()}>
            <span className="kern-icon kern-icon--drive-folder-upload" aria-hidden="true" />
            <span className="kern-label">{hochladen ? angabe.action : 'Dateien hinzufügen'}</span>
          </button>
          <input
            ref={feld}
            type="file"
            multiple
            accept={NACHWEIS_ENDUNGEN}
            className="op-file-input"
            tabIndex={-1}
            aria-label={`Nachweis hochladen für: ${angabe.fact}${angabe.person ? ` (${angabe.person})` : ''}`}
            onChange={(ereignis) => {
              onNachweise(Array.from(ereignis.target.files ?? []))
              // Allow picking the same file again on a follow-up upload.
              ereignis.target.value = ''
            }}
          />
        </div>
      </div>
    </div>
  )
}

export interface BelegteAngabeProps {
  angabe: Anforderung
  /** The status changed in the last check: the card lights up. */
  gerade: boolean
}

/** A statement the evidence proves. */
export function BelegteAngabe({ angabe, gerade }: BelegteAngabeProps) {
  return (
    <div className={`kern-card kern-card--hug kern-card--small ${gerade ? 'op-settled' : ''}`}>
      <div className="kern-card__container">
        <div className="kern-card__header flex-row! items-center! justify-between! gap-4!">
          <Titel angabe={angabe} />
          <Badge status="belegt" />
        </div>
        <div className="kern-card__body">
          <Meta pairs={zeilenVon(angabe)} />
          {angabe.anmerkungen.map((anmerkung) => (
            <p key={anmerkung} className="kern-body kern-body--small kern-body--muted">
              {anmerkung}
            </p>
          ))}
        </div>
      </div>
    </div>
  )
}

export interface EntfalleneAngabeProps {
  angabe: Anforderung
}

/** A statement that does not apply, with the reason from the application's own answer. */
export function EntfalleneAngabe({ angabe }: EntfalleneAngabeProps) {
  return (
    <div className="kern-card kern-card--hug kern-card--small">
      <div className="kern-card__container">
        <div className="kern-card__header flex-row! items-center! justify-between! gap-4!">
          <Titel angabe={angabe} klein />
          <Badge status="entfaellt" />
        </div>
        <div className="kern-card__body">
          {angabe.person && <Meta pairs={[['Betrifft', angabe.person]]} />}
          <p className="kern-body kern-body--small kern-body--muted">{angabe.reason}</p>
        </div>
      </div>
    </div>
  )
}
