/**
 * The check from end to end: application + uploaded evidence → what is proven and what is missing.
 *
 *   1. read the application and work out where evidence can belong     (no network)
 *   2. open the files and count their pages                              (no network)
 *   3. read every page with the OCR model                                (IONOS, in parallel)
 *   4. let the language model group the pages into documents            (IONOS, once)
 *   5. place the documents at the places of the application             (no network)
 *
 * Steps 1, 2 and 5 are deterministic and run without a network; so does the whole check if no
 * evidence was uploaded — the result then simply lists what is needed. Everything that touches the
 * outside is injected (`oeffne`, `ki`), which keeps this module free of the browser and testable.
 *
 * If step 4 fails — the model answered in no readable form, took too long, or the service was busy —
 * the check does not end empty-handed: the result lists what the application needs, the pages stand
 * as not assigned, and a note says that the grouping failed and that checking again helps. Pages
 * already read are not read a second time (`cache`).
 *
 * Progress is reported as events `{phase, anteil, bis, text}`. `anteil` is the share of the whole
 * check (0–1) at the start of the event; `bis` is where the phase ends. Only step 4 has no
 * measurable progress, so the page lets the bar creep from `anteil` towards `bis` meanwhile.
 */
import { leseAntrag } from './antrag.ts'
import { InstanceError } from './fim/instanz.ts'
import { PruefFehler, GRUNDSAETZLICHE_KI_FEHLER, meldungVon } from './fehler.ts'
import type { PageRef, PageTexts } from './gruppierung/dokument.ts'
import type { GruppierDatei, GruppierSeite, PromptPerson } from './gruppierung/anweisung.ts'
import { bearbeiteDokumente, gruppiere } from './gruppierung/gruppieren.ts'
import type { Gruppierung } from './gruppierung/gruppieren.ts'
import { monatDerSeite } from './gruppierung/monate.ts'
import { IonosFehler, istWiederholbar, LAENGSTE_PAUSE_SEKUNDEN } from './ionos/client.ts'
import type { ChatClient, IonosFehlerArt, KiClient, Verbrauch } from './ionos/client.ts'
import { loeseModellAuf } from './ionos/modelle.ts'
import type { KiKonfiguration } from './ionos/modelle.ts'
import { istObjekt } from './json.ts'
import { leseSeite } from './ocr/lesen.ts'
import type { SeitenLeser, SeitenText } from './ocr/lesen.ts'
import { mitBegrenzung } from './parallel.ts'
import type { Profil } from './profil/laden.ts'
import { bereiteAntragVor, ordneZu } from './zuordnung/index.ts'
import type { VorbereiteterAntrag, Zuordnung } from './zuordnung/index.ts'
import type { NichtZugeordnet } from './zuordnung/anforderungen.ts'

/** The phases of a check, in the order they run. */
export type Phase = 'antrag' | 'oeffnen' | 'lesen' | 'gruppieren' | 'zuordnen'

/** Where each phase lies on the bar of the whole check: from where to where, as shares of 1. */
export const ABSCHNITT: Readonly<Record<Phase, readonly [von: number, bis: number]>> = Object.freeze({
  antrag: [0, 0.03],
  oeffnen: [0.03, 0.08],
  lesen: [0.08, 0.68],
  gruppieren: [0.68, 0.93],
  zuordnen: [0.93, 1],
})

/**
 * More pages than this are not read in one go. Reading costs a model call per page, and the
 * grouping model gets the text of all pages in one request, which has a limit.
 */
export const MAX_SEITEN = 120

/** How long the grouping model may think, in ms. It reasons before it answers. */
const GRUPPIERUNG_ZEITLIMIT_MS = 480_000

/**
 * After this many pages in a row that failed although the client had already tried again, the
 * reading service is taken to be down: the rest is not tried page by page, each with its own pauses.
 */
export const LESEN_FEHLER_IN_FOLGE = 3

/** Failures of the grouping after which the check goes on without it (see the head comment). */
const GRUPPIERUNG_ERSETZBAR: ReadonlySet<string> = new Set(['antwort', 'zeitlimit', 'server', 'ratenlimit', 'netz', 'anfrage', 'kontext'])

/** At most this many names of unknown document types in the note; the rest is counted. */
const ERFUNDENE_TYPEN_IM_HINWEIS = 5

/** One uploaded file, opened (see `src/pdf/quelle.ts`). */
export interface Quelle {
  name: string
  mime: string
  /** Bytes. */
  groesse: number
  /** Last modified, ms since 1970. */
  geaendert?: number | null
  /** Number of pages. */
  seiten: number
  /** SHA-512 as hex, `null` where the browser cannot compute it. */
  hash: string | null
  /** The image of a page, as data URL. */
  bild: (seite: number, signal?: AbortSignal) => Promise<string>
  /** Lets go of the file; a later `bild` opens it again. */
  schliessen: () => void
}

/** A {@link Quelle} as the check holds it while it runs: with the id it gives the file, and whether it was let go. */
export interface GeoeffneteQuelle extends Quelle {
  /** `f1`, `f2` … in the order of the uploads. */
  id: string
  /** The file was let go; set once, so that it is not closed twice. */
  geschlossen?: boolean
}

/** What reading one page came to. */
export interface SeitenInfo {
  status: 'gelesen' | 'leer' | 'abgeschnitten' | 'fehler'
  /** `''` for a blank or an unreadable page. */
  text: string
  /** Why a page could not be read. */
  fehler?: string
}

/** What reading made of the pages of every file: file id → page number (from 1) → state. */
export type SeitenJeDatei = Record<string, Record<number, SeitenInfo>>

/** What the check needs of an uploaded file, whatever it is: in the browser a `File`, in tests a stand-in. */
export interface Nachweisdatei {
  name: string
  /** Media type, where the file states one. */
  type?: string
}

/** The access to the AI as a check uses it. */
export interface KiZugang {
  client: KiClient
  konfiguration: KiKonfiguration
}

/** One event of the progress: where on the bar the check is, and what it is doing. */
export interface Fortschrittsereignis {
  phase: Phase
  /** The share of the whole check (0–1) at the start of the event. */
  anteil: number
  /** Where the phase ends, as a share of the whole check. */
  bis: number
  /** What is being done, in words for the person. */
  text: string
}

/** What {@link pruefe} is given. `D` is the kind of file the page hands over (a `File`, or a stand-in in tests). */
export interface PruefeOptionen<D extends Nachweisdatei = Nachweisdatei> {
  profil: Profil
  /** The application: FIM (XML) or OneProof Format (JSON). One of `antragText` and `antragXml` is needed. */
  antragText?: string
  /** The same, by its earlier name. */
  antragXml?: string
  /** The uploaded files. */
  nachweise?: D[]
  /** Opens an uploaded file as a source of page images. */
  oeffne: (datei: D) => Promise<Quelle>
  /** The access to the AI; not needed as long as there is nothing to read. */
  ki?: KiZugang
  fortschritt?: (ereignis: Fortschrittsereignis) => void
  signal?: AbortSignal
  /** Page texts read earlier, by file hash (or name and size), page and model. */
  cache?: Map<string, SeitenText>
  /** For environments without one. */
  DOMParser?: typeof globalThis.DOMParser
  /** The clock, in ms since 1970. */
  jetzt?: () => number
  /** The day evidence must be current at (default: the date of the application). */
  stichtag?: Date
}

/** An uploaded file the check opened. */
export interface GeoeffneteDatei {
  id: string
  name: string
  mime: string
  groesse: number
  seiten: number
  hash: string | null
  /** Only a file that could not be opened has one; here it stays out. */
  fehler?: undefined
}

/** An uploaded file that could not be opened, and why. */
export interface UngeoeffneteDatei {
  id: string
  name: string
  mime: string | null
  /** Why it could not be opened, in words for the person. */
  fehler: string
  groesse?: undefined
  seiten?: undefined
  hash?: undefined
}

/** The files of a check as the result lists them: those it opened, then those it could not. */
export type ErgebnisDatei = GeoeffneteDatei | UngeoeffneteDatei

/** The profile as the result names it. */
export interface ErgebnisProfil {
  id: string
  /** `id@version`. */
  kennung: string
  name: string
  hinweis: string
}

/**
 * How the grouping went: `ok`, `entfallen` (nothing to group), or `fehlgeschlagen` — the check went
 * on without it, and `hinweis` says so in words for the page, which offers to check again.
 */
export type GruppierungsStatus =
  | { status: 'ok' | 'entfallen' }
  | { status: 'fehlgeschlagen'; art: IonosFehlerArt; grund: string; hinweis: string }

/** What the check did with the AI. */
export interface KiAngaben {
  /** The model that read the pages; `null` if nothing was read. */
  ocrModell: string | null
  /** The model that grouped the pages; `null` if nothing was read. */
  textModell: string | null
  /** How often the grouping model was asked. */
  versuche: number
  /** The token count of the grouping, as the service reports it. */
  verbrauch: Verbrauch | null
  /** Names of document types the model made up and the profile does not know. */
  erfundeneTypen: string[]
  gruppierung: GruppierungsStatus
}

/** The result of a check: what the application needs, what is proven, where every document went. */
export interface Pruefergebnis extends Omit<Zuordnung, 'plan'> {
  profil: ErgebnisProfil
  dateien: ErgebnisDatei[]
  /** What reading made of every page. */
  seiten: SeitenJeDatei
  ki: KiAngaben
  /** When the check was made, ISO 8601. */
  erstelltAm: string
  /** How long the check took, in ms. */
  dauerMs: number
}

/** Anything that went wrong becomes a {@link PruefFehler}. */
export function alsPruefFehler(fehler: unknown): PruefFehler {
  if (fehler instanceof PruefFehler) return fehler
  if (fehler instanceof IonosFehler) {
    if (fehler.art === 'abgebrochen') return new PruefFehler('abbruch', fehler.message, { ursache: fehler })
    return new PruefFehler('ki', fehler.message, {
      art: fehler.art,
      wiederholbar: istWiederholbar(fehler) || fehler.art === 'antwort',
      ursache: fehler,
    })
  }
  if (fehler instanceof InstanceError) return new PruefFehler('antrag', fehler.message, { ursache: fehler })
  if (istObjekt(fehler) && fehler.name === 'AbortError') return new PruefFehler('abbruch', 'Die Prüfung wurde abgebrochen.', { ursache: fehler })
  return new PruefFehler('intern', `Die Prüfung ist unerwartet fehlgeschlagen: ${meldungVon(fehler)}`, {
    ursache: fehler,
  })
}

/** The check: application and evidence in, what is proven and what is missing out. */
export async function pruefe<D extends Nachweisdatei>({
  profil,
  antragText,
  antragXml,
  nachweise = [],
  oeffne,
  ki,
  fortschritt = () => {},
  signal,
  cache = new Map<string, SeitenText>(),
  DOMParser,
  jetzt = () => Date.now(),
  stichtag,
}: PruefeOptionen<D>): Promise<Pruefergebnis> {
  const start = jetzt()
  const quellen: GeoeffneteQuelle[] = []

  const melde = (phase: Phase, innerhalb: number, text: string) => {
    const [von, bis] = ABSCHNITT[phase]
    fortschritt({ phase, anteil: von + (bis - von) * innerhalb, bis, text })
  }
  const pruefeAbbruch = () => {
    if (signal?.aborted) throw new PruefFehler('abbruch', 'Die Prüfung wurde abgebrochen.')
  }

  try {
    /* 1. The application */
    melde('antrag', 0, 'Die Antragsdaten werden gelesen …')
    const vorbereitet = await bereiteAntragVor({ profil, antrag: leseAntrag(antragText ?? antragXml ?? '', { DOMParser }) })
    pruefeAbbruch()

    /* 2. The files */
    const hinweise = [...vorbereitet.hinweise]
    const nichtGeoeffnet: UngeoeffneteDatei[] = []
    for (const [index, datei] of nachweise.entries()) {
      melde('oeffnen', index / nachweise.length, `Nachweis ${index + 1} von ${nachweise.length} wird geöffnet …`)
      try {
        quellen.push({ id: `f${index + 1}`, ...(await oeffne(datei)) })
      } catch (fehler) {
        nichtGeoeffnet.push({ id: `f${index + 1}`, name: datei.name, mime: datei.type || null, fehler: meldungVon(fehler) })
        hinweise.push(`„${datei.name}“ konnte nicht geöffnet werden: ${meldungVon(fehler)}`)
      }
      pruefeAbbruch()
    }

    // Nothing to read at all: a result would look like a check although none took place.
    if (nachweise.length > 0 && quellen.length === 0) {
      const gruende = [...new Set(nichtGeoeffnet.map(({ fehler }) => fehler))].join(' ')
      const [einzige] = nachweise
      throw new PruefFehler(
        'nachweise',
        einzige && nachweise.length === 1
          ? `„${einzige.name}“ konnte nicht geöffnet werden: ${gruende}`
          : `Keine der ${nachweise.length} Dateien konnte geöffnet werden: ${gruende}`,
      )
    }

    /* 3. Read the pages */
    const seitenInfo: SeitenJeDatei = Object.fromEntries(quellen.map((quelle): [string, Record<number, SeitenInfo>] => [quelle.id, {}]))
    const modelle: { ocr: string | null; text: string | null } = { ocr: null, text: null }
    const seitenGesamt = quellen.reduce((summe, quelle) => summe + quelle.seiten, 0)
    if (seitenGesamt > MAX_SEITEN) {
      throw new PruefFehler(
        'nachweise',
        `Die Nachweise haben zusammen ${seitenGesamt} Seiten. Mehr als ${MAX_SEITEN} Seiten werden nicht auf einmal geprüft. Bitte laden Sie weniger Unterlagen hoch.`,
      )
    }

    if (seitenGesamt > 0) {
      if (!ki) throw new PruefFehler('ki', 'Für das Lesen der Nachweise ist kein KI-Zugang eingerichtet.', { art: 'nicht-eingerichtet' })

      modelle.ocr = await loeseModellAuf({ client: ki.client, art: 'ocr', einstellung: ki.konfiguration.ocr, signal })
      modelle.text = await loeseModellAuf({ client: ki.client, art: 'text', einstellung: ki.konfiguration.text, signal })

      await leseAlleSeiten({
        quellen,
        client: ki.client,
        modell: modelle.ocr,
        parallel: ki.konfiguration.parallel,
        cache,
        signal,
        ergebnis: seitenInfo,
        beiFortschritt: (fertig) =>
          melde('lesen', fertig / seitenGesamt, `${fertig} von ${seitenGesamt} ${seitenGesamt === 1 ? 'Seite' : 'Seiten'} gelesen`),
      })
      pruefeAbbruch()
    }

    hinweise.push(...hinweiseZuSeiten(quellen, seitenInfo))

    /* 4. Group the pages into documents */
    const seitenTexte: PageTexts = {}
    const alleSeiten: PageRef[] = []
    const fuerDieKi: GruppierDatei[] = []
    for (const quelle of quellen) {
      const texte: Record<number, string> = {}
      seitenTexte[quelle.id] = texte
      const infos = seitenDerDatei(seitenInfo, quelle.id)
      const seiten: GruppierSeite[] = []
      for (let nummer = 1; nummer <= quelle.seiten; nummer++) {
        const info = infos[nummer]
        texte[nummer] = info?.text ?? ''
        alleSeiten.push({ fileId: quelle.id, page: nummer })
        if (info && info.status !== 'fehler') seiten.push({ page: nummer, text: info.text })
      }
      // A file in which no page has any text has nothing to group; its pages are caught below.
      if (seiten.some(({ text }) => text !== '')) fuerDieKi.push({ id: quelle.id, name: quelle.name, seiten })
    }

    let vorschlaege: Gruppierung['dokumente'] = []
    let gruppierung: Gruppierung | null = null
    let gruppierungsFehler: IonosFehler | null = null
    if (fuerDieKi.length > 0) {
      // Pages with text exist only where pages were read, and that took the access and both models.
      if (!ki || modelle.text === null) throw new Error('Die Seiten wurden gelesen, ohne dass ein KI-Zugang und ein Modell feststanden.')

      melde('gruppieren', 0, 'Die KI ordnet die Seiten einzelnen Dokumenten zu …')
      try {
        gruppierung = await gruppiere({
          client: mitZeitlimit(ki.client, GRUPPIERUNG_ZEITLIMIT_MS),
          modell: modelle.text,
          profil,
          ...personenFuerDieKi(profil, vorbereitet),
          antragslage: vorbereitet.ziele.antragslage,
          anzeigeNamen: vorbereitet.personen,
          verzeichnis: vorbereitet.verzeichnis,
          dateien: fuerDieKi,
          kontextfenster: kontextfensterVon(ki, modelle.text),
          beiVersuch: (versuch) => melde('gruppieren', 0, `Die KI ordnet die Seiten zu … (Versuch ${versuch})`),
          signal,
        })
        vorschlaege = gruppierung.dokumente
      } catch (fehler) {
        if (!(fehler instanceof IonosFehler) || !GRUPPIERUNG_ERSETZBAR.has(fehler.art) || signal?.aborted) throw fehler
        gruppierungsFehler = fehler
      }
      pruefeAbbruch()
    }

    const dokumente = bearbeiteDokumente({ dokumente: vorschlaege, seitenTexte, katalog: profil.katalog, alleSeiten })

    /* 5. Place the documents at the application */
    melde('zuordnen', 0, 'Die Dokumente werden den Angaben im Antrag zugeordnet …')
    const { plan: _plan, ...ergebnis } = await ordneZu({
      profil,
      vorbereitet,
      dokumente,
      dateien: new Map(quellen.map((quelle): [string, { name: string }] => [quelle.id, { name: quelle.name }])),
      monateJeSeite: (seite) => monatDerSeite(seitenTexte[seite.fileId]?.[seite.page] ?? ''),
      stichtag,
    })
    ergebnis.nichtZugeordnet = begruendeNichtZugeordnete(ergebnis.nichtZugeordnet, seitenInfo, gruppierungsFehler)

    if (gruppierung?.erfundeneTypen.length) hinweise.push(hinweisZuErfundenenTypen(gruppierung.erfundeneTypen))

    const dauerMs = jetzt() - start
    melde('zuordnen', 1, 'Fertig.')

    return {
      ...ergebnis,
      hinweise,
      profil: { id: profil.id, kennung: profil.kennung, name: profil.name, hinweis: profil.hinweis },
      dateien: [
        ...quellen.map(({ id, name, mime, groesse, seiten, hash }): GeoeffneteDatei => ({ id, name, mime, groesse, seiten, hash })),
        ...nichtGeoeffnet,
      ],
      seiten: seitenInfo,
      ki: {
        ocrModell: modelle.ocr,
        textModell: modelle.text,
        versuche: gruppierung?.antwort.versuche ?? 0,
        verbrauch: gruppierung?.antwort.usage ?? null,
        erfundeneTypen: gruppierung?.erfundeneTypen ?? [],
        /**
         * `ok`, `entfallen` (nothing to group) or `fehlgeschlagen`: the check went on without it,
         * and `hinweis` says so in words for the page, which offers to check again.
         */
        gruppierung: gruppierungsFehler
          ? {
              status: 'fehlgeschlagen',
              art: gruppierungsFehler.art,
              grund: gruppierungsFehler.message,
              hinweis: `Die KI konnte die gelesenen Seiten nicht zu Dokumenten ordnen. ${gruppierungsFehler.message} Die Seiten stehen deshalb unter „Nicht zugeordnete Unterlagen“, und die Angaben dazu sind noch nicht geprüft. Prüfen Sie erneut; bereits gelesene Seiten werden dabei nicht noch einmal gelesen.`,
            }
          : { status: gruppierung ? 'ok' : 'entfallen' },
      },
      erstelltAm: new Date(jetzt()).toISOString(),
      dauerMs,
    }
  } catch (fehler) {
    throw alsPruefFehler(fehler)
  } finally {
    for (const quelle of quellen) schliesse(quelle)
  }
}

/** The pages of one file in the result of the reading. Every file that was opened has an entry. */
function seitenDerDatei(seitenInfo: SeitenJeDatei, id: string): Record<number, SeitenInfo> {
  const seiten = seitenInfo[id]
  if (!seiten) throw new Error(`Für die Datei ${id} fehlen die gelesenen Seiten.`)
  return seiten
}

/**
 * Lets go of a file once. A file that does not close cleanly must not take the result — or the real
 * error — with it.
 */
function schliesse(quelle: GeoeffneteQuelle): void {
  if (quelle.geschlossen) return
  quelle.geschlossen = true
  try {
    quelle.schliessen?.()
  } catch {
    // see above
  }
}

/** The client with a longer time limit per call, for the one call that reasons before it answers. */
function mitZeitlimit(client: ChatClient, zeitlimitMs: number): ChatClient {
  return { ...client, chat: (eingabe) => client.chat({ zeitlimitMs, ...eingabe }) }
}

/**
 * The context window of the grouping model: as the model list states it, otherwise as the
 * configuration does (`ionos.text.kontextfenster`), otherwise unknown.
 */
function kontextfensterVon(ki: KiZugang, modell: string): number | null {
  const ausDerListe = ki.client.kontextfenster?.(modell)
  if (typeof ausDerListe === 'number' && Number.isInteger(ausDerListe) && ausDerListe > 0) return ausDerListe
  const konfiguriert = ki.konfiguration.text?.kontextfenster
  return typeof konfiguriert === 'number' && Number.isInteger(konfiguriert) && konfiguriert > 0 ? konfiguriert : null
}

/** The persons of an application for the instruction to the model: those of the household, and those outside it. */
export interface PersonenFuerDieKi {
  personen: PromptPerson[]
  nebenpersonen: PromptPerson[]
}

/**
 * The persons the application names, for the instruction to the model: the household with role
 * and birth name, and the persons it names outside the household.
 */
export function personenFuerDieKi(profil: Profil, vorbereitet: VorbereiteterAntrag): PersonenFuerDieKi {
  const { personen, rollen = [], namensteile = [], nebenpersonen = [] } = vorbereitet.ziele
  // An application type may bind its persons itself (profile format 2).
  const gebunden = profil.anbindungFuer?.(vorbereitet.antragsart?.schema)?.personen ?? profil.personen ?? {}
  const rolleVon = (index: number) => rollen[index] ?? (index === 0 ? gebunden.antragsteller?.bezeichnung : gebunden.mitglieder?.bezeichnung)
  return {
    personen: personen.flatMap((name, index) =>
      name
        ? [
            {
              name,
              rolle: rolleVon(index),
              geburtsname: namensteile[index]?.geburtsname || null,
            },
          ]
        : [],
    ),
    nebenpersonen: nebenpersonen.filter(({ anzeige }) => anzeige).map(({ anzeige, rolle }) => ({ name: anzeige, rolle: rolle ?? null })),
  }
}

/** „A“, „B“ … — the first few names of unknown types, the rest counted. */
function hinweisZuErfundenenTypen(typen: string[]): string {
  const genannt = typen.slice(0, ERFUNDENE_TYPEN_IM_HINWEIS).map((typ) => `„${typ}“`)
  const rest = typen.length - genannt.length
  const liste = rest > 0 ? `${genannt.join(', ')} und ${rest} weitere` : genannt.join(', ')
  return `Die KI hat Unterlagen als ${liste} erkannt. Diese Arten kennt das Profil nicht; sie stehen unter „Sonstiger Nachweis“.`
}

/** What {@link leseAlleSeiten} needs. */
interface LeseAlleSeitenEingabe {
  quellen: GeoeffneteQuelle[]
  client: SeitenLeser
  /** The OCR model. */
  modell: string
  /** How many pages are read at the same time. */
  parallel: number
  cache: Map<string, SeitenText>
  signal?: AbortSignal
  /** Where the state of every page is recorded. */
  ergebnis: SeitenJeDatei
  /** Called with the number of pages done so far. */
  beiFortschritt: (fertig: number) => void
}

/** What reading a page left: the text, or why there is none. */
type GeleseneSeite = (SeitenText & { fehler?: undefined }) | { fehler: string }

/**
 * Reads every page of every file. A page that cannot be read does not stop the check — it is
 * recorded and reported. What would fail the same way for every page does: no access, no model,
 * a service that asks for a long pause, or {@link LESEN_FEHLER_IN_FOLGE} pages in a row that failed
 * although the client had already tried again. A file is let go as soon as its last page is done.
 */
async function leseAlleSeiten({ quellen, client, modell, parallel, cache, signal, ergebnis, beiFortschritt }: LeseAlleSeitenEingabe): Promise<void> {
  const aufgaben = quellen.flatMap((quelle) => Array.from({ length: quelle.seiten }, (_, i) => ({ quelle, seite: i + 1 })))
  const offen = new Map(quellen.map((quelle): [string, number] => [quelle.id, quelle.seiten]))
  let fertig = 0
  let fehlerInFolge = 0
  beiFortschritt(0)

  await mitBegrenzung(
    aufgaben,
    parallel,
    async ({ quelle, seite }, innen) => {
      const schluessel = `${quelle.hash ?? `${quelle.name}:${quelle.groesse}:${quelle.geaendert ?? ''}`}:${seite}:${modell}`
      let eintrag: GeleseneSeite | undefined = cache.get(schluessel)

      if (!eintrag) {
        try {
          const bild = await quelle.bild(seite, innen)
          eintrag = await leseSeite({ client, modell, bild, signal: innen })
          cache.set(schluessel, eintrag)
          fehlerInFolge = 0
        } catch (fehler) {
          if (fehler instanceof IonosFehler && GRUNDSAETZLICHE_KI_FEHLER.has(fehler.art)) throw fehler
          if (innen.aborted) throw new PruefFehler('abbruch', 'Die Prüfung wurde abgebrochen.')
          if (fehler instanceof IonosFehler && istWiederholbar(fehler)) {
            fehlerInFolge++
            if ((fehler.warteSekunden ?? 0) > LAENGSTE_PAUSE_SEKUNDEN || fehlerInFolge >= LESEN_FEHLER_IN_FOLGE) {
              throw new PruefFehler(
                'ki',
                `Der Lesedienst ist gerade nicht verfügbar: ${fehler.message} Bereits gelesene Seiten bleiben erhalten und werden beim nächsten Versuch nicht noch einmal gelesen.`,
                { art: fehler.art, wiederholbar: true, ursache: fehler },
              )
            }
          }
          eintrag = { fehler: meldungVon(fehler) }
        }
      }

      seitenDerDatei(ergebnis, quelle.id)[seite] = seitenInfoAus(eintrag)
      beiFortschritt(++fertig)

      const verbleibend = offen.get(quelle.id)
      if (verbleibend === undefined) throw new Error(`Die Datei ${quelle.id} ist nicht unter den zu lesenden.`)
      const uebrig = verbleibend - 1
      offen.set(quelle.id, uebrig)
      if (uebrig === 0) schliesse(quelle)
    },
    signal,
  )

  // Every page was read or recorded as unreadable. If not a single one could be read, say why.
  const [erste] = aufgaben
  if (erste && aufgaben.every(({ quelle, seite }) => seitenDerDatei(ergebnis, quelle.id)[seite]?.status === 'fehler')) {
    const erster = seitenDerDatei(ergebnis, erste.quelle.id)[erste.seite]?.fehler
    throw new PruefFehler('ki', `Keine Seite der Nachweise konnte gelesen werden. ${erster ?? ''}`.trim(), { wiederholbar: true })
  }
}

function seitenInfoAus(eintrag: GeleseneSeite): SeitenInfo {
  if (eintrag.fehler !== undefined) return { status: 'fehler', text: '', fehler: eintrag.fehler }

  const text = eintrag.text.trim()
  if (eintrag.abgeschnitten) return { status: 'abgeschnitten', text }
  return { status: text === '' ? 'leer' : 'gelesen', text }
}

function hinweiseZuSeiten(quellen: GeoeffneteQuelle[], seitenInfo: SeitenJeDatei): string[] {
  const hinweise: string[] = []
  for (const quelle of quellen) {
    const infos = seitenDerDatei(seitenInfo, quelle.id)
    for (let seite = 1; seite <= quelle.seiten; seite++) {
      const wo = quelle.seiten === 1 ? `„${quelle.name}“` : `Seite ${seite} von „${quelle.name}“`
      const status = infos[seite]?.status
      if (status === 'fehler') hinweise.push(`${wo} konnte nicht gelesen werden.`)
      if (status === 'abgeschnitten') hinweise.push(`${wo} wurde möglicherweise nicht vollständig gelesen.`)
    }
  }
  return hinweise
}

/** Why pages are not part of any document: unreadable, blank, not grouped, or not recognised. */
function begruendeNichtZugeordnete(eintraege: NichtZugeordnet[], seitenInfo: SeitenJeDatei, gruppierungsFehler: IonosFehler | null): NichtZugeordnet[] {
  return eintraege.map((eintrag) => {
    if (eintrag.typLabel !== 'Nicht erkannt') return eintrag

    const stati = eintrag.dateien.flatMap(({ fileId, seiten }) => seiten.map((seite) => seitenInfo[fileId]?.[seite]?.status))
    if (stati.every((status) => status === 'fehler')) return { ...eintrag, grund: 'Diese Seiten konnten nicht gelesen werden.' }
    if (stati.every((status) => status === 'leer')) return { ...eintrag, grund: 'Auf diesen Seiten wurde kein Text erkannt.' }
    if (gruppierungsFehler) return { ...eintrag, grund: 'Die KI konnte diese Seiten nicht zuordnen. Prüfen Sie erneut.' }
    return eintrag
  })
}
