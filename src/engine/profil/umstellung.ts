/**
 * From profile format 1 to format 2 — the step a department takes once, the first time it opens a
 * profile of format 1 on its page. Nothing about what the profile decides changes: every place of
 * every application type gets the settings of its statement, written out, and counts as decided.
 */

import type { Schema, SchemaNode } from '../fim/schema.ts'
import { beschreibeStelle } from '../fim/xdf.ts'
import { eindeutig, herkunftNachStruktur, knotenMitId, kurzform, neueStelle, positionenVon, slug, STATUS } from './bedingungen.ts'
import type { AntragsartFormat2, ProfilFormat2, StelleFormat2, Zeitraum } from './bedingungen.ts'
import { ROLLE, verwendungenAus } from './laden.ts'
import type { Abdeckung, Nachweisart, Nennt, ProfilFormat1, StelleFormat1 } from './laden.ts'

/** What `ausFormat1` needs besides the profile. */
export interface UmstellungOptionen {
  /** The schema of every application type of the profile, by its id. */
  schemas: ReadonlyMap<string, Schema>
  /** The catalogue of document types; only its keys count. */
  typen: ReadonlyMap<string, unknown>
}

/** A place of format 1 with its positions as a list. */
interface AlteStelle extends StelleFormat1 {
  positionen: string[]
}

/** A place of a schema, with the place of format 1 that stands for it — if there is one. */
interface Platz {
  position: string
  /** The path of its field in the schema. */
  pfad: SchemaNode[]
  alt: AlteStelle | null
}

/** The settings of a place of format 2 that tell the engine how to read it. */
type Lesart = Partial<Pick<StelleFormat2, 'nennt' | 'nurFrage' | 'auffang' | 'einmal' | 'aussage' | 'merkmale'>>

/**
 * A profile of format 1 in format 2, unchanged in what it decides: every place of every
 * application type with the settings of its statement, written out, and marked as decided.
 *
 * @param roh   `profil.json` of format 1
 */
export function ausFormat1(roh: ProfilFormat1, { schemas, typen }: UmstellungOptionen): ProfilFormat2 {
  const verwendungen = verwendungenAus(roh.nachweisarten ?? {}, typen)
  const alteStellen = (roh.stellen ?? []).map((stelle): AlteStelle => ({ ...stelle, positionen: [stelle.position].flat() }))
  const { nachweisarten: _arten, stellen: _stellen, bekanntOffen: _offen, ...profil } = roh

  const antragsarten = roh.antragsarten.map((antragsart): AntragsartFormat2 => {
    const schema = schemas.get(antragsart.schema)
    if (!schema) throw new Error(`Das Schema der Antragsart ${antragsart.schema} fehlt.`)

    // In the order of the places of format 1 — the order the result lists them in — and then the
    // places format 1 has none for, in the order of the schema.
    const positionen = positionenVon(schema)
    const reihe: Platz[] = [
      ...alteStellen.flatMap((alt) =>
        alt.positionen.flatMap((position): Platz[] => {
          const pfad = positionen.get(position)
          return pfad ? [{ position, pfad, alt }] : []
        }),
      ),
      ...[...positionen]
        .filter(([position]) => !alteStellen.some((alt) => alt.positionen.includes(position)))
        .map(([position, pfad]): Platz => ({ position, pfad, alt: null })),
    ]

    const stellen: StelleFormat2[] = []
    const vergeben = new Set<string>()
    for (const { position, pfad, alt } of reihe) {
      const beschreibung = beschreibeStelle(pfad)

      if (!alt) {
        stellen.push({
          ...neueStelle({ id: eindeutig(slug(beschreibung.titel), vergeben), position, ...beschreibung }, pfad),
          ...(roh.bekanntOffen?.[position] ? { ohne: roh.bekanntOffen[position], bedingungen: [] } : {}),
        })
        continue
      }

      const id = eindeutig(alt.id, vergeben)
      const definition: Partial<Nachweisart> = roh.nachweisarten?.[alt.art] ?? {}
      stellen.push({
        id,
        position,
        titel: alt.titel,
        bereich: alt.bereich ?? beschreibung.bereich,
        // A question named by hand, or "always": set by hand. Without either the structure decides.
        herkunft: { art: alt.nennt ? 'profil' : herkunftNachStruktur(pfad) },
        ...technischVon(alt, schema),
        bedingungen: [
          {
            id,
            art: alt.art,
            status: STATUS.FESTGELEGT,
            nachweise: {},
            ...(definition.abdeckung ? { zeitraum: zeitraumVon(definition.abdeckung) } : {}),
            hinweis: alt.hinweis ?? definition.hinweis ?? '',
          },
        ],
      })
    }

    // The documents, now that every place has its id: a link to a coarser statement becomes a link
    // to the condition that stands for it here.
    const bedingungMitArt = (art: string): string | null =>
      stellen.find((stelle) => stelle.bedingungen[0]?.art === art)?.bedingungen[0]?.id ?? null
    for (const stelle of stellen) {
      for (const bedingung of stelle.bedingungen) {
        if (!bedingung.art) continue
        for (const [typ, liste] of verwendungen) {
          const eigene = liste.find((verwendung) => verwendung.art === bedingung.art)
          if (!eigene) continue
          const ziel = eigene.groebere ? bedingungMitArt(eigene.groebere) : null
          bedingung.nachweise[typ] = kurzform({
            rolle: eigene.rolle,
            merkmale: eigene.merkmale ?? {},
            ersatzweise: ziel ? { bedingung: ziel, rolle: eigene.rolleGroeber ?? ROLLE.ERGAENZT } : null,
          })
        }
      }
    }

    return { ...antragsart, stellen }
  })

  return { ...profil, format: 2, antragsarten }
}

/** The settings of a place of format 1 that tell the engine how to read it. */
function technischVon(stelle: StelleFormat1, schema: Schema): Lesart {
  const technisch: Lesart = {}
  if (stelle.nennt) technisch.nennt = nenntIn(stelle.nennt, schema)
  for (const schalter of ['nurFrage', 'auffang', 'einmal'] satisfies ('nurFrage' | 'auffang' | 'einmal')[]) {
    if (stelle[schalter] === true) technisch[schalter] = true
  }
  if (stelle.aussage) technisch.aussage = stelle.aussage
  if (stelle.merkmale?.length) technisch.merkmale = stelle.merkmale
  return technisch
}

/**
 * The questions of a place that its schema has. Format 1 lists the variants of all application
 * types in one place; an application type of format 2 only needs its own. Should none be left, the
 * list stays as it is: the engine then reads the place as before.
 */
function nenntIn(nennt: Nennt, schema: Schema): Nennt | undefined {
  if (!Array.isArray(nennt)) return nennt
  const eigene = nennt.filter((frage) => !frage?.feld || knotenMitId(schema, frage.feld))
  if (eigene.length === 0) return nennt
  return eigene.length === 1 ? eigene[0] : eigene
}

const zeitraumVon = (abdeckung: Abdeckung): Zeitraum => ({
  mindestens: abdeckung.mindestens,
  ...(Number.isInteger(abdeckung.hoechstensAlt) ? { hoechstensAlt: abdeckung.hoechstensAlt } : {}),
  fuer: abdeckung.fuer ?? [],
  ...(abdeckung.beispiel ? { beispiel: true } : {}),
})
