/**
 * What the pages show, derived from the data of a check.
 *
 * There is no React in here: the components only lay out what these functions return. That keeps
 * the wording, the counting and the grouping in one place where they can be tested without a
 * browser.
 */
import type { PruefFehler } from '../engine/fehler.ts'
import type { Phase, Pruefergebnis } from '../engine/pipeline.ts'
import type { Rolle } from '../engine/profil/laden.ts'
import type { AkzeptierteQuelle, Anforderung, BelegBasis, Status, Zusammenfassung } from '../engine/zuordnung/anforderungen.ts'
import { seitenText } from '../engine/zuordnung/posten.ts'

/** Keeps "Seite 1" together on one line: a number alone at the start of a line reads badly. */
export const zusammenhalten = (text: string): string => text.replaceAll(' ', '\u00a0')

/** "1 Angabe", "2 Angaben". */
export const zaehle = (anzahl: number, einzahl: string, mehrzahl: string): string => `${anzahl} ${anzahl === 1 ? einzahl : mehrzahl}`

/** "A", "A und B", "A, B und C". */
export function aufzaehlung(eintraege: readonly string[]): string {
  return new Intl.ListFormat('de', { style: 'long', type: 'conjunction' }).format(eintraege)
}

/** 12 345 bytes → "12 KB"; sizes as the file manager of the person shows them (powers of ten). */
export function groesseText(bytes: number): string {
  if (bytes < 1000) return `${bytes} Byte`
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`
  return `${(bytes / 1_000_000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`
}

/** 42 000 ms → "42 Sekunden", 125 000 ms → "2 Min. 5 Sek.". */
export function dauerText(ms: number): string {
  const sekunden = Math.max(1, Math.round(ms / 1000))
  if (sekunden < 60) return zaehle(sekunden, 'Sekunde', 'Sekunden')
  return `${Math.floor(sekunden / 60)} Min. ${sekunden % 60} Sek.`
}

/* ------------------------------------------------------------------------------------------ */
/* The result                                                                                  */
/* ------------------------------------------------------------------------------------------ */

/** The requirements by what a person has to do about them. A `type`, so that `Object.values` knows the groups are alike. */
export type AnforderungsGruppen = {
  /** `offen` and `unklar`: something is still missing. */
  zuTun: Anforderung[]
  belegt: Anforderung[]
  entfaellt: Anforderung[]
}

/**
 * The requirements by what a person has to do about them, in the order of the application:
 * what is still to do, what is proven, what does not apply.
 */
export function teileAuf(anforderungen: readonly Anforderung[]): AnforderungsGruppen {
  const gruppen: AnforderungsGruppen = { zuTun: [], belegt: [], entfaellt: [] }
  for (const anforderung of anforderungen) {
    if (anforderung.status === 'entfaellt') gruppen.entfaellt.push(anforderung)
    else if (anforderung.status === 'belegt') gruppen.belegt.push(anforderung)
    else gruppen.zuTun.push(anforderung)
  }
  return gruppen
}

/** The counts of a check, as {@link Zusammenfassung} gives them. */
export type Anzahlen = Pick<Zusammenfassung, 'belegt' | 'offen' | 'unklar' | 'entfaellt'>

/** The counts the page speaks about. */
export interface Zaehlungen extends Anzahlen {
  gesamt: number
  /** What has to be proven: all requirements except those that do not apply. */
  zuBelegen: number
  /** What is still missing: `offen` and `unklar`. */
  nochOffen: number
}

/** The counts the page speaks about. `zuBelegen` leaves out what does not apply. */
export function zaehlungen({ belegt, offen, unklar, entfaellt, gesamt }: Anzahlen & Pick<Zusammenfassung, 'gesamt'>): Zaehlungen {
  return { gesamt, belegt, offen, unklar, entfaellt, zuBelegen: gesamt - entfaellt, nochOffen: offen + unklar }
}

/** How many pages the check looked at, readable or not. */
export function seitenZahl(ergebnis: Pick<Pruefergebnis, 'seiten'>): number {
  return Object.values(ergebnis.seiten).reduce((summe, jeDatei) => summe + Object.keys(jeDatei).length, 0)
}

/** The sentence under "Für Ihren Antrag wurden N Angaben geprüft". */
export function infoText({ belegt, offen, unklar, entfaellt }: Anzahlen): string {
  const saetze: string[] = []
  if (belegt > 0) saetze.push(`${belegt} ${belegt === 1 ? 'Angabe ist' : 'Angaben sind'} durch Ihre Unterlagen belegt.`)
  if (entfaellt > 0) saetze.push(`${entfaellt} ${entfaellt === 1 ? 'Angabe ist' : 'Angaben sind'} in Ihrem Fall nicht erforderlich.`)
  if (offen > 0) saetze.push(`Für ${zaehle(offen, 'Angabe', 'Angaben')} fehlt noch eine Unterlage.`)
  if (unklar > 0) saetze.push(`Bei ${zaehle(unklar, 'Angabe', 'Angaben')} reicht die vorhandene Unterlage noch nicht aus.`)
  if (offen === 0 && unklar === 0) saetze.push('Es fehlt nichts.')
  return saetze.join(' ')
}

/** What the card to submit says; the application can be submitted whatever is still open. */
export function einreichenText(nochOffen: number): string {
  return nochOffen === 0
    ? 'Alle Angaben sind belegt. Sie können den Antrag jetzt absenden.'
    : `${nochOffen} ${nochOffen === 1 ? 'Angabe ist' : 'Angaben sind'} noch offen. Sie können den Antrag trotzdem absenden — die Frist ist damit gewahrt und Sie reichen die fehlenden Nachweise später nach.`
}

/** What the confirmation says once the application is submitted. */
export function eingangsText(nochOffen: number): string {
  return nochOffen === 0
    ? 'Alle Angaben sind belegt. Sie müssen nichts nachreichen.'
    : `${nochOffen} ${nochOffen === 1 ? 'Angabe ist' : 'Angaben sind'} noch offen. Sie können die Nachweise jederzeit nachreichen — Ihre Behörde meldet sich, wenn etwas fehlt.`
}

/** What two checks are compared by: the status of each requirement. */
export interface Pruefstand {
  anforderungen: readonly Pick<Anforderung, 'id' | 'status'>[]
}

/** The requirements whose state differs from an earlier check — the page lets those light up. */
export function unterschiede(vorher: Pruefstand | null, nachher: Pruefstand): Set<string> {
  if (!vorher) return new Set()
  const frueher = new Map(vorher.anforderungen.map(({ id, status }): [string, Status] => [id, status]))
  return new Set(
    nachher.anforderungen.filter(({ id, status }) => frueher.has(id) && frueher.get(id) !== status).map(({ id }) => id),
  )
}

/* ------------------------------------------------------------------------------------------ */
/* Evidence                                                                                    */
/* ------------------------------------------------------------------------------------------ */

/** What a kind of document can do for a statement, in the words of the page. */
export interface RollenText {
  /** The heading of the list of such documents. */
  titel: string
  /** The short form on a document that proves a statement; `null` for one that suffices. */
  kurz: string | null
}

/** What a kind of document can do for a statement, in the words of the page. */
export const ROLLEN: Readonly<Record<Rolle, RollenText>> = Object.freeze({
  genuegt: { titel: 'Genügt als Nachweis', kurz: null },
  pruefen: { titel: 'Reicht allein nicht aus', kurz: 'reicht allein nicht aus' },
  ergaenzt: { titel: 'Ergänzt einen Nachweis', kurz: 'ergänzt den Nachweis' },
})

/** What of an accepted kind of document the page shows. */
export type QuelleZeile = Pick<AkzeptierteQuelle, 'label' | 'rolle'>

/** The kinds of document accepted for a requirement that can do the same, under the heading for it. */
export interface RollenGruppe {
  rolle: string
  titel: string
  /** Labels of the kinds of document. */
  arten: string[]
}

/** The kinds of document a profile accepts for a requirement, by what they can do. */
export function quellenNachRolle(quellen: readonly QuelleZeile[]): RollenGruppe[] {
  return Object.entries(ROLLEN)
    .map(([rolle, { titel }]) => ({
      rolle,
      titel,
      arten: quellen.filter((quelle) => quelle.rolle === rolle).map((quelle) => quelle.label),
    }))
    .filter(({ arten }) => arten.length > 0)
}

/** A file of a document, with the pages that belong to it. */
export interface DateiZeile {
  /** The id of the file in the check, `f1`, `f2`, … */
  schluessel: string
  name: string
  /** "Seite 3", "Seiten 1–3, 5". */
  seiten: string
}

/** A document that proves a requirement, as a line for a card. */
export interface BelegZeile {
  /** The id of the document. */
  schluessel: string
  /** What kind of document it is. */
  art: string
  /** What it can do for the statement, where that is less than suffice; `null` otherwise. */
  rolle: string | null
  person: string | null
  /** Billing months, `MM.JJJJ`. */
  monate: string[]
  dateien: DateiZeile[]
}

/** The documents that prove a requirement, as lines for a card. */
export function belegZeilen(belege: readonly BelegBasis[]): BelegZeile[] {
  return belege.map((beleg) => ({
    schluessel: beleg.dokument,
    art: beleg.typLabel,
    // `keine` is the role of a document that has no place; the table has no entry for it.
    rolle: (beleg.rolle === 'keine' ? null : ROLLEN[beleg.rolle].kurz) ?? null,
    person: beleg.person ?? null,
    monate: beleg.monate ?? [],
    dateien: beleg.dateien.map(({ fileId, name, seitenText: seiten }) => ({ schluessel: fileId, name, seiten })),
  }))
}

/** A document the check recognised, as lines for a card. */
export interface DokumentZeile {
  /** The id of the document, `D1`, `D2`, … */
  id: string
  /** What kind of document it is. */
  art: string
  person: string | null
  /** 0–100 as reported by the grouping. */
  vertrauen: number | null
  /** Billing months, `MM.JJJJ`. */
  monate: string[]
  dateien: DateiZeile[]
  /** The requirements it proves, as "Fact – Person". */
  verwendetFuer: string[]
  /** Where in the application it fits although the person gave no answer there; `null` otherwise. */
  weitere: string | null
  /** Why it is not used; `null` where it is, or where nothing is said. */
  grund: string | null
}

/**
 * Every document the check recognised, with the files and pages it consists of and what it is
 * used for. This is the grouping made visible: which pages belong together, and where they went.
 */
export function dokumentZeilen(
  ergebnis: Pick<Pruefergebnis, 'dateien' | 'anforderungen' | 'weitere' | 'nichtZugeordnet' | 'dokumente'>,
): DokumentZeile[] {
  const dateiName = new Map(ergebnis.dateien.map(({ id, name }): [string, string] => [id, name]))

  const verwendung = new Map<string, string[]>()
  const merke = (dokument: string, text: string) => verwendung.set(dokument, [...(verwendung.get(dokument) ?? []), text])
  for (const anforderung of ergebnis.anforderungen) {
    for (const beleg of anforderung.belege) {
      merke(beleg.dokument, [anforderung.fact, anforderung.person].filter(Boolean).join(' – '))
    }
  }
  const weitere = new Map(ergebnis.weitere.map((beleg) => [beleg.dokument, beleg]))
  const ohneStelle = new Map(ergebnis.nichtZugeordnet.map((beleg) => [beleg.dokument, beleg]))

  return ergebnis.dokumente.map((dokument) => {
    const seitenJeDatei = new Map<string, number[]>()
    for (const { fileId, page } of dokument.seiten) {
      seitenJeDatei.set(fileId, [...(seitenJeDatei.get(fileId) ?? []), page])
    }
    const einWeiterer = weitere.get(dokument.id)

    return {
      id: dokument.id,
      art: dokument.typLabel,
      person: dokument.person ?? null,
      vertrauen: dokument.vertrauen ?? null,
      monate: dokument.monate ?? [],
      dateien: [...seitenJeDatei].map(([fileId, seiten]) => ({
        schluessel: fileId,
        name: dateiName.get(fileId) ?? fileId,
        seiten: seitenText(seiten),
      })),
      verwendetFuer: verwendung.get(dokument.id) ?? [],
      weitere: einWeiterer ? einWeiterer.stelle?.pfad?.join(' › ') || 'ohne genauere Stelle' : null,
      grund: ohneStelle.get(dokument.id)?.grund ?? null,
    }
  })
}

/* ------------------------------------------------------------------------------------------ */
/* Errors                                                                                      */
/* ------------------------------------------------------------------------------------------ */

/** What went wrong, in a heading, by where it happened and — for the AI — what kind of failure. */
export function ueberschriftZu(fehler: Pick<PruefFehler, 'bereich' | 'art'>): string {
  switch (fehler.bereich) {
    case 'antrag':
      return 'Die Antragsdaten konnten nicht gelesen werden'
    case 'nachweise':
      return 'Die Nachweise können nicht geprüft werden'
    case 'ki':
      switch (fehler.art) {
        case 'nicht-eingerichtet':
          return 'Die KI-Anbindung ist nicht eingerichtet'
        case 'auth':
          return 'Der Zugang zur KI wurde abgelehnt'
        case 'modell':
          return 'Ein KI-Modell steht nicht zur Verfügung'
        case 'ratenlimit':
          return 'Die KI ist gerade ausgelastet'
        case 'zeitlimit':
          return 'Die KI hat zu lange gebraucht'
        case 'netz':
          return 'Die KI ist nicht erreichbar'
        default:
          return 'Die KI konnte die Unterlagen nicht auswerten'
      }
    default:
      return 'Die Prüfung ist fehlgeschlagen'
  }
}

/** What can be done about it, for the failures where there is something to say. */
export function empfehlungZu(fehler: Pick<PruefFehler, 'bereich' | 'art' | 'wiederholbar'>): string | null {
  if (fehler.bereich === 'ki' && (fehler.art === 'nicht-eingerichtet' || fehler.art === 'auth')) {
    return 'Das lässt sich hier nicht beheben: Der Zugang zur KI muss von den Betreibern dieser Seite eingerichtet werden (Token IONOS_API_TOKEN, siehe README).'
  }
  if (fehler.bereich === 'ki' && fehler.art === 'modell') {
    return 'Welche Modelle genutzt werden, steht in der Datei konfiguration.json.'
  }
  if (fehler.wiederholbar) {
    return 'Ein erneuter Versuch kann helfen. Was bereits gelesen wurde, wird nicht noch einmal gelesen.'
  }
  return null
}

/* ------------------------------------------------------------------------------------------ */
/* Progress                                                                                    */
/* ------------------------------------------------------------------------------------------ */

/** A step of the check as the page lists it. */
export interface Schritt {
  phase: Phase
  titel: string
  /** The step has nothing to do where no evidence was chosen. */
  nurMitNachweisen: boolean
}

/** Whether a step is done, running or waiting. */
export type SchrittStand = 'wartet' | 'laeuft' | 'fertig'

/** A step with its state. */
export interface SchrittMitStand extends Schritt {
  stand: SchrittStand
}

const SCHRITTE: readonly Schritt[] = [
  { phase: 'antrag', titel: 'Antragsdaten lesen', nurMitNachweisen: false },
  { phase: 'oeffnen', titel: 'Nachweise öffnen', nurMitNachweisen: true },
  { phase: 'lesen', titel: 'Seiten lesen', nurMitNachweisen: true },
  { phase: 'gruppieren', titel: 'Seiten zu Dokumenten ordnen', nurMitNachweisen: true },
  { phase: 'zuordnen', titel: 'Dokumente den Angaben im Antrag zuordnen', nurMitNachweisen: false },
]

/** The steps a check goes through; without evidence there is nothing to open, read or group. */
export const schritteFuer = (mitNachweisen: boolean): Schritt[] => SCHRITTE.filter((schritt) => mitNachweisen || !schritt.nurMitNachweisen)

/** Each step as done, running or waiting, given the phase the check reports. */
export function schrittStaende(schritte: readonly Schritt[], phase: Phase | undefined): SchrittMitStand[] {
  const aktuell = schritte.findIndex((schritt) => schritt.phase === phase)
  return schritte.map((schritt, index) => ({
    ...schritt,
    stand: aktuell < 0 || index > aktuell ? 'wartet' : index === aktuell ? 'laeuft' : 'fertig',
  }))
}

/**
 * The bar creeps towards the end of a phase while the check waits for an answer that has no
 * measurable progress (the language model that groups the pages reasons for a while), but never
 * reaches it: the phase ends when the answer arrives, not before.
 *
 * @param anteil     share of the whole check at the start of the phase (0–1)
 * @param bis        share at which the phase ends
 * @param vergangenMs  time since the phase began
 * @param zeitkonstanteMs  after this time about two thirds of the way are covered
 */
export function kriechen(anteil: number, bis: number, vergangenMs: number, zeitkonstanteMs = 45_000): number {
  const gewonnen = 1 - Math.exp(-Math.max(0, vergangenMs) / zeitkonstanteMs)
  return anteil + (bis - anteil) * gewonnen
}
