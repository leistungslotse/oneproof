import { useCallback, useEffect, useRef, useState } from 'react'
import { browserSpeicher, liesJson, mitZwischenspeicher } from '../browser.ts'
import Dialog from '../components/Dialog.tsx'
import Seite from '../components/Seite.tsx'
import { meldungVon } from '../engine/fehler.ts'
import type { Schema } from '../engine/fim/schema.ts'
import { aenderungen as aenderungenVon, geaenderteBedingungen } from '../engine/profil/bearbeiten.ts'
import type { Bedingung, ProfilFormat2, StelleFormat2 } from '../engine/profil/bedingungen.ts'
import { ladeEntwurf, liesMitProfil, neueProfileIm, ordnerDesEntwurfs, speichereEntwurf, verwerfeEntwurf } from '../engine/profil/entwurf.ts'
import { kompaktesSchema, ladeSchemataNeben } from '../engine/oneproof/schema.ts'
import { formatVon, ladeProfil, ladeProfilIndex, ProfilError } from '../engine/profil/laden.ts'
import type { Katalog, ProfilRoh, Typ, Wertetabellen } from '../engine/profil/laden.ts'
import { ausFormat1 } from '../engine/profil/umstellung.ts'
import { validiereProfil } from '../engine/profil/validieren.ts'
import { zaehle } from '../pruefen/ansicht.ts'
import Anlegen from './Anlegen.tsx'
import { gruppiereStellen, kurznamen, offenImProfil, passtZumFilter, uhrzeitText, zaehleBedingungen } from './ansicht.ts'
import type { Bedingungszahlen, Filter } from './ansicht.ts'
import { arbeitsprofil, bearbeite, waehleBasis } from './arbeit.ts'
import type { Arbeitsstand, Basis, Bearbeitung } from './arbeit.ts'
import { Hinweis } from './Kennzeichen.tsx'
import Pruefmeldungen from './Pruefmeldungen.tsx'
import type { Pruefung } from './Pruefmeldungen.tsx'
import Stelle from './Stelle.tsx'
import Stellenliste from './Stellenliste.tsx'
import Veroeffentlichen from './Veroeffentlichen.tsx'
import type { Dateien, ProfilIndex } from './version.ts'

const BASIS = import.meta.env.BASE_URL
const PROFILE = `${BASIS}profile/`

/** The catalogue and the schemas are the same on every check; they are fetched once per visit. */
const lesen = mitZwischenspeicher(liesJson)
const speicher = browserSpeicher()

const HINWEIS =
  'Verwaltung der Nachweisprofile: OneProof. Vorführung — Änderungen bleiben als Entwurf in diesem Browser. Für Antragstellende ändert sich erst etwas, wenn eine neue Version eingespielt ist.'

const LINKS = [
  { href: '/pruefen.html', text: 'Zur Prüfung für Bürgerinnen und Bürger' },
  { href: '/api.html', text: 'Die Schnittstelle hinter der Prüfung ansehen' },
]

/** The address of the view that makes an application type from its schema. */
const ANLEGEN = 'anlegen'

/** The profile to open, with the version and the application type to start with. */
interface Ziel {
  id: string | null
  version: string | null
  antragsart: string | null
}

/** `?profil=wohngeld` or `?profil=wohngeld@2026-11-07`. */
function leseZiel(): Ziel {
  const [id, version] = (new URLSearchParams(window.location.search).get('profil') ?? '').split('@')
  return { id: id || null, version: version || null, antragsart: null }
}

/** `#einnahmen`: the place the address points to; `#anlegen`: the view to make an application type. */
function leseHash(): string {
  try {
    return decodeURIComponent(window.location.hash.slice(1))
  } catch {
    return ''
  }
}

/** Moves the address to a place (`#einnahmen`), to the view that makes an application type, or to neither. */
function setzeHash(ziel: string): void {
  if (ziel) window.location.hash = encodeURIComponent(ziel)
  else window.history.pushState(null, '', `${window.location.pathname}${window.location.search}`)
}

/**
 * The schemas of the application types of a profile, by file: those of the draft, else from the
 * folder. One that cannot be read is left out. An application type in the OneProof Format is shown
 * in the compact form of its JSON Schema and the schemas it refers to.
 */
async function ladeSchemas(roh: Pick<ProfilRoh, 'antragsarten'> | null | undefined, ordner: string, dateien: Dateien = {}): Promise<Map<string, Schema>> {
  const lies = async (pfad: string): Promise<unknown> => (Object.hasOwn(dateien, pfad) ? dateien[pfad] : lesen(`${ordner}${pfad}`))
  const gelesen = await Promise.all(
    (roh?.antragsarten ?? []).map(async (art): Promise<[string, Schema] | null> => {
      try {
        if (formatVon(art) === 'oneproof') return [art.datei, kompaktesSchema(await ladeSchemataNeben(lies, art.datei))]
        // A schema file of the profile, as `ladeProfil` reads it (`profil.ladeSchema`).
        return [art.datei, (await lies(art.datei)) as Schema]
      } catch {
        return null
      }
    }),
  )
  return new Map(gelesen.filter((eintrag) => eintrag !== null))
}

/** Everything the page needs of a profile before anything can be edited. */
interface Geladen {
  id: string
  name: string
  /** The released profiles and the new ones in this browser. */
  profile: { id: string; name: string }[]
  indexRoh: ProfilIndex
  /** The folder of the version that is opened. */
  ordner: string
  /** The released version the draft starts from; `null` for a new profile. */
  basis: Basis | null
  typen: Map<string, Typ>
  katalog: Katalog
  wertetabellen: Wertetabellen
  /** A newer current version than the draft's: the draft is out of date. */
  neuere: string | null
  /** The draft was made from a version this profile does not list any more. */
  verwaist: boolean
  /** The application type to open first. */
  antragsart: string | null
  /** The schemas of the application types, by file. */
  schemas: Map<string, Schema>
  stand: Arbeitsstand
}


/**
 * Everything the page needs of a profile before anything can be edited: the version to start from
 * (that of the draft if there is one) in format 2, its catalogue and schemas, and the draft. A
 * profile of format 1 is put into format 2 here; nothing about what it decides changes.
 */
async function ladeArbeitsstand({ id: gewuenscht, version: gewuenschteVersion, antragsart = null }: Ziel): Promise<Geladen> {
  // A file of the installation; `ladeProfilIndex` below checks it, before anything is read from it.
  const indexRoh = (await lesen(`${PROFILE}index.json`)) as ProfilIndex
  const index = await ladeProfilIndex(lesen, PROFILE)
  const neue = neueProfileIm(speicher).filter((profil) => !index.some((eintrag) => eintrag.id === profil.id))
  const profile = [...index.map((eintrag) => ({ id: eintrag.id, name: eintrag.name ?? eintrag.id })), ...neue.map((profil) => ({ id: profil.id, name: `${profil.name} (neu)` }))]
  const [erstes] = profile
  if (!erstes) throw new ProfilError('Es sind noch keine Profile hinterlegt.')

  const id = gewuenscht ?? erstes.id
  const eintrag = index.find((kandidat) => kandidat.id === id)
  const gespeichert = ladeEntwurf(speicher, id)

  // A new profile exists only as a draft in this browser.
  if (!eintrag) {
    // A new profile is made in format 2 (`neuesProfil`).
    if (!gespeichert || gespeichert.basis !== null || gespeichert.profil.format !== 2) throw new ProfilError(`Das Profil „${id}“ gibt es nicht.`)
    const ordner = ordnerDesEntwurfs(id, null, PROFILE)
    const profil = await ladeProfil(liesMitProfil(lesen, ordner, gespeichert.profil, gespeichert.dateien), ordner)
    return {
      id,
      name: gespeichert.profil.name ?? id,
      profile,
      indexRoh,
      ordner,
      basis: null,
      typen: profil.typen,
      katalog: profil.katalog,
      wertetabellen: profil.wertetabellen,
      neuere: null,
      verwaist: false,
      antragsart,
      schemas: await ladeSchemas(gespeichert.profil, ordner, gespeichert.dateien),
      stand: { basisRoh: null, entwurf: { ...gespeichert, profil: gespeichert.profil } },
    }
  }

  const { version, neuere, verwaist } = waehleBasis({ eintrag, gewuenscht: gewuenschteVersion, entwurf: gespeichert })
  const ordner = `${PROFILE}${eintrag.id}/${version}/`
  const profil = await ladeProfil(lesen, ordner)
  const entwurf = verwaist ? null : gespeichert

  const schemas = await ladeSchemas(profil.roh, ordner)
  for (const [datei, schema] of await ladeSchemas(entwurf?.profil, ordner, entwurf?.dateien)) schemas.set(datei, schema)

  const inFormat2 = (roh: ProfilRoh): ProfilFormat2 => {
    if (roh.format !== 1) return roh
    // A schema that could not be read is left out, as it is in `schemas`.
    const jeSchema = new Map(
      roh.antragsarten.flatMap((art): [string, Schema][] => {
        const schema = schemas.get(art.datei)
        return schema ? [[art.schema, schema]] : []
      }),
    )
    return ausFormat1(roh, { schemas: jeSchema, typen: profil.typen })
  }

  return {
    id: eintrag.id,
    name: profil.name,
    profile,
    indexRoh,
    ordner,
    basis: { version, ordner, format: profil.roh.format },
    typen: profil.typen,
    katalog: profil.katalog,
    wertetabellen: profil.wertetabellen,
    neuere,
    verwaist,
    antragsart,
    schemas,
    stand: { basisRoh: inFormat2(profil.roh), entwurf: entwurf && { ...entwurf, profil: inFormat2(entwurf.profil) } },
  }
}

interface FortschrittProps {
  zahlen: Bedingungszahlen
  filter: Filter
  /** The filter by what the draft changed is offered. */
  mitGeaendert: boolean
  onFilter: (filter: Filter) => void
}

/** How far the conditions of the application type are decided, and the filter by state. */
function Fortschritt({ zahlen, filter, mitGeaendert, onFilter }: FortschrittProps) {
  const chips: [Filter, string, number][] = [
    ['alle', 'Alle', zahlen.gesamt],
    ['offen', 'Offen', zahlen.offen],
    ['vorschlag', 'Vorschlag', zahlen.vorschlag],
    ['festgelegt', 'Festgelegt', zahlen.festgelegt],
    ...(mitGeaendert ? [['geaendert', 'Geändert', zahlen.geaendert] satisfies [Filter, string, number]] : []),
  ]
  const ausstehend = [
    zahlen.vorschlag > 0 && `${zaehle(zahlen.vorschlag, 'Vorschlag wartet', 'Vorschläge warten')} auf Bestätigung`,
    zahlen.offen > 0 && `${zaehle(zahlen.offen, 'Bedingung ist', 'Bedingungen sind')} offen`,
  ].filter(Boolean)
  return (
    <section className="op-fortschritt" aria-label="Stand der Festlegung">
      <div>
        <p className="kern-body kern-body--bold">
          {zahlen.festgelegt} von {zaehle(zahlen.gesamt, 'Bedingung', 'Bedingungen')} festgelegt
        </p>
        <div className="kern-progress mt-2">
          <progress value={zahlen.festgelegt} max={Math.max(zahlen.gesamt, 1)} aria-label="Festgelegte Bedingungen" />
        </div>
        {ausstehend.length > 0 && <p className="kern-body kern-body--small kern-body--muted mt-2!">{ausstehend.join(', ')}.</p>}
      </div>
      <div className="op-chips" role="group" aria-label="Bedingungen anzeigen">
        {chips.map(([wert, text, anzahl]) => (
          <button key={wert} type="button" className="op-chip" aria-pressed={filter === wert} onClick={() => onFilter(wert)}>
            {text} <b>{anzahl}</b>
          </button>
        ))}
      </div>
    </section>
  )
}

/** Another profile to open, with a view (`hash`) and an application type to start with. */
interface Wechsel {
  id?: string | null
  version?: string | null
  hash?: string
  antragsart?: string | null
}

/** What the page knows of the check of the draft, and of which profile it was made. */
type Pruefstand = Pruefung & { fuer: ProfilFormat2 }

interface ArbeitsplatzProps {
  geladen: Geladen
  onWechsel: (ziel: Wechsel) => void
}

/** The profile is loaded: pick an application type and a place, set its conditions, try them, release them. */
function Arbeitsplatz({ geladen, onWechsel }: ArbeitsplatzProps) {
  const { id, name, profile, indexRoh, ordner, basis, typen, katalog, wertetabellen } = geladen

  const [stand, setStand] = useState(geladen.stand)
  const standRef = useRef(geladen.stand)
  const [schemas, setSchemas] = useState(geladen.schemas)
  const [speicherung, setSpeicherung] = useState<{ ok: true; um: string } | { ok: false } | null>(null)
  const [meldung, setMeldung] = useState<string | null>(null)
  const [pruefung, setPruefung] = useState<Pruefstand | null>(null)
  const [dialog, setDialog] = useState<'veroeffentlichen' | 'verwerfen' | null>(null)
  const [hash, setHash] = useState(leseHash)
  const [filter, setFilter] = useState<Filter>('alle')
  const [gewaehlteArt, setGewaehlteArt] = useState(geladen.antragsart)
  const [verwaistVerworfen, setVerwaistVerworfen] = useState(false)

  const { basisRoh, entwurf } = stand
  const arbeit = arbeitsprofil(stand)
  // The state always holds the draft or the version it starts from.
  if (!arbeit) throw new Error('Es gibt weder einen Entwurf noch eine Version.')
  const antragsarten = arbeit.antragsarten ?? []

  // --- Derived ---------------------------------------------------------------------------------
  const art = antragsarten.find((kandidat) => kandidat.schema === gewaehlteArt) ?? antragsarten[0] ?? null
  const schemaId = art?.schema ?? null
  const schema = art ? (schemas.get(art.datei) ?? null) : null
  const basisArt = basisRoh?.antragsarten?.find((kandidat) => kandidat.schema === schemaId) ?? null
  // A new application type has nothing to compare with: what it has is new, not changed.
  const mitGeaendert = basisArt !== null
  const zeige = mitGeaendert || filter !== 'geaendert' ? filter : 'alle'
  const anbindung = art ? { personen: art.personen ?? arbeit.personen ?? {} } : { personen: {} }
  // All of this is cheap enough to work out anew on every render: a few hundred conditions at most,
  // and the page renders anew only when something is chosen or changed.
  const namen = kurznamen(antragsarten)
  const aenderungen = entwurf ? aenderungenVon(basisRoh, entwurf.profil) : []
  const geaendert = geaenderteBedingungen(aenderungen, arbeit)
  const istGeaendert = (bedingung: Bedingung) => geaendert.has(`${schemaId}|${bedingung.id}`)
  const zahlen = zaehleBedingungen(art, geaendert)
  const gruppen = gruppiereStellen(art)
  const offenListe = offenImProfil(arbeit)

  const stelle = art?.stellen.find((kandidat) => kandidat.id === hash) ?? gruppen.bereiche[0]?.stellen[0] ?? art?.stellen[0] ?? null
  const formatwechsel = basis?.format === 1
  const veroeffentlichbar = Boolean(entwurf) && (aenderungen.length > 0 || formatwechsel || !basis)

  // --- The address and the focus -------------------------------------------------------------------
  const stellenIds = (art?.stellen ?? []).map((kandidat) => kandidat.id).join('\n')
  useEffect(() => {
    const bekannt = new Set(stellenIds.split('\n'))
    const aufHash = () => {
      // The service bar has anchors of its own (#hilfe); they leave the view as it is.
      const ziel = leseHash()
      if (ziel === ANLEGEN || ziel === '' || bekannt.has(ziel)) setHash(ziel)
    }
    window.addEventListener('hashchange', aufHash)
    return () => window.removeEventListener('hashchange', aufHash)
  }, [stellenIds])

  function geheZu(ziel: string) {
    setzeHash(ziel)
    // Taking the hash away fires no `hashchange`.
    if (!ziel) setHash('')
  }

  // Choosing another place moves the focus to its heading: a screen reader hears that the view changed.
  const kopf = useRef<HTMLHeadingElement>(null)
  const zuletzt = useRef(`${schemaId}|${stelle?.id}`)
  useEffect(() => {
    const jetzt = `${schemaId}|${stelle?.id}`
    if (zuletzt.current === jetzt) return
    zuletzt.current = jetzt
    kopf.current?.focus()
  }, [schemaId, stelle?.id])

  // --- Editing -------------------------------------------------------------------------------------
  const aendere = useCallback(
    (aenderung: Bearbeitung, dateien: Dateien | null = null) => {
      try {
        const neu = bearbeite(standRef.current, aenderung, dateien)
        if (neu === standRef.current) return
        // A change that is made leaves a draft.
        if (!neu.entwurf) throw new Error('Die Änderung hat keinen Entwurf angelegt.')
        standRef.current = neu
        setStand(neu)
        setMeldung(null)
        setSpeicherung(speichereEntwurf(speicher, id, neu.entwurf) ? { ok: true, um: new Date().toISOString() } : { ok: false })
      } catch (fehler) {
        setMeldung(fehler instanceof ProfilError ? fehler.message : 'Die Änderung war nicht möglich.')
      }
    },
    [id],
  )

  function verwirf() {
    verwerfeEntwurf(speicher, id)
    setDialog(null)
    if (!basis) {
      // A new profile is nothing but its draft.
      onWechsel({ id: null })
      return
    }
    if (geladen.neuere) {
      // The draft held the page on an old version; without it the current one is opened.
      onWechsel({ id, version: geladen.neuere })
      return
    }
    const neu = { basisRoh, entwurf: null }
    standRef.current = neu
    setStand(neu)
    setSpeicherung(null)
    setMeldung(null)
    setPruefung(null)
  }

  // --- Check of the draft, a moment after the last change ----------------------------------------------
  useEffect(() => {
    if (!entwurf) return undefined
    let abgebrochen = false
    const frist = window.setTimeout(async () => {
      try {
        const profil = await ladeProfil(liesMitProfil(lesen, ordner, entwurf.profil, entwurf.dateien), ordner)
        const ergebnis = await validiereProfil(profil)
        if (!abgebrochen) setPruefung({ fuer: entwurf.profil, ...ergebnis })
      } catch (fehler) {
        if (!abgebrochen) setPruefung({ fuer: entwurf.profil, meldung: meldungVon(fehler) })
      }
    }, 600)
    return () => {
      abgebrochen = true
      window.clearTimeout(frist)
    }
  }, [entwurf, ordner])

  const gepruefte = entwurf != null && pruefung?.fuer === entwurf.profil && 'fehler' in pruefung && pruefung.fehler.length === 0

  // --- Filter: the place shown stays one that has a condition the filter leaves --------------------------
  function filtere(wert: Filter) {
    setFilter(wert)
    const passt = (kandidat: StelleFormat2) => kandidat.bedingungen.some((bedingung) => passtZumFilter(wert, bedingung, istGeaendert(bedingung)))
    if (stelle && !stelle.ohne && passt(stelle)) return
    const erste = gruppen.bereiche.flatMap(({ stellen }) => stellen).find(passt)
    if (erste) geheZu(erste.id)
  }

  if (hash === ANLEGEN || !art) {
    return (
      <Anlegen
        profile={profile}
        profilId={id}
        arbeit={arbeit}
        typen={typen}
        katalog={katalog}
        onProfil={(anderes) => onWechsel({ id: anderes, hash: ANLEGEN })}
        onUebernehmen={(aenderung, dateien, angezeigt) => {
          aendere(aenderung, dateien)
          // The page shows a schema as `Anlegen` read it: a JSON Schema in its compact form, not as stored.
          setSchemas((vorher) => new Map([...vorher, ...Object.entries(angezeigt)]))
        }}
        onNeuesProfil={({ id: neueId, roh, dateien }) => speichereEntwurf(speicher, neueId, { basis: null, profil: roh, dateien })}
        onFertig={(neueArt, neuesProfil) => {
          if (neuesProfil) {
            onWechsel({ id: neuesProfil, antragsart: neueArt })
            return
          }
          setGewaehlteArt(neueArt)
          setFilter('alle')
          geheZu('')
        }}
        onZurueck={() => (art ? geheZu('') : window.history.back())}
      />
    )
  }

  const statusText = [
    basis
      ? entwurf
        ? `Entwurf auf Grundlage der Version ${basis.version} — ${aenderungen.length === 0 ? 'noch ohne Änderungen' : zaehle(aenderungen.length, 'Änderung', 'Änderungen')}`
        : `Version ${basis.version} — noch kein Entwurf. Sobald Sie etwas ändern, wird er angelegt`
      : 'Neues Profil, noch nicht veröffentlicht',
    speicherung?.ok ? `, gespeichert um ${uhrzeitText(speicherung.um)}` : '',
    `. Schema ${schemaId}, Version ${art.version}.`,
  ].join('')

  return (
    <>
      <header>
        <h1 className="kern-title kern-title--large">Nachweisprofile verwalten</h1>
      </header>

      <section className="op-kopf mt-6" aria-label="Profil, Antragsart und Entwurf">
        <div className="flex flex-col gap-2 min-w-0">
          <div className="op-filter">
            {profile.length > 1 && (
              <div className="kern-form-input">
                <label className="kern-label" htmlFor="profilwahl">
                  Profil
                </label>
                <div className="kern-form-input__select-wrapper">
                  <select id="profilwahl" className="kern-form-input__select" value={id} onChange={(ereignis) => onWechsel({ id: ereignis.target.value })}>
                    {profile.map((profil) => (
                      <option key={profil.id} value={profil.id}>
                        {profil.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
            <div className="kern-form-input">
              <label className="kern-label" htmlFor="antragsartwahl">
                Antragsart {profile.length > 1 ? '' : `im Profil ${name}`}
              </label>
              <div className="kern-form-input__select-wrapper">
                <select id="antragsartwahl" className="kern-form-input__select" value={art.schema} onChange={(ereignis) => setGewaehlteArt(ereignis.target.value)}>
                  {antragsarten.map((kandidat) => (
                    <option key={kandidat.schema} value={kandidat.schema}>
                      {namen.get(kandidat.schema)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <p className="kern-body kern-body--small kern-body--muted" role="status">
            {statusText}
          </p>
          <div>
            <button type="button" className="kern-btn kern-btn--tertiary kern-btn--small" onClick={() => geheZu(ANLEGEN)}>
              <span className="kern-icon kern-icon--add" aria-hidden="true" />
              <span className="kern-label">Antragsart aus Schemadatei anlegen</span>
            </button>
          </div>
        </div>

        <div className="op-kopf__aktionen">
          {entwurf ? (
            <a className="kern-btn kern-btn--secondary" href={`/pruefen.html?profil=${encodeURIComponent(id)}&entwurf`} target="_blank" rel="noopener noreferrer">
              <span className="kern-icon kern-icon--open-in-new" aria-hidden="true" />
              <span className="kern-label">Entwurf ausprobieren</span>
            </a>
          ) : (
            <button type="button" className="kern-btn kern-btn--secondary" disabled>
              <span className="kern-icon kern-icon--open-in-new" aria-hidden="true" />
              <span className="kern-label">Entwurf ausprobieren</span>
            </button>
          )}
          <button type="button" className="kern-btn kern-btn--primary" disabled={!veroeffentlichbar} onClick={() => setDialog('veroeffentlichen')}>
            <span className="kern-label">Neue Version veröffentlichen</span>
          </button>
          <button type="button" className="kern-btn kern-btn--tertiary" disabled={!entwurf} onClick={() => setDialog('verwerfen')}>
            <span className="kern-label">Entwurf verwerfen</span>
          </button>
        </div>
      </section>

      <div className="mt-6 flex flex-col gap-4">
        {geladen.neuere && (
          <Hinweis art="warning" titel={`Es gibt eine neuere Version (${geladen.neuere})`}>
            <p className="kern-body">Ihr Entwurf baut auf Version {basis?.version} auf und enthält deren spätere Änderungen nicht. Um mit der neueren zu beginnen, verwerfen Sie den Entwurf.</p>
          </Hinweis>
        )}
        {geladen.verwaist && !verwaistVerworfen && (
          <Hinweis art="warning" titel="Ein älterer Entwurf passt nicht mehr">
            <p className="kern-body">Er baut auf einer Version auf, die es nicht mehr gibt, und wird bei der nächsten Änderung ersetzt.</p>
            <p className="kern-body mt-2!">
              <button
                type="button"
                className="kern-link"
                onClick={() => {
                  verwerfeEntwurf(speicher, id)
                  setVerwaistVerworfen(true)
                }}
              >
                Jetzt verwerfen
              </button>
            </p>
          </Hinweis>
        )}
        {speicherung?.ok === false && (
          <Hinweis art="warning" titel="Der Entwurf wird nicht gespeichert">
            <p className="kern-body">Der Browser lässt das Speichern nicht zu (etwa in einem privaten Fenster). Laden Sie das Paket herunter, bevor Sie die Seite schließen.</p>
          </Hinweis>
        )}
        {meldung && (
          <Hinweis art="danger" titel="Die Änderung war nicht möglich">
            <p className="kern-body">{meldung}</p>
          </Hinweis>
        )}
        {entwurf && pruefung?.fuer === entwurf.profil && <Pruefmeldungen pruefung={pruefung} />}
      </div>

      <div className="mt-6">
        <Fortschritt zahlen={zahlen} filter={zeige} mitGeaendert={mitGeaendert} onFilter={filtere} />
      </div>

      <div className="op-verwaltung mt-8">
        <Stellenliste gruppen={gruppen} gewaehlt={stelle?.id ?? null} filter={zeige} istGeaendert={istGeaendert} />

        {stelle ? (
          <Stelle
            key={`${schemaId}|${stelle.id}`}
            ref={kopf}
            stelle={stelle}
            schema={schema}
            schemaId={art.schema}
            arbeit={arbeit}
            basisAntragsart={basisArt}
            anbindung={anbindung}
            filter={zeige}
            istGeaendert={istGeaendert}
            aendere={aendere}
            typen={typen}
            wertetabellen={wertetabellen}
            basisVersion={basis?.version ?? null}
            basisRoh={basisRoh}
          />
        ) : (
          <p className="kern-body">Das Schema dieser Antragsart hat keine Stelle, an der ein Nachweis verlangt werden kann.</p>
        )}
      </div>

      {entwurf && (
        <Veroeffentlichen
          offen={dialog === 'veroeffentlichen'}
          onSchliessen={() => setDialog(null)}
          id={id}
          name={name}
          indexRoh={indexRoh}
          basis={basis}
          entwurf={entwurf}
          aenderungen={aenderungen}
          offenListe={offenListe}
          gepruefte={gepruefte}
        />
      )}

      <Dialog
        offen={dialog === 'verwerfen'}
        titel="Entwurf verwerfen?"
        onSchliessen={() => setDialog(null)}
        fuss={
          <>
            <button type="button" className="kern-btn kern-btn--secondary" onClick={() => setDialog(null)}>
              <span className="kern-label">Abbrechen</span>
            </button>
            <button type="button" className="kern-btn kern-btn--primary" onClick={verwirf}>
              <span className="kern-label">Entwurf verwerfen</span>
            </button>
          </>
        }
      >
        <p className="kern-body">
          {basis
            ? `${aenderungen.length > 0 ? `Ihre ${zaehle(aenderungen.length, 'Änderung', 'Änderungen')} gehen` : 'Der Entwurf geht'} verloren.`
            : `Das neue Profil „${name}“ geht mit allen Antragsarten verloren.`}{' '}
          Das lässt sich nicht rückgängig machen.
          {geladen.neuere && ` Danach arbeiten Sie mit der Version ${geladen.neuere} weiter.`}
        </p>
      </Dialog>
    </>
  )
}

/** How far loading the profile is. */
type Start = { zustand: 'laedt' } | { zustand: 'bereit'; geladen: Geladen } | { zustand: 'fehler'; meldung: string }

/** The page: loads the profile and hands it to the workplace. */
export default function Profilverwaltung() {
  const [ziel, setZiel] = useState(leseZiel)
  const [start, setStart] = useState<Start>({ zustand: 'laedt' })

  useEffect(() => {
    let abgebrochen = false
    ladeArbeitsstand(ziel).then(
      (geladen) => {
        if (!abgebrochen) setStart({ zustand: 'bereit', geladen })
      },
      (fehler) => {
        if (!abgebrochen) setStart({ zustand: 'fehler', meldung: meldungVon(fehler) })
      },
    )
    return () => {
      abgebrochen = true
    }
  }, [ziel])

  /** Opens another profile — or the same anew —, with a view (`hash`) and an application type to start with. */
  function wechsle({ id = null, version = null, hash = '', antragsart = null }: Wechsel) {
    const adresse = new URL(window.location.href)
    adresse.search = id ? `?profil=${encodeURIComponent(version ? `${id}@${version}` : id)}` : ''
    adresse.hash = hash
    window.history.replaceState(null, '', adresse)
    setStart({ zustand: 'laedt' })
    setZiel({ id, version, antragsart })
  }

  return (
    <Seite titel="Nachweisprofile verwalten" kennzeichnung="Fachabteilung des Landkreises Auenthal" breit hinweis={HINWEIS} links={LINKS}>
      {start.zustand === 'laedt' && (
        <p className="kern-body" role="status">
          Das Profil wird geladen …
        </p>
      )}
      {start.zustand === 'fehler' && (
        <Hinweis art="danger" titel="Das Profil konnte nicht geladen werden">
          <p className="kern-body">{start.meldung}</p>
        </Hinweis>
      )}
      {start.zustand === 'bereit' && <Arbeitsplatz key={`${start.geladen.id}@${start.geladen.basis?.version ?? 'neu'}|${start.geladen.antragsart ?? ''}`} geladen={start.geladen} onWechsel={wechsle} />}
    </Seite>
  )
}
