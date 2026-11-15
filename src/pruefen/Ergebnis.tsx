import type { ReactNode } from 'react'
import { aufzaehlung, dauerText, einreichenText, infoText, seitenZahl, teileAuf, zaehlungen } from './ansicht.ts'
import { BelegteAngabe, EntfalleneAngabe, OffeneAngabe } from './Angaben.tsx'
import Meta from '../components/Meta.tsx'
import type { Pruefergebnis } from '../engine/pipeline.ts'
import type { Profil } from '../engine/profil/laden.ts'
import Seite from './Seite.tsx'
import { ErkannteUnterlagen, NichtZugeordneteUnterlagen, WeitereUnterlagen } from './Unterlagen.tsx'

/** How "Antrag einreichen" is going: the package being made, or why it could not be. */
export interface Einreichung {
  laeuft: boolean
  /** Documents put together so far. */
  fertig: number
  /** Documents to put together; 0 until it is known. */
  gesamt: number
  /** Why the package could not be made. */
  fehler: string | null
}

/** A warning with a list of notes. */
function Hinweise({ titel, eintraege }: { titel: string; eintraege: readonly string[] }) {
  if (eintraege.length === 0) return null

  return (
    <div className="kern-alert kern-alert--warning mt-4 w-full">
      <div className="kern-alert__header">
        <span className="kern-icon kern-icon--warning" aria-hidden="true" />
        <span className="kern-title">{titel}</span>
      </div>
      <div className="kern-alert__body">
        <ul className="kern-list kern-list--bullet">
          {eintraege.map((eintrag) => (
            <li key={eintrag}>{eintrag}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/**
 * The grouping failed and the check went on without it: said first, with the way out. The pages
 * are read already, so checking again costs only the grouping.
 */
function GruppierungFehlgeschlagen({ gruppierung, onErneut }: { gruppierung: Pruefergebnis['ki']['gruppierung']; onErneut: () => void }) {
  if (gruppierung?.status !== 'fehlgeschlagen') return null

  return (
    <div className="kern-alert kern-alert--warning mt-6" role="alert">
      <div className="kern-alert__header">
        <span className="kern-icon kern-icon--warning" aria-hidden="true" />
        <span className="kern-title">Ihre Unterlagen konnten noch nicht zugeordnet werden</span>
      </div>
      <div className="kern-alert__body">
        <p className="kern-body">{gruppierung.hinweis}</p>
        <div className="kern-btn-wrapper mt-4">
          <button type="button" className="kern-btn kern-btn--primary" onClick={onErneut}>
            <span className="kern-icon kern-icon--autorenew" aria-hidden="true" />
            <span className="kern-label">Erneut prüfen</span>
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Said at the top: an AI made the comparison, and it decides nothing. Next to it the way to start
 * over, which otherwise waits only at the end of a long page.
 */
function KiHinweis({ ki, onNeu }: { ki: Pruefergebnis['ki']; onNeu: () => void }) {
  // The models are only chosen when there are pages to read.
  const mitKi = Boolean(ki?.ocrModell || ki?.textModell)

  return (
    <div className="mt-6 flex flex-col items-start gap-4 md:flex-row">
      <div className="kern-alert kern-alert--info w-full md:flex-1">
        <div className="kern-alert__header">
          <span className="kern-icon kern-icon--info" aria-hidden="true" />
          <span className="kern-title">{mitKi ? 'Der Abgleich erfolgte KI-basiert' : 'Der Abgleich erfolgte ohne KI'}</span>
        </div>
        <div className="kern-alert__body">
          <p className="kern-body">
            {mitKi ? (
              <>
                Eine KI hat Ihre Unterlagen gelesen, zu Dokumenten geordnet und mit den Angaben im Antrag abgeglichen. Dabei können
                Fehler passieren. Das Ergebnis hilft Ihnen beim Einreichen; über Ihren Antrag entscheidet die Behörde. Welche Modelle
                beteiligt waren, steht unter{' '}
                <a className="kern-link" href="#ueberschrift-bericht">
                  Angaben zur Prüfung
                </a>
                .
              </>
            ) : (
              'Es lagen keine lesbaren Nachweise vor. Das Ergebnis folgt allein aus Ihren Angaben im Antrag; eine KI war dafür nicht nötig.'
            )}
          </p>
        </div>
      </div>
      <button type="button" className="kern-btn kern-btn--secondary md:shrink-0" onClick={onNeu}>
        <span className="kern-icon kern-icon--autorenew" aria-hidden="true" />
        <span className="kern-label">Neue Prüfung</span>
      </button>
    </div>
  )
}

/** What "Antrag einreichen" is doing: putting the documents together, or why it could not. */
function EinreichenStand({ einreichen }: { einreichen: Einreichung }) {
  const { laeuft, fertig, gesamt, fehler } = einreichen

  return (
    <>
      {/* Always there, so that a screen reader hears it when it starts to speak. */}
      <p className={laeuft ? 'kern-body kern-body--muted mt-3!' : 'kern-sr-only'} role="status">
        {laeuft && (gesamt > 0 ? `Dokument ${Math.min(fertig + 1, gesamt)} von ${gesamt} wird zusammengestellt …` : 'Das Antragspaket wird erstellt …')}
      </p>
      {fehler && (
        <div className="kern-alert kern-alert--danger mt-4" role="alert">
          <div className="kern-alert__header">
            <span className="kern-icon kern-icon--danger" aria-hidden="true" />
            <span className="kern-title">Das Antragspaket konnte nicht erstellt werden</span>
          </div>
          <div className="kern-alert__body">
            <p className="kern-body">{fehler}</p>
          </div>
        </div>
      )}
    </>
  )
}

/** `2026-08-13` → `13.08.2026`. */
const alsDatum = (tag: string): string => (tag ? tag.split('-').reverse().join('.') : '')

/** What the check used and how long it took — for whoever wants to know how the result came about. */
function Pruefbericht({ ergebnis, onManifest }: { ergebnis: Pruefergebnis; onManifest: () => void }) {
  const { antrag, profil, ki } = ergebnis
  const zeilen: ([string, ReactNode] | null)[] = [
    ['Antrag', antrag.name],
    [
      'Schema',
      `${antrag.schema}, Version ${antrag.version}${antrag.urspruenglicheVersion ? ` (umgesetzt aus Version ${antrag.urspruenglicheVersion})` : ''}`,
    ],
    antrag.personen.length > 0 ? ['Personen', aufzaehlung(antrag.personen)] : null,
    antrag.stichtag
      ? [
          'Stichtag für die Aktualität der Nachweise',
          `${alsDatum(antrag.stichtag)}${antrag.stichtagAusAntrag ? ' (Datum des Antrags)' : ' (Tag der Prüfung)'}`,
        ]
      : null,
    ['Profil', `${profil.name} (${profil.kennung})`],
    profil.hinweis ? ['Hinweis zum Profil', profil.hinweis] : null,
    ['Texterkennung', ki.ocrModell ?? 'nicht nötig'],
    ['Zuordnung', ki.textModell ?? 'nicht nötig'],
    ['Gelesene Seiten', String(seitenZahl(ergebnis))],
    ['Dauer', dauerText(ergebnis.dauerMs)],
    ['Geprüft am', new Date(ergebnis.erstelltAm).toLocaleString('de-DE', { dateStyle: 'long', timeStyle: 'short' })],
  ]

  return (
    <section className="mt-10" aria-labelledby="ueberschrift-bericht">
      <h2 id="ueberschrift-bericht" className="kern-heading-small">
        Angaben zur Prüfung
      </h2>
      <details className="kern-details mt-2">
        <summary className="kern-details__header">
          <span className="kern-title kern-title--small">Antrag, Profil, Modelle und Dauer anzeigen</span>
        </summary>
        <div className="kern-details__body">
          <Meta pairs={zeilen.filter((zeile) => zeile !== null)} />
        </div>
      </details>
      <p className="kern-body kern-body--muted mt-4!">
        Das Ergebnis gibt es auch als Manifest nach der OneProof-Schnittstelle. Es nennt zu jeder Angabe den Beleg, die Fundstelle und
        den Hash der Datei.
      </p>
      <div className="kern-btn-wrapper mt-2">
        <button type="button" className="kern-btn kern-btn--secondary kern-btn--small" onClick={onManifest}>
          <span className="kern-icon kern-icon--download" aria-hidden="true" />
          <span className="kern-label">Manifest speichern (JSON)</span>
        </button>
      </div>
    </section>
  )
}

export interface ErgebnisProps {
  profil: Pick<Profil, 'name'>
  /** The result of a check. */
  ergebnis: Pruefergebnis
  /** Requirements whose state changed in the last check. */
  geaendert: ReadonlySet<string>
  /** Files that were not taken up. */
  meldungen: readonly string[]
  /** More evidence: read it and check again. */
  onNachweise: (dateien: File[]) => void
  /** The same evidence once more (after a failed grouping). */
  onErneut: () => void
  /** The package being made. */
  einreichen: Einreichung
  /** Makes the package, offers it to save, and shows the confirmation. */
  onEinreichen: () => void
  onManifest: () => void
  onNeu: () => void
}

/**
 * The result, laid out like the dummy: what is still to do, what is proven, what does not apply —
 * and the way to submit the application whatever is still open.
 */
export default function Ergebnis({
  profil,
  ergebnis,
  geaendert,
  meldungen,
  onNachweise,
  onErneut,
  einreichen,
  onEinreichen,
  onManifest,
  onNeu,
}: ErgebnisProps) {
  const { zuTun, belegt, entfaellt } = teileAuf(ergebnis.anforderungen)
  const zahlen = zaehlungen(ergebnis.zusammenfassung)
  const { antrag } = ergebnis

  return (
    <Seite titel={`${profil.name} beantragen`}>
      <p className="kern-preline">
        Antrag auf {profil.name}
        {antrag.personen.length > 0 && ` für ${antrag.personen[0]}`} · Schritt 2 von 2
      </p>
      <h1 id="seitenueberschrift" tabIndex={-1} className="kern-heading-x-large">
        Nachweise einreichen
      </h1>

      <KiHinweis ki={ergebnis.ki} onNeu={onNeu} />
      <GruppierungFehlgeschlagen gruppierung={ergebnis.ki?.gruppierung} onErneut={onErneut} />

      <div className="kern-alert kern-alert--info mt-6">
        <div className="kern-alert__header">
          <span className="kern-icon kern-icon--info" aria-hidden="true" />
          <span className="kern-title">
            {zahlen.gesamt === 1 ? 'Für Ihren Antrag wurde 1 Angabe geprüft' : `Für Ihren Antrag wurden ${zahlen.gesamt} Angaben geprüft`}
          </span>
        </div>
        <div className="kern-alert__body">
          <p className="kern-body">{infoText(zahlen)}</p>
        </div>
      </div>

      <Hinweise titel="Nicht aufgenommen" eintraege={meldungen} />
      <Hinweise titel="Hinweise zur Prüfung" eintraege={ergebnis.hinweise} />

      <p className="kern-label mt-6!" aria-live="polite">
        {zahlen.belegt} von {zahlen.zuBelegen} Angaben belegt
      </p>
      <div className="kern-divider kern-divider--decorative mt-2!" />

      {zuTun.length > 0 && (
        <section className="mt-8" aria-labelledby="ueberschrift-offen">
          <h2 id="ueberschrift-offen" className="kern-heading-medium">
            Sie müssen folgende Nachweise einreichen
          </h2>
          <p className="kern-body kern-body--muted">
            Für diese Angaben fehlt noch ein Nachweis, oder der vorhandene reicht nicht aus. Alles andere ist bereits erledigt.
            Dateien, die Sie hier hinzufügen, werden gelesen und der passenden Angabe zugeordnet.
          </p>
          <div className="mt-4 flex flex-col gap-4">
            {zuTun.map((angabe) => (
              <OffeneAngabe key={angabe.id} angabe={angabe} gerade={geaendert.has(angabe.id)} onNachweise={onNachweise} />
            ))}
          </div>
        </section>
      )}

      {belegt.length > 0 && (
        <section className="mt-10" aria-labelledby="ueberschrift-belegt">
          <h2 id="ueberschrift-belegt" className="kern-heading-medium">
            Diese Angaben sind belegt
          </h2>
          <p className="kern-body kern-body--muted">Ihre Unterlagen belegen diese Angaben. Sie müssen dafür nichts weiter tun.</p>
          <div className="mt-4 flex flex-col gap-4">
            {belegt.map((angabe) => (
              <BelegteAngabe key={angabe.id} angabe={angabe} gerade={geaendert.has(angabe.id)} />
            ))}
          </div>
        </section>
      )}

      {entfaellt.length > 0 && (
        <section className="mt-10" aria-labelledby="ueberschrift-entfaellt">
          <h2 id="ueberschrift-entfaellt" className="kern-heading-small">
            Nicht erforderlich
          </h2>
          <p className="kern-body kern-body--muted">
            Das ergibt sich aus Ihren Antworten im Antrag. Dafür müssen Sie nichts einreichen.
          </p>
          <details className="kern-details mt-4">
            <summary className="kern-details__header">
              <span className="kern-title kern-title--small">
                {entfaellt.length === 1 ? '1 Angabe anzeigen' : `Alle ${entfaellt.length} Angaben anzeigen`}
              </span>
            </summary>
            <div className="kern-details__body">
              <div className="flex flex-col gap-2">
                {entfaellt.map((angabe) => (
                  <EntfalleneAngabe key={angabe.id} angabe={angabe} />
                ))}
              </div>
            </div>
          </details>
        </section>
      )}

      <WeitereUnterlagen weitere={ergebnis.weitere} />
      <NichtZugeordneteUnterlagen eintraege={ergebnis.nichtZugeordnet} />
      <ErkannteUnterlagen ergebnis={ergebnis} />
      <Pruefbericht ergebnis={ergebnis} onManifest={onManifest} />

      <section className="mt-10" aria-labelledby="ueberschrift-einreichen">
        <div className="kern-card kern-card--surface kern-card--hug">
          <div className="kern-card__container">
            <div className="kern-card__header">
              <h2 id="ueberschrift-einreichen" className="kern-heading-small">
                Antrag einreichen
              </h2>
            </div>
            <div className="kern-card__body">
              <p className="kern-body">{einreichenText(zahlen.nochOffen)}</p>
              <p className="kern-body mt-3!">
                Sie erhalten dabei das Antragspaket als ZIP-Datei:{' '}
                {antrag.format === 'oneproof'
                  ? 'Ihre Antragsdaten im OneProof Format, in dem jede Datei als Anlage die Angaben nennt, die sie belegt,'
                  : 'Ihre Antragsdaten als FIM-Datei, die an den passenden Stellen auf die Nachweise verweist,'}{' '}
                je Dokument eine PDF-Datei und das Ergebnis dieser Prüfung.
              </p>
              <EinreichenStand einreichen={einreichen} />
            </div>
            <div className="kern-card__footer">
              <button
                type="button"
                className="kern-btn kern-btn--primary"
                onClick={onEinreichen}
                aria-disabled={einreichen.laeuft || undefined}
              >
                <span className="kern-label">{einreichen.laeuft ? 'Antragspaket wird erstellt …' : 'Antrag einreichen'}</span>
                {!einreichen.laeuft && <span className="kern-icon kern-icon--arrow-forward" aria-hidden="true" />}
              </button>
              <button type="button" className="kern-btn kern-btn--tertiary" onClick={onNeu}>
                <span className="kern-icon kern-icon--autorenew" aria-hidden="true" />
                <span className="kern-label">Neue Prüfung</span>
              </button>
            </div>
          </div>
        </div>
      </section>
    </Seite>
  )
}
