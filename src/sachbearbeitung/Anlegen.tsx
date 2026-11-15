import { useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Fehlermeldung from '../components/Fehlermeldung.tsx'
import { liesJson } from '../browser.ts'
import { XdfError } from '../engine/fim/xdf.ts'
import { liesOneProofSchema, OneProofSchemaFehler } from '../engine/oneproof/ableitung.ts'
import type { OneProofSchemaGelesen } from '../engine/oneproof/ableitung.ts'
import { fuegeAntragsartEin, liesAntragsart, neuesProfil, schlageAnbindungVor, waehleAnbindung } from '../engine/profil/antragsart.ts'
import type { AntragsartGelesen, Anbindungsvorschlag, Bindung, Personenrolle, Zaehlung } from '../engine/profil/antragsart.ts'
import { eindeutig, knotenMitId, slug } from '../engine/profil/bedingungen.ts'
import type { Herkunft, ProfilFormat2 } from '../engine/profil/bedingungen.ts'
import type { Katalog, PersonBindung, Typ } from '../engine/profil/laden.ts'
import { groesseText, zaehle } from '../pruefen/ansicht.ts'
import { labelOf } from '../engine/fim/schema.ts'
import type { Schema } from '../engine/fim/schema.ts'
import type { Bearbeitung } from './arbeit.ts'
import { HerkunftChip, Hinweis } from './Kennzeichen.tsx'
import type { Dateien } from './version.ts'

const NEU = '__neu__'
/** Larger than any schema of the FIM portal; a bigger file is not read, so that the tab does not stall. */
const HOECHSTENS = 50 * 1024 * 1024
const LEITER: Herkunft['art'][] = ['regel', 'regelFremd', 'frage', 'abschnitt', 'immer']
/** Where the page finds the frame of the OneProof Format that the schema of a benefit refers to. */
const FORMAT_ORDNER = `${import.meta.env.BASE_URL}format/oneproof/`
/** A new profile as long as it has no name: what it would hold does not depend on the name. */
const LEERES_PROFIL = neuesProfil({ id: 'neu', name: '' })

/** A schema file read: a FIM schema from its XDF file, or the JSON Schema of a benefit in the OneProof Format. */
type Gelesen = AntragsartGelesen | OneProofSchemaGelesen

interface SchrittProps {
  nr: number
  titel: string
  gesperrt?: boolean
  children: ReactNode
}

/** A step of the page: number, title, and — until it can be taken — greyed out and not reachable. */
function Schritt({ nr, titel, gesperrt = false, children }: SchrittProps) {
  const id = useId()
  return (
    <section className="op-import" data-gesperrt={gesperrt ? 'true' : undefined} aria-labelledby={id}>
      <div className="op-import__kopf">
        <span className="kern-number" aria-hidden="true">
          {nr}
        </span>
        <h2 className="kern-title kern-title--small" id={id}>
          {titel}
        </h2>
      </div>
      <div className="mt-3" inert={gesperrt || undefined}>
        {children}
      </div>
    </section>
  )
}

interface ErgebnisProps {
  gelesen: Gelesen
  zahlen: Zaehlung
}

/** What reading the schema found: figures, where the conditions come from, and the rules not understood. */
function Ergebnis({ gelesen, zahlen }: ErgebnisProps) {
  const { ableitung } = gelesen
  const herkunft = Object.fromEntries(LEITER.map((art) => [art, ableitung.stellen.filter((stelle) => stelle.herkunft.art === art).length]))
  // Only a FIM schema has rules.
  const nichtAusgewertet = gelesen.format === 'fim' ? gelesen.ableitung.regeln.nichtAusgewertet : []
  const beiNachweis = nichtAusgewertet.filter((regel) => regel.beiNachweis)
  const kacheln: [string | number, string][] =
    gelesen.format === 'oneproof'
      ? [
          [gelesen.elemente.toLocaleString('de-DE'), 'Elemente im Schema'],
          [gelesen.ableitung.fragen, 'Abschnitte mit Ja/Nein-Frage'],
          [ableitung.stellen.length, 'Stellen im Antrag'],
          [zahlen.bedingungen, 'Bedingungen'],
        ]
      : [
          [gelesen.elemente.toLocaleString('de-DE'), 'Elemente im Schema'],
          [gelesen.ableitung.nachweisfelder, 'Nachweisfelder'],
          [ableitung.stellen.length, 'Stellen im Antrag'],
          [`${gelesen.ableitung.regeln.ausgewertet} von ${gelesen.ableitung.regeln.gesamt}`, 'Regeln ausgewertet'],
          [zahlen.bedingungen, 'Bedingungen'],
        ]

  return (
    <div className="flex flex-col gap-4 mt-6">
      <div className="op-kacheln">
        {kacheln.map(([wert, text]) => (
          <div className="op-kachel" key={text}>
            <b>{wert}</b>
            <span className="kern-body kern-body--small kern-body--muted">{text}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="kern-body kern-body--small">Woher die Bedingungen kommen:</span>
        {LEITER.filter((art) => (herkunft[art] ?? 0) > 0).map((art) => (
          <span key={art} className="flex items-center gap-1">
            <HerkunftChip art={art} />
            <span className="kern-body kern-body--small">{herkunft[art]}</span>
          </span>
        ))}
      </div>
      {nichtAusgewertet.length > 0 && (
        <details className="kern-details">
          <summary className="kern-details__header">
            <span className="kern-body">
              {zaehle(nichtAusgewertet.length, 'Regel', 'Regeln')} nicht ausgewertet, {beiNachweis.length} davon an einem Nachweis
            </span>
          </summary>
          <div className="kern-details__body">
            <p className="kern-body">Die Seite versteht Sätze der Form „Wenn Feld = Antwort, dann muss Feld befüllt sein“. Die Bedingung dieser Stellen legen Sie selbst fest.</p>
            {beiNachweis.length > 0 && (
              <div className="kern-table-responsive mt-3">
                <table className="kern-table kern-table--small">
                  <thead className="kern-table__head">
                    <tr className="kern-table__row">
                      <th className="kern-table__header" scope="col">
                        Regel
                      </th>
                      <th className="kern-table__header" scope="col">
                        Wortlaut (gekürzt)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="kern-table__body">
                    {beiNachweis.map((regel) => (
                      <tr className="kern-table__row" key={regel.id}>
                        <td className="kern-table__cell">
                          <span className="op-code">{regel.id}</span>
                          <br />
                          {regel.name}
                        </td>
                        <td className="kern-table__cell">{regel.text.length > 230 ? `${regel.text.slice(0, 230)} …` : regel.text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  )
}

const ROLLEN: [Personenrolle | 'stichtag', string][] = [
  ['antragsteller', 'Antragstellende Person'],
  ['mitglieder', 'Haushaltsmitglieder'],
  ['stichtag', 'Stichtag des Antrags'],
]

interface AnbindungProps {
  schema: Schema
  vorschlag: Anbindungsvorschlag
  anbindung: Bindung
  /** The id the person chose for a role, or `null` for none. */
  onWahl: (rolle: Personenrolle | 'stichtag', wert: string | null) => void
}

/** Who the persons of an application are and which field dates it: proposed, to be confirmed. */
function Anbindung({ schema, vorschlag, anbindung, onWahl }: AnbindungProps) {
  const id = useId()
  const gewaehlt = (rolle: Personenrolle | 'stichtag') => (rolle === 'stichtag' ? anbindung.stichtag : (anbindung.personen[rolle]?.gruppe ?? null))
  const namensText = (person: PersonBindung | undefined) => {
    if (!person) return null
    const name = (feld: string | undefined) => {
      const knoten = feld ? knotenMitId(schema, feld) : null
      return knoten ? `„${labelOf(knoten)}“` : null
    }
    const felder = [name(person.name.nachname), name(person.name.vorname)].filter(Boolean)
    return felder.length > 0 ? `Name aus ${felder.join(' und ')}` : null
  }

  return (
    <>
      <p className="kern-body">
        Damit die Prüfung weiß, wessen Nachweis es ist und ab welchem Tag sie rechnet. {vorschlag.passt ? 'Wie im Profil festgelegt.' : 'Vorschlag nach den Namen im Schema, bitte prüfen.'}
      </p>
      <div className="kern-table-responsive mt-3">
        <table className="kern-table kern-table--small">
          <thead className="kern-table__head">
            <tr className="kern-table__row">
              <th className="kern-table__header" scope="col">
                Was
              </th>
              <th className="kern-table__header" scope="col">
                Gruppe oder Feld im Schema
              </th>
              <th className="kern-table__header" scope="col">
                Kennung
              </th>
            </tr>
          </thead>
          <tbody className="kern-table__body">
            {ROLLEN.map(([rolle, text]) => {
              const wert = gewaehlt(rolle)
              const kandidaten = vorschlag.kandidaten[rolle]
              return (
                <tr className="kern-table__row" key={rolle}>
                  <th className="kern-table__header" scope="row">
                    <label htmlFor={`${id}-${rolle}`}>{text}</label>
                  </th>
                  <td className="kern-table__cell">
                    <div className="kern-form-input__select-wrapper">
                      <select id={`${id}-${rolle}`} className="kern-form-input__select" value={wert ?? ''} onChange={(ereignis) => onWahl(rolle, ereignis.target.value || null)}>
                        <option value="">— nicht festgelegt —</option>
                        {kandidaten.map((kandidat) => (
                          <option key={kandidat.id} value={kandidat.id}>
                            {kandidat.titel}
                          </option>
                        ))}
                      </select>
                    </div>
                    {rolle !== 'stichtag' && namensText(anbindung.personen[rolle]) && (
                      <span className="kern-body kern-body--small kern-body--muted block mt-1">{namensText(anbindung.personen[rolle])}</span>
                    )}
                  </td>
                  <td className="kern-table__cell">{wert && <span className="op-code">{wert}</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {!anbindung.personen.antragsteller && (
        <p className="kern-body kern-body--small mt-2!">Ohne antragstellende Person ordnet die Prüfung Unterlagen keiner Person zu.</p>
      )}
    </>
  )
}

/** What was made: „X“ hat 20 Stellen mit Nachweis und 2 bewusst ohne. 20 Bedingungen: 20 übernommen. */
function erzeugtText({ name, zahlen }: { name: string; zahlen: Zaehlung }): string {
  const ohne = zahlen.ohne > 0 ? ` und ${zahlen.ohne} bewusst ohne` : ''
  const teile = [
    zahlen.festgelegt > 0 && `${zahlen.festgelegt} übernommen`,
    zahlen.vorschlag > 0 && `${zaehle(zahlen.vorschlag, 'Vorschlag', 'Vorschläge')} aus dem Katalog`,
    zahlen.offen > 0 && `${zahlen.offen} offen`,
  ].filter(Boolean)
  const bedingungen = teile.length > 0 ? ` ${zaehle(zahlen.bedingungen, 'Bedingung', 'Bedingungen')}: ${teile.join(', ')}.` : ''
  return `„${name}“ hat ${zaehle(zahlen.stellen, 'Stelle', 'Stellen')} mit Nachweis${ohne}.${bedingungen}`
}

export interface AnlegenProps {
  /** Released profiles and new ones in this browser. */
  profile: { id: string; name: string }[]
  /** The profile open now. */
  profilId: string
  /** Its draft. */
  arbeit: ProfilFormat2
  /** The catalogue, for proposals. */
  typen: Map<string, Typ>
  /** The catalogue as it stands in the file, for a new profile. */
  katalog: Katalog
  /** Opens another profile. */
  onProfil: (id: string) => void
  /** `angezeigt`: the schema of the new type as the page shows it. */
  onUebernehmen: (aenderung: Bearbeitung, dateien: Dateien, angezeigt: Record<string, Schema>) => void
  /** `false` if the profile could not be kept. */
  onNeuesProfil: (eingabe: { id: string; roh: ProfilFormat2; dateien: Dateien }) => boolean
  /** On to its conditions — in the new profile, if one was made. */
  onFertig: (schema: string, profilId: string | null) => void
  onZurueck: () => void
}

/**
 * Makes an application type from the XDF file of its FIM schema: read the file, confirm the
 * binding, and add it to the draft of a profile — or start a new profile with it.
 */
export default function Anlegen({ profile, profilId, arbeit, typen, katalog, onProfil, onUebernehmen, onNeuesProfil, onFertig, onZurueck }: AnlegenProps) {
  const id = useId()
  const dateiFeld = useRef<HTMLInputElement>(null)
  const [neu, setNeu] = useState(false)
  const [name, setName] = useState('')
  const [nameFehlt, setNameFehlt] = useState(false)
  const [datei, setDatei] = useState<{ name: string; groesse: number } | null>(null)
  const [gelesen, setGelesen] = useState<Gelesen | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  const [liest, setLiest] = useState(false)
  const [anbindung, setAnbindung] = useState<Bindung | null>(null)
  const [erzeugt, setErzeugt] = useState<{ name: string; schema: string; zahlen: Zaehlung; neu: boolean } | null>(null)

  const neueId = useMemo(() => eindeutig(slug(name.trim() || 'profil').replace(/_/g, '-'), new Set(profile.map((profil) => profil.id))), [name, profile])
  const ziel = neu ? LEERES_PROFIL : arbeit
  const vorschlag = useMemo(() => (gelesen ? schlageAnbindungVor(gelesen.schema, ziel) : null), [gelesen, ziel])
  const ergebnis = useMemo(
    () => (gelesen && anbindung ? fuegeAntragsartEin(ziel, { ...gelesen, anbindung, typen }) : null),
    [gelesen, anbindung, ziel, typen],
  )
  const schema = gelesen?.schema ?? null
  const oneproof = gelesen?.format === 'oneproof'
  const vorhanden = schema && !neu ? arbeit.antragsarten.find((art) => art.schema === schema.schemaId) : null

  function neuBeginnen() {
    setErzeugt(null)
    setAnbindung(null)
  }

  function waehleProfil(wert: string) {
    if (wert === NEU) {
      setNeu(true)
      neuBeginnen()
      if (gelesen) setAnbindung(schlageAnbindungVor(gelesen.schema, LEERES_PROFIL).anbindung)
    } else if (wert !== profilId) {
      onProfil(wert)
    } else {
      setNeu(false)
      neuBeginnen()
      if (gelesen) setAnbindung(schlageAnbindungVor(gelesen.schema, arbeit).anbindung)
    }
  }

  async function lies(gewaehlt: File | undefined) {
    if (!gewaehlt) return
    neuBeginnen()
    setGelesen(null)
    setFehler(null)
    setDatei({ name: gewaehlt.name, groesse: gewaehlt.size })
    if (gewaehlt.size > HOECHSTENS) {
      setFehler(`Die Datei ist größer als ${groesseText(HOECHSTENS)}.`)
      return
    }
    setLiest(true)
    try {
      const text = await gewaehlt.text()
      // A JSON Schema of the OneProof Format, else the XDF file of a FIM schema.
      const ergebnisDerDatei = /^\s*\{/.test(text)
        ? await liesOneProofSchema(text, { liesNeben: (name) => liesJson(`${FORMAT_ORDNER}${name}`) })
        : liesAntragsart(text)
      setGelesen(ergebnisDerDatei)
      setAnbindung(schlageAnbindungVor(ergebnisDerDatei.schema, ziel).anbindung)
    } catch (grund) {
      setFehler(grund instanceof XdfError || grund instanceof OneProofSchemaFehler ? grund.message : 'Die Datei konnte nicht gelesen werden.')
    } finally {
      setLiest(false)
    }
  }

  function erzeuge() {
    if (!ergebnis) return
    // `ergebnis` is only made where something was read and a binding is there.
    if (!gelesen || !anbindung) throw new Error('Es wurde noch keine Schemadatei gelesen.')
    if (neu && name.trim() === '') {
      setNameFehlt(true)
      return
    }
    const { dateien: schemaDateien, zahlen } = ergebnis
    if (neu) {
      const fertig = fuegeAntragsartEin(neuesProfil({ id: neueId, name: name.trim() }), { ...gelesen, anbindung, typen })
      if (!onNeuesProfil({ id: neueId, roh: fertig.roh, dateien: { 'dokumenttypen.json': katalog, ...schemaDateien } })) {
        setFehler('Der Browser lässt das Speichern nicht zu (etwa in einem privaten Fenster). Ein neues Profil braucht den Speicher.')
        return
      }
    } else {
      onUebernehmen((roh) => fuegeAntragsartEin(roh, { ...gelesen, anbindung, typen }).roh, schemaDateien, { [ergebnis.datei.pfad]: gelesen.schema })
    }
    setErzeugt({ name: vorhanden?.name ?? gelesen.schema.name, schema: gelesen.schema.schemaId, zahlen, neu })
  }

  const profilName = neu ? name.trim() || 'Neues Profil' : (profile.find((profil) => profil.id === profilId)?.name ?? profilId)
  const keineStellen = gelesen !== null && gelesen.ableitung.stellen.length === 0

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="kern-preline kern-preline--small">Nachweisprofil {profilName}</p>
        <h1 className="kern-title kern-title--large">Antragsart anlegen</h1>
        <p className="kern-body mt-2! max-w-208">
          Aus dem FIM-Datenschema (XDF) oder dem JSON Schema einer Leistung im OneProof Format entsteht ein Antragsmodell: alle Stellen, an denen ein
          Nachweis verlangt werden kann, mit ihren Bedingungen.
        </p>
        <button type="button" className="kern-btn kern-btn--tertiary kern-btn--small mt-2" onClick={onZurueck}>
          <span className="kern-icon kern-icon--arrow-back" aria-hidden="true" />
          <span className="kern-label">Zurück zu den Bedingungen</span>
        </button>
      </header>

      <Schritt nr={1} titel="Schema auswählen">
        <div className="op-filter max-w-208">
          <div className="kern-form-input">
            <label className="kern-label" htmlFor={`${id}-profil`}>
              Zu welchem Profil gehört die Antragsart?
            </label>
            <div className="kern-form-input__select-wrapper">
              <select id={`${id}-profil`} className="kern-form-input__select" value={neu ? NEU : profilId} disabled={Boolean(erzeugt)} onChange={(ereignis) => waehleProfil(ereignis.target.value)}>
                {profile.map((profil) => (
                  <option key={profil.id} value={profil.id}>
                    {profil.name}
                  </option>
                ))}
                <option value={NEU}>Neues Profil anlegen …</option>
              </select>
            </div>
          </div>
          {neu && (
            <div className={`kern-form-input ${nameFehlt && name.trim() === '' ? 'kern-form-input--error' : ''}`}>
              <label className="kern-label" htmlFor={`${id}-name`}>
                Name des neuen Profils
              </label>
              <p className="kern-hint" id={`${id}-name-hinweis`}>
                Kennung: {neueId}
              </p>
              <input
                id={`${id}-name`}
                className="kern-form-input__input"
                autoComplete="off"
                value={name}
                disabled={Boolean(erzeugt)}
                aria-describedby={`${id}-name-hinweis${nameFehlt && name.trim() === '' ? ` ${id}-name-fehler` : ''}`}
                onChange={(ereignis) => setName(ereignis.target.value)}
              />
              {nameFehlt && name.trim() === '' && <Fehlermeldung id={`${id}-name-fehler`}>Bitte einen Namen angeben.</Fehlermeldung>}
            </div>
          )}
        </div>

        <div className="op-datei mt-4">
          <span className="kern-icon kern-icon--draft" aria-hidden="true" />
          <div className="op-datei__name">
            <p className="kern-body kern-body--bold">{datei ? datei.name : 'Noch keine Datei gewählt'}</p>
            <p className="kern-body kern-body--small kern-body--muted">
              {gelesen && datei
                ? `${groesseText(datei.groesse)} · ${gelesen.formatName} · Schema ${gelesen.schema.schemaId}, Version ${gelesen.schema.version} · ${gelesen.schema.name}`
                : datei
                  ? groesseText(datei.groesse)
                  : 'XDF3 oder XDF2, wie das FIM-Portal sie bereitstellt, oder ein JSON Schema des OneProof Formats'}
            </p>
          </div>
          <input
            ref={dateiFeld}
            id={`${id}-datei`}
            className="op-file-input"
            tabIndex={-1}
            aria-label="Schemadatei wählen"
            type="file"
            accept=".xml,application/xml,text/xml,.json,application/json,application/schema+json"
            disabled={liest || Boolean(erzeugt)}
            onChange={(ereignis) => {
              lies(ereignis.target.files?.[0])
              ereignis.target.value = ''
            }}
          />
          <button type="button" className="kern-btn kern-btn--primary kern-btn--small" disabled={liest || Boolean(erzeugt)} onClick={() => dateiFeld.current?.click()}>
            <span className="kern-label">{liest ? 'Wird gelesen …' : datei ? 'Andere Datei wählen' : 'Schemadatei wählen'}</span>
          </button>
        </div>

        {fehler && (
          <div className="mt-4">
            <Hinweis art="danger" titel="Die Datei lässt sich nicht verwenden">
              <p className="kern-body">{fehler}</p>
            </Hinweis>
          </div>
        )}
        {vorhanden && schema && !erzeugt && (
          <div className="mt-4">
            <Hinweis titel="Diese Antragsart gibt es im Profil schon">
              <p className="kern-body">
                {vorhanden.version === schema.version ? 'Sie wird neu eingelesen.' : `Sie wird durch Version ${schema.version} ersetzt (bisher ${vorhanden.version}).`} Festgelegte Bedingungen bleiben
                erhalten, wo es die Stelle noch gibt.
              </p>
            </Hinweis>
          </div>
        )}
        {keineStellen && (
          <div className="mt-4">
            <Hinweis art="warning" titel={oneproof ? 'Das Schema hat keinen Abschnitt mit Ja/Nein-Frage und keine Liste' : 'Das Schema hat kein Feld vom Typ „Datei“'}>
              <p className="kern-body">Für diese Antragsart gibt es keine Nachweise festzulegen.</p>
            </Hinweis>
          </div>
        )}
        {gelesen && ergebnis && <Ergebnis gelesen={gelesen} zahlen={ergebnis.zahlen} />}
      </Schritt>

      <Schritt nr={2} titel="Technische Anbindung bestätigen" gesperrt={!vorschlag || !anbindung || Boolean(erzeugt)}>
        {oneproof ? (
          <p className="kern-body">
            Im OneProof Format sind die Personen unter „personen“ genannt, die antragstellende Person mit der Rolle „antragsteller“. Gerechnet wird ab dem
            Zeitpunkt der Antragstellung („antragstellung.zeitpunkt“). Hier ist nichts festzulegen.
          </p>
        ) : vorschlag && anbindung && schema ? (
          <Anbindung schema={schema} vorschlag={vorschlag} anbindung={anbindung} onWahl={(rolle, wert) => setAnbindung((vorher) => (vorher ? waehleAnbindung(schema, vorher, rolle, wert) : vorher))} />
        ) : (
          <p className="kern-body">Wessen Nachweis es ist und ab welchem Tag gerechnet wird. Folgt nach dem Einlesen.</p>
        )}
      </Schritt>

      <Schritt nr={3} titel="Antragsmodell erzeugen" gesperrt={!ergebnis || keineStellen}>
        {erzeugt ? (
          <div className="flex flex-col gap-4">
            <Hinweis art="success" titel="Die Antragsart ist angelegt">
              <p className="kern-body">{erzeugtText(erzeugt)} Für Antragstellende ändert sich noch nichts.</p>
            </Hinweis>
            <div>
              <button type="button" className="kern-btn kern-btn--primary" onClick={() => onFertig(erzeugt.schema, erzeugt.neu ? neueId : null)}>
                <span className="kern-label">Bedingungen festlegen</span>
                <span className="kern-icon kern-icon--arrow-forward" aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="kern-body">Legt die Antragsart im Entwurf an. Veröffentlicht wird erst, wenn Sie es tun.</p>
            <button type="button" className="kern-btn kern-btn--primary mt-4" disabled={!ergebnis || keineStellen} onClick={erzeuge}>
              <span className="kern-label">Antragsmodell erzeugen</span>
            </button>
          </>
        )}
      </Schritt>
    </div>
  )
}
