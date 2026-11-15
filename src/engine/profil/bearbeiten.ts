/**
 * Edits of a profile of format 2, as a department makes them: per condition of a place of an
 * application type (see `bedingungen.ts`).
 *
 * Every edit returns a new `profil.json` and leaves the one it got as it was. An edit that changes
 * nothing returns the very object it got, so that no draft is made of it. What the department sets
 * is decided: the condition is then „festgelegt“.
 */

import type { Schema } from '../fim/schema.ts'
import { unterscheidungenFuer } from '../fim/xdf.ts'
import { eintragVon, kurzform, signatur, STATUS } from './bedingungen.ts'
import type { AntragsartFormat2, Bedingung, ProfilFormat2, Status, StelleFormat2, Zeitraum } from './bedingungen.ts'
import { ProfilError } from './laden.ts'
import type { Rolle } from './laden.ts'

/** What `finde` looks for: a place by its id, or the place of a condition and the condition by its id. */
export interface Suche {
  stelleId?: string | null
  bedingungId?: string | null
}

/** What `finde` finds. */
export interface Fundstelle {
  antragsart: AntragsartFormat2
  stelle: StelleFormat2
  /** `null` where only a place was asked for. */
  bedingung: Bedingung | null
}

/** The application type of a schema, the place and the condition — in the profile handed in. */
export function finde(roh: ProfilFormat2, schema: string, suche: Suche & { bedingungId: string }): Fundstelle & { bedingung: Bedingung }
export function finde(roh: ProfilFormat2, schema: string, suche?: Suche): Fundstelle
export function finde(roh: ProfilFormat2, schema: string, { stelleId = null, bedingungId = null }: Suche = {}): Fundstelle {
  const antragsart = roh.antragsarten?.find((art) => art.schema === schema)
  if (!antragsart) throw new ProfilError(`Die Antragsart ${schema} gibt es im Profil nicht.`)
  const stelle = antragsart.stellen.find((kandidat) =>
    stelleId ? kandidat.id === stelleId : kandidat.bedingungen.some((bedingung) => bedingung.id === bedingungId),
  )
  if (!stelle) throw new ProfilError(`Die Stelle „${stelleId ?? bedingungId}“ gibt es in ${antragsart.name ?? schema} nicht.`)
  const bedingung = bedingungId ? (stelle.bedingungen.find((kandidat) => kandidat.id === bedingungId) ?? null) : null
  if (bedingungId && !bedingung) throw new ProfilError(`Die Bedingung „${bedingungId}“ gibt es nicht.`)
  return { antragsart, stelle, bedingung }
}

/** Changes a condition of a copy; the original if nothing changed. Whatever is set is decided. */
function aendereBedingung(
  roh: ProfilFormat2,
  schema: string,
  bedingungId: string,
  aenderung: (bedingung: Bedingung) => void,
  { festlegen = true }: { festlegen?: boolean } = {},
): ProfilFormat2 {
  const vorher = finde(roh, schema, { bedingungId }).bedingung
  const neu = structuredClone(roh)
  const { bedingung } = finde(neu, schema, { bedingungId })
  aenderung(bedingung)
  if (festlegen) bedingung.status = STATUS.FESTGELEGT
  return JSON.stringify(bedingung) === JSON.stringify(vorher) ? roh : neu
}

/** Changes a place of a copy; the original if nothing changed. */
function aendereStelle(
  roh: ProfilFormat2,
  schema: string,
  stelleId: string,
  aenderung: (stelle: StelleFormat2, antragsart: AntragsartFormat2) => void,
): ProfilFormat2 {
  const vorher = JSON.stringify(finde(roh, schema, { stelleId }).antragsart)
  const neu = structuredClone(roh)
  const { antragsart, stelle } = finde(neu, schema, { stelleId })
  aenderung(stelle, antragsart)
  return JSON.stringify(antragsart) === vorher ? roh : neu
}

/**
 * How a type counts for a condition: a role of `ROLLE`, or `null` — it does not count. What the
 * entry says besides (features, the coarser condition) stays.
 */
export function setzeRolle(roh: ProfilFormat2, schema: string, bedingungId: string, typ: string, rolle: Rolle | null): ProfilFormat2 {
  return aendereBedingung(roh, schema, bedingungId, (bedingung) => {
    bedingung.nachweise ??= {}
    if (rolle === null) delete bedingung.nachweise[typ]
    else bedingung.nachweise[typ] = kurzform({ ...eintragVon(bedingung.nachweise[typ]), rolle })
  })
}

/** The period the evidence must cover, or `null` for none. */
export function setzeZeitraum(roh: ProfilFormat2, schema: string, bedingungId: string, zeitraum: Zeitraum | null): ProfilFormat2 {
  return aendereBedingung(roh, schema, bedingungId, (bedingung) => {
    if (!zeitraum) {
      delete bedingung.zeitraum
      return
    }
    bedingung.zeitraum = {
      mindestens: zeitraum.mindestens,
      ...(Number.isInteger(zeitraum.hoechstensAlt) ? { hoechstensAlt: zeitraum.hoechstensAlt } : {}),
      fuer: [...new Set(zeitraum.fuer ?? [])],
      ...(zeitraum.beispiel ? { beispiel: true } : {}),
    }
  })
}

/** What the applicant reads while the evidence is missing. */
export function setzeHinweis(roh: ProfilFormat2, schema: string, bedingungId: string, text: string | null | undefined): ProfilFormat2 {
  return aendereBedingung(roh, schema, bedingungId, (bedingung) => {
    bedingung.hinweis = String(text ?? '')
  })
}

/** A proposal taken as it is. */
export const bestaetige = (roh: ProfilFormat2, schema: string, bedingungId: string): ProfilFormat2 =>
  aendereBedingung(roh, schema, bedingungId, () => {})

/** The condition as in the version the draft was made from. Nothing changes where that version has none. */
export function setzeZurueck(roh: ProfilFormat2, basisRoh: ProfilFormat2, schema: string, bedingungId: string): ProfilFormat2 {
  let basis: Bedingung
  try {
    basis = finde(basisRoh, schema, { bedingungId }).bedingung
  } catch {
    return roh
  }
  return aendereBedingung(
    roh,
    schema,
    bedingungId,
    (bedingung) => {
      for (const schluessel of Object.keys(bedingung)) Reflect.deleteProperty(bedingung, schluessel)
      Object.assign(bedingung, structuredClone(basis))
    },
    { festlegen: false },
  )
}

/**
 * Documents, period and text of another condition — of the same place, or of the place in another
 * application type. A link to a coarser condition holds only where that condition is there, too.
 */
export function uebernimmVon(
  roh: ProfilFormat2,
  schema: string,
  bedingungId: string,
  quelle: { schema: string; bedingungId: string },
): ProfilFormat2 {
  const { bedingung: vorlage } = finde(roh, quelle.schema, { bedingungId: quelle.bedingungId })
  const { antragsart } = finde(roh, schema, { bedingungId })
  const vorhanden = new Set(antragsart.stellen.flatMap((stelle) => stelle.bedingungen.map(({ id }) => id)))

  return aendereBedingung(roh, schema, bedingungId, (bedingung) => {
    bedingung.nachweise = {}
    for (const [typ, wert] of Object.entries(vorlage.nachweise ?? {})) {
      const eintrag = eintragVon(wert)
      if (eintrag.ersatzweise && !vorhanden.has(eintrag.ersatzweise.bedingung)) eintrag.ersatzweise = null
      bedingung.nachweise[typ] = kurzform(eintrag)
    }
    if (vorlage.zeitraum) bedingung.zeitraum = structuredClone(vorlage.zeitraum)
    else delete bedingung.zeitraum
    bedingung.hinweis = vorlage.hinweis ?? ''
  })
}

/**
 * One condition per answer of a question of the section, or per yes/no question (`je-frage`) — or
 * one for all (`''`). The new conditions start from what the place had and are proposals until
 * the department confirms them; one for all keeps a setting the conditions share, else the first.
 *
 * @param schemaObjekt   the schema of the application type
 * @param wert   an option of `unterscheidungenFuer`, or `''`
 */
export function unterscheide(roh: ProfilFormat2, schemaObjekt: Schema, stelleId: string, wert: string): ProfilFormat2 {
  const schema = schemaObjekt.schemaId
  return aendereStelle(roh, schema, stelleId, (stelle, antragsart) => {
    if ((stelle.unterscheiden ?? '') === wert) return
    const vorher = stelle.bedingungen
    const erste: Partial<Bedingung> = vorher[0] ?? { nachweise: {}, hinweis: '' }
    const grundlage = { nachweise: structuredClone(erste.nachweise ?? {}), ...(erste.zeitraum ? { zeitraum: structuredClone(erste.zeitraum) } : {}), hinweis: erste.hinweis ?? '' }

    if (wert === '') {
      const gleich = vorher.every((bedingung) => signatur(bedingung, { mitHinweis: true }) === signatur(erste, { mitHinweis: true }))
      const festgelegt = gleich && vorher.every((bedingung) => bedingung.status === STATUS.FESTGELEGT)
      delete stelle.unterscheiden
      stelle.bedingungen = [{ id: stelle.id, status: festgelegt ? STATUS.FESTGELEGT : STATUS.VORSCHLAG, ...grundlage }]
    } else {
      const option = unterscheidungenFuer(schemaObjekt, stelle.position).find((kandidat) => kandidat.wert === wert)
      if (!option) throw new ProfilError('Nach dieser Frage lässt sich die Stelle nicht unterscheiden.')
      stelle.unterscheiden = wert
      stelle.bedingungen = option.antworten.map((antwort) => ({
        id: `${stelle.id}:${antwort.code ?? antwort.wenn.feld}`,
        titel: antwort.titel,
        wenn: antwort.wenn,
        status: STATUS.VORSCHLAG,
        ...structuredClone(grundlage),
      }))
    }

    // Links to conditions that are gone point to the first new one.
    const neueErste = stelle.bedingungen[0]
    const neueIds = new Set(stelle.bedingungen.map(({ id }) => id))
    const weg = new Set(vorher.map(({ id }) => id).filter((id) => !neueIds.has(id)))
    for (const andere of antragsart.stellen) {
      for (const bedingung of andere.bedingungen) {
        for (const [typ, eintragWert] of Object.entries(bedingung.nachweise ?? {})) {
          const eintrag = eintragVon(eintragWert)
          if (eintrag.ersatzweise && weg.has(eintrag.ersatzweise.bedingung)) {
            // Cannot happen: one condition for all, or one per answer of a question `unterscheidungenFuer` offers, and that has several.
            if (!neueErste) throw new ProfilError('Eine Stelle braucht mindestens eine Bedingung.')
            bedingung.nachweise[typ] = kurzform({ ...eintrag, ersatzweise: { ...eintrag.ersatzweise, bedingung: neueErste.id } })
          }
        }
      }
    }
  })
}

/** The place asks for no evidence on purpose (`grund`), or again for evidence (`null`). */
export function setzeOhne(roh: ProfilFormat2, schema: string, stelleId: string, grund: string | null): ProfilFormat2 {
  return aendereStelle(roh, schema, stelleId, (stelle) => {
    if (grund) {
      stelle.ohne = String(grund).trim()
      return
    }
    delete stelle.ohne
    if (stelle.bedingungen.length === 0) stelle.bedingungen = [{ id: stelle.id, status: STATUS.OFFEN, nachweise: {}, hinweis: '' }]
  })
}

/* ---------------------------------------------------------------------------------------------
 * What a draft changes
 * ------------------------------------------------------------------------------------------- */

const STATUS_TEXT: Record<Status, string> = { festgelegt: 'Festgelegt', vorschlag: 'Vorschlag', offen: 'Offen' }

const zeitraumText = (zeitraum: Zeitraum | undefined): string =>
  zeitraum ? `${zeitraum.mindestens} ${zeitraum.mindestens === 1 ? 'Monat' : 'Monate'}` : 'keiner'

/** What `teileDerAenderung` reads of a condition. */
export type Bedingungsstand = Pick<Bedingung, 'status'> & Partial<Pick<Bedingung, 'nachweise' | 'zeitraum' | 'hinweis'>>

/** What changed at a condition, in short parts — empty if nothing did. */
export function teileDerAenderung(vorher: Bedingungsstand, jetzt: Bedingungsstand): string[] {
  const teile: string[] = []
  const typen = new Set([...Object.keys(vorher.nachweise ?? {}), ...Object.keys(jetzt.nachweise ?? {})])
  const anders = [...typen].filter((typ) => JSON.stringify(eintragVon(vorher.nachweise?.[typ])) !== JSON.stringify(eintragVon(jetzt.nachweise?.[typ]))).length
  if (anders > 0) teile.push(`${anders} ${anders === 1 ? 'Nachweisart' : 'Nachweisarten'} geändert`)
  if (JSON.stringify(vorher.zeitraum ?? null) !== JSON.stringify(jetzt.zeitraum ?? null)) {
    const gleicheMonate = vorher.zeitraum && jetzt.zeitraum && vorher.zeitraum.mindestens === jetzt.zeitraum.mindestens
    teile.push(gleicheMonate ? 'Zeitraum geändert' : `Zeitraum: ${zeitraumText(vorher.zeitraum)} → ${zeitraumText(jetzt.zeitraum)}`)
  }
  if ((vorher.hinweis ?? '').trim() !== (jetzt.hinweis ?? '').trim()) teile.push('Hinweistext geändert')
  if (vorher.status !== jetzt.status && teile.length === 0) teile.push(`als „${STATUS_TEXT[jetzt.status] ?? jetzt.status}“ übernommen`)
  return teile
}

/** One change of a draft against the version it was made from. */
export interface Aenderung {
  schema: string
  /** The name of the application type. */
  antragsart: string
  stelleId?: string
  /** The title of the place. */
  stelle?: string
  bedingungId?: string
  /** The title of the condition, where the place has several. */
  bedingung?: string | null
  /** What changed, in short parts. */
  teile: string[]
}

/**
 * Everything a draft changes against the version it was made from, per application type, place
 * and condition. A new application type is one change; so is a place told apart differently.
 */
export function aenderungen(basisRoh: ProfilFormat2 | null | undefined, roh: ProfilFormat2): Aenderung[] {
  const liste: Aenderung[] = []
  const basisArten = new Map((basisRoh?.antragsarten ?? []).map((art): [string, AntragsartFormat2] => [art.schema, art]))

  for (const antragsart of roh.antragsarten ?? []) {
    const wo = { schema: antragsart.schema, antragsart: antragsart.name ?? antragsart.schema }
    const basis = basisArten.get(antragsart.schema)
    if (!basis) {
      liste.push({ ...wo, teile: ['neu angelegt'] })
      continue
    }
    if (basis.version !== antragsart.version) liste.push({ ...wo, teile: [`Schema ${basis.version} → ${antragsart.version}`] })
    else if (JSON.stringify([basis.personen, basis.stichtag]) !== JSON.stringify([antragsart.personen, antragsart.stichtag])) {
      liste.push({ ...wo, teile: ['Anbindung geändert'] })
    }

    const basisStellen = new Map(basis.stellen.map((stelle): [string, StelleFormat2] => [stelle.id, stelle]))
    for (const stelle of antragsart.stellen) {
      const hier = { ...wo, stelleId: stelle.id, stelle: stelle.titel }
      const alt = basisStellen.get(stelle.id)
      if (!alt) {
        liste.push({ ...hier, teile: ['neue Stelle'] })
        continue
      }
      if (Boolean(alt.ohne) !== Boolean(stelle.ohne)) {
        liste.push({ ...hier, teile: [stelle.ohne ? 'bewusst ohne Nachweis' : 'verlangt wieder Nachweise'] })
        continue
      }
      if (stelle.ohne) continue
      if ((alt.unterscheiden ?? '') !== (stelle.unterscheiden ?? '')) {
        liste.push({ ...hier, teile: [stelle.unterscheiden ? `${stelle.bedingungen.length} Bedingungen statt ${alt.bedingungen.length}` : 'eine Bedingung für alle Antworten'] })
        continue
      }
      for (const bedingung of stelle.bedingungen) {
        const vorher = alt.bedingungen.find(({ id }) => id === bedingung.id)
        const teile = vorher ? teileDerAenderung(vorher, bedingung) : ['neue Bedingung']
        if (teile.length > 0) liste.push({ ...hier, bedingungId: bedingung.id, bedingung: stelle.bedingungen.length > 1 ? (bedingung.titel ?? null) : null, teile })
      }
    }
    for (const alt of basis.stellen) {
      if (!antragsart.stellen.some(({ id }) => id === alt.id)) liste.push({ ...wo, stelleId: alt.id, stelle: alt.titel, teile: ['Stelle entfällt'] })
    }
  }
  for (const basis of basisArten.values()) {
    if (!(roh.antragsarten ?? []).some(({ schema }) => schema === basis.schema)) {
      liste.push({ schema: basis.schema, antragsart: basis.name ?? basis.schema, teile: ['entfernt'] })
    }
  }
  return liste
}

/** The conditions a draft changes, as `schema|bedingung` — a place changed as a whole counts with all its conditions. */
export function geaenderteBedingungen(liste: Aenderung[], roh: ProfilFormat2): Set<string> {
  const ids = new Set<string>()
  for (const aenderung of liste) {
    if (!aenderung.stelleId) continue
    if (aenderung.bedingungId) {
      ids.add(`${aenderung.schema}|${aenderung.bedingungId}`)
      continue
    }
    const stelle = roh.antragsarten.find(({ schema }) => schema === aenderung.schema)?.stellen.find(({ id }) => id === aenderung.stelleId)
    for (const bedingung of stelle?.bedingungen ?? []) ids.add(`${aenderung.schema}|${bedingung.id}`)
  }
  return ids
}
