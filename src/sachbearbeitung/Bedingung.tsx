import { useId, useMemo, useState } from 'react'
import Badge from '../components/Badge.tsx'
import type { Schema } from '../engine/fim/schema.ts'
import { bestaetige, setzeHinweis, setzeRolle, setzeZeitraum, setzeZurueck, uebernimmVon } from '../engine/profil/bearbeiten.ts'
import { eintragVon } from '../engine/profil/bedingungen.ts'
import type { Bedingung as ProfilBedingung, ProfilFormat2, StelleFormat2 } from '../engine/profil/bedingungen.ts'
import type { Typ, Wertetabellen } from '../engine/profil/laden.ts'
import { WelcheUnterlagen } from '../pruefen/Angaben.tsx'
import { bedingungsText, nachweisText, vorschauQuellen, zaehltJeMonat, zeilenFuer, zeitraumText } from './ansicht.ts'
import type { Vorlage, VorschauQuelle } from './ansicht.ts'
import type { Bearbeitung } from './arbeit.ts'
import HinweisFeld from './HinweisFeld.tsx'
import { StandBadge } from './Kennzeichen.tsx'
import Nachweisauswahl from './Nachweisauswahl.tsx'
import ZeitraumFeld from './ZeitraumFeld.tsx'

interface VorschauProps {
  titel: string
  hinweis: string
  quellen: VorschauQuelle[]
}

/** What an applicant sees of the condition while evidence is missing, with the draft applied. */
function Vorschau({ titel, hinweis, quellen }: VorschauProps) {
  const id = useId()
  return (
    <section aria-labelledby={`${id}-titel`}>
      <h3 className="kern-title kern-title--small" id={`${id}-titel`}>
        So sehen Antragstellende diese Angabe
      </h3>
      {quellen.length === 0 ? (
        <p className="kern-body mt-2!">Solange keine Unterlage zugelassen ist, verlangt die Prüfung hier nichts.</p>
      ) : (
        <div className="kern-card kern-card--hug kern-card--small mt-4">
          <div className="kern-card__container">
            <div className="kern-card__header flex-row! items-center! justify-between! gap-4!">
              <h4 className="kern-title kern-title--small">{titel}</h4>
              <Badge status="offen" />
            </div>
            <div className="kern-card__body">
              {hinweis.trim() !== '' && <p className="kern-hint">{hinweis.trim()}</p>}
              <WelcheUnterlagen quellen={quellen} offen />
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

interface AktionenProps {
  bedingung: ProfilBedingung
  basisVersion: string | null
  zuruecksetzbar: boolean
  vorlagen: Vorlage[]
  onBestaetigen: () => void
  onZuruecksetzen: () => void
  onUebernehmen: (vorlage: Vorlage) => void
}

/** Confirm, reset, or take the setting of another condition. */
function Aktionen({ bedingung, basisVersion, zuruecksetzbar, vorlagen, onBestaetigen, onZuruecksetzen, onUebernehmen }: AktionenProps) {
  const id = useId()
  return (
    <div className="op-bedingung__aktionen">
      {bedingung.status === 'festgelegt' ? (
        <span className="kern-body flex items-center gap-2">
          <span className="kern-icon kern-icon--success" aria-hidden="true" />
          Festgelegt
        </span>
      ) : (
        <button type="button" className="kern-btn kern-btn--primary kern-btn--small" onClick={onBestaetigen}>
          <span className="kern-icon kern-icon--check" aria-hidden="true" />
          <span className="kern-label">{bedingung.status === 'vorschlag' ? 'Vorschlag übernehmen' : 'So festlegen'}</span>
        </button>
      )}
      {zuruecksetzbar && (
        <button type="button" className="kern-btn kern-btn--secondary kern-btn--small" onClick={onZuruecksetzen}>
          <span className="kern-label">Auf Version {basisVersion} zurücksetzen</span>
        </button>
      )}
      {vorlagen.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="kern-body" htmlFor={id}>
            Übernehmen von:
          </label>
          <div className="kern-form-input__select-wrapper">
            <select
              id={id}
              className="kern-form-input__select"
              value=""
              onChange={(ereignis) => {
                const vorlage = vorlagen[Number(ereignis.target.value)]
                if (vorlage) onUebernehmen(vorlage)
              }}
            >
              <option value="">Bedingung wählen …</option>
              {vorlagen.map((vorlage, index) => (
                <option key={`${vorlage.schema}|${vorlage.bedingungId}`} value={index}>
                  {vorlage.text}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  )
}

/** What a condition is shown with, besides the place and the condition itself. */
interface EditorDaten {
  /** The condition in the version the draft was made from; `null` where that version lacks it. */
  basisBedingung: ProfilBedingung | null
  schemaId: string
  /** The catalogue of document types. */
  typen: Map<string, Typ>
  wertetabellen: Wertetabellen
  basisVersion: string | null
  basisRoh: ProfilFormat2 | null
  vorlagen: Vorlage[]
  aendere: (aenderung: Bearbeitung) => void
}

interface EditorProps extends EditorDaten {
  id: string
  stelle: StelleFormat2
  bedingung: ProfilBedingung
  istGeaendert: boolean
}

/** The setting of an open condition: documents, period, text, preview. */
function Editor({ id, stelle, bedingung, basisBedingung, schemaId, typen, wertetabellen, basisVersion, basisRoh, istGeaendert, vorlagen, aendere }: EditorProps) {
  // The order of the rows is that of the moment the condition was opened.
  const [anfang] = useState(bedingung)
  const zeilen = useMemo(() => zeilenFuer(bedingung, basisBedingung, typen, anfang), [bedingung, basisBedingung, typen, anfang])
  const zugelassen = useMemo(
    () =>
      Object.entries(bedingung.nachweise ?? {})
        .filter(([, wert]) => ['genuegt', 'pruefen'].includes(eintragVon(wert).rolle))
        .map(([typ]) => ({ typ, label: typen.get(typ)?.label ?? typ, monatlich: zaehltJeMonat(typen.get(typ)) }))
        .sort((a, b) => a.label.localeCompare(b.label, 'de')),
    [bedingung, typen],
  )
  const titel = stelle.unterscheiden && bedingung.titel ? `${stelle.titel}: ${bedingung.titel}` : stelle.titel

  return (
    <div className="op-bedingung__editor" id={id}>
      <Nachweisauswahl
        bedingung={bedingung}
        zeilen={zeilen}
        wertetabellen={wertetabellen}
        onRolle={(typ, rolle) => aendere((roh) => setzeRolle(roh, schemaId, bedingung.id, typ, rolle))}
      />
      <ZeitraumFeld
        zeitraum={bedingung.zeitraum ?? null}
        zugelassen={zugelassen}
        onAendern={(zeitraum) => aendere((roh) => setzeZeitraum(roh, schemaId, bedingung.id, zeitraum))}
        onAnlegen={() =>
          aendere((roh) =>
            setzeZeitraum(roh, schemaId, bedingung.id, { mindestens: 3, fuer: zugelassen.filter(({ monatlich }) => monatlich).map(({ typ }) => typ) }),
          )
        }
      />
      <HinweisFeld
        wert={bedingung.hinweis ?? ''}
        basisWert={basisBedingung ? (basisBedingung.hinweis ?? '') : null}
        onAendern={(text) => aendere((roh) => setzeHinweis(roh, schemaId, bedingung.id, text))}
      />
      <Vorschau titel={titel} hinweis={bedingung.hinweis ?? ''} quellen={vorschauQuellen(bedingung, typen)} />
      <Aktionen
        bedingung={bedingung}
        basisVersion={basisVersion}
        zuruecksetzbar={Boolean(basisBedingung) && istGeaendert}
        vorlagen={vorlagen}
        onBestaetigen={() => aendere((roh) => bestaetige(roh, schemaId, bedingung.id))}
        onZuruecksetzen={() =>
          aendere((roh) => {
            // Offered only where the version has the condition, so there is a version.
            if (!basisRoh) throw new Error('Es gibt keine Version, auf die sich zurücksetzen ließe.')
            return setzeZurueck(roh, basisRoh, schemaId, bedingung.id)
          })
        }
        onUebernehmen={(vorlage) => aendere((roh) => uebernimmVon(roh, schemaId, bedingung.id, vorlage))}
      />
    </div>
  )
}

export interface BedingungProps extends EditorDaten {
  stelle: StelleFormat2
  bedingung: ProfilBedingung
  /** The schema of the application type; `null` where it could not be read. */
  schema: Schema | null
  istGeaendert: boolean
  offen: boolean
  onUmschalten: () => void
}

/**
 * A condition of a place as a card: when it applies, what it accepts, how far it is decided — and,
 * opened, everything that can be set for it.
 */
export default function Bedingung({ stelle, bedingung, schema, offen, onUmschalten, istGeaendert, ...weiter }: BedingungProps) {
  const id = useId()
  const titel = stelle.unterscheiden ? (bedingung.titel ?? bedingung.id) : stelle.titel
  const zeitraum = zeitraumText(bedingung.zeitraum)

  return (
    <li className="op-bedingung" data-status={bedingung.status} data-offen={offen ? 'true' : undefined}>
      <div className="op-bedingung__kopf">
        <div className="op-bedingung__titel">
          <h4 className="kern-title kern-title--small">{titel}</h4>
          {istGeaendert && <span className="kern-badge kern-badge--info">geändert</span>}
        </div>
        <StandBadge status={bedingung.status} />
        <p className="kern-body kern-body--small op-bedingung__zeile">
          <b>Gilt, wenn</b> {bedingungsText(stelle, bedingung, schema)}
        </p>
        <p className="kern-body kern-body--small op-bedingung__zeile">
          <b>Nachweise</b> {nachweisText(bedingung)}{' '}
          {zeitraum && (
            <span className="op-zeitraum">
              <span className="kern-icon kern-icon--calendar-today kern-icon--small" aria-hidden="true" />
              {zeitraum}
            </span>
          )}
        </p>
        <div className="op-bedingung__zeile">
          <button type="button" className="kern-btn kern-btn--secondary kern-btn--small" aria-expanded={offen} aria-controls={offen ? `${id}-editor` : undefined} onClick={onUmschalten}>
            <span className="kern-label">{offen ? 'Schließen' : bedingung.status === 'festgelegt' ? 'Nachweise ändern' : 'Nachweise festlegen'}</span>
          </button>
        </div>
      </div>
      {offen && <Editor id={`${id}-editor`} stelle={stelle} bedingung={bedingung} istGeaendert={istGeaendert} {...weiter} />}
    </li>
  )
}
