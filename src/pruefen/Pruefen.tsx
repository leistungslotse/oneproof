import { useCallback, useEffect, useRef, useState } from 'react'
import { browserSpeicher, liesJson, speichereDatei } from '../browser.ts'
import { meldungVon } from '../engine/fehler.ts'
import type { PruefFehler } from '../engine/fehler.ts'
import type { KiKonfiguration } from '../engine/ionos/modelle.ts'
import { baueManifest } from '../engine/manifest.ts'
import type { FruehePruefung } from '../engine/manifest.ts'
import type { SeitenText } from '../engine/ocr/lesen.ts'
import type { Antragspaket } from '../engine/paket/paket.ts'
import { alsPruefFehler } from '../engine/pipeline.ts'
import type { Fortschrittsereignis, Pruefergebnis } from '../engine/pipeline.ts'
import { ladeEntwurfAlsProfil } from '../engine/profil/entwurf.ts'
import type { Entwurf } from '../engine/profil/entwurf.ts'
import { ladeProfilNachKennung } from '../engine/profil/laden.ts'
import type { Profil } from '../engine/profil/laden.ts'
import { oeffneNachweis } from '../pdf/quelle.ts'
import { unterschiede } from './ansicht.ts'
import { ladeBeispielBeschreibung, ladeBeispielDateien } from './beispiel.ts'
import type { Beispielfall, Beispielkatalog } from './beispiel.ts'
import Eingabe from './Eingabe.tsx'
import Eingegangen from './Eingegangen.tsx'
import { EntwurfKontext } from './entwurfskontext.ts'
import Ergebnis from './Ergebnis.tsx'
import type { Einreichung } from './Ergebnis.tsx'
import Fehler from './Fehler.tsx'
import Fortschritt from './Fortschritt.tsx'
import { ladeKonfiguration } from './konfiguration.ts'
import { erstelleAntragspaket } from './paket.ts'
import type { Eingang } from './paket.ts'
import Seite from './Seite.tsx'
import { erkenneAntrag, fuehreAus, waehleNachweise } from './steuerung.ts'
import type { GewaehlterAntrag } from './steuerung.ts'

const BASIS = import.meta.env.BASE_URL
const STANDARD_PROFIL = 'wohngeld'

/** The views of the page. */
type Ansicht = 'eingabe' | 'laeuft' | 'ergebnis' | 'fehler' | 'eingereicht'

/** The profile and the settings are loaded first; the page is useless without them. */
type Start =
  | { zustand: 'laedt' }
  | {
      zustand: 'bereit'
      profil: Profil
      /** Set where the profile is a draft of the department. */
      entwurf: Entwurf | null
      konfiguration: KiKonfiguration
      beispiel: Beispielkatalog | null
    }
  | { zustand: 'fehler'; fehler: unknown }

const TITEL: Record<Ansicht, string> = {
  eingabe: 'Antrag und Nachweise prüfen',
  laeuft: 'Die Prüfung läuft',
  ergebnis: 'Nachweise einreichen',
  fehler: 'Die Prüfung ist nicht gelungen',
  eingereicht: 'Ihr Antrag ist eingegangen',
}

/** Nothing is being submitted. */
const EINREICHEN_RUHT: Einreichung = Object.freeze({ laeuft: false, fertig: 0, gesamt: 0, fehler: null })

/** The profile that decides what is needed: `?profil=wohngeld` or `?profil=wohngeld@2026-11-07`. */
const gewuenschtesProfil = (): string => new URLSearchParams(window.location.search).get('profil') || STANDARD_PROFIL

/**
 * The profile to check against: the released one, or — with `?entwurf` — the draft the department
 * has made of it in this browser, to try a change before it goes out.
 */
async function ladeGewaehltesProfil(): Promise<{ profil: Profil; entwurf: Entwurf | null }> {
  const basis = `${BASIS}profile/`
  const kennung = gewuenschtesProfil()

  if (new URLSearchParams(window.location.search).has('entwurf')) {
    const [id = ''] = kennung.split('@')
    return ladeEntwurfAlsProfil(liesJson, browserSpeicher(), id, basis)
  }
  return { profil: await ladeProfilNachKennung(liesJson, kennung, basis), entwurf: null }
}

/** File number and case id of a submission; they only exist for the demonstration. */
function neuerEingang(profil: Pick<Profil, 'aktenzeichenPraefix'>): Eingang {
  const jetzt = new Date()
  const ziffern = String(Math.floor(Math.random() * 100_000)).padStart(5, '0')
  return {
    aktenzeichen: `${profil.aktenzeichenPraefix}-${jetzt.getFullYear()}-${ziffern}`,
    fallId: `f_${globalThis.crypto?.randomUUID?.().slice(0, 8) ?? ziffern}`,
    datum: jetzt.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }),
  }
}

/**
 * The page of the evidence check: choose application and evidence, wait, read the result, submit.
 * It holds the state and does the talking to the engine; what is shown is in the views.
 */
export default function Pruefen() {
  const [start, setStart] = useState<Start>({ zustand: 'laedt' })
  const [ansicht, setAnsicht] = useState<Ansicht>('eingabe')

  const [antrag, setAntrag] = useState<GewaehlterAntrag | null>(null)
  const [antragFehler, setAntragFehler] = useState<string | null>(null)
  const [nachweise, setNachweise] = useState<File[]>([])
  const [abgelehnt, setAbgelehnt] = useState<string[]>([])
  const [beispielLaedt, setBeispielLaedt] = useState(false)
  const [beispielFehler, setBeispielFehler] = useState<string | null>(null)

  const [laufart, setLaufart] = useState({ erneut: false, mitNachweisen: false })
  const [fortschritt, setFortschritt] = useState<Fortschrittsereignis | null>(null)
  const [ergebnis, setErgebnis] = useState<Pruefergebnis | null>(null)
  const [geaendert, setGeaendert] = useState<Set<string>>(() => new Set())
  const [meldungen, setMeldungen] = useState<string[]>([])
  const [fehler, setFehler] = useState<PruefFehler | null>(null)
  const [eingang, setEingang] = useState<Eingang | null>(null)
  /** The package of the last submission, and how making it goes. */
  const [paket, setPaket] = useState<Antragspaket | null>(null)
  const [einreichen, setEinreichen] = useState<Einreichung>(EINREICHEN_RUHT)

  const lauf = useRef<AbortController | null>(null)
  /** Counts submissions: a new check or a new case makes a package still being made obsolete. */
  const einreichung = useRef(0)
  const letzteDateien = useRef<File[]>([])
  const cache = useRef(new Map<string, SeitenText>())
  /** The earlier checks of this case, oldest first: the history of every status in the manifest. */
  const verlauf = useRef<FruehePruefung[]>([])
  const antragNummer = useRef(0)
  const ersteAnsicht = useRef(true)

  /* The profile and the settings come first. */
  useEffect(() => {
    let abgebrochen = false
    ;(async () => {
      try {
        const [{ profil, entwurf }, konfiguration] = await Promise.all([ladeGewaehltesProfil(), ladeKonfiguration({ basis: BASIS })])
        const beispiel = await ladeBeispielBeschreibung(profil.id)
        if (!abgebrochen) setStart({ zustand: 'bereit', profil, entwurf, konfiguration, beispiel })
      } catch (fehlgeschlagen) {
        if (!abgebrochen) setStart({ zustand: 'fehler', fehler: fehlgeschlagen })
      }
    })()
    return () => {
      abgebrochen = true
    }
  }, [])

  /* A new view is announced: title of the page, focus on its heading, back to the top. */
  useEffect(() => {
    document.title = `${TITEL[ansicht]} · Vorführung`
    if (ersteAnsicht.current) {
      ersteAnsicht.current = false
      return
    }
    document.getElementById('seitenueberschrift')?.focus({ preventScroll: true })
    window.scrollTo({ top: 0 })
  }, [ansicht])

  /* A check takes minutes. Leaving the page would lose it. */
  useEffect(() => {
    if (ansicht !== 'laeuft') return undefined
    const warne = (ereignis: BeforeUnloadEvent) => ereignis.preventDefault()
    window.addEventListener('beforeunload', warne)
    return () => window.removeEventListener('beforeunload', warne)
  }, [ansicht])

  // Until the page is ready there is no profile; the views that call back are only shown once there is.
  const bereit = start.zustand === 'bereit' ? start : null
  const profil = bereit?.profil
  const konfiguration = bereit?.konfiguration

  const waehleAntrag = useCallback(
    async (datei: File | null) => {
      const nummer = ++antragNummer.current
      setAntragFehler(null)
      if (!datei) {
        setAntrag(null)
        return
      }

      setAntrag({ datei, erkannt: null })
      try {
        if (!profil) throw new Error('Das Profil ist noch nicht geladen.')
        const erkannt = await erkenneAntrag({ profil, datei })
        if (nummer === antragNummer.current) setAntrag({ datei, erkannt })
      } catch (nichtErkannt) {
        // A newer choice has already replaced this one.
        if (nummer === antragNummer.current) setAntragFehler(meldungVon(nichtErkannt))
      }
    },
    [profil],
  )

  const fuegeNachweiseHinzu = useCallback(
    (gewaehlt: File[]) => {
      const { angenommen, abgelehnt: abgewiesen } = waehleNachweise(gewaehlt, nachweise)
      setAbgelehnt(abgewiesen)
      if (angenommen.length > 0) setNachweise([...nachweise, ...angenommen])
    },
    [nachweise],
  )

  const entferneNachweis = useCallback((datei: File) => {
    setNachweise((aktuell) => aktuell.filter((kandidat) => kandidat !== datei))
    setAbgelehnt([])
  }, [])

  const ladeBeispiel = useCallback(async (gewaehlt: Beispielfall) => {
    setBeispielLaedt(true)
    setBeispielFehler(null)
    try {
      if (!profil) throw new Error('Das Profil ist noch nicht geladen.')
      const dateien = await ladeBeispielDateien(profil.id, gewaehlt)
      setNachweise(dateien.nachweise)
      setAbgelehnt([])
      await waehleAntrag(dateien.antrag)
    } catch (fehlgeschlagen) {
      setBeispielFehler(meldungVon(fehlgeschlagen))
    } finally {
      setBeispielLaedt(false)
    }
  }, [profil, waehleAntrag])

  /** Runs the check with these files. A repeated check keeps what was read before. */
  const pruefe = useCallback(
    async (dateien: File[]) => {
      const steuerung = new AbortController()
      lauf.current = steuerung
      letzteDateien.current = dateien
      einreichung.current++
      setEinreichen(EINREICHEN_RUHT)

      setLaufart({ erneut: ergebnis !== null, mitNachweisen: dateien.length > 0 })
      setFortschritt(null)
      setFehler(null)
      setAnsicht('laeuft')

      try {
        if (!profil || !konfiguration || !antrag?.erkannt) throw new Error('Es fehlt das Profil oder der Antrag.')
        const neu = await fuehreAus({
          profil,
          antrag: antrag.erkannt,
          nachweise: dateien,
          oeffne: oeffneNachweis,
          konfiguration,
          cache: cache.current,
          fortschritt: setFortschritt,
          signal: steuerung.signal,
        })
        // Cancelled while the last step ran: the view has already gone back.
        if (steuerung.signal.aborted) return

        if (ergebnis) {
          verlauf.current.push({
            erstelltAm: ergebnis.erstelltAm,
            anforderungen: ergebnis.anforderungen.map(({ id, status }) => ({ id, status })),
          })
        }
        setGeaendert(unterschiede(ergebnis, neu))
        setErgebnis(neu)
        setNachweise(dateien)
        setAnsicht('ergebnis')
      } catch (fehlgeschlagen) {
        if (steuerung.signal.aborted) return
        setFehler(alsPruefFehler(fehlgeschlagen))
        setAnsicht('fehler')
      } finally {
        if (lauf.current === steuerung) lauf.current = null
      }
    },
    [profil, antrag, konfiguration, ergebnis],
  )

  const starte = () => {
    setMeldungen([])
    return pruefe(nachweise)
  }

  /** More evidence on the result page: take it up and check again. */
  const ergaenze = (gewaehlt: File[]) => {
    const { angenommen, abgelehnt: abgewiesen } = waehleNachweise(gewaehlt, nachweise)
    setMeldungen(abgewiesen)
    if (angenommen.length > 0) pruefe([...nachweise, ...angenommen])
    else if (abgewiesen.length > 0) window.scrollTo({ top: 0 })
  }

  const abbrechen = () => {
    lauf.current?.abort()
    setAnsicht(ergebnis ? 'ergebnis' : 'eingabe')
  }

  const zurueck = () => setAnsicht(ergebnis ? 'ergebnis' : 'eingabe')

  const neuePruefung = () => {
    lauf.current?.abort()
    antragNummer.current++
    cache.current = new Map()
    verlauf.current = []
    setAntrag(null)
    setAntragFehler(null)
    setNachweise([])
    setAbgelehnt([])
    setBeispielFehler(null)
    setErgebnis(null)
    setGeaendert(new Set())
    setMeldungen([])
    setFehler(null)
    setEingang(null)
    einreichung.current++
    setPaket(null)
    setEinreichen(EINREICHEN_RUHT)
    setAnsicht('eingabe')
  }

  /** Submitting makes the package — application with references, one PDF per document — and offers it to save. */
  const reiche = async () => {
    if (einreichen.laeuft) return
    if (!profil || !ergebnis || !antrag?.erkannt) throw new Error('Es fehlt das Profil, das Ergebnis oder der Antrag.')
    const nummer = ++einreichung.current
    const neu = neuerEingang(profil)
    setEinreichen({ ...EINREICHEN_RUHT, laeuft: true })
    try {
      const gebaut = await erstelleAntragspaket({
        ergebnis,
        antrag: antrag.erkannt,
        profil,
        nachweise,
        eingang: neu,
        frueher: verlauf.current,
        fortschritt: (fertig, gesamt) => {
          if (nummer === einreichung.current) setEinreichen((stand) => ({ ...stand, fertig, gesamt }))
        },
      })
      if (nummer !== einreichung.current) return
      speichereDatei(gebaut.name, gebaut.daten, 'application/zip')
      setPaket(gebaut)
      setEingang(neu)
      setEinreichen(EINREICHEN_RUHT)
      setAnsicht('eingereicht')
    } catch (fehlgeschlagen) {
      if (nummer === einreichung.current) setEinreichen({ ...EINREICHEN_RUHT, fehler: meldungVon(fehlgeschlagen) })
    }
  }

  const speicherePaket = () => {
    if (!paket) throw new Error('Es gibt kein Antragspaket.')
    speichereDatei(paket.name, paket.daten, 'application/zip')
  }

  const speichereErgebnis = () => {
    if (!profil || !ergebnis) throw new Error('Es fehlt das Profil oder das Ergebnis.')
    // Once submitted, the manifest of the package: it names the file in the package of every source.
    const manifest =
      ansicht === 'eingereicht' && paket
        ? paket.manifest
        : baueManifest(ergebnis, {
            fallId: eingang?.fallId ?? null,
            aktenzeichen: eingang?.aktenzeichen ?? null,
            frueher: verlauf.current,
          })
    speichereDatei(`oneproof-manifest-${eingang?.aktenzeichen ?? profil.id}.json`, JSON.stringify(manifest, null, 2))
  }

  /* --- What is shown ------------------------------------------------------------------------ */

  if (start.zustand === 'laedt') {
    return (
      <Seite titel="Nachweisprüfung">
        <h1 className="kern-heading-x-large">Nachweisprüfung</h1>
        <p className="kern-body mt-4!" role="status">
          Die Prüfung wird vorbereitet …
        </p>
      </Seite>
    )
  }

  if (start.zustand === 'fehler') {
    return (
      <Seite titel="Nachweisprüfung">
        <h1 className="kern-heading-x-large">Nachweisprüfung</h1>
        <div className="kern-alert kern-alert--danger mt-6" role="alert">
          <div className="kern-alert__header">
            <span className="kern-icon kern-icon--danger" aria-hidden="true" />
            <span className="kern-title">Das Prüfprofil konnte nicht geladen werden</span>
          </div>
          <div className="kern-alert__body">
            <p className="kern-body">{meldungVon(start.fehler)}</p>
          </div>
        </div>
      </Seite>
    )
  }

  /** The view the page is in. */
  const zeige = () => {
    switch (ansicht) {
      case 'laeuft':
        return <Fortschritt profil={start.profil} fortschritt={fortschritt} {...laufart} onAbbrechen={abbrechen} />

      case 'fehler':
        if (!fehler) throw new Error('Es gibt keinen Fehler zu zeigen.')
        return <Fehler profil={start.profil} fehler={fehler} onErneut={() => pruefe(letzteDateien.current)} onZurueck={zurueck} />

      case 'ergebnis':
        if (!ergebnis) throw new Error('Es gibt noch kein Ergebnis.')
        return (
          <Ergebnis
            profil={start.profil}
            ergebnis={ergebnis}
            geaendert={geaendert}
            meldungen={meldungen}
            onNachweise={ergaenze}
            onErneut={() => {
              setMeldungen([])
              return pruefe(nachweise)
            }}
            einreichen={einreichen}
            onEinreichen={reiche}
            onManifest={speichereErgebnis}
            onNeu={neuePruefung}
          />
        )

      case 'eingereicht':
        if (!ergebnis || !eingang) throw new Error('Es gibt noch kein Ergebnis oder keinen Eingang.')
        return (
          <Eingegangen
            profil={start.profil}
            eingang={eingang}
            nochOffen={ergebnis.zusammenfassung.offen + ergebnis.zusammenfassung.unklar}
            paket={paket}
            onPaket={speicherePaket}
            onManifest={speichereErgebnis}
            onZurueck={() => setAnsicht('ergebnis')}
            onNeu={neuePruefung}
          />
        )

      default:
        return (
          <Eingabe
            profil={start.profil}
            antrag={antrag}
            antragFehler={antragFehler}
            nachweise={nachweise}
            abgelehnt={abgelehnt}
            beispiel={start.beispiel}
            beispielFehler={beispielFehler}
            beispielLaedt={beispielLaedt}
            onAntrag={waehleAntrag}
            onNachweise={fuegeNachweiseHinzu}
            onEntferne={entferneNachweis}
            onBeispiel={ladeBeispiel}
            onPruefen={starte}
          />
        )
    }
  }

  return <EntwurfKontext value={start.entwurf ? { profil: start.profil, entwurf: start.entwurf } : null}>{zeige()}</EntwurfKontext>
}
