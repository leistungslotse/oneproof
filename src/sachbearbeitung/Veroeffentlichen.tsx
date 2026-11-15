import { useId, useMemo, useState } from 'react'
import { holeBytes, speichereDatei } from '../browser.ts'
import Dialog from '../components/Dialog.tsx'
import Fehlermeldung from '../components/Fehlermeldung.tsx'
import { meldungVon } from '../engine/fehler.ts'
import type { Aenderung } from '../engine/profil/bearbeiten.ts'
import { aufzaehlung, zaehle } from '../pruefen/ansicht.ts'
import { kurznamen } from './ansicht.ts'
import type { OffeneBedingung } from './ansicht.ts'
import type { ArbeitsEntwurf, Basis } from './arbeit.ts'
import { Hinweis } from './Kennzeichen.tsx'
import { baueVersionspaket, pruefeVersion, schlageVersionVor } from './version.ts'
import type { ProfilIndex } from './version.ts'
import { baueZip } from './zip.ts'

interface AenderungenProps {
  aenderungen: Aenderung[]
  /** The short names of the application types, by schema. */
  namen: Map<string, string>
}

/** What changed, by application type. */
function Aenderungen({ aenderungen, namen }: AenderungenProps) {
  const jeAntragsart = useMemo(() => {
    const gruppen = new Map<string, string[]>()
    for (const aenderung of aenderungen) {
      const wo = [aenderung.stelle, aenderung.bedingung].filter(Boolean).join(' › ')
      const text = wo ? `${wo}: ${aenderung.teile.join('; ')}` : aenderung.teile.join('; ')
      gruppen.set(aenderung.schema, [...(gruppen.get(aenderung.schema) ?? []), text])
    }
    return [...gruppen]
  }, [aenderungen])

  return (
    <ul className="op-aenderungen">
      {jeAntragsart.map(([schema, eintraege]) => (
        <li key={schema}>
          <span className="kern-body kern-body--bold">{namen.get(schema) ?? schema}</span>
          <ul className="kern-list kern-list--bullet">
            {eintraege.map((text, index) => (
              <li key={`${index}|${text}`}>{text}</li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}

interface MetaProps {
  eintraege: readonly (readonly [string, string])[]
}

function Meta({ eintraege }: MetaProps) {
  return (
    <dl className="kern-description-list op-meta">
      {eintraege.map(([schluessel, wert]) => (
        <div className="kern-description-list-item" key={schluessel}>
          <dt className="kern-description-list-item__key">{schluessel}</dt>
          <dd className="kern-description-list-item__value">{wert}</dd>
        </div>
      ))}
    </dl>
  )
}

/** How far making the package is. */
type Zustand = { zustand: 'bereit' } | { zustand: 'baut' } | { zustand: 'fertig'; dateien: number } | { zustand: 'fehler'; meldung: string }

export interface VeroeffentlichenProps {
  offen: boolean
  onSchliessen: () => void
  /** The profile. */
  id: string
  name: string
  /** `profile/index.json` as it is now. */
  indexRoh: ProfilIndex
  /** The version the draft was made from; `null` for a new profile. */
  basis: Basis | null
  entwurf: ArbeitsEntwurf
  /** `aenderungen()` of the draft. */
  aenderungen: Aenderung[]
  offenListe: { offen: OffeneBedingung[]; vorschlaege: number }
  /** The check of the draft is through and has no errors. */
  gepruefte: boolean
}

/**
 * Turns the draft into a new version: a package with the files of the version and the updated
 * index, to be unpacked on the server. The page cannot write there itself, it is a static site.
 */
export default function Veroeffentlichen({ offen, onSchliessen, id, name, indexRoh, basis, entwurf, aenderungen, offenListe, gepruefte }: VeroeffentlichenProps) {
  const feldId = useId()
  const versionen = indexRoh.profile.find((eintrag) => eintrag.id === id)?.versionen ?? []
  const namen = useMemo(() => kurznamen(entwurf.profil.antragsarten ?? []), [entwurf])
  const formatwechsel = basis?.format === 1

  const [version, setVersion] = useState('')
  const [alsAktuell, setAlsAktuell] = useState(true)
  const [stand, setStand] = useState<Zustand>({ zustand: 'bereit' })
  const [vorher, setVorher] = useState(false)

  // Each time it is opened it starts afresh: today's date, nothing downloaded yet.
  if (offen !== vorher) {
    setVorher(offen)
    if (offen) {
      setVersion(schlageVersionVor(versionen))
      setAlsAktuell(true)
      setStand({ zustand: 'bereit' })
    }
  }

  const versionsfehler = version === '' ? null : pruefeVersion(version, versionen)
  const bereit = gepruefte && (aenderungen.length > 0 || formatwechsel) && version !== '' && versionsfehler === null && stand.zustand !== 'baut'

  async function erstelle() {
    setStand({ zustand: 'baut' })
    try {
      const paket = await baueVersionspaket({
        roh: entwurf.profil,
        id,
        version,
        index: indexRoh,
        alsAktuell,
        ordner: basis?.ordner ?? null,
        holeDatei: holeBytes,
        dateien: entwurf.dateien ?? {},
      })
      speichereDatei(`${id}-${version}.zip`, baueZip(paket), 'application/zip')
      setStand({ zustand: 'fertig', dateien: paket.length })
    } catch (fehler) {
      setStand({ zustand: 'fehler', meldung: meldungVon(fehler) })
    }
  }

  const offeneTexte = offenListe.offen.map(({ stelle, bedingung }) => (bedingung ? `${stelle} › ${bedingung}` : stelle))

  return (
    <Dialog
      offen={offen}
      titel="Neue Version veröffentlichen"
      onSchliessen={onSchliessen}
      fuss={
        <>
          <button type="button" className="kern-btn kern-btn--secondary" onClick={onSchliessen}>
            <span className="kern-label">{stand.zustand === 'fertig' ? 'Schließen' : 'Abbrechen'}</span>
          </button>
          <button type="button" className="kern-btn kern-btn--primary" disabled={!bereit} onClick={erstelle}>
            <span className="kern-icon kern-icon--download" aria-hidden="true" />
            <span className="kern-label">Paket herunterladen (ZIP)</span>
          </button>
        </>
      }
    >
      <Meta
        eintraege={[
          ['Profil', name],
          ['Version', `${basis?.version ?? 'neu'} → ${version || '…'}`],
          ['Format', formatwechsel ? '1 (Nachweisarten) → 2 (Bedingungen)' : '2 (Bedingungen)'],
        ]}
      />

      <div>
        <h3 className="kern-title kern-title--small">
          {/* One child: KERN makes a title in a dialog a flex container, which drops the space between a text and an element. */}
          <span>Was sich ändert ({aenderungen.length})</span>
        </h3>
        <div className="mt-2">
          {aenderungen.length > 0 ? (
            <Aenderungen aenderungen={aenderungen} namen={namen} />
          ) : (
            <p className="kern-body">{formatwechsel ? 'Inhaltlich nichts: Das Profil wird im neuen Format gespeichert und entscheidet wie bisher.' : 'Der Entwurf unterscheidet sich nicht von seiner Version.'}</p>
          )}
        </div>
      </div>

      {offeneTexte.length > 0 && (
        <Hinweis art="warning" titel={`${zaehle(offeneTexte.length, 'Bedingung ist', 'Bedingungen sind')} noch offen`}>
          <p className="kern-body">
            {aufzaehlung(offeneTexte.slice(0, 5))}
            {offeneTexte.length > 5 ? ` und ${offeneTexte.length - 5} weitere` : ''}. Dort verlangt die Prüfung keinen Nachweis. Sie können trotzdem veröffentlichen.
          </p>
        </Hinweis>
      )}
      {offenListe.vorschlaege > 0 && (
        <p className="kern-body kern-body--small">
          {zaehle(offenListe.vorschlaege, 'Vorschlag ist', 'Vorschläge sind')} nicht bestätigt und {offenListe.vorschlaege === 1 ? 'gilt' : 'gelten'} so, wie vorgeschlagen.
        </p>
      )}

      <div className={`kern-form-input w-full ${versionsfehler ? 'kern-form-input--error' : ''}`}>
        <label className="kern-label" htmlFor={feldId}>
          Version
        </label>
        <p className="kern-hint" id={`${feldId}-hinweis`}>
          Das Datum, ab dem die Version gelten soll, im Format JJJJ-MM-TT.
        </p>
        <input
          id={feldId}
          className={`kern-form-input__input op-feld-schmal ${versionsfehler ? 'kern-form-input__input--error' : ''}`}
          autoComplete="off"
          value={version}
          aria-invalid={versionsfehler ? 'true' : undefined}
          aria-describedby={`${feldId}-hinweis${versionsfehler ? ` ${feldId}-fehler` : ''}`}
          onChange={(ereignis) => setVersion(ereignis.target.value.trim())}
        />
        {versionsfehler && <Fehlermeldung id={`${feldId}-fehler`}>{versionsfehler}</Fehlermeldung>}
      </div>

      {basis && (
        <div className="kern-form-check">
          <input id={`${feldId}-aktuell`} className="kern-form-check__checkbox" type="checkbox" checked={alsAktuell} onChange={(ereignis) => setAlsAktuell(ereignis.target.checked)} />
          <label className="kern-label" htmlFor={`${feldId}-aktuell`}>
            Als aktuelle Version eintragen
          </label>
        </div>
      )}

      {!gepruefte && <p className="kern-body kern-body--small kern-body--muted">Der Entwurf wird noch geprüft, oder die Prüfung hat Fehler gefunden. Danach lässt sich das Paket erstellen.</p>}

      {stand.zustand === 'fehler' && (
        <Hinweis art="danger" titel="Das Paket konnte nicht erstellt werden">
          <p className="kern-body">{stand.meldung}</p>
        </Hinweis>
      )}
      {stand.zustand === 'fertig' && (
        <Hinweis art="success" titel="Das Paket ist heruntergeladen">
          <p className="kern-body">
            {id}-{version}.zip enthält {zaehle(stand.dateien, 'Datei', 'Dateien')}.
          </p>
        </Hinweis>
      )}

      <Hinweis titel="Für Antragstellende ändert sich noch nichts">
        <ol className="kern-list kern-list--number">
          <li>
            Das Paket entpacken und den Ordner <code>profile/</code> nach <code>public/</code> kopieren. Frühere Versionen bleiben erhalten.
          </li>
          <li>Das Projekt bauen und ausliefern.</li>
        </ol>
      </Hinweis>
    </Dialog>
  )
}
