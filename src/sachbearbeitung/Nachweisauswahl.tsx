import { useId, useMemo, useState } from 'react'
import Badge from '../components/Badge.tsx'
import type { Bedingung } from '../engine/profil/bedingungen.ts'
import type { Rolle, Wertetabellen } from '../engine/profil/laden.ts'
import { filtereZeilen, merkmalText, rollenSatz, WAHL, wahlFuer, wahlZuWert } from './ansicht.ts'
import type { Zeile as Nachweiszeile } from './ansicht.ts'

/** What the choices mean. */
function Erklaerung() {
  return (
    <details className="kern-details mt-4">
      <summary className="kern-details__header">
        <span className="kern-body">Was bedeuten die Einstellungen?</span>
      </summary>
      <div className="kern-details__body">
        <dl className="flex flex-col gap-4">
          {WAHL.map((wahl) => (
            <div key={wahl.wert}>
              <dt className="kern-body kern-body--bold">
                {wahl.titel} {wahl.folge && <Badge status={wahl.folge} />}
              </dt>
              <dd className="kern-body mt-1!">{wahl.beschreibung}</dd>
            </div>
          ))}
        </dl>
      </div>
    </details>
  )
}

interface ZeileProps {
  zeile: Nachweiszeile
  /** The condition is a proposal. */
  vorschlag: boolean
  wertetabellen: Wertetabellen
  onRolle: (typ: string, rolle: Rolle | null) => void
}

/** One type of document at the condition: its name, what limits it, and the choice for it. */
function Zeile({ zeile, vorschlag, wertetabellen, onRolle }: ZeileProps) {
  const id = useId()
  const wahl = wahlFuer(zeile.rolle)
  const geaendert = zeile.vorher !== undefined && zeile.vorher !== zeile.rolle
  const merkmal = merkmalText(zeile.merkmale, wertetabellen)
  const zusatz = [merkmal, zeile.ersatzweise && 'gilt auch ersatzweise', vorschlag && zeile.rolle && !geaendert && 'Vorschlag aus dem Katalog'].filter(Boolean)

  return (
    <li className={`op-zeile ${geaendert ? 'op-zeile--geaendert' : ''}`}>
      <div className="op-zeile__text">
        <label className="kern-body kern-body--bold" htmlFor={id}>
          {zeile.label}
        </label>
        {zusatz.length > 0 && <span className="kern-body kern-body--small kern-body--muted block">{zusatz.join(' · ')}</span>}
        {zeile.unbekannt && <span className="kern-body kern-body--small kern-body--muted block">Diesen Dokumenttyp gibt es im Katalog nicht.</span>}
        {geaendert && (
          <span className="kern-body kern-body--small block">
            <span className="kern-badge kern-badge--info">geändert</span> <span className="kern-body--muted">vorher: {wahlFuer(zeile.vorher).titel}</span>
          </span>
        )}
      </div>

      <div className="kern-form-input op-zeile__wahl">
        <div className="kern-form-input__select-wrapper">
          <select
            id={id}
            className="kern-form-input__select"
            value={wahl.wert}
            onChange={(ereignis) => {
              const gewaehlt = wahlZuWert(ereignis.target.value)
              if (gewaehlt) onRolle(zeile.typ, gewaehlt.rolle)
            }}
          >
            {WAHL.map(({ wert, titel }) => (
              <option key={wert} value={wert}>
                {titel}
              </option>
            ))}
          </select>
        </div>
      </div>
    </li>
  )
}

export interface NachweisauswahlProps {
  bedingung: Pick<Bedingung, 'status' | 'nachweise'>
  zeilen: Nachweiszeile[]
  wertetabellen: Wertetabellen
  onRolle: (typ: string, rolle: Rolle | null) => void
}

/**
 * Which types of document count for a condition, and how well: every type of the catalogue, each
 * with a choice. The types the condition names — now or in the version before — come first; the
 * others are folded away until searched for.
 */
export default function Nachweisauswahl({ bedingung, zeilen, wertetabellen, onRolle }: NachweisauswahlProps) {
  const id = useId()
  const [suche, setSuche] = useState('')
  const [weitereOffen, setWeitereOffen] = useState(() => !zeilen.some((zeile) => zeile.vorgesehen))

  const sichtbar = useMemo(() => filtereZeilen(zeilen, suche), [zeilen, suche])
  const vorn = sichtbar.filter((zeile) => zeile.vorgesehen)
  const weitere = sichtbar.filter((zeile) => !zeile.vorgesehen)
  const sucht = suche.trim() !== ''
  const gemeinsam = { vorschlag: bedingung.status === 'vorschlag', wertetabellen, onRolle }

  return (
    <section aria-labelledby={`${id}-titel`}>
      <h3 className="kern-title kern-title--small" id={`${id}-titel`}>
        Welche Unterlagen genügen?
      </h3>
      <p className="kern-body mt-2!">{rollenSatz(bedingung)}</p>
      <Erklaerung />

      <div className="op-filter mt-4">
        <div className="kern-form-input">
          <label className="kern-label" htmlFor={`${id}-suche`}>
            Nachweisart suchen
          </label>
          <input
            id={`${id}-suche`}
            className="kern-form-input__input"
            type="search"
            autoComplete="off"
            value={suche}
            onChange={(ereignis) => setSuche(ereignis.target.value)}
          />
        </div>
      </div>

      {vorn.length > 0 && (
        <div className="mt-6">
          <h4 className="kern-title kern-title--small">
            Für diese Bedingung vorgesehen <span className="kern-body kern-body--muted">({vorn.length})</span>
          </h4>
          <ul className="op-zeilen mt-2">
            {vorn.map((zeile) => (
              <Zeile key={zeile.typ} zeile={zeile} {...gemeinsam} />
            ))}
          </ul>
        </div>
      )}

      {weitere.length > 0 && (
        <details className="kern-details mt-6" open={weitereOffen || sucht} onToggle={(ereignis) => setWeitereOffen(ereignis.currentTarget.open)}>
          <summary className="kern-details__header">
            <span className="kern-title kern-title--small">
              Weitere Nachweisarten <span className="kern-body kern-body--muted">({weitere.length})</span>
            </span>
          </summary>
          <div className="kern-details__body">
            <ul className="op-zeilen">
              {weitere.map((zeile) => (
                <Zeile key={zeile.typ} zeile={zeile} {...gemeinsam} />
              ))}
            </ul>
          </div>
        </details>
      )}

      {sichtbar.length === 0 && <p className="kern-body mt-6!">Keine Nachweisart passt zu dieser Suche.</p>}
    </section>
  )
}
