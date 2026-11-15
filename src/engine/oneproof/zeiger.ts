/**
 * JSON Pointers (RFC 6901) and the patterns a profile writes them as.
 *
 * A pointer names one value of an application in the OneProof Format: `/fachdaten/personen/1/einkommen`.
 * A pattern names the same place in every application: `/fachdaten/personen/*\/einkommen`, where `*`
 * stands for every entry of a list. The profile addresses its places with patterns; the check and
 * the package work with the pointers they lead to in one application.
 *
 * Nothing here knows a benefit.
 */

import { istObjekt } from '../json.ts'

/** Stands for every entry of a list in a pattern. */
export const JEDER = '*'

const entschluessele = (teil: string): string => teil.replace(/~1/g, '/').replace(/~0/g, '~')
const verschluessele = (teil: string | number): string => String(teil).replace(/~/g, '~0').replace(/\//g, '~1')

/** `/a/b~1c/0` → `['a', 'b/c', '0']`. The empty pointer is the whole document. */
export function zerlege(zeiger: unknown): string[] | null {
  if (zeiger === '') return []
  if (typeof zeiger !== 'string' || !zeiger.startsWith('/')) return null
  return zeiger.slice(1).split('/').map(entschluessele)
}

/** `['a', 'b/c', 0]` → `/a/b~1c/0`. */
export const zusammen = (teile: readonly (string | number)[]): string => teile.map((teil) => `/${verschluessele(teil)}`).join('')

/** Is the text a pointer or a pattern (and not, say, the id of a FIM field)? */
export const istZeiger = (text: unknown): text is string => typeof text === 'string' && text.startsWith('/')

const istIndex = (teil: string): boolean => /^(0|[1-9][0-9]*)$/.test(teil)

/**
 * The value a pointer leads to, or `undefined` if the document has none there.
 *
 * @param zeiger  pointer or its parts
 */
export function wertBei(daten: unknown, zeiger: string | string[]): unknown {
  const teile = Array.isArray(zeiger) ? zeiger : zerlege(zeiger)
  if (teile === null) return undefined
  let hier: unknown = daten
  for (const teil of teile) {
    if (Array.isArray(hier)) {
      if (!istIndex(teil) || Number(teil) >= hier.length) return undefined
      hier = hier[Number(teil)]
    } else if (istObjekt(hier) && Object.hasOwn(hier, teil)) {
      hier = hier[teil]
    } else {
      return undefined
    }
  }
  return hier
}

/**
 * `wert?.[schluessel]` for a value of which nothing is known: the member of an object or a list,
 * and nothing where the value is none of them. Unlike {@link wertBei} it reads inherited members and
 * takes the key as it is (`'01'` is not the index `1`).
 */
export const mitgliedVon = (wert: unknown, schluessel: string | number): unknown =>
  typeof wert === 'object' && wert !== null ? Reflect.get(wert, schluessel) : undefined

/** The pattern of a pointer: every list index becomes `*`. */
export function musterVon(zeiger: string, daten: unknown): string | null {
  const teile = zerlege(zeiger)
  if (teile === null) return null
  let hier: unknown = daten
  const muster = teile.map((teil) => {
    if (Array.isArray(hier)) {
      hier = hier[Number(teil)]
      return JEDER
    }
    hier = istObjekt(hier) ? hier[teil] : undefined
    return teil
  })
  return zusammen(muster)
}

/**
 * A place of a pattern in a document: `teile` are the concrete parts down to where the document goes;
 * `fehlt` are the parts of the pattern below that, empty where the whole pattern was found.
 */
export interface Treffer {
  teile: string[]
  fehlt: string[]
}

/**
 * Every place a pattern leads to in a document — and, where the document ends before the pattern
 * does, the place where it ends: a list without the entry, a section without the value.
 */
export function treffer(daten: unknown, muster: string): Treffer[] {
  const gesucht = zerlege(muster)
  if (gesucht === null) return []
  const gefunden: Treffer[] = []

  const laufe = (hier: unknown, tiefe: number, teile: string[]): void => {
    const teil = gesucht[tiefe]
    // The whole pattern is found (`tiefe` never runs past its end).
    if (teil === undefined) {
      gefunden.push({ teile, fehlt: [] })
      return
    }
    if (teil === JEDER) {
      if (Array.isArray(hier) && hier.length > 0) {
        hier.forEach((eintrag, index) => laufe(eintrag, tiefe + 1, [...teile, String(index)]))
      } else {
        gefunden.push({ teile, fehlt: gesucht.slice(tiefe) })
      }
      return
    }
    if (istObjekt(hier) && Object.hasOwn(hier, teil)) {
      laufe(hier[teil], tiefe + 1, [...teile, teil])
      return
    }
    gefunden.push({ teile, fehlt: gesucht.slice(tiefe) })
  }

  laufe(daten, 0, [])
  return gefunden
}

/**
 * A pattern bound to a place: every `*` the pattern shares with the place — as far as both run
 * the same way — takes the index of the place. `/fachdaten/personen/*\/einkommen/vorhanden` bound to
 * `/fachdaten/personen/1/einkommen/eintraege/0` is `/fachdaten/personen/1/einkommen/vorhanden`.
 * A `*` beyond the shared part stays: the pattern then names no single value, and the result is `null`.
 *
 * @param ort  the concrete parts of the place
 */
export function binde(muster: string, ort: readonly string[]): string[] | null {
  const teile = zerlege(muster)
  if (teile === null) return null
  const gebunden: string[] = []
  let gemeinsam = true
  for (const [index, teil] of teile.entries()) {
    const dort = ort[index]
    if (gemeinsam && dort !== undefined && (teil === dort || (teil === JEDER && istIndex(dort)))) {
      gebunden.push(dort)
      continue
    }
    gemeinsam = false
    if (teil === JEDER) return null
    gebunden.push(teil)
  }
  return gebunden
}

/** Does a pointer lie at or below another one? */
export const liegtUnter = (zeiger: string, oben: string): boolean => zeiger === oben || zeiger.startsWith(`${oben}/`)
