/**
 * From placed documents to requirements with a status.
 *
 * A *requirement* is a fact the application states — not a document. Each named target of the
 * application is one. Its status follows from what has been placed there and from what the
 * profile says about the documents:
 *
 * - `belegt`      a document that suffices on its own is there, it is certainly this fact's (the
 *                 person fits, it fits no other entry just as well) and — where the profile asks
 *                 for a period — enough of it is covered, recently enough;
 * - `unklar`      something is there, but it does not (yet) settle the fact: too few or too old
 *                 months, a person who is not in the application, a document that fits several
 *                 entries equally well, one that only may suffice, or an answer in the application
 *                 that is still outstanding;
 * - `offen`       nothing suffices yet;
 * - `entfaellt`   the application itself says it does not apply (a question answered with "no").
 *
 * Nothing here decides whether a claim exists. The engine states what is proven and what is not.
 */

import { ROLLE } from '../profil/laden.ts'
import type { Abdeckung, Merkmale, Profil, Quelle } from '../profil/laden.ts'
import { ADJUSTMENT, REJECTION } from './platzierung.ts'
import type { Adjustment, Plan } from './platzierung.ts'
import { seitenJeDatei, seitenText } from './posten.ts'
import type { BelegRolle, DokumentInfo, PostenInfo } from './posten.ts'
import type { Entfaellt, Ort, Ziel, ZielInfo, Zielableitung } from './ziele.ts'

export const STATUS = Object.freeze({
  BELEGT: 'belegt',
  OFFEN: 'offen',
  UNKLAR: 'unklar',
  ENTFAELLT: 'entfaellt',
})

/** One of the values of {@link STATUS}. */
export type Status = (typeof STATUS)[keyof typeof STATUS]

/** The names of the uploaded files by id, for the references in the result. */
export type Dateinamen = ReadonlyMap<string, { name: string }>

/** The pages of a document within one file, with the name of the file. */
export interface BelegDatei {
  fileId: string
  /** The name of the file (its id where the name is unknown). */
  name: string
  /** Page numbers. */
  seiten: number[]
  /** "Seite 3", "Seiten 1–3, 5". */
  seitenText: string
}

/** A document as the result lists it, wherever it stands. */
export interface BelegBasis {
  /** Id of the document, `D1`, `D2`, … */
  dokument: string
  /** Catalogue key. */
  typ: string
  typLabel: string
  /** The role the document plays here; `keine` for one without a place. */
  rolle: BelegRolle
  dateien: BelegDatei[]
  /** Name as it stands on the document. */
  person: string | null
  /** Index of the person of the household the name was resolved to. */
  personIndex: number | null
  /** `false` if the name fits nobody the application names. */
  personBekannt: boolean
  /** The name is one the application gives for someone outside the household. */
  personAusserhalb: boolean
  /** Billing months, `MM.JJJJ`. */
  monate: string[]
  /** 0–100 as reported by the grouping. */
  vertrauen: number | null
}

/** A document placed at a requirement. */
export interface Beleg extends BelegBasis {
  /** The number of places the document fitted equally well, if the first of them was taken. */
  gleichAuf: number | null
  /** The document names nobody outside the household, or the person whose entry this place is. */
  nebenPasst: boolean
}

/** A document placed at a place the application does not ask for: kept and shown, no requirement. */
export interface WeitererBeleg extends Beleg {
  stelle: Fundstelle
  anmerkungen: string[]
}

/** A document with no place at all, and why. */
export interface NichtZugeordnet extends BelegBasis {
  grund: string
}

/** Where in the application a requirement or a document sits. */
export interface Fundstelle {
  slot: string
  /** Id of the `stelle` in the profile (not for a requirement ruled out by the application). */
  stelle?: string
  art: string
  /** Labels of the groups from the section down to the place. */
  pfad: string[]
  /** 1-based position among the entries of a repeated group. */
  eintrag?: number | null
  /** Number of entries. */
  von?: number | null
  /** The place in an application of the OneProof Format, as a JSON Pointer (`oneproof/zugang.ts`). */
  zeiger?: string
}

/** A document type the profile accepts as evidence for an art, and how well. */
export type AkzeptierteQuelle = Pick<Quelle, 'typ' | 'label' | 'rolle' | 'genau'>

/** A fact the application states and that needs evidence, with its status. */
export interface Anforderung {
  /** The slot of the target (`stelle#p<person>#<n>`), or the id of the entry the application rules out. */
  id: string
  status: Status
  /** Title of the fact. */
  fact: string
  /** What the application says, in words. */
  aussage: string | null
  bereich: string | null
  /** The person it is about, in words. */
  person: string | null
  /** 1-based position among the entries of a repeated group. */
  eintrag: number | null
  /** Number of entries. */
  von: number | null
  /** What to bring, where it is not settled yet. */
  hint: string | null
  /** Why it is not settled. */
  note: string | null
  /** What to do next. */
  action: string | null
  /** Why it does not apply (`entfaellt` only). */
  reason: string | null
  /** What is accepted as evidence. */
  quellen: AkzeptierteQuelle[]
  belege: Beleg[]
  stelle: Fundstelle
  /** Remarks on how the documents were placed. */
  anmerkungen: string[]
}

/** Where a document is filed in the application. */
export interface AblageEintrag {
  /** Id of the document. */
  dokument: string
  slot: string
  /** The place in words („Einkommen · Albert Einstein“). */
  bezeichnung: string
  benannt: boolean
  ort: Ort
  /** The check placed the document here, but the application is not to refer to it (someone else's name). */
  grund?: string
}

/** How many requirements have which status. */
export interface Zusammenfassung {
  belegt: number
  offen: number
  unklar: number
  entfaellt: number
  /** The number of requirements. */
  gesamt: number
  /** The number of documents at places the application does not ask for. */
  weitere: number
}

/** What {@link bewerteAnforderungen} needs. */
export interface BewerteAnforderungenEingabe {
  profil: Profil
  ziele: Zielableitung
  plan: Plan
  posten: Map<string, PostenInfo>
  dokumente: DokumentInfo[]
  dateien?: Dateinamen
  /** The day the evidence must be current at. */
  stichtag?: Date
}

/** The requirements with their status, and everything that goes with them. */
export interface AnforderungenErgebnis {
  anforderungen: Anforderung[]
  weitere: WeitererBeleg[]
  nichtZugeordnet: NichtZugeordnet[]
  ablage: AblageEintrag[]
  zusammenfassung: Zusammenfassung
}

/** How the placement treated an item. */
interface Anpassung {
  /** Landed at the coarser art. */
  groeber?: boolean
  /** The number of equally good places; the first got it. */
  gleichAuf?: number
}

/** The status of one requirement and what to tell about it. */
interface Bewertung {
  status: Status
  note: string | null
  action: string | null
}

/** A document placed elsewhere that fitted a place just as well. */
interface AuchMoeglich {
  typLabel: string
  /** Where it was placed. */
  bei: ZielInfo | undefined
}

/** What makes a document someone else's. */
type Fremdheit = Pick<Beleg, 'person' | 'personBekannt' | 'personAusserhalb' | 'nebenPasst'>

/** The requirements of an application with their status, derived from what has been placed. */
export function bewerteAnforderungen({
  profil,
  ziele,
  plan,
  posten,
  dokumente,
  dateien = new Map(),
  stichtag = new Date(),
}: BewerteAnforderungenEingabe): AnforderungenErgebnis {
  const dokumentVon = new Map(dokumente.map((dokument) => [dokument.id, dokument]))

  /** How the placement treated an item: over the coarser art, or first of several equal places. */
  const anpassungen = new Map<string, Anpassung>()
  for (const anpassung of plan.adjustments) {
    const bisher = anpassungen.get(anpassung.name) ?? {}
    if (anpassung.kind === ADJUSTMENT.COARSER_ART && anpassung.placedArt !== anpassung.art) bisher.groeber = true
    if (anpassung.kind === ADJUSTMENT.FIRST_OF_SEVERAL) bisher.gleichAuf = anpassung.candidates
    anpassungen.set(anpassung.name, bisher)
  }

  const belegeAn = (ziel: Ziel): Beleg[] => {
    const jeDokument = new Map<string, Beleg>()
    for (const itemName of plan.bySlot[ziel.slot] ?? []) {
      const posten_ = posten.get(itemName)
      const dokument = posten_ && dokumentVon.get(posten_.dokument)
      if (!dokument) continue

      const anpassung = anpassungen.get(itemName) ?? {}
      // Landing at the coarser art proves the coarser fact only as far as the profile says.
      const rolle = anpassung.groeber ? (posten_.rolleGroeber ?? ROLLE.ERGAENZT) : posten_.rolle
      const beleg: Beleg = {
        ...belegVon(dokument, rolle, dateien),
        gleichAuf: anpassung.gleichAuf ?? null,
        nebenPasst: !dokument.personTreffer.neben || ziel.merkmale?.nebenperson === dokument.personTreffer.neben,
      }

      // One document may arrive via several uses; the strongest role counts.
      const vorhanden = jeDokument.get(dokument.id)
      if (!vorhanden || staerke(beleg.rolle) > staerke(vorhanden.rolle)) jeDokument.set(dokument.id, beleg)
    }
    return [...jeDokument.values()]
  }

  const anmerkungenZu = (slot: string): string[] =>
    plan.adjustments
      .filter((anpassung) => anpassung.placedSlot === slot)
      .map((anpassung) => anmerkung(anpassung))
      .filter((text): text is string => Boolean(text))

  /**
   * Documents placed elsewhere that fitted this place just as well: the first of several equal
   * places got them, this one may be theirs as much.
   */
  const auchMoeglichAn = (slot: string): AuchMoeglich[] => {
    const gesehen = new Set<string>()
    const liste: AuchMoeglich[] = []
    for (const anpassung of plan.adjustments) {
      if (anpassung.kind !== ADJUSTMENT.FIRST_OF_SEVERAL || !anpassung.alternatives?.includes(slot)) continue
      const id = posten.get(anpassung.name)?.dokument
      const dokument = id === undefined ? undefined : dokumentVon.get(id)
      if (!dokument || gesehen.has(dokument.id)) continue
      gesehen.add(dokument.id)
      liste.push({ typLabel: dokument.typLabel, bei: ziele.infos.get(anpassung.placedSlot) })
    }
    return liste
  }

  const anforderungen: Anforderung[] = []
  const weitere: WeitererBeleg[] = []
  /** Documents in the name of someone else, set aside at a place that has evidence of its own. */
  const beiseite = new Map<string, string>()

  for (const ziel of ziele.ziele) {
    const info = ziele.infos.get(ziel.slot)
    if (!info) throw new Error(`Kein Ziel zum Platz ${ziel.slot}.`)
    // A document in the name of someone else is no evidence where a document of the person
    // suffices already: two payslips of the applicant and one of a son who lives elsewhere are not
    // three payslips of the applicant. Where the person has nothing that suffices, it stays — the
    // name may have been misread — and makes the fact `unklar`.
    const alle = belegeAn(ziel)
    const eigenesGenuegt = alle.some((beleg) => beleg.rolle === ROLLE.GENUEGT && !istFremd(beleg))
    const belege = eigenesGenuegt ? alle.filter((beleg) => !istFremd(beleg)) : alle
    if (eigenesGenuegt) {
      for (const beleg of alle) if (istFremd(beleg)) beiseite.set(beleg.dokument, fremdGrund(beleg))
    }

    if (!info.benannt) {
      // Evidence at a place the application does not ask for: kept, shown, not a requirement.
      for (const beleg of belege) weitere.push({ ...beleg, stelle: stelleVon(info), anmerkungen: [] })
      continue
    }

    const bewertung = bewerte(info, belege, profil, stichtag, auchMoeglichAn(ziel.slot))
    anforderungen.push({
      id: ziel.slot,
      status: bewertung.status,
      fact: info.titel,
      aussage: info.aussage,
      bereich: info.bereich,
      person: info.personLabel,
      eintrag: info.eintrag,
      von: info.von,
      hint: bewertung.status === STATUS.BELEGT ? null : (info.hinweis ?? profil.nachweisarten[info.art]?.hinweis ?? null),
      note: bewertung.note,
      action: bewertung.action,
      reason: null,
      quellen: quellenFuer(profil, info.art, ziel.merkmale),
      belege,
      stelle: stelleVon(info),
      anmerkungen: anmerkungenZu(ziel.slot),
    })
  }

  for (const eintrag of ziele.entfaellt) {
    anforderungen.push({
      id: eintrag.id,
      status: STATUS.ENTFAELLT,
      fact: eintrag.titel,
      aussage: null,
      bereich: eintrag.bereich,
      person: eintrag.personLabel,
      eintrag: null,
      von: null,
      hint: null,
      note: null,
      action: null,
      reason: grundEntfaellt(eintrag),
      quellen: quellenFuer(profil, eintrag.art),
      belege: [],
      stelle: { pfad: [], slot: eintrag.id, art: eintrag.art },
      anmerkungen: [],
    })
  }

  // Set aside everywhere it was placed: then it has no place, and that is said with the reason.
  const verwendet = new Set([...anforderungen.flatMap(({ belege }) => belege), ...weitere].map(({ dokument }) => dokument))
  const ohnePlatz = new Map([...beiseite].filter(([dokument]) => !verwendet.has(dokument)))

  return {
    anforderungen,
    weitere,
    nichtZugeordnet: nichtZugeordnet({ plan, posten, dateien, dokumente, beiseite: ohnePlatz }),
    ablage: ablageVon({ ziele, plan, posten, dokumentVon }),
    zusammenfassung: zaehle(anforderungen, weitere),
  }
}

/**
 * Is the document in the name of someone else than the place is for: a person the application
 * does not name, or one it names, but not for this fact (the flatmate's contract at the rent of the
 * household)?
 */
const istFremd = (beleg: Fremdheit): boolean => Boolean(beleg.person && !beleg.personBekannt) || !beleg.nebenPasst

function fremdGrund(beleg: Fremdheit): string {
  return beleg.personAusserhalb
    ? `Die Unterlage lautet auf „${beleg.person}“. Diese Person nennt der Antrag, aber nicht zu dieser Angabe.`
    : `Die Unterlage lautet auf „${beleg.person}“. Diese Person kommt im Antrag nicht vor.`
}

/**
 * Where each document is filed in the application: one entry per document and place, in the order
 * of the places. A document that serves several facts (a bank statement for the rent and for an
 * income) is filed at each of them; one that has no place is not in the list.
 *
 * A document in the name of someone else than the place is for is in the list with `grund`: the
 * check placed it there, but the application is not to refer to it there.
 */
function ablageVon({
  ziele,
  plan,
  posten,
  dokumentVon,
}: {
  ziele: Zielableitung
  plan: Plan
  posten: Map<string, PostenInfo>
  dokumentVon: Map<string, DokumentInfo>
}): AblageEintrag[] {
  const ablage: AblageEintrag[] = []
  for (const ziel of ziele.ziele) {
    const info = ziele.infos.get(ziel.slot)
    if (!info) throw new Error(`Kein Ziel zum Platz ${ziel.slot}.`)
    for (const itemName of plan.bySlot[ziel.slot] ?? []) {
      const id = posten.get(itemName)?.dokument
      const dokument = id === undefined ? undefined : dokumentVon.get(id)
      if (id === undefined || !dokument || ablage.some((eintrag) => eintrag.dokument === id && eintrag.slot === ziel.slot)) continue

      const beleg = {
        person: dokument.person,
        personBekannt: dokument.personTreffer.bekannt,
        personAusserhalb: dokument.personTreffer.neben !== null && dokument.personTreffer.neben !== undefined,
        nebenPasst: !dokument.personTreffer.neben || ziel.merkmale?.nebenperson === dokument.personTreffer.neben,
      }
      ablage.push({
        dokument: id,
        slot: ziel.slot,
        bezeichnung: ziel.label,
        benannt: info.benannt,
        ort: info.ort,
        ...(istFremd(beleg) ? { grund: fremdGrund(beleg) } : {}),
      })
    }
  }
  return ablage
}

const STAERKE: Partial<Record<BelegRolle, number>> = { [ROLLE.GENUEGT]: 3, [ROLLE.PRUEFEN]: 2, [ROLLE.ERGAENZT]: 1 }
const staerke = (rolle: BelegRolle): number => STAERKE[rolle] ?? 0

function belegVon(dokument: DokumentInfo, rolle: BelegRolle, dateien: Dateinamen): BelegBasis {
  return {
    dokument: dokument.id,
    typ: dokument.typ,
    typLabel: dokument.typLabel,
    rolle,
    dateien: seitenJeDatei(dokument.seiten).map(({ fileId, seiten }) => ({
      fileId,
      name: dateien.get(fileId)?.name ?? fileId,
      seiten,
      seitenText: seitenText(seiten),
    })),
    person: dokument.person,
    personIndex: dokument.personTreffer.index,
    personBekannt: dokument.personTreffer.bekannt,
    personAusserhalb: dokument.personTreffer.neben !== null && dokument.personTreffer.neben !== undefined,
    monate: dokument.monate,
    vertrauen: dokument.vertrauen,
  }
}

function stelleVon(info: ZielInfo): Fundstelle {
  return {
    slot: info.slot,
    stelle: info.stelle,
    art: info.art,
    pfad: info.pfad,
    eintrag: info.eintrag,
    von: info.von,
    // The place in an application of the OneProof Format, as a JSON Pointer (`oneproof/zugang.ts`).
    ...('stelle' in info.ort && typeof info.ort.stelle === 'string' ? { zeiger: info.ort.stelle } : {}),
  }
}

/**
 * What is accepted for a statement — for this entry: a row of pensions lists the pension notice,
 * not the payslip. The features of the entry decide, as in the placement: only what both sides
 * know restricts.
 */
function quellenFuer(profil: Profil, art: string, zielMerkmale: Merkmale = {}): AkzeptierteQuelle[] {
  return (profil.quellenJeArt.get(art) ?? [])
    .filter(({ merkmale }) => passtZuMerkmalen(merkmale ?? {}, zielMerkmale))
    .map(({ typ, label, rolle, genau }) => ({ typ, label, rolle, genau }))
}

function passtZuMerkmalen(merkmale: Merkmale, zielMerkmale: Merkmale): boolean {
  return Object.entries(merkmale).every(([name, wert]) => {
    if (!Object.hasOwn(zielMerkmale, name)) return true
    const erlaubt = Array.isArray(wert) ? wert : [wert]
    const ziel = zielMerkmale[name]
    const verlangt = Array.isArray(ziel) ? ziel : [ziel]
    return erlaubt.some((kandidat) => verlangt.includes(kandidat))
  })
}

/** "Im Antrag haben Sie die Frage „…“ mit „Nein“ beantwortet. …" — for one or several questions. */
function grundEntfaellt(eintrag: Entfaellt): string {
  const antworten = eintrag.antworten?.length ? eintrag.antworten : [{ frage: eintrag.frage, antwort: eintrag.antwort }]
  const ohnePunkt = (text: string): string => String(text).replace(/\.$/, '')

  const [einzige] = antworten
  if (einzige && antworten.length === 1) {
    return `Im Antrag haben Sie die Frage „${einzige.frage}“ mit „${ohnePunkt(einzige.antwort)}“ beantwortet. Deshalb ist hier kein Nachweis nötig.`
  }
  const teile = antworten.map(({ frage, antwort }) => `„${frage}“ mit „${ohnePunkt(antwort)}“`)
  return `Im Antrag haben Sie die Fragen ${teile.slice(0, -1).join(', ')} und ${teile.at(-1)} beantwortet. Deshalb ist hier kein Nachweis nötig.`
}

/* ---------------------------------------------------------------------------------------------
 * The status of one requirement
 * ------------------------------------------------------------------------------------------- */

function bewerte(info: ZielInfo, belege: Beleg[], profil: Profil, stichtag: Date, auchMoeglich: AuchMoeglich[] = []): Bewertung {
  const art = profil.nachweisarten[info.art]

  if (belege.length === 0) {
    const [erste] = auchMoeglich
    if (erste) {
      const { typLabel, bei } = erste
      const wo = bei ? `„${bei.titel}${bei.personLabel ? ` · ${bei.personLabel}` : ''}“` : 'einer anderen Angabe'
      return {
        status: STATUS.UNKLAR,
        note: `„${typLabel}“ passt auch zu dieser Angabe und steht vorläufig bei ${wo}. Bitte prüfen Sie, zu welcher Angabe die Unterlage gehört.`,
        action: 'Zuordnung prüfen',
      }
    }
    if (info.spaeter) {
      return {
        status: STATUS.UNKLAR,
        note: `Im Antrag ist die Frage „${info.frage}“ noch offen („später nachreichen“). Sobald Sie sie beantwortet haben, zeigt sich, ob hier ein Nachweis nötig ist.`,
        action: 'Frage im Antrag beantworten',
      }
    }
    return { status: STATUS.OFFEN, note: null, action: 'Nachweis hinzufügen' }
  }

  // A document in the name of someone else: unknown to the application, or named in it, but not
  // for this fact (the flatmate's contract at the rent of the household).
  const fremd = istFremd
  const genuegen = belege.filter((beleg) => beleg.rolle === ROLLE.GENUEGT)
  const sicher = genuegen.filter((beleg) => !fremd(beleg) && !(beleg.gleichAuf !== null && beleg.gleichAuf > 1))
  const pruefen = belege.filter((beleg) => beleg.rolle === ROLLE.PRUEFEN && !fremd(beleg))

  if (sicher.length > 0) {
    const abdeckung = abdeckungPruefen(art?.abdeckung, sicher, stichtag)
    if (abdeckung !== null) return { status: STATUS.UNKLAR, note: abdeckung.note, action: abdeckung.action }
    return { status: STATUS.BELEGT, note: null, action: null }
  }

  const [fremderBeleg] = genuegen.filter(fremd)
  if (fremderBeleg) {
    return {
      status: STATUS.UNKLAR,
      note: fremderBeleg.personAusserhalb
        ? `Die Unterlage lautet auf „${fremderBeleg.person}“. Diese Person nennt der Antrag, aber nicht zu dieser Angabe. Bitte prüfen Sie, ob es die richtige Unterlage ist.`
        : `Die Unterlage lautet auf „${fremderBeleg.person}“. Diese Person kommt im Antrag nicht vor. Bitte prüfen Sie, ob es die richtige Unterlage ist.`,
      action: 'Unterlage prüfen oder ersetzen',
    }
  }

  const [gleichAufBeleg] = genuegen.filter((beleg) => beleg.gleichAuf !== null && beleg.gleichAuf > 1)
  if (gleichAufBeleg) {
    const warum = gleichAufBeleg.person ? '' : ' Auf der Unterlage ist keine Person des Antrags erkennbar.'
    return {
      status: STATUS.UNKLAR,
      note: `„${gleichAufBeleg.typLabel}“ passt zu ${gleichAufBeleg.gleichAuf} Angaben im Antrag gleich gut und steht vorläufig hier.${warum} Bitte prüfen Sie, zu welcher Angabe die Unterlage gehört.`,
      action: 'Zuordnung prüfen',
    }
  }

  if (pruefen.length > 0) {
    const namen = [...new Set(pruefen.map((beleg) => beleg.typLabel))].join(', ')
    return {
      status: STATUS.UNKLAR,
      note: `„${namen}“ kann die Angabe belegen, wenn der Inhalt dazu passt. Das lässt sich nicht automatisch feststellen. Bitte prüfen Sie es.`,
      action: 'Unterlage prüfen',
    }
  }

  const namen = [...new Set(belege.map((beleg) => beleg.typLabel))].join(', ')
  return {
    status: STATUS.OFFEN,
    note: `Es liegen nur ergänzende Unterlagen vor („${namen}“). Ein ausreichender Nachweis fehlt noch.`,
    action: 'Nachweis hinzufügen',
  }
}

/** `MM.JJJJ` → a running month number, for distances in months. */
const monatsnummer = (monat: string): number | null => {
  const [mm, jjjj] = String(monat).split('.').map(Number)
  return mm !== undefined && jjjj !== undefined && Number.isInteger(mm) && Number.isInteger(jjjj) ? jjjj * 12 + (mm - 1) : null
}

/**
 * Does the profile ask for a period, and is it covered? Returns why it is not, or null.
 *
 * Only documents that prove ONE month each (a payslip) are counted; a document that certifies a
 * period on its own (a certificate of earnings, a tax assessment, a notice of a benefit) settles
 * it. Where the profile limits the age (`hoechstensAlt`, in months before the reference day), an
 * older month does not count: three payslips from 2019 say nothing about the income today.
 */
function abdeckungPruefen(abdeckung: Abdeckung | undefined, genuegende: Beleg[], stichtag: Date): { note: string; action: string } | null {
  if (!abdeckung || abdeckung.einheit !== 'monat') return null

  const einzelne = genuegende.filter((beleg) => abdeckung.fuer.includes(beleg.typ))
  if (einzelne.length < genuegende.length) return null

  const grenze = abdeckung.hoechstensAlt !== undefined && Number.isInteger(abdeckung.hoechstensAlt)
    ? stichtag.getFullYear() * 12 + stichtag.getMonth() - abdeckung.hoechstensAlt
    : null

  const erkannt = new Set<string>()
  const zuAlt = new Set<string>()
  for (const monat of einzelne.flatMap((beleg) => beleg.monate)) {
    const nummer = monatsnummer(monat)
    if (grenze !== null && nummer !== null && nummer < grenze) zuAlt.add(monat)
    else erkannt.add(monat)
  }
  // A payslip whose month could not be read still counts once.
  const ohneMonat = einzelne.filter((beleg) => beleg.monate.length === 0).length
  const vorhanden = erkannt.size + ohneMonat

  if (vorhanden >= abdeckung.mindestens) return null

  const fehlt = abdeckung.mindestens - vorhanden
  const ab = stichtag.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const alt =
    zuAlt.size === 0
      ? ''
      : ` ${zuAlt.size === 1 ? 'Eine Abrechnung ist' : `${zuAlt.size} Abrechnungen sind`} älter als ${abdeckung.hoechstensAlt} Monate (${[...zuAlt].sort((a, b) => (monatsnummer(a) ?? 0) - (monatsnummer(b) ?? 0)).join(', ')}), gerechnet ab dem ${ab}, und ${zuAlt.size === 1 ? 'zählt' : 'zählen'} nicht.`
  return {
    note: `${vorhanden} von ${abdeckung.mindestens} Monaten liegen vor. Es ${fehlt === 1 ? 'fehlt' : 'fehlen'} noch ${fehlt === 1 ? 'ein Monat' : `${fehlt} Monate`}.${alt}`,
    action: zuAlt.size > 0 ? 'Aktuelle Abrechnungen hinzufügen' : 'Weitere Abrechnungen hinzufügen',
  }
}

/* ---------------------------------------------------------------------------------------------
 * Remarks, balance, summary
 * ------------------------------------------------------------------------------------------- */

function anmerkung({ kind, placedArt, art }: Adjustment): string | null {
  switch (kind) {
    case ADJUSTMENT.FIRST_OF_SEVERAL:
      return 'Die Unterlage passt zu mehreren Stellen im Antrag gleich gut und wurde der ersten zugeordnet.'
    case ADJUSTMENT.COARSER_ART:
      return placedArt === art
        ? null
        : 'Für diese Unterlage nennt der Antrag keine genauere Stelle. Sie steht beim übergeordneten Nachweis und ergänzt ihn nur.'
    default:
      return null
  }
}

/**
 * Documents with no place at all, and why. `beiseite`: documents the check placed, but set aside
 * everywhere, as in the name of someone else — with the reason.
 */
function nichtZugeordnet({
  plan,
  posten,
  dateien,
  dokumente,
  beiseite = new Map(),
}: {
  plan: Plan
  posten: Map<string, PostenInfo>
  dateien: Dateinamen
  dokumente: DokumentInfo[]
  beiseite?: Map<string, string>
}): NichtZugeordnet[] {
  const platziert = new Set<string | undefined>()
  for (const namen of Object.values(plan.bySlot)) {
    for (const itemName of namen) platziert.add(posten.get(itemName)?.dokument)
  }

  const dokumentVon = new Map(dokumente.map((dokument) => [dokument.id, dokument]))
  const grund = new Map<string, string>()
  for (const abgelehnt of plan.rejections) {
    const id = posten.get(abgelehnt.name)?.dokument
    if (!id || platziert.has(id)) continue

    const dokument = dokumentVon.get(id)
    if (abgelehnt.reason === REJECTION.UNCLASSIFIED) {
      grund.set(id, 'Für diesen Antrag ist kein Nachweis dieser Art vorgesehen.')
    } else if (dokument?.personTreffer.neben) {
      grund.set(
        id,
        `Die Unterlage lautet auf „${dokument.person}“. Diese Person nennt der Antrag, sie gehört aber nicht zum Haushalt, und zu ihr gibt es keine passende Angabe.`,
      )
    } else {
      grund.set(id, 'Der Antrag nennt dazu keine passende Stelle, zum Beispiel keine Angabe dieser Art für diese Person.')
    }
  }

  const liste: NichtZugeordnet[] = []
  for (const dokument of dokumente) {
    const begruendung = grund.get(dokument.id)
    const beiseitegestellt = beiseite.get(dokument.id)
    if (dokument.nichtZugeordnet) {
      liste.push({
        ...belegVon(dokument, 'keine', dateien),
        typLabel: 'Nicht erkannt',
        grund: 'Diese Seiten konnten keinem Dokument zugeordnet werden.',
      })
    } else if (begruendung !== undefined) {
      liste.push({ ...belegVon(dokument, 'keine', dateien), grund: begruendung })
    } else if (beiseitegestellt !== undefined) {
      liste.push({ ...belegVon(dokument, 'keine', dateien), grund: beiseitegestellt })
    }
  }

  return liste
}

function zaehle(anforderungen: Anforderung[], weitere: WeitererBeleg[]): Zusammenfassung {
  const zaehler: Record<Status, number> = { belegt: 0, offen: 0, unklar: 0, entfaellt: 0 }
  for (const anforderung of anforderungen) zaehler[anforderung.status]++
  return { ...zaehler, gesamt: anforderungen.length, weitere: weitere.length }
}
