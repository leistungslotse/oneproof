import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import Fehlermeldung from '../components/Fehlermeldung.tsx'
import type { Antragsformat, Profil } from '../engine/profil/laden.ts'
import { aufzaehlung, groesseText, zaehle } from './ansicht.ts'
import type { Beispielfall, Beispielkatalog } from './beispiel.ts'
import Seite from './Seite.tsx'
import type { AntragErkennung, GewaehlterAntrag } from './steuerung.ts'

const ANTRAG_ENDUNGEN = '.xml,application/xml,text/xml,.json,application/json'
const NACHWEIS_ENDUNGEN = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'

/** What the check understood of the application, shown the moment it is chosen. */
function ErkannterAntrag({ erkannt }: { erkannt: AntragErkennung }) {
  return (
    <div className="kern-alert kern-alert--success mt-4 w-full">
      <div className="kern-alert__header">
        <span className="kern-icon kern-icon--success" aria-hidden="true" />
        <span className="kern-title">Antrag erkannt</span>
      </div>
      <div className="kern-alert__body">
        <p className="kern-body">
          {erkannt.name} · {erkannt.formatName ? `${erkannt.formatName}, ` : ''}Schema {erkannt.schema}, Version {erkannt.version}
        </p>
        {erkannt.personen.length > 0 && (
          <p className="kern-body">
            {erkannt.personen.length === 1 ? 'Person' : 'Personen'} im Antrag: {aufzaehlung(erkannt.personen)}
          </p>
        )}
        {erkannt.hinweise.map((hinweis) => (
          <p key={hinweis} className="kern-body kern-body--muted">
            {hinweis}
          </p>
        ))}
      </div>
    </div>
  )
}

/**
 * The invented cases of the profile. The chosen one is loaded as if its files had been chosen by
 * hand: the application into its field, the evidence into the list.
 */
function Beispielfaelle({
  katalog,
  laedt,
  fehler,
  onLaden,
}: {
  katalog: Beispielkatalog
  laedt: boolean
  fehler: string | null
  onLaden: (beispiel: Beispielfall) => void
}) {
  const [index, setIndex] = useState(0)
  const { beispiele } = katalog
  const gewaehlt = beispiele[index] ?? beispiele[0]
  // A catalogue is only offered with at least one case.
  if (!gewaehlt) throw new Error('Der Katalog enthält keinen Beispielfall.')

  return (
    <div className="flex flex-col gap-3">
      <div className="kern-divider kern-divider--decorative" />
      <div className="kern-form-input">
        <label className="kern-label" htmlFor="beispielfall">
          Beispielfall laden
        </label>
        <p className="kern-hint" id="beispielfall-hinweis">
          Erfundene Fälle zum Ausprobieren. Antrag und Nachweise werden ausgewählt, als hätten Sie sie hochgeladen.
        </p>
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          {beispiele.length > 1 && (
            <div className="kern-form-input__select-wrapper w-full sm:w-auto sm:flex-1">
              <select
                id="beispielfall"
                className="kern-form-input__select"
                value={index}
                aria-describedby="beispielfall-hinweis beispielfall-beschreibung"
                onChange={(ereignis) => setIndex(Number(ereignis.target.value))}
              >
                {beispiele.map((beispiel, stelle) => (
                  <option key={beispiel.id} value={stelle}>
                    {beispiel.titel}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button
            type="button"
            id={beispiele.length > 1 ? undefined : 'beispielfall'}
            className="kern-btn kern-btn--secondary"
            onClick={() => onLaden(gewaehlt)}
            disabled={laedt}
          >
            <span className="kern-icon kern-icon--drive-folder-upload" aria-hidden="true" />
            <span className="kern-label">{laedt ? 'Beispiel wird geladen …' : 'Beispiel laden'}</span>
          </button>
        </div>
        {gewaehlt.beschreibung && (
          <p id="beispielfall-beschreibung" className="kern-body kern-body--small kern-body--muted">
            {gewaehlt.beschreibung}
          </p>
        )}
        {fehler && <Fehlermeldung id="beispiel-fehler">{fehler}</Fehlermeldung>}
      </div>
    </div>
  )
}

export interface EingabeProps {
  profil: Pick<Profil, 'name' | 'antragsarten'>
  antrag: GewaehlterAntrag | null
  antragFehler: string | null
  nachweise: readonly File[]
  abgelehnt: readonly string[]
  /** The example cases of the profile. */
  beispiel: Beispielkatalog | null
  beispielFehler: string | null
  beispielLaedt: boolean
  onAntrag: (datei: File | null) => void
  onNachweise: (dateien: File[]) => void
  onEntferne: (datei: File) => void
  /** Loads the files of this case. */
  onBeispiel: (beispiel: Beispielfall) => void
  onPruefen: () => void
}

/** The first view: the application and the evidence to check. */
export default function Eingabe({
  profil,
  antrag,
  antragFehler,
  nachweise,
  abgelehnt,
  beispiel,
  beispielFehler,
  beispielLaedt,
  onAntrag,
  onNachweise,
  onEntferne,
  onBeispiel,
  onPruefen,
}: EingabeProps) {
  const antragFeld = useRef<HTMLInputElement>(null)
  const bereit = antrag?.erkannt != null
  const versionenIm = (format: Antragsformat): string =>
    [...new Set(profil.antragsarten.filter((art) => (art.format === 'oneproof' ? 'oneproof' : 'fim') === format).map(({ version }) => version))].join(', ')
  const versionen = versionenIm('fim')
  const oneproofVersionen = versionenIm('oneproof')

  /*
   * The field shows the file that is chosen, also when it was not chosen in the field: after the
   * example is loaded, and when the person comes back to this view from another.
   */
  useEffect(() => {
    const feld = antragFeld.current
    const gewaehlt = antrag?.datei ?? null
    if (!feld || (feld.files?.[0] ?? null) === gewaehlt) return
    try {
      const behaelter = new DataTransfer()
      if (gewaehlt) behaelter.items.add(gewaehlt)
      feld.files = behaelter.files
    } catch {
      // A browser that cannot do this still shows the file name below the field.
    }
  }, [antrag])

  /*
   * After an error the field is emptied: the same file, corrected in the meantime, is a new choice —
   * a field that still holds its path does not fire `change` for it.
   */
  useEffect(() => {
    if (antragFehler && antragFeld.current) antragFeld.current.value = ''
  }, [antragFehler])

  return (
    <Seite titel={`${profil.name} beantragen`}>
      <p className="kern-preline">Nachweisprüfung · Schritt 1 von 2</p>
      <h1 id="seitenueberschrift" tabIndex={-1} className="kern-heading-x-large">
        Antrag und Nachweise prüfen
      </h1>
      <p className="kern-body mt-4!">
        Laden Sie Ihre Antragsdaten und Ihre Nachweise hoch. Die Unterlagen werden gelesen, zu Dokumenten gruppiert und den
        passenden Angaben in Ihrem Antrag zugeordnet. Danach sehen Sie, was belegt ist und was noch fehlt — und können den Antrag
        trotzdem einreichen.
      </p>

      <form
        className="mt-8 flex flex-col gap-8"
        noValidate
        onSubmit={(ereignis: FormEvent<HTMLFormElement>) => {
          ereignis.preventDefault()
          if (bereit) onPruefen()
        }}
      >
        <div>
          <div className={`kern-form-input ${antragFehler ? 'kern-form-input--error' : ''}`}>
            <label className="kern-label" htmlFor="antragsdaten">
              Antragsdaten
            </label>
            <p className="kern-hint" id="antragsdaten-hinweis">
              {versionen && `XML-Datei zum FIM-Schema der ${profil.name}-Anträge (XDF ${versionen}). Ältere Versionen des Schemas werden umgesetzt.`}
              {versionen && oneproofVersionen && ' '}
              {oneproofVersionen &&
                `${versionen ? 'Oder eine' : 'Eine'} JSON-Datei im OneProof Format (Version ${oneproofVersionen}).`}
            </p>
            <input
              id="antragsdaten"
              ref={antragFeld}
              className={`kern-form-input__input ${antragFehler ? 'kern-form-input__input--error' : ''}`}
              type="file"
              accept={ANTRAG_ENDUNGEN}
              aria-describedby={`antragsdaten-hinweis${antragFehler ? ' antragsdaten-fehler' : ''}`}
              aria-invalid={antragFehler ? 'true' : undefined}
              aria-required="true"
              onChange={(ereignis) => {
                onAntrag(ereignis.target.files?.[0] ?? null)
              }}
            />
            {antragFehler && <Fehlermeldung id="antragsdaten-fehler">{antragFehler}</Fehlermeldung>}
          </div>
          {antrag && !antragFehler && (
            <p className="kern-body kern-body--small kern-body--muted mt-2!">
              Ausgewählt: {antrag.datei.name} ({groesseText(antrag.datei.size)})
            </p>
          )}
          {antrag?.erkannt && <ErkannterAntrag erkannt={antrag.erkannt} />}
        </div>

        <div>
          <div className={`kern-form-input ${abgelehnt.length > 0 ? 'kern-form-input--error' : ''}`}>
            <label className="kern-label" htmlFor="nachweise">
              Nachweise <span className="kern-label__optional">(optional)</span>
            </label>
            <p className="kern-hint" id="nachweise-hinweis">
              PDF-, JPEG- oder PNG-Dateien, auch mehrere auf einmal. Ohne Nachweise zeigt die Prüfung, was Sie einreichen müssen.
            </p>
            <input
              id="nachweise"
              className={`kern-form-input__input ${abgelehnt.length > 0 ? 'kern-form-input__input--error' : ''}`}
              type="file"
              multiple
              accept={NACHWEIS_ENDUNGEN}
              aria-describedby={`nachweise-hinweis${abgelehnt.length > 0 ? ' nachweise-fehler' : ''}`}
              aria-invalid={abgelehnt.length > 0 ? 'true' : undefined}
              onChange={(ereignis) => {
                onNachweise(Array.from(ereignis.target.files ?? []))
                // The choice is kept in the list below, so the same file can be picked again later.
                ereignis.target.value = ''
              }}
            />
            {abgelehnt.length > 0 && (
              <Fehlermeldung id="nachweise-fehler">
                {abgelehnt.map((meldung) => (
                  <span key={meldung} className="block">
                    {meldung}
                  </span>
                ))}
              </Fehlermeldung>
            )}
          </div>

          {nachweise.length > 0 && (
            <div className="mt-4">
              <p className="kern-label" id="nachweisliste">
                {zaehle(nachweise.length, 'Nachweis', 'Nachweise')} ausgewählt
              </p>
              <ul className="op-dateiliste mt-2" aria-labelledby="nachweisliste">
                {nachweise.map((datei) => (
                  <li key={`${datei.name}:${datei.size}:${datei.lastModified}`}>
                    <span className="kern-icon kern-icon--draft" aria-hidden="true" />
                    <span className="kern-body op-dateiliste__name">{datei.name}</span>
                    <span className="kern-body kern-body--small kern-body--muted">{groesseText(datei.size)}</span>
                    <button type="button" className="kern-btn kern-btn--tertiary kern-btn--small" onClick={() => onEntferne(datei)}>
                      <span className="kern-icon kern-icon--delete" aria-hidden="true" />
                      <span className="kern-label kern-sr-only">{datei.name} entfernen</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="kern-alert kern-alert--info w-full">
          <div className="kern-alert__header">
            <span className="kern-icon kern-icon--info" aria-hidden="true" />
            <span className="kern-title">So werden Ihre Daten verarbeitet</span>
          </div>
          <div className="kern-alert__body">
            <p className="kern-body">
              Die Prüfung läuft in Ihrem Browser. Die Antragsdatei selbst verlässt ihn nicht. An den KI-Dienst von IONOS gehen die
              Seiten Ihrer Nachweise als Bild, der daraus gelesene Text, die Namen der Personen aus dem Antrag (mit Geburtsnamen,
              auch von Personen außerhalb des Haushalts, etwa einer Vertretung) und Ihre Angaben zur Wohnsituation, zum Beispiel ob
              Sie zur Miete wohnen. Nutzen Sie für die Vorführung erfundene Daten.
            </p>
          </div>
        </div>

        <div className="kern-btn-wrapper">
          <button type="submit" className="kern-btn kern-btn--primary" disabled={!bereit}>
            <span className="kern-label">Prüfen</span>
            <span className="kern-icon kern-icon--arrow-forward" aria-hidden="true" />
          </button>
        </div>

        {!bereit && !antragFehler && (
          <p className="kern-hint -mt-4!">„Prüfen“ ist möglich, sobald Antragsdaten ausgewählt sind.</p>
        )}
        {beispiel && <Beispielfaelle katalog={beispiel} laedt={beispielLaedt} fehler={beispielFehler} onLaden={onBeispiel} />}
      </form>
    </Seite>
  )
}
