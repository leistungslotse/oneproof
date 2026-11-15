/**
 * The documents as items for the placement.
 *
 * This is the other half of the placement (the first are the targets, see `ziele.ts`). A grouped
 * document becomes one item per way it may be used: the profile says for every document type
 * where it counts as evidence and in which role. Most types have exactly one use; a bank
 * statement has several (it may show the rent, an income, an asset), and each of them is placed on
 * its own.
 *
 * The person on the document is resolved to a person of the application. A name that cannot be
 * resolved yields no person — the document then fits every person — but the doubt is kept for the
 * result: a document that names someone who does not appear in the application is not silently
 * taken for the applicant's.
 */

import { documentIdentity, pageKey } from '../gruppierung/dokument.ts'
import type { Document } from '../gruppierung/dokument.ts'
import { ROLLE } from '../profil/laden.ts'
import type { Merkmale, Profil, Rolle } from '../profil/laden.ts'
import { anzeigeName } from './personen.ts'
import type { PersonDirectory, PersonMatch } from './personen.ts'
import type { Item } from './platzierung.ts'

/** A page of an uploaded file. */
export interface Seite {
  fileId: string
  page: number
}

/** The pages of a document within one file. */
export interface DateiSeiten {
  fileId: string
  /** Page numbers in the order they were given. */
  seiten: number[]
}

/** The role of a use in the balance: the profile's, or `keine` for a type without any use. */
export type BelegRolle = Rolle | 'keine'

/** The billing month on a page, `MM.JJJJ`, or `null` where there is none. */
export type MonateJeSeite = (seite: Seite) => string | null

/** A grouped document as the result states it. */
export interface DokumentInfo {
  /** Short id within this check, `D1`, `D2`, … */
  id: string
  /** Identity across runs (type, person, pages). */
  identitaet: string
  /** Catalogue key. */
  typ: string
  /** Name of the type for display. */
  typLabel: string
  /** Name as it stands on the document. */
  person: string | null
  personTreffer: PersonMatch
  seiten: Seite[]
  /** Billing months found on the pages, `MM.JJJJ`. */
  monate: string[]
  /** 0–100 as reported by the grouping. */
  vertrauen: number | null
  /** The catch-all of pages nothing could be made of. */
  nichtZugeordnet: boolean
}

/** What an item of the placement stands for: one use of one document. */
export interface PostenInfo {
  /** Id of the document. */
  dokument: string
  /** Role of this use. */
  rolle: BelegRolle
  /** Role where it lands at the coarser art (default `ergaenzt`). */
  rolleGroeber?: Rolle
}

/** What {@link baueItems} needs. */
export interface BaueItemsEingabe {
  dokumente: Document[]
  profil: Profil
  verzeichnis: PersonDirectory
  monateJeSeite?: MonateJeSeite
  /** The application type: in profile format 2 only its uses count. */
  schemaId?: string | null
}

/** What {@link baueItems} makes of the documents. */
export interface BaueItemsErgebnis {
  items: Item[]
  /** Item name → the document and role it stands for. */
  posten: Map<string, PostenInfo>
  dokumente: DokumentInfo[]
}

export function baueItems({
  dokumente,
  profil,
  verzeichnis,
  monateJeSeite = () => null,
  schemaId = null,
}: BaueItemsEingabe): BaueItemsErgebnis {
  const items: Item[] = []
  const posten = new Map<string, PostenInfo>()
  const alleVerwendungen = schemaId && profil.verwendungenFuer ? profil.verwendungenFuer(schemaId) : profil.verwendungen

  const infos = dokumente.map((dokument, index) => {
    const typ = String(dokument.type ?? '')
    const katalog = profil.typen.get(typ)
    const name = String(dokument.person ?? '').trim()

    const info: DokumentInfo = {
      id: `D${index + 1}`,
      identitaet: documentIdentity(dokument),
      typ,
      typLabel: dokument.typeLabel || katalog?.label || dokument.label || typ,
      person: name === '' ? null : anzeigeName(name),
      personTreffer: verzeichnis.match(name),
      seiten: (dokument.pages ?? []).map(({ fileId, page }) => ({ fileId: String(fileId), page })),
      monate: monateDes(dokument, monateJeSeite),
      vertrauen: dokument.confidence ?? null,
      nichtZugeordnet: dokument.unassigned === true,
    }

    if (info.nichtZugeordnet) return info

    const verwendungen = alleVerwendungen.get(typ) ?? []

    // A type without any use is still handed over — as an item without an art — so that it shows
    // up in the balance with its reason instead of vanishing from the result.
    if (verwendungen.length === 0) {
      items.push({ name: info.id, art: null, person: info.personTreffer.index, merkmale: {}, bezeichnung: info.typLabel })
      posten.set(info.id, { dokument: info.id, rolle: 'keine' })
      return info
    }

    // A document in the name of someone the application names outside the household belongs to
    // that person's entry (see `nebenpersonMerkmal` in `ziele.ts`), never to a fact of the household.
    const neben: Merkmale = info.personTreffer.neben ? { nebenperson: info.personTreffer.neben } : {}

    for (const verwendung of verwendungen) {
      const itemName = `${info.id}>${verwendung.art}`
      items.push({
        name: itemName,
        art: verwendung.art,
        person: info.personTreffer.index,
        merkmale: { ...(verwendung.merkmale ?? {}), ...neben },
        coarserArt: verwendung.groebere ?? null,
        bezeichnung: info.typLabel,
      })
      posten.set(itemName, {
        dokument: info.id,
        rolle: verwendung.rolle,
        rolleGroeber: verwendung.rolleGroeber ?? ROLLE.ERGAENZT,
      })
    }

    return info
  })

  return { items, posten, dokumente: infos }
}

/** Billing months named on the pages of a document, in order of appearance. */
function monateDes(dokument: Document, monateJeSeite: MonateJeSeite): string[] {
  const gefunden: string[] = []
  for (const seite of dokument.pages ?? []) {
    const monat = monateJeSeite({ fileId: String(seite.fileId), page: seite.page })
    if (monat !== null && monat !== undefined && !gefunden.includes(monat)) gefunden.push(monat)
  }
  return gefunden
}

/**
 * "Seite 3", "Seiten 1–3, 5".
 */
export function seitenText(seiten: number[]): string {
  const sortiert = [...new Set(seiten)].sort((a, b) => a - b)
  if (sortiert.length === 0) return ''

  const bereiche: [number, number][] = []
  for (const seite of sortiert) {
    const letzter = bereiche.at(-1)
    if (letzter && seite === letzter[1] + 1) letzter[1] = seite
    else bereiche.push([seite, seite])
  }

  const text = bereiche.map(([von, bis]) => (von === bis ? String(von) : `${von}–${bis}`)).join(', ')
  return `${sortiert.length === 1 ? 'Seite' : 'Seiten'} ${text}`
}

/** The pages of a document grouped by file: `[{fileId, seiten: [1, 2]}]`. */
export function seitenJeDatei(seiten: Seite[]): DateiSeiten[] {
  const jeDatei = new Map<string, number[]>()
  for (const { fileId, page } of seiten) jeDatei.set(fileId, [...(jeDatei.get(fileId) ?? []), page])
  return [...jeDatei].map(([fileId, nummern]) => ({ fileId, seiten: nummern }))
}

export { pageKey }
