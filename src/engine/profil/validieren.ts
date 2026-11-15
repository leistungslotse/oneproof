/**
 * Consistency check of a loaded profile against the schemas and the document catalogue it refers
 * to. A profile is edited by people, not by compilers; this is the compiler.
 *
 * Errors make the profile unusable (a position that does not exist, a role nobody knows).
 * Warnings point at something that is probably unintended but harmless (a field id that is in no
 * schema of the profile, a document type that is no longer in the catalogue, a code a question
 * does not have, a file field of a schema that no place of the profile takes and that is not
 * listed as knowingly open).
 *
 * A profile of format 2 is checked per application type: its places, their conditions and the
 * binding of persons and date against its own schema.
 */

import { meldungVon } from '../fehler.ts'
import { fileFields, indexById, positionKey } from '../fim/schema.ts'
import type { Schema, SchemaNode } from '../fim/schema.ts'
import { knotenNachId } from '../oneproof/schema.ts'
import { JEDE_ANTWORT, PLATZHALTER } from '../zuordnung/ziele.ts'
import { eintragVon, knotenIm, STATUS } from './bedingungen.ts'
import type { Zeitraum } from './bedingungen.ts'
import { formatVon, ROLLEN } from './laden.ts'
import type { Antragsart, Antragsformat, Frage, Nennt, Profil, StelleFormat1, WerteAbbildungen } from './laden.ts'

/** What the check finds: errors make the profile unusable, warnings point at something probably unintended. */
export interface Validierung {
  fehler: string[]
  warnungen: string[]
}

/**
 * A loaded profile as the check takes it. The check also reads `werteAbbildungen` — the mappings of
 * code lists of older versions, as `profil.json` has them at its head. A loaded profile carries them
 * in `roh`; a profile put together by hand may have them of its own.
 */
export type ZuPruefendesProfil = Profil & { werteAbbildungen?: WerteAbbildungen }

/** An application type of the profile with its schema and what the check needs to know of it. */
interface SchemaEintrag {
  art: Antragsart
  schema: Schema
  format: Antragsformat
  /** The places of evidence of the schema. */
  positionen: Set<string>
  /** The nodes of the schema by id, as `indexById` gives them. */
  ids: Map<string, SchemaNode[][]>
}

/** What the checks of a place report to and look things up in. */
interface PruefKontext extends Validierung {
  kenntId: (id: string) => boolean
  knotenVon: (id: string) => SchemaNode | null
  profil: Profil
}

const istGanzeZahlAb1 = (wert: unknown): boolean => typeof wert === 'number' && Number.isInteger(wert) && wert >= 1

/** The questions of a place as a list (`nennt` may be one question or several). */
const fragenVon = (nennt: Nennt | undefined): Frage[] => (!nennt || nennt === 'immer' ? [] : Array.isArray(nennt) ? nennt : [nennt])

export async function validiereProfil(profil: ZuPruefendesProfil): Promise<Validierung> {
  const fehler: string[] = []
  const warnungen: string[] = []

  const schemata: SchemaEintrag[] = []
  for (const art of profil.antragsarten) {
    let schema: Schema | null = null
    try {
      schema = await profil.ladeSchema(art.schema)
    } catch (grund) {
      fehler.push(`Antragsart ${art.schema}: das Schema lässt sich nicht lesen (${meldungVon(grund)}).`)
      continue
    }
    if (!schema) {
      fehler.push(`Antragsart ${art.schema}: Schemadatei fehlt.`)
      continue
    }
    // An application is read against the schema in `datei` and must name the same benefit and version.
    if (formatVon(art) === 'oneproof' && (schema.schemaId !== art.schema || schema.version !== art.version)) {
      fehler.push(`Antragsart ${art.schema}: „${art.datei}“ ist das Schema „${schema.schemaId}“ in Version ${schema.version}, die Antragsart nennt „${art.schema}“ in Version ${art.version}.`)
    }
    schemata.push({ art, schema, format: formatVon(art), ...orteVon(art, schema) })
  }

  const kenntId = (id: string): boolean => schemata.some(({ ids }) => ids.has(id))
  const knotenVon = (id: string): SchemaNode | null => schemata.map(({ ids }) => knotenIm(ids, id)).find(Boolean) ?? null

  if (profil.format === 2) {
    for (const eintrag of schemata) pruefeAntragsart(eintrag, profil, { fehler, warnungen })
  } else {
    pruefeFormat1(profil, schemata, { kenntId, knotenVon, fehler, warnungen })
  }
  pruefeVersionen(profil, schemata, { kenntId, knotenVon, fehler, warnungen })
  pruefeKatalog(profil, warnungen)

  return { fehler, warnungen }
}

/** Keys an older catalogue carried to say which statement of one benefit a type proves. */
const PROFILANGABEN_IM_KATALOG = ['fim', 'fim_merkmale', 'fim_fallback']

/**
 * The catalogue describes documents and serves every benefit alike. Which statement a type proves
 * is the profile's to say; a catalogue that still says it is not read for it.
 */
function pruefeKatalog(profil: Profil, warnungen: string[]): void {
  const betroffen = [...profil.typen]
    .filter(([, eintrag]) => PROFILANGABEN_IM_KATALOG.some((schluessel) => Object.hasOwn(eintrag, schluessel)))
    .map(([typ]) => typ)
  if (betroffen.length === 0) return
  const wo = betroffen.length === 1 ? `beim Dokumenttyp „${betroffen[0]}“` : `bei ${betroffen.length} Dokumenttypen (etwa ${betroffen.slice(0, 3).map((typ) => `„${typ}“`).join(', ')})`
  warnungen.push(
    `Der Katalog nennt ${wo} eine Nachweisart (fim, fim_merkmale, fim_fallback). ` +
      'Die Engine wertet das nicht aus: Welche Angabe ein Typ belegt, sagt allein das Profil.',
  )
}

/**
 * The places of evidence of a schema and its nodes by id (as `indexById` gives them): the file
 * fields for FIM, every value under `personen` and `fachdaten` for the OneProof Format, which
 * names places by pattern.
 */
function orteVon(art: Antragsart, schema: Schema): Pick<SchemaEintrag, 'positionen' | 'ids'> {
  if (formatVon(art) !== 'oneproof') {
    return { positionen: new Set(fileFields(schema).map(({ path }) => positionKey(path))), ids: indexById(schema) }
  }
  const knoten = knotenNachId(schema)
  return {
    positionen: new Set([...knoten.keys()].filter((id) => /^\/(personen|fachdaten)\//.test(id))),
    ids: new Map([...knoten].map(([id, eintrag]): [string, SchemaNode[][]] => [id, [[eintrag]]])),
  }
}

/** The codes of a question that it does not have: a typo — "04" where the list says "004". */
function pruefeCodes(frage: Frage, knoten: SchemaNode, wo: string, warnungen: string[]): void {
  const bekannt = knoten.typ === 'bool' ? ['true', 'false'] : Object.keys(knoten.werte ?? {})
  for (const klasse of ['ja', 'nein', 'spaeter'] satisfies ('ja' | 'nein' | 'spaeter')[]) {
    for (const code of frage[klasse] ?? []) {
      if (klasse === 'ja' && code === JEDE_ANTWORT) continue
      const andereForm = knoten.typ === 'bool' && /^\d{3}$/.test(code) // the code of an older version
      if (bekannt.length > 0 && !bekannt.includes(code) && !andereForm) {
        warnungen.push(`${wo}: die Frage „${frage.feld}“ kennt den Wert „${code}“ aus „${klasse}“ nicht.`)
      }
    }
  }
}

/** How the engine reads a place: its questions, the sentence it shows and the features of an entry. */
function pruefeLesart(
  stelle: Pick<StelleFormat1, 'nennt' | 'aussage' | 'merkmale'>,
  wo: string,
  { kenntId, knotenVon, profil, fehler, warnungen }: PruefKontext,
): void {
  if (stelle.nennt && stelle.nennt !== 'immer' && (typeof stelle.nennt !== 'object' || fragenVon(stelle.nennt).some((frage) => !frage?.feld))) {
    fehler.push(`${wo}: „nennt“ braucht ein Feld, eine Liste von Feldern oder den Wert „immer“.`)
  }

  for (const frage of fragenVon(stelle.nennt).filter((kandidat) => kandidat?.feld)) {
    const knoten = knotenVon(frage.feld)
    if (knoten) pruefeCodes(frage, knoten, wo, warnungen)
    else warnungen.push(`${wo}: das Feld „${frage.feld}“ aus „nennt“ steht in keinem Schema.`)
  }

  for (const [, id = ''] of String(stelle.aussage ?? '').matchAll(PLATZHALTER)) {
    if (!kenntId(id)) warnungen.push(`${wo}: der Platzhalter „${id}“ steht in keinem Schema.`)
  }

  for (const merkmal of stelle.merkmale ?? []) {
    if ('wert' in merkmal) continue
    if (!kenntId(merkmal.feld)) warnungen.push(`${wo}: das Merkmalsfeld „${merkmal.feld}“ steht in keinem Schema.`)
    if (merkmal.tabelle && !profil.wertetabellen[merkmal.tabelle]) {
      fehler.push(`${wo}: die Wertetabelle „${merkmal.tabelle}“ gibt es nicht.`)
    }
  }
}

/** Format 2: one application type against its own schema. */
function pruefeAntragsart(
  { art: antragsart, format, positionen, ids }: SchemaEintrag,
  profil: Profil,
  { fehler, warnungen }: Validierung,
): void {
  const name = antragsart.name ?? antragsart.schema
  const kenntId = (id: string): boolean => ids.has(id)
  const knotenVon = (id: string): SchemaNode | null => knotenIm(ids, id)
  const kontext: PruefKontext = { kenntId, knotenVon, profil, fehler, warnungen }

  const stellen = Array.isArray(antragsart.stellen) ? antragsart.stellen : []
  if (!Array.isArray(antragsart.stellen)) fehler.push(`${name}: die Antragsart hat keine Liste „stellen“.`)

  // Conditions refer to each other by id (`ersatzweise`), within the application type.
  const alleBedingungen = new Set(stellen.flatMap((stelle) => stelle.bedingungen ?? []).map((bedingung) => bedingung.id))
  const stellenIds = new Set<string>()
  const bedingungIds = new Set<string>()
  const verankert = new Set<string>()

  for (const stelle of stellen) {
    const wo = `${name} › ${stelle.titel || stelle.id}`
    if (stellenIds.has(stelle.id)) fehler.push(`${wo}: die ID „${stelle.id}“ kommt mehrfach vor.`)
    stellenIds.add(stelle.id)
    if (!positionen.has(stelle.position)) fehler.push(`${wo}: die Position „${stelle.position}“ gibt es im Schema nicht.`)
    verankert.add(stelle.position)

    if (stelle.ohne !== undefined) {
      if (typeof stelle.ohne !== 'string' || stelle.ohne.trim() === '') fehler.push(`${wo}: „ohne“ braucht einen Grund.`)
      continue
    }
    if (!Array.isArray(stelle.bedingungen) || stelle.bedingungen.length === 0) {
      fehler.push(`${wo}: die Stelle hat keine Bedingung.`)
      continue
    }

    pruefeLesart(stelle, wo, kontext)

    for (const bedingung of stelle.bedingungen) {
      const hier = stelle.bedingungen.length > 1 ? `${wo} › ${bedingung.titel || bedingung.id}` : wo
      if (bedingungIds.has(bedingung.id)) fehler.push(`${hier}: die ID „${bedingung.id}“ kommt mehrfach vor.`)
      bedingungIds.add(bedingung.id)
      if (!Object.values(STATUS).includes(bedingung.status)) fehler.push(`${hier}: der Stand „${bedingung.status}“ ist unbekannt.`)

      if (stelle.unterscheiden) {
        const wenn = bedingung.wenn
        const knoten = wenn?.feld ? knotenVon(wenn.feld) : null
        if (wenn && knoten) pruefeCodes(wenn, knoten, hier, warnungen)
        else fehler.push(`${hier}: es fehlt die Frage, nach deren Antwort die Bedingung gilt.`)
      }

      for (const [typ, wert] of Object.entries(bedingung.nachweise ?? {})) {
        const { rolle, ersatzweise } = eintragVon(wert)
        if (!ROLLEN.has(rolle)) fehler.push(`${hier}: die Rolle „${rolle}“ von „${typ}“ ist unbekannt.`)
        if (!profil.typen.has(typ)) warnungen.push(`${hier}: der Dokumenttyp „${typ}“ steht nicht im Katalog.`)
        if (ersatzweise && !alleBedingungen.has(ersatzweise.bedingung)) {
          fehler.push(`${hier}: „${typ}“ verweist auf die Bedingung „${ersatzweise.bedingung}“, die es nicht gibt.`)
        }
        if (ersatzweise?.rolle && !ROLLEN.has(ersatzweise.rolle)) fehler.push(`${hier}: die Rolle „${ersatzweise.rolle}“ bei „${typ}“ ist unbekannt.`)
      }

      if (bedingung.zeitraum) pruefeZeitraum(bedingung.zeitraum, hier, { wer: 'der Zeitraum', wessen: 'des Zeitraums' }, kontext)
    }
  }

  // In FIM every file field asks for a place; in the OneProof Format any value may be one.
  if (format !== 'oneproof') {
    for (const position of positionen) {
      if (!verankert.has(position)) warnungen.push(`${name}: das Nachweisfeld „${position}“ hat keine Stelle.`)
    }
  } else {
    // An attachment of the package names its type by a code the schema lists (`paket.ts`).
    const dokumentarten = knotenVon('/anlagen/*/dokumentart')?.werte
    const fehlen = dokumentarten ? [...profil.typen.keys()].filter((typ) => !Object.hasOwn(dokumentarten, typ)) : []
    if (fehlen.length > 0) {
      warnungen.push(`${name}: das Schema kennt die Dokumentarten ${fehlen.map((typ) => `„${typ}“`).join(', ')} des Katalogs nicht. Anlagen dieser Typen stehen im Antragspaket ohne Dokumentart.`)
    }
  }

  for (const satz of Array.isArray(antragsart.antragslage) ? antragsart.antragslage : []) {
    for (const [, id = ''] of String(satz).matchAll(PLATZHALTER)) {
      if (!kenntId(id)) warnungen.push(`${name}: der Platzhalter „${id}“ der Antragslage steht nicht im Schema.`)
    }
  }

  const { personen, stichtag } = profil.anbindungFuer(antragsart.schema)
  for (const [rolle, person] of Object.entries(personen)) {
    if (!kenntId(person.gruppe)) fehler.push(`${name}: die Gruppe „${person.gruppe}“ der Person „${rolle}“ steht nicht im Schema.`)
    for (const id of [...(person.name?.pfad ?? []), person.name?.nachname, person.name?.vorname, person.name?.geburtsname].filter((kandidat): kandidat is string => Boolean(kandidat))) {
      if (!kenntId(id)) fehler.push(`${name}: „${id}“ aus dem Namen der Person „${rolle}“ steht nicht im Schema.`)
    }
  }
  if (stichtag && !kenntId(stichtag)) fehler.push(`${name}: das Feld „${stichtag}“ für den Stichtag steht nicht im Schema.`)
}

/**
 * A period of evidence: `abdeckung` of format 1, `zeitraum` of format 2.
 *
 * @param name  „die Abdeckung“ / „der Abdeckung“
 */
function pruefeZeitraum(
  zeitraum: Pick<Zeitraum, 'mindestens' | 'hoechstensAlt' | 'fuer'>,
  wo: string,
  { wer, wessen }: { wer: string; wessen: string },
  { profil, fehler, warnungen }: { profil: Profil } & Validierung,
): void {
  if (!istGanzeZahlAb1(zeitraum.mindestens)) fehler.push(`${wo}: „mindestens“ ${wessen} muss eine ganze Zahl ab 1 sein.`)
  if (zeitraum.hoechstensAlt !== undefined && !istGanzeZahlAb1(zeitraum.hoechstensAlt)) {
    fehler.push(`${wo}: „hoechstensAlt“ ${wessen} muss eine ganze Zahl ab 1 sein.`)
  }
  if (!Array.isArray(zeitraum.fuer)) {
    fehler.push(`${wo}: ${wer} braucht unter „fuer“ eine Liste von Dokumenttypen.`)
    return
  }
  for (const typ of zeitraum.fuer) {
    if (!profil.typen.has(typ)) warnungen.push(`${wo}: ${wer} nennt den unbekannten Dokumenttyp „${typ}“.`)
  }
}

/** Format 1: statements (`nachweisarten`) and places (`stellen`) across all application types. */
function pruefeFormat1(
  profil: Profil,
  schemata: SchemaEintrag[],
  { kenntId, knotenVon, fehler, warnungen }: Omit<PruefKontext, 'profil'>,
): void {
  const arten = new Set(Object.keys(profil.nachweisarten))

  // --- Stellen --------------------------------------------------------------------------------
  const gesehen = new Set<string>()
  for (const stelle of profil.stellen) {
    const wo = `Stelle „${stelle.id}“`

    if (gesehen.has(stelle.id)) fehler.push(`${wo}: die ID kommt mehrfach vor.`)
    gesehen.add(stelle.id)

    if (!arten.has(stelle.art)) fehler.push(`${wo}: die Nachweisart „${stelle.art}“ ist nicht unter „nachweisarten“ definiert.`)

    for (const position of stelle.positionen) {
      if (!schemata.some(({ positionen }) => positionen.has(position))) {
        fehler.push(`${wo}: die Position „${position}“ gibt es in keinem Schema des Profils.`)
      }
    }

    pruefeLesart(stelle, wo, { kenntId, knotenVon, profil, fehler, warnungen })

    // Per application type: where the place exists, at least one of its questions should, too —
    // otherwise only the existence of an entry decides there.
    const fragen = fragenVon(stelle.nennt).filter((frage) => frage?.feld)
    if (fragen.length > 0) {
      for (const { art, positionen, ids } of schemata) {
        const hatStelle = stelle.positionen.some((position) => positionen.has(position))
        if (hatStelle && !fragen.some((frage) => ids.has(frage.feld))) {
          warnungen.push(`${wo}: in ${art.schema} gibt es keine der Fragen aus „nennt“ (${fragen.map((frage) => frage.feld).join(', ')}).`)
        }
      }
    }

  }

  // --- Nachweisarten und Quellen --------------------------------------------------------------
  for (const [art, definition] of Object.entries(profil.nachweisarten)) {
    for (const [typ, angabe] of Object.entries(definition.quellen ?? {})) {
      const rolle = typeof angabe === 'string' ? angabe : angabe?.rolle
      if (!ROLLEN.has(rolle)) {
        fehler.push(`Nachweisart „${art}“, Quelle „${typ}“: die Rolle „${rolle}“ ist unbekannt.`)
      }
      if (!profil.typen.has(typ)) warnungen.push(`Nachweisart „${art}“: der Dokumenttyp „${typ}“ steht nicht im Katalog.`)

      const groebere = typeof angabe === 'object' ? angabe.groebere : null
      const groebereArt = typeof groebere === 'object' && groebere !== null ? groebere.art : groebere
      if (groebereArt && !arten.has(groebereArt)) fehler.push(`Nachweisart „${art}“, Quelle „${typ}“: die gröbere Art „${groebereArt}“ gibt es nicht.`)
      if (typeof groebere === 'object' && groebere?.rolle && !ROLLEN.has(groebere.rolle)) {
        fehler.push(`Nachweisart „${art}“, Quelle „${typ}“: die Rolle „${groebere.rolle}“ der gröberen Art ist unbekannt.`)
      }
    }

    const abdeckung = definition.abdeckung
    if (abdeckung) {
      if (abdeckung.einheit !== 'monat') fehler.push(`Nachweisart „${art}“: die Einheit „${abdeckung.einheit}“ der Abdeckung ist unbekannt, es gibt nur „monat“.`)
      pruefeZeitraum(abdeckung, `Nachweisart „${art}“`, { wer: 'die Abdeckung', wessen: 'der Abdeckung' }, { profil, fehler, warnungen })
    }
  }

  // --- Personen -------------------------------------------------------------------------------
  for (const [rolle, person] of Object.entries(profil.personen)) {
    if (!kenntId(person.gruppe)) fehler.push(`Person „${rolle}“: die Gruppe „${person.gruppe}“ steht in keinem Schema.`)
    for (const id of [...(person.name?.pfad ?? []), person.name?.nachname, person.name?.vorname, person.name?.geburtsname].filter((kandidat): kandidat is string => Boolean(kandidat))) {
      if (!kenntId(id)) fehler.push(`Person „${rolle}“: „${id}“ aus dem Namen steht in keinem Schema.`)
    }
  }

  // --- Stichtag ------------------------------------------------------------------------------
  if (profil.stichtag && !kenntId(profil.stichtag)) fehler.push(`Das Feld „${profil.stichtag}“ für den Stichtag steht in keinem Schema.`)

  // --- Abdeckung der Nachweisfelder -----------------------------------------------------------
  // Every file field of every schema has a place, or the profile says why not (`bekanntOffen`).
  const verankert = new Set(profil.stellen.flatMap((stelle) => stelle.positionen))
  const offen = profil.bekanntOffen ?? {}
  for (const { art, positionen } of schemata) {
    for (const position of positionen) {
      if (!verankert.has(position) && !Object.hasOwn(offen, position)) {
        warnungen.push(`Antragsart ${art.schema}: das Nachweisfeld „${position}“ hat keine Stelle und steht nicht unter „bekanntOffen“.`)
      }
    }
  }
  for (const position of Object.keys(offen)) {
    if (verankert.has(position)) warnungen.push(`„bekanntOffen“ nennt „${position}“, das eine Stelle hat.`)
    else if (!schemata.some(({ positionen }) => positionen.has(position))) warnungen.push(`„bekanntOffen“ nennt „${position}“, das es in keinem Schema gibt.`)
  }
}

/** What both formats share: the sentences about the application, the mappings of older versions. */
function pruefeVersionen(
  profil: ZuPruefendesProfil,
  schemata: SchemaEintrag[],
  { kenntId, knotenVon, fehler, warnungen }: Omit<PruefKontext, 'profil'>,
): void {
  for (const satz of profil.antragslage ?? []) {
    for (const [, id = ''] of String(satz).matchAll(PLATZHALTER)) {
      if (!kenntId(id)) warnungen.push(`Antragslage: der Platzhalter „${id}“ steht in keinem Schema.`)
    }
  }

  for (const { art, ids } of schemata) {
    for (const [version, korrekturen] of Object.entries(art.abbildungKorrekturen ?? {})) {
      for (const [alt, neu] of Object.entries(korrekturen)) {
        if (!ids.has(neu)) fehler.push(`Antragsart ${art.schema}: die Korrektur der Abbildung ${version} „${alt}“ → „${neu}“ zielt auf kein Element des Schemas.`)
      }
    }
  }
  for (const [version, felder] of Object.entries(profil.werteAbbildungen ?? profil.roh.werteAbbildungen ?? {})) {
    for (const [feld, tabelle] of Object.entries(felder)) {
      const knoten = knotenVon(feld)
      if (!knoten) {
        warnungen.push(`Werteabbildung ${version}: das Feld „${feld}“ steht in keinem Schema.`)
        continue
      }
      for (const neu of Object.values(tabelle)) {
        if (knoten.werte && !Object.hasOwn(knoten.werte, neu)) warnungen.push(`Werteabbildung ${version}: „${feld}“ kennt den Wert „${neu}“ nicht.`)
      }
    }
  }
}
