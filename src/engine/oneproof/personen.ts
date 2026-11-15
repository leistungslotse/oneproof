/**
 * The persons of an application in the OneProof Format.
 *
 * The frame keeps them in one list, `personen`, each with an id and a role; exactly one is the
 * applicant. Everything else refers to a person by her id: an entry about a person names her with
 * `person`. The engine counts the persons of an application as it does for FIM — the applicant
 * first (0), then the others in the order of the file.
 */

import { istObjekt } from '../json.ts'
import { mitgliedVon, zerlege } from './zeiger.ts'

export const ANTRAGSTELLER = 'antragsteller'

/** A person of the application as the engine counts her. `id` and `rolle` are as the file gives them. */
export interface Haushaltsmitglied {
  id: unknown
  rolle: unknown
  /** The number of the engine: the applicant is 0. */
  index: number
  /** The position in `personen`. */
  quelle: number
  person: unknown
}

/** The persons in the order of the engine: the applicant first. */
export function haushalt(daten: unknown): Haushaltsmitglied[] {
  const roh: unknown = istObjekt(daten) ? daten.personen : undefined
  const personen = (Array.isArray(roh) ? roh : []).map((person: unknown, quelle) => ({ person, quelle }))
  const erste = personen.filter(({ person }) => mitgliedVon(person, 'rolle') === ANTRAGSTELLER)
  const uebrige = personen.filter(({ person }) => mitgliedVon(person, 'rolle') !== ANTRAGSTELLER)
  return [...erste, ...uebrige].map(({ person, quelle }, index) => ({ id: mitgliedVon(person, 'id'), rolle: mitgliedVon(person, 'rolle'), index, quelle, person }))
}

/**
 * The id of the person a place of the file belongs to, or `null` for a place of nobody (the
 * household, the dwelling). A place under `personen` belongs to that person; elsewhere the nearest
 * entry on the way down that names one with `person` decides — the entry itself first.
 *
 * @param stelle   pointer or its parts
 */
export function personDerStelle(daten: unknown, stelle: string | string[]): string | null {
  const teile = Array.isArray(stelle) ? stelle : zerlege(stelle)
  if (!teile || teile.length === 0) return null
  if (teile[0] === 'personen' && teile.length >= 2) {
    const id = mitgliedVon(mitgliedVon(mitgliedVon(daten, 'personen'), Number(teile[1])), 'id')
    return typeof id === 'string' ? id : null
  }

  const kette: unknown[] = [daten]
  for (const teil of teile) {
    const hier = kette.at(-1)
    if (hier === null || typeof hier !== 'object') break
    kette.push(Array.isArray(hier) ? hier[Number(teil)] : mitgliedVon(hier, teil))
  }
  for (const knoten of kette.slice(1).reverse()) {
    if (istObjekt(knoten) && typeof knoten.person === 'string') return knoten.person
  }
  return null
}
