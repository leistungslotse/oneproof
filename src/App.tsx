import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import Badge from './components/Badge.tsx'
import Footer from './components/Footer.tsx'
import Kopfzeile from './components/Kopfzeile.tsx'
import Meta from './components/Meta.tsx'
import { retrieveFromRegisters } from './noots.ts'
import { APPLICANT, REQUIREMENTS } from './scenario.ts'
import type { DroppedRequirement, RegisterRequirement, UploadRequirement } from './scenario.ts'
import type { StatusSchluessel } from './status.ts'

/** How long a simulated evidence check runs, in milliseconds. */
const CHECK_DURATION = 1200

/** The way on from the dummy: the real check with one's own files, and the interface behind it. */
const FOOTER_LINKS = [
  { href: '/pruefen.html', text: 'Eigene Antragsdaten und Nachweise prüfen lassen (Wohngeld)' },
  { href: '/api.html', text: 'Die Schnittstelle hinter dieser Seite ansehen' },
]

/** The requirements that name a registry: they are asked over the NOOTS when the page opens. */
const REGISTER_REQUIREMENTS = REQUIREMENTS.filter((item): item is RegisterRequirement => item.register !== undefined)

/** A requirement the applicant may have to act on. */
type ActionableRequirement = RegisterRequirement | UploadRequirement

/** What the page knows of a requirement while the walkthrough runs. */
interface RequirementState {
  status: StatusSchluessel
  note: string | null
  /** Names of the files uploaded so far. */
  files: string[]
  stepIndex: number
  settled: boolean
  register: 'pending' | 'delivered' | 'failed' | null
  registerNote?: string
  source?: string
  sourceDetail?: string
  evidenceType?: string
}

/** By the id of the requirement. */
type States = Record<string, RequirementState>

/** The state of a requirement: every requirement has one from the start. */
function stateOf(states: States, id: string): RequirementState {
  const state = states[id]
  if (!state) throw new Error(`There is no state for the requirement ${id}.`)
  return state
}

/** Every requirement as the page opens: what names a registry is being asked, the rest starts as scripted. */
function initialStates(): States {
  return Object.fromEntries(
    REQUIREMENTS.map((item): [string, RequirementState] => [
      item.id,
      {
        status: item.register ? 'pruefung' : item.initial,
        note: null,
        files: [],
        stepIndex: 0,
        settled: false,
        register: item.register ? 'pending' : null,
      },
    ]),
  )
}

/** A requirement the registry has delivered for: what the page shows of it. */
type ConfirmedItem = Pick<RegisterRequirement, 'id' | 'fact' | 'person' | 'period'> & Pick<RequirementState, 'source' | 'sourceDetail'>

interface ConfirmedSectionProps {
  items: ConfirmedItem[]
  pending: RegisterRequirement[]
}

/** The facts NOOTS answered, in Markus' wording, and those still being asked. */
function ConfirmedSection({ items, pending }: ConfirmedSectionProps) {
  if (items.length === 0 && pending.length === 0) return null

  return (
    <section className="mt-8" aria-labelledby="ueberschrift-bestaetigt">
      <h2 id="ueberschrift-bestaetigt" className="kern-heading-medium">
        {items.length > 0
          ? 'Folgende Informationen konnten bereits über eine NOOTS-Abfrage bestätigt werden'
          : 'Die NOOTS-Abfrage läuft'}
      </h2>
      <p className="kern-body kern-body--muted">
        Diese Angaben {items.length > 0 ? 'hat' : 'erfragt'} Ihre Behörde direkt bei der zuständigen Stelle
        {items.length > 0 ? ' erfragt' : ''}. Sie müssen dafür nichts einreichen.
      </p>

      <div className="mt-4 flex flex-col gap-4" aria-live="polite">
        {pending.map((item) => (
          <div key={item.id} className="kern-card kern-card--hug kern-card--small">
            <div className="kern-card__container">
              <div className="kern-card__header flex-row! items-center! justify-between! gap-4!">
                <h3 className="kern-title">{item.fact}</h3>
                <Badge status="pruefung" />
              </div>
              <div className="kern-card__body">
                <Meta
                  pairs={[
                    ['Betrifft', item.person],
                    ['Zeitraum', item.period],
                  ]}
                />
                <p className="kern-body kern-body--small kern-body--muted">
                  Wird bei der zuständigen Stelle erfragt …
                </p>
              </div>
            </div>
          </div>
        ))}
        {items.map((item) => (
          <div key={item.id} className="kern-card kern-card--hug kern-card--small">
            <div className="kern-card__container">
              <div className="kern-card__header flex-row! items-center! justify-between! gap-4!">
                <h3 className="kern-title">{item.fact}</h3>
                <Badge status="belegt" />
              </div>
              <div className="kern-card__body">
                <Meta
                  pairs={[
                    ['Betrifft', item.person],
                    ['Zeitraum', item.period],
                    ['Quelle', item.source],
                  ]}
                />
                <p className="kern-body kern-body--small kern-body--muted">
                  {item.sourceDetail}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

interface OpenRequirementProps {
  item: ActionableRequirement
  state: RequirementState
  onUpload: (id: string, fileNames: string[]) => void
}

/** One requirement the applicant still has to act on. */
function OpenRequirement({ item, state, onUpload }: OpenRequirementProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const { status, note, files, settled } = state
  const busy = status === 'pruefung'
  const step = item.steps?.[state.stepIndex - 1]

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? [])
    if (chosen.length === 0) return
    onUpload(item.id, chosen.map((file) => file.name))
    // Allow picking the same file again on the follow-up upload.
    event.target.value = ''
  }

  return (
    <div
      className={`kern-card kern-card--hug kern-card--small ${settled ? 'op-settled' : ''}`}
    >
      <div className="kern-card__container">
        <div className="kern-card__header flex-row! items-center! justify-between! gap-4!">
          <h3 className="kern-title">{item.fact}</h3>
          <Badge status={status} />
        </div>

        <div className="kern-card__body">
          <Meta
            pairs={[
              ['Betrifft', item.person],
              ['Zeitraum', item.period],
            ]}
          />

          {status === 'offen' && state.registerNote && (
            <p className="kern-body kern-body--small">
              {state.registerNote} Bitte reichen Sie den Nachweis selbst ein.
            </p>
          )}
          {status === 'offen' && <p className="kern-hint">{item.hint}</p>}

          {files.length > 0 && (
            <p className="kern-body kern-body--small kern-body--muted">
              Hochgeladen: {files.join(', ')}
            </p>
          )}

          {busy && (
            <div className="kern-alert kern-alert--info mt-2 w-full">
              <div className="kern-alert__header">
                <span className="kern-icon kern-icon--info" aria-hidden="true" />
                <span className="kern-title">Wird geprüft …</span>
              </div>
              <div className="kern-alert__body">
                <p className="kern-body">
                  Der Nachweis wird gelesen, den Personen und Zeiträumen zugeordnet und
                  mit Ihren Angaben abgeglichen.
                </p>
              </div>
            </div>
          )}

          {!busy && note && (
            <div
              className={`kern-alert mt-2 w-full ${
                status === 'belegt' ? 'kern-alert--success' : 'kern-alert--info'
              }`}
            >
              <div className="kern-alert__header">
                <span
                  className={`kern-icon ${
                    status === 'belegt' ? 'kern-icon--success' : 'kern-icon--info'
                  }`}
                  aria-hidden="true"
                />
                <span className="kern-title">
                  {status === 'belegt' ? 'Vollständig' : 'Es fehlt noch etwas'}
                </span>
              </div>
              <div className="kern-alert__body">
                <p className="kern-body">{note}</p>
              </div>
            </div>
          )}
        </div>

        {status !== 'belegt' && (
          <div className="kern-card__footer op-actions">
            <button
              type="button"
              className="kern-btn kern-btn--secondary kern-btn--small"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              <span className="kern-icon kern-icon--drive-folder-upload" aria-hidden="true" />
              <span className="kern-label">{step?.action ?? 'Dateien hinzufügen'}</span>
            </button>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="op-file-input"
              onChange={handleFiles}
              aria-label={`Nachweis hochladen für: ${item.fact}`}
            />
          </div>
        )}
      </div>
    </div>
  )
}

interface OpenSectionProps {
  items: ActionableRequirement[]
  states: States
  onUpload: (id: string, fileNames: string[]) => void
}

function OpenSection({ items, states, onUpload }: OpenSectionProps) {
  if (items.length === 0) return null

  return (
    <section className="mt-10" aria-labelledby="ueberschrift-offen">
      <h2 id="ueberschrift-offen" className="kern-heading-medium">
        Sie müssen folgende Nachweise einreichen
      </h2>
      <p className="kern-body kern-body--muted">
        Nur diese Angaben lassen sich nicht aus Registern belegen. Alles andere ist
        bereits erledigt.
      </p>

      <div className="mt-4 flex flex-col gap-4">
        {items.map((item) => (
          <OpenRequirement
            key={item.id}
            item={item}
            state={stateOf(states, item.id)}
            onUpload={onUpload}
          />
        ))}
      </div>
    </section>
  )
}

function DroppedSection({ items }: { items: DroppedRequirement[] }) {
  if (items.length === 0) return null

  return (
    <section className="mt-10" aria-labelledby="ueberschrift-entfaellt">
      <h2 id="ueberschrift-entfaellt" className="kern-heading-small">
        Nicht erforderlich
      </h2>
      <div className="mt-2 flex flex-col gap-2">
        {items.map((item) => (
          <div key={item.id} className="kern-card kern-card--hug kern-card--small">
            <div className="kern-card__container">
              <div className="kern-card__header flex-row! items-center! justify-between! gap-4!">
                <h3 className="kern-title kern-title--small">{item.fact}</h3>
                <Badge status="entfaellt" />
              </div>
              <div className="kern-card__body">
                <p className="kern-body kern-body--small kern-body--muted">{item.reason}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export default function App() {
  const [states, setStates] = useState<States>(initialStates)
  const [submitted, setSubmitted] = useState(false)
  /** Counts the walkthroughs: every reset asks the registries anew. */
  const [run, setRun] = useState(0)

  useEffect(() => {
    let stale = false
    retrieveFromRegisters(REGISTER_REQUIREMENTS).then((outcomes) => {
      if (stale) return
      setStates((current) => ({
        ...current,
        ...Object.fromEntries(outcomes.map(([id, outcome]): [string, RequirementState] => [id, { ...stateOf(current, id), ...outcome }])),
      }))
    })
    return () => {
      stale = true
    }
  }, [run])

  const actionable = REQUIREMENTS.filter((item) => item.initial !== 'entfaellt')
  const dropped = REQUIREMENTS.filter((item): item is DroppedRequirement => item.initial === 'entfaellt')
  const askingRegister = REGISTER_REQUIREMENTS.filter((item) => stateOf(states, item.id).register === 'pending')
  const confirmedByRegister = REGISTER_REQUIREMENTS.filter((item) => stateOf(states, item.id).register === 'delivered').map(
    (item) => ({ ...item, ...stateOf(states, item.id) }),
  )
  // What no registry holds, and what a registry could not deliver.
  const uploadable = REQUIREMENTS.filter((item): item is ActionableRequirement =>
    item.register ? stateOf(states, item.id).register === 'failed' : item.initial === 'offen',
  )

  const proven = useMemo(
    () => actionable.filter((item) => stateOf(states, item.id).status === 'belegt').length,
    [actionable, states],
  )
  const stillOpen = actionable.length - proven

  function handleUpload(id: string, fileNames: string[]) {
    const item = REQUIREMENTS.find((candidate) => candidate.id === id)

    setStates((current) => ({
      ...current,
      [id]: {
        ...stateOf(current, id),
        status: 'pruefung',
        note: null,
        settled: false,
        files: [...stateOf(current, id).files, ...fileNames],
      },
    }))

    window.setTimeout(() => {
      setStates((current) => {
        if (!item || item.initial === 'entfaellt') throw new Error(`The requirement ${id} has no steps to upload for.`)
        const nextIndex = Math.min(stateOf(current, id).stepIndex + 1, item.steps.length)
        const step = item.steps[nextIndex - 1]
        if (!step) throw new Error(`The requirement ${id} has no step ${nextIndex}.`)
        return {
          ...current,
          [id]: {
            ...stateOf(current, id),
            status: step.status,
            note: step.note,
            stepIndex: nextIndex,
            settled: true,
          },
        }
      })
    }, CHECK_DURATION)
  }

  function handleReset() {
    setStates(initialStates())
    setRun((count) => count + 1)
    setSubmitted(false)
    window.scrollTo({ top: 0 })
  }

  if (submitted) {
    return (
      <>
        <Kopfzeile />
        <main className="op-page py-10">
          <div className="kern-alert kern-alert--success">
            <div className="kern-alert__header">
              <span className="kern-icon kern-icon--success" aria-hidden="true" />
              <span className="kern-title kern-title--large">Ihr Antrag ist eingegangen</span>
            </div>
            <div className="kern-alert__body">
              <p className="kern-body">
                Eingangsdatum: 9. September 2026. Ihr Aktenzeichen lautet{' '}
                {APPLICANT.fileNumber}. Die Frist ist damit gewahrt.
              </p>
              <p className="kern-body mt-3">
                {stillOpen === 0
                  ? 'Alle Angaben sind belegt. Sie müssen nichts nachreichen.'
                  : `${stillOpen} ${stillOpen === 1 ? 'Angabe ist' : 'Angaben sind'} noch offen. Sie können die Nachweise jederzeit nachreichen — Ihre Behörde meldet sich, wenn etwas fehlt.`}
              </p>
            </div>
          </div>

          <div className="kern-btn-wrapper mt-8">
            <button type="button" className="kern-btn kern-btn--secondary" onClick={handleReset}>
              <span className="kern-icon kern-icon--autorenew" aria-hidden="true" />
              <span className="kern-label">Vorführung zurücksetzen</span>
            </button>
          </div>

          <Footer links={FOOTER_LINKS} />
        </main>
      </>
    )
  }

  return (
    <>
      <Kopfzeile />

      <main className="op-page py-10">
        <p className="kern-preline">
          Antrag auf Elterngeld für {APPLICANT.child} · Schritt 6 von 6
        </p>
        <h1 className="kern-heading-x-large">Nachweise einreichen</h1>

        <div className="kern-alert kern-alert--info mt-6">
          <div className="kern-alert__header">
            <span className="kern-icon kern-icon--info" aria-hidden="true" />
            <span className="kern-title">
              Für Ihren Antrag wurden {REQUIREMENTS.length} Angaben geprüft
            </span>
          </div>
          <div className="kern-alert__body">
            <p className="kern-body">
              {askingRegister.length > 0
                ? `${askingRegister.length} davon erfragen wir gerade über eine NOOTS-Abfrage direkt bei der zuständigen Stelle.`
                : `${confirmedByRegister.length} davon konnten wir über eine NOOTS-Abfrage direkt bei der zuständigen Stelle bestätigen.`}{' '}
              {dropped.length} ist in Ihrem Fall nicht erforderlich. Bleiben {uploadable.length},
              für die wir noch Unterlagen von Ihnen brauchen.
            </p>
          </div>
        </div>

        <p className="kern-label mt-6" aria-live="polite">
          {proven} von {actionable.length} Angaben belegt
        </p>
        <div className="kern-divider kern-divider--decorative mt-2" />

        <ConfirmedSection items={confirmedByRegister} pending={askingRegister} />
        <OpenSection items={uploadable} states={states} onUpload={handleUpload} />
        <DroppedSection items={dropped} />

        <section className="mt-10" aria-labelledby="ueberschrift-einreichen">
          <div className="kern-card kern-card--surface kern-card--hug">
            <div className="kern-card__container">
              <div className="kern-card__header">
                <h2 id="ueberschrift-einreichen" className="kern-heading-small">
                  Antrag einreichen
                </h2>
              </div>
              <div className="kern-card__body">
                <p className="kern-body">
                  {stillOpen === 0
                    ? 'Alle Angaben sind belegt. Sie können den Antrag jetzt absenden.'
                    : `${stillOpen} ${stillOpen === 1 ? 'Angabe ist' : 'Angaben sind'} noch offen. Sie können den Antrag trotzdem absenden — die Frist ist damit gewahrt und Sie reichen die fehlenden Nachweise später nach.`}
                </p>
              </div>
              <div className="kern-card__footer">
                <button
                  type="button"
                  className="kern-btn kern-btn--primary"
                  onClick={() => {
                    setSubmitted(true)
                    window.scrollTo({ top: 0 })
                  }}
                >
                  <span className="kern-label">Antrag einreichen</span>
                  <span className="kern-icon kern-icon--arrow-forward" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="kern-btn kern-btn--tertiary"
                  onClick={handleReset}
                >
                  <span className="kern-icon kern-icon--autorenew" aria-hidden="true" />
                  <span className="kern-label">Zurücksetzen</span>
                </button>
              </div>
            </div>
          </div>
        </section>

        <Footer links={FOOTER_LINKS} />
      </main>
    </>
  )
}
