import type { Antragspaket as Paket, PaketDatei as PaketDateiInfo } from '../engine/paket/paket.ts'
import type { Profil } from '../engine/profil/laden.ts'
import { eingangsText, zaehle } from './ansicht.ts'
import type { Eingang } from './paket.ts'
import Seite from './Seite.tsx'
import { Karte } from './Unterlagen.tsx'

/** One file of the package: what it is, where it comes from, and where the application refers to it — or why not. */
function PaketDatei({ datei }: { datei: PaketDateiInfo }) {
  return (
    <Karte
      titel={<span className="wrap-anywhere">{datei.name}</span>}
      zeilen={[
        ['Inhalt', datei.seiten ? `${datei.art}, ${zaehle(datei.seiten, 'Seite', 'Seiten')}` : datei.art],
        datei.herkunft ? ['Aus', datei.herkunft] : null,
        // One label for both, so that the values of all cards start at the same place.
        datei.verweise.length > 0
          ? ['Verweis im Antrag', datei.verweise.map(({ bezeichnung }) => bezeichnung).join('; ')]
          : ['Verweis im Antrag', `Keiner. ${datei.ohneVerweis ?? ''}`.trim()],
      ]}
    />
  )
}

/** What the package holds, file by file. */
function Antragspaket({ paket }: { paket: Paket }) {
  const mitVerweis = paket.dateien.filter(({ verweise }) => verweise.length > 0).length
  const anzahl = paket.dateien.length

  return (
    <section className="mt-8" aria-labelledby="ueberschrift-paket">
      <h2 id="ueberschrift-paket" className="kern-heading-small">
        Ihr Antragspaket
      </h2>
      <p className="kern-body">
        „<span className="wrap-anywhere">{paket.name}</span>“ wurde heruntergeladen. Es enthält Ihre Antragsdaten{' '}
        {paket.oneproof ? 'im OneProof Format (antrag.json)' : 'als FIM-Datei (antrag.xml)'}
        {anzahl > 0 ? `, ${zaehle(anzahl, 'Nachweisdatei', 'Nachweisdateien')}` : ''}, das Manifest mit dem Ergebnis der
        Prüfung und eine Übersicht (inhalt.txt).
        {anzahl > 0 &&
          (mitVerweis === anzahl
            ? ` Der Antrag verweist an den passenden Stellen auf ${anzahl === 1 ? 'die Datei' : `alle ${anzahl} Dateien`}.`
            : ` Der Antrag verweist an den passenden Stellen auf ${mitVerweis} davon. Warum die übrigen ohne Verweis sind, steht bei der Datei.`)}
      </p>

      {paket.hinweise.length > 0 && (
        <div className="kern-alert kern-alert--warning mt-4">
          <div className="kern-alert__header">
            <span className="kern-icon kern-icon--warning" aria-hidden="true" />
            <span className="kern-title">Hinweise zum Antragspaket</span>
          </div>
          <div className="kern-alert__body">
            <ul className="kern-list kern-list--bullet">
              {paket.hinweise.map((hinweis) => (
                <li key={hinweis}>{hinweis}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {anzahl > 0 && (
        <details className="kern-details mt-4">
          <summary className="kern-details__header">
            <span className="kern-title kern-title--small">Dateien und Verweise anzeigen</span>
          </summary>
          <div className="kern-details__body">
            <div className="flex flex-col gap-2">
              {paket.dateien.map((datei) => (
                <PaketDatei key={datei.name} datei={datei} />
              ))}
            </div>
          </div>
        </details>
      )}
    </section>
  )
}

export interface EingegangenProps {
  profil: Pick<Profil, 'name'>
  eingang: Eingang
  /** The statements that are still open or unclear. */
  nochOffen: number
  /** The package of this submission; `null` where there is none. */
  paket: Paket | null
  /** Saves the package again. */
  onPaket: () => void
  onManifest: () => void
  onZurueck: () => void
  onNeu: () => void
}

/**
 * The confirmation after "Antrag einreichen". Nothing is sent anywhere: the page says so, as the
 * footer does, because the files may be a person's own. What would be sent is the package, which
 * the person has been offered to save.
 */
export default function Eingegangen({ profil, eingang, nochOffen, paket, onPaket, onManifest, onZurueck, onNeu }: EingegangenProps) {
  return (
    <Seite titel={`${profil.name} beantragen`}>
      <h1 id="seitenueberschrift" tabIndex={-1} className="kern-sr-only">
        Ihr Antrag ist eingegangen
      </h1>

      <div className="kern-alert kern-alert--success">
        <div className="kern-alert__header">
          <span className="kern-icon kern-icon--success" aria-hidden="true" />
          <span className="kern-title kern-title--large">Ihr Antrag ist eingegangen</span>
        </div>
        <div className="kern-alert__body">
          <p className="kern-body">
            Eingangsdatum: {eingang.datum}. Ihr Aktenzeichen lautet {eingang.aktenzeichen}. Die Frist ist damit gewahrt.
          </p>
          <p className="kern-body mt-3!">{eingangsText(nochOffen)}</p>
          <p className="kern-body kern-body--muted mt-3!">
            In dieser Vorführung wird nichts an eine Behörde übermittelt. Was übermittelt würde, ist das Antragspaket.
          </p>
        </div>
      </div>

      {paket && <Antragspaket paket={paket} />}

      <div className="kern-btn-wrapper mt-8">
        {paket && (
          <button type="button" className="kern-btn kern-btn--secondary" onClick={onPaket}>
            <span className="kern-icon kern-icon--download" aria-hidden="true" />
            <span className="kern-label">Antragspaket erneut herunterladen (ZIP)</span>
          </button>
        )}
        <button type="button" className="kern-btn kern-btn--secondary" onClick={onManifest}>
          <span className="kern-icon kern-icon--download" aria-hidden="true" />
          <span className="kern-label">Manifest speichern (JSON)</span>
        </button>
        <button type="button" className="kern-btn kern-btn--tertiary" onClick={onZurueck}>
          <span className="kern-icon kern-icon--arrow-back" aria-hidden="true" />
          <span className="kern-label">Zurück zur Prüfung</span>
        </button>
        <button type="button" className="kern-btn kern-btn--tertiary" onClick={onNeu}>
          <span className="kern-icon kern-icon--autorenew" aria-hidden="true" />
          <span className="kern-label">Neue Prüfung</span>
        </button>
      </div>
    </Seite>
  )
}
