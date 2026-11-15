import type { ReactNode } from 'react'
import Meta from '../components/Meta.tsx'
import type { Pruefergebnis } from '../engine/pipeline.ts'
import type { BelegBasis, NichtZugeordnet, WeitererBeleg } from '../engine/zuordnung/anforderungen.ts'
import { belegZeilen, dokumentZeilen, zaehle, zusammenhalten } from './ansicht.ts'
import type { BelegZeile, DateiZeile } from './ansicht.ts'

/** Files and pages of a document as lines. */
function Dateien({ dateien }: { dateien: readonly DateiZeile[] }) {
  return (
    <>
      {dateien.map(({ schluessel, name, seiten }) => (
        <span key={schluessel} className="block">
          {name}, {zusammenhalten(seiten)}
        </span>
      ))}
    </>
  )
}

export interface KarteProps {
  titel: ReactNode
  /** Key and value of each line; a `null` is left out. */
  zeilen: readonly (readonly [key: string, value: ReactNode] | null)[]
  children?: ReactNode
}

/** A small card: a title and lines of key and value. */
export function Karte({ titel, zeilen, children }: KarteProps) {
  return (
    <div className="kern-card kern-card--hug kern-card--small">
      <div className="kern-card__container">
        <div className="kern-card__header">
          <h3 className="kern-title kern-title--small">{titel}</h3>
        </div>
        <div className="kern-card__body">
          <Meta pairs={zeilen.filter((zeile) => zeile !== null)} />
          {children}
        </div>
      </div>
    </div>
  )
}

/** The line of one document. */
function zeileVon(beleg: BelegBasis): BelegZeile {
  const [zeile] = belegZeilen([beleg])
  // One document in, one line out.
  if (!zeile) throw new Error('Zu einem Beleg fehlt die Zeile.')
  return zeile
}

export interface ErkannteUnterlagenProps {
  ergebnis: Pruefergebnis
}

/**
 * Every document the check recognised: which pages belong together and where they were placed.
 * This is the grouping made visible, and the way to see why a statement counts as proven.
 */
export function ErkannteUnterlagen({ ergebnis }: ErkannteUnterlagenProps) {
  const zeilen = dokumentZeilen(ergebnis)
  if (zeilen.length === 0) return null

  const dateien = new Set(zeilen.flatMap(({ dateien: liste }) => liste.map(({ schluessel }) => schluessel)))

  return (
    <section className="mt-10" aria-labelledby="ueberschrift-erkannt">
      <h2 id="ueberschrift-erkannt" className="kern-heading-small">
        So wurden Ihre Unterlagen erkannt
      </h2>
      <p className="kern-body kern-body--muted">
        {zaehle(zeilen.length, 'Dokument', 'Dokumente')} aus {zaehle(dateien.size, 'Datei', 'Dateien')}. Seiten, die zusammengehören,
        sind zu einem Dokument gruppiert.
      </p>

      <details className="kern-details mt-4">
        <summary className="kern-details__header">
          <span className="kern-title kern-title--small">Erkannte Dokumente anzeigen</span>
        </summary>
        <div className="kern-details__body">
          <div className="flex flex-col gap-2">
            {zeilen.map((dokument) => (
              <Karte
                key={dokument.id}
                titel={dokument.art}
                zeilen={[
                  ['Datei', <Dateien key="d" dateien={dokument.dateien} />],
                  dokument.person ? ['Lautet auf', dokument.person] : null,
                  dokument.monate.length > 0 ? ['Abrechnungsmonate', dokument.monate.join(', ')] : null,
                  dokument.vertrauen != null ? ['Sicherheit der KI', `${dokument.vertrauen} %`] : null,
                  dokument.verwendetFuer.length > 0 ? ['Verwendet für', dokument.verwendetFuer.join('; ')] : null,
                  dokument.weitere ? ['Passt zu', dokument.weitere] : null,
                  dokument.grund ? ['Nicht verwendet', dokument.grund] : null,
                ]}
              />
            ))}
          </div>
        </div>
      </details>
    </section>
  )
}

export interface WeitereUnterlagenProps {
  weitere: readonly WeitererBeleg[]
}

/** Documents that fit a place of the application which the person did not fill in. */
export function WeitereUnterlagen({ weitere }: WeitereUnterlagenProps) {
  if (weitere.length === 0) return null

  return (
    <section className="mt-10" aria-labelledby="ueberschrift-weitere">
      <h2 id="ueberschrift-weitere" className="kern-heading-small">
        Weitere Unterlagen
      </h2>
      <p className="kern-body kern-body--muted">
        Diese Unterlagen passen zu Stellen im Antrag, zu denen Sie keine Angabe gemacht haben. Sie werden mit dem Antrag
        aufbewahrt, sind aber nicht erforderlich.
      </p>
      <div className="mt-2 flex flex-col gap-2">
        {weitere.map((beleg) => {
          const zeile = zeileVon(beleg)
          return (
            <Karte
              key={beleg.dokument}
              titel={zeile.art}
              zeilen={[
                ['Datei', <Dateien key="d" dateien={zeile.dateien} />],
                zeile.person ? ['Lautet auf', zeile.person] : null,
                beleg.stelle?.pfad?.length > 0 ? ['Passt zu', beleg.stelle.pfad.join(' › ')] : null,
              ]}
            />
          )
        })}
      </div>
    </section>
  )
}

export interface NichtZugeordneteUnterlagenProps {
  eintraege: readonly NichtZugeordnet[]
}

/** Documents or pages that belong to no statement of the application, and why. */
export function NichtZugeordneteUnterlagen({ eintraege }: NichtZugeordneteUnterlagenProps) {
  if (eintraege.length === 0) return null

  return (
    <section className="mt-10" aria-labelledby="ueberschrift-nicht-zugeordnet">
      <h2 id="ueberschrift-nicht-zugeordnet" className="kern-heading-small">
        Nicht zugeordnete Unterlagen
      </h2>
      <p className="kern-body kern-body--muted">
        Diese Unterlagen konnten keiner Angabe im Antrag zugeordnet werden. Sie müssen dazu nichts tun.
      </p>
      <div className="mt-2 flex flex-col gap-2">
        {eintraege.map((beleg) => {
          const zeile = zeileVon(beleg)
          return (
            <Karte
              key={beleg.dokument}
              titel={zeile.art}
              zeilen={[
                ['Datei', <Dateien key="d" dateien={zeile.dateien} />],
                zeile.person ? ['Lautet auf', zeile.person] : null,
                ['Grund', beleg.grund],
              ]}
            />
          )
        })}
      </div>
    </section>
  )
}
