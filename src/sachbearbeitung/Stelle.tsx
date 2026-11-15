import { useId, useMemo, useState } from 'react'
import type { Ref } from 'react'
import Dialog from '../components/Dialog.tsx'
import Fehlermeldung from '../components/Fehlermeldung.tsx'
import type { Schema } from '../engine/fim/schema.ts'
import { unterscheidungenFuer } from '../engine/fim/xdf.ts'
import type { Unterscheidung } from '../engine/fim/xdf.ts'
import { setzeOhne, unterscheide } from '../engine/profil/bearbeiten.ts'
import { signatur } from '../engine/profil/bedingungen.ts'
import type { AntragsartFormat2, Bedingung as ProfilBedingung, ProfilFormat2, StelleFormat2 } from '../engine/profil/bedingungen.ts'
import type { Anbindung } from '../engine/profil/laden.ts'
import { zaehle } from '../pruefen/ansicht.ts'
import { giltWenn, jePerson, passtZumFilter, pfadText, vorlagenFuer } from './ansicht.ts'
import type { Filter } from './ansicht.ts'
import type { Bearbeitung } from './arbeit.ts'
import Bedingung from './Bedingung.tsx'
import type { BedingungProps } from './Bedingung.tsx'
import { HerkunftChip } from './Kennzeichen.tsx'

interface GiltWennProps {
  stelle: StelleFormat2
  schema: Schema | null
}

/** When the place asks for evidence, and where that comes from. */
function GiltWenn({ stelle, schema }: GiltWennProps) {
  const id = useId()
  const { saetze, art } = giltWenn(stelle, schema)
  const herkunft = stelle.herkunft?.art ?? 'immer'
  const regeln = stelle.herkunft?.regeln ?? []

  return (
    <section className={`op-karte ${herkunft === 'profil' ? 'op-karte--hand' : ''}`} aria-labelledby={`${id}-titel`}>
      <h3 className="kern-title kern-title--small flex flex-wrap items-center gap-2" id={`${id}-titel`}>
        Gilt, wenn <HerkunftChip art={herkunft} />
      </h3>
      {saetze.length === 0 ? (
        <p className="kern-body mt-2!">{art === 'abschnitt' ? 'Der Abschnitt im Antrag ist ausgefüllt.' : 'Immer, wenn der Antrag diese Stelle enthält.'}</p>
      ) : (
        <ul className="flex flex-col gap-2 mt-3">
          {saetze.map((satz, index) => (
            <li key={`${satz.frage}|${index}`}>
              {index > 0 && <p className="kern-body kern-body--small kern-body--muted mb-2">oder</p>}
              <div className="op-satz kern-body">
                {satz.gefuellt ? (
                  <>„{satz.frage}“ ist ausgefüllt</>
                ) : satz.jede ? (
                  <>
                    {satz.frage}: <b>jede Antwort</b>
                    {satz.ausser.length > 0 && <> außer {satz.ausser.map((antwort) => `„${antwort}“`).join(', ')}</>}
                  </>
                ) : (
                  <>
                    {satz.frage} = {satz.antworten.map((antwort, nummer) => (
                      <span key={antwort}>
                        {nummer > 0 && ' oder '}
                        <b>„{antwort}“</b>
                      </span>
                    ))}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {herkunft === 'regelFremd' && <p className="kern-body kern-body--small mt-3!">Eine Regel nennt diese Stelle, die Seite versteht ihren Satz aber nicht. Bitte prüfen Sie die Bedingung.</p>}
      {regeln.length > 0 && (
        <details className="kern-details mt-3">
          <summary className="kern-details__header">
            <span className="kern-body kern-body--small">{regeln.length === 1 ? 'Regel' : 'Regeln'} im Wortlaut</span>
          </summary>
          <div className="kern-details__body flex flex-col gap-3">
            {regeln.map((regel) => (
              <div key={`${regel.id}|${regel.satz}`}>
                <p className="kern-body kern-body--small">
                  <span className="op-code">{regel.id}</span> {regel.name}
                </p>
                <p className="op-regelsatz mt-1">{regel.satz}</p>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  )
}

interface UnterscheidenProps {
  stelle: StelleFormat2
  schema: Schema
  /** The question chosen, or `''` for none. */
  onWahl: (wert: string) => void
}

/** Whether the place has one condition per answer of a question of its section. */
function Unterscheiden({ stelle, schema, onWahl }: UnterscheidenProps) {
  const id = useId()
  const optionen = useMemo((): Pick<Unterscheidung, 'wert' | 'frage'>[] => {
    const liste = schema ? unterscheidungenFuer(schema, stelle.position) : []
    return stelle.unterscheiden && !liste.some(({ wert }) => wert === stelle.unterscheiden) ? [...liste, { wert: stelle.unterscheiden, frage: stelle.unterscheiden }] : liste
  }, [schema, stelle.position, stelle.unterscheiden])
  if (optionen.length === 0) return null

  return (
    <section className="op-karte" aria-labelledby={`${id}-titel`}>
      <h3 className="kern-title kern-title--small" id={`${id}-titel`}>
        Unterscheiden nach
      </h3>
      <div className="kern-form-input mt-3 max-w-160">
        <label className="kern-label" htmlFor={id}>
          Eigene Bedingung je …
        </label>
        <div className="kern-form-input__select-wrapper">
          <select id={id} className="kern-form-input__select" value={stelle.unterscheiden ?? ''} onChange={(ereignis) => onWahl(ereignis.target.value)}>
            <option value="">Nicht unterscheiden – eine Bedingung für alle Antworten</option>
            {optionen.map(({ wert, frage }) => (
              <option key={wert} value={wert}>
                {frage}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="kern-body kern-body--small kern-body--muted mt-2!">
        {stelle.unterscheiden ? 'Jede Antwort hat eigene Nachweise.' : 'Alle Antworten werden gleich behandelt. Wählen Sie eine Frage, wenn die Nachweise davon abhängen.'}
      </p>
    </section>
  )
}

interface OhneDialogProps {
  offen: boolean
  onSchliessen: () => void
  onSetzen: (grund: string) => void
}

/** The reason why a place knowingly asks for nothing; asked for before it is set. */
function OhneDialog({ offen, onSchliessen, onSetzen }: OhneDialogProps) {
  const id = useId()
  const [grund, setGrund] = useState('')
  const [versucht, setVersucht] = useState(false)
  const fehlt = grund.trim() === ''

  return (
    <Dialog
      offen={offen}
      titel="Hier keinen Nachweis verlangen?"
      onSchliessen={onSchliessen}
      fuss={
        <>
          <button type="button" className="kern-btn kern-btn--secondary" onClick={onSchliessen}>
            <span className="kern-label">Abbrechen</span>
          </button>
          <button
            type="button"
            className="kern-btn kern-btn--primary"
            onClick={() => {
              setVersucht(true)
              if (!fehlt) onSetzen(grund.trim())
            }}
          >
            <span className="kern-label">Keinen Nachweis verlangen</span>
          </button>
        </>
      }
    >
      <div className={`kern-form-input w-full ${versucht && fehlt ? 'kern-form-input--error' : ''}`}>
        <label className="kern-label" htmlFor={id}>
          Grund
        </label>
        <p className="kern-hint" id={`${id}-hinweis`}>
          Zum Beispiel: „Ausweiskopie, wird beim Termin vorgelegt“.
        </p>
        <input
          id={id}
          className="kern-form-input__input"
          autoComplete="off"
          value={grund}
          aria-invalid={versucht && fehlt ? 'true' : undefined}
          aria-describedby={`${id}-hinweis${versucht && fehlt ? ` ${id}-fehler` : ''}`}
          onChange={(ereignis) => setGrund(ereignis.target.value)}
        />
        {versucht && fehlt && <Fehlermeldung id={`${id}-fehler`}>Bitte einen Grund angeben.</Fehlermeldung>}
      </div>
    </Dialog>
  )
}

/** The dialog that is open at a place. */
type StellenDialog = { art: 'ohne' } | { art: 'unterscheiden'; schema: Schema; wert: string }

export interface StelleProps extends Pick<BedingungProps, 'typen' | 'wertetabellen' | 'basisVersion' | 'basisRoh'> {
  ref?: Ref<HTMLHeadingElement>
  stelle: StelleFormat2
  /** The schema of the application type; `null` where it could not be read. */
  schema: Schema | null
  schemaId: string
  /** The profile being edited. */
  arbeit: ProfilFormat2
  /** The application type in the version the draft was made from. */
  basisAntragsart: AntragsartFormat2 | null
  anbindung: Pick<Anbindung, 'personen'>
  filter: Filter
  istGeaendert: (bedingung: ProfilBedingung) => boolean
  aendere: (aenderung: Bearbeitung) => void
}

/**
 * A place of an application type where evidence can be asked for: when it applies, how it is told
 * apart, and its conditions.
 */
export default function Stelle({ ref, stelle, schema, schemaId, arbeit, basisAntragsart, anbindung, filter, istGeaendert, aendere, ...weiter }: StelleProps) {
  const id = useId()
  const [offen, setOffen] = useState<string | null>(() => (stelle.bedingungen.length === 1 ? (stelle.bedingungen[0]?.id ?? null) : null))
  const [dialog, setDialog] = useState<StellenDialog | null>(null)
  // Counted when the dialog is opened, not when it is closed: the dialog that is closed again must be
  // the one that was opened, or the browser has no place to give the focus back to.
  const [oeffnungen, setOeffnungen] = useState(0)

  const pfad = pfadText(stelle, schema)
  const anderswo = (arbeit.antragsarten ?? []).filter((art) => art.schema !== schemaId && art.stellen?.some((andere) => andere.position === stelle.position)).length
  const basisStelle = basisAntragsart?.stellen?.find((kandidat) => kandidat.id === stelle.id) ?? null
  const sichtbar = stelle.bedingungen.filter((bedingung) => passtZumFilter(filter, bedingung, istGeaendert(bedingung)))
  const verschieden = new Set(stelle.bedingungen.map((bedingung) => signatur(bedingung, { mitHinweis: true }))).size > 1

  function waehle(gewaehltesSchema: Schema, wert: string) {
    if (verschieden) setDialog({ art: 'unterscheiden', schema: gewaehltesSchema, wert })
    else aendere((roh) => unterscheide(roh, gewaehltesSchema, stelle.id, wert))
  }
  const aufteilen = dialog?.art === 'unterscheiden' ? dialog : null

  return (
    <article aria-labelledby={`${id}-titel`} className="flex flex-col gap-8">
      <header>
        {stelle.bereich && stelle.bereich !== stelle.titel && <p className="kern-preline kern-preline--small">{stelle.bereich}</p>}
        <h2 className="kern-title kern-title--large" id={`${id}-titel`} tabIndex={-1} ref={ref}>
          {stelle.titel}
        </h2>
        {pfad && <p className="kern-body kern-body--small kern-body--muted mt-2!">Im Antrag: {pfad}</p>}
        <p className="kern-body kern-body--small kern-body--muted mt-1!">
          {[jePerson(stelle, anbindung, schema) && 'Wird für jede Person einzeln verlangt.', anderswo > 0 && `Die Stelle gibt es auch in ${zaehle(anderswo, 'weiteren Antragsart', 'weiteren Antragsarten')}.`]
            .filter(Boolean)
            .join(' ')}
        </p>
      </header>

      {stelle.ohne ? (
        <section className="op-karte op-karte--hand">
          <h3 className="kern-title kern-title--small">Bewusst ohne Nachweis</h3>
          <p className="kern-body mt-2!">{stelle.ohne}</p>
          <button type="button" className="kern-btn kern-btn--secondary kern-btn--small mt-3" onClick={() => aendere((roh) => setzeOhne(roh, schemaId, stelle.id, null))}>
            <span className="kern-label">Doch Nachweise verlangen</span>
          </button>
        </section>
      ) : (
        <>
          <GiltWenn stelle={stelle} schema={schema} />
          {schema && <Unterscheiden stelle={stelle} schema={schema} onWahl={(wert) => waehle(schema, wert)} />}

          <section aria-labelledby={`${id}-bedingungen`}>
            <h3 className="kern-title kern-title--small" id={`${id}-bedingungen`}>
              {zaehle(stelle.bedingungen.length, 'Bedingung', 'Bedingungen')}
              {filter !== 'alle' && <span className="kern-body kern-body--muted"> ({sichtbar.length} passen zum Filter)</span>}
            </h3>
            {sichtbar.length > 0 ? (
              <ul className="op-bedingungen mt-4">
                {sichtbar.map((bedingung) => (
                  <Bedingung
                    key={bedingung.id}
                    stelle={stelle}
                    bedingung={bedingung}
                    basisBedingung={basisStelle?.bedingungen.find((kandidat) => kandidat.id === bedingung.id) ?? null}
                    schema={schema}
                    schemaId={schemaId}
                    offen={offen === bedingung.id}
                    onUmschalten={() => setOffen((vorher) => (vorher === bedingung.id ? null : bedingung.id))}
                    istGeaendert={istGeaendert(bedingung)}
                    vorlagen={vorlagenFuer(arbeit, schemaId, stelle, bedingung.id)}
                    aendere={aendere}
                    {...weiter}
                  />
                ))}
              </ul>
            ) : (
              <p className="kern-body mt-4!">Keine Bedingung dieser Stelle passt zum Filter.</p>
            )}
          </section>

          <div>
            <button
              type="button"
              className="kern-btn kern-btn--tertiary kern-btn--small"
              onClick={() => {
                setOeffnungen((vorher) => vorher + 1)
                setDialog({ art: 'ohne' })
              }}
            >
              <span className="kern-label">Hier keinen Nachweis verlangen</span>
            </button>
          </div>
        </>
      )}

      <OhneDialog
        key={oeffnungen}
        offen={dialog?.art === 'ohne'}
        onSchliessen={() => setDialog(null)}
        onSetzen={(grund) => {
          setDialog(null)
          aendere((roh) => setzeOhne(roh, schemaId, stelle.id, grund))
        }}
      />

      <Dialog
        offen={aufteilen !== null}
        titel="Bedingungen neu aufteilen?"
        onSchliessen={() => setDialog(null)}
        fuss={
          aufteilen && (
            <>
              <button type="button" className="kern-btn kern-btn--secondary" onClick={() => setDialog(null)}>
                <span className="kern-label">Abbrechen</span>
              </button>
              <button
                type="button"
                className="kern-btn kern-btn--primary"
                onClick={() => {
                  setDialog(null)
                  aendere((roh) => unterscheide(roh, aufteilen.schema, stelle.id, aufteilen.wert))
                }}
              >
                <span className="kern-label">Neu aufteilen</span>
              </button>
            </>
          )
        }
      >
        <p className="kern-body">
          Die Bedingungen dieser Stelle sind unterschiedlich eingestellt. Danach gilt für alle zunächst die Einstellung von „{stelle.bedingungen[0]?.titel ?? stelle.titel}“.
        </p>
      </Dialog>
    </article>
  )
}
