/**
 * The result as an OneProof manifest — the hand-over to the target system.
 *
 * The shape is the `Manifest` of `public/openapi.yaml`: it ties every requirement to its source,
 * person, place in the document (`fundstelle`), hash, status and history. What the check found
 * becomes one entry per requirement that has to be proven in this case — `belegt`, `offen` or
 * `unklar`. A requirement the application itself rules out (`entfaellt`) is no entry: the reason
 * is the answer in the application, which the receiver has, and the manifest is the list of what
 * needs evidence. A requirement that several documents prove has a `beleg` for the first and all
 * of them in `belege`.
 */
import type { ErgebnisDatei, Pruefergebnis } from './pipeline.ts'
import { seitenText } from './zuordnung/posten.ts'
import { STATUS } from './zuordnung/anforderungen.ts'
import type { Anforderung, Status } from './zuordnung/anforderungen.ts'

/** What the history says triggered the status. */
export const AUSLOESER = 'Nachweisprüfung (hochgeladene Unterlagen)'

/** One source of a requirement: a document, with the upload its pages come from and where in it. */
export interface ManifestBeleg {
  art: 'dokument'
  /** The kind of document, as the profile names it. */
  nachweistyp: string
  /** The file of the package the document is delivered in; only where there is a package. */
  datei?: string
  /** The name of the upload the pages come from. */
  quelle: string
  mimeType: string | null
  /** `sha512-` and the hash of the upload as hex; `null` where the browser could not compute one. */
  hash: string | null
  /** „Seiten 1–2 von 2“. */
  fundstelle: string
}

/** One change of the status of a requirement. */
export interface ManifestHistorie {
  /** When the check was made, ISO 8601. */
  zeitpunkt: string
  status: Status
  /** What triggered the status ({@link AUSLOESER}). */
  ausloeser: string
}

/** One requirement that has to be proven in the case. */
export interface ManifestEintrag {
  anforderungId: string
  /** The fact in the words of the person: what it is, whom it concerns, what they said. */
  tatsache: string
  /** Where the fact stands in an application of the OneProof Format, as a JSON Pointer. */
  stelle?: string
  /** Whom the fact concerns, with the name from the application. */
  personen?: string[]
  /** `belegt`, `offen` or `unklar`: a requirement the application rules out (`entfaellt`) is no entry. */
  status: Status
  /** What to do, if `offen`. */
  hinweis?: string
  /** What is still missing, if `unklar`. */
  notiz?: string
  /** The first source; where there is one. */
  beleg?: ManifestBeleg
  /** All sources, where there is one. */
  belege?: ManifestBeleg[]
  historie: ManifestHistorie[]
}

/** How many requirements have which status. */
export interface ManifestZusammenfassung {
  belegt: number
  offen: number
  unklar: number
}

/** The result as an OneProof manifest: the `Manifest` of `public/openapi.yaml`. */
export interface Manifest {
  fallId?: string
  aktenzeichen?: string
  /** The benefit: the id of the profile. */
  leistung: string
  /** `id@version` of the profile. */
  profilVersion: string
  /** When the check was made, ISO 8601. */
  erstelltAm: string
  zusammenfassung: ManifestZusammenfassung
  eintraege: ManifestEintrag[]
}

/** What the manifest takes of a check. */
export type ManifestEingabe = Pick<Pruefergebnis, 'zusammenfassung' | 'profil' | 'erstelltAm' | 'anforderungen' | 'dateien'>

/** What the manifest takes of an earlier check of the case, for the history. */
export interface FruehePruefung {
  erstelltAm: string
  anforderungen: readonly Pick<Anforderung, 'id' | 'status'>[]
}

/** What {@link baueManifest} may be told about the case. */
export interface ManifestOptionen {
  fallId?: string | null
  aktenzeichen?: string | null
  /** Earlier checks of the same case, oldest first. */
  frueher?: readonly FruehePruefung[]
  /** Document id → name of its file in the package. */
  paketDateien?: ReadonlyMap<string, string>
}

/**
 * The sources of one requirement in the form of the API: one entry per document and file. Where
 * the documents are delivered as files of a package, `datei` names the file; `quelle`,
 * `fundstelle` and `hash` stay with the upload the pages come from.
 */
function belegeVon(anforderung: Anforderung, dateien: readonly ErgebnisDatei[], paketDateien: ReadonlyMap<string, string>): ManifestBeleg[] {
  return anforderung.belege.flatMap((beleg) =>
    beleg.dateien.map((teil) => {
      const datei = dateien.find((kandidat) => kandidat.id === teil.fileId)
      const imPaket = paketDateien.get(beleg.dokument)
      return {
        art: 'dokument',
        nachweistyp: beleg.typLabel,
        ...(imPaket ? { datei: imPaket } : {}),
        quelle: teil.name,
        mimeType: datei?.mime ?? null,
        hash: datei?.hash ? `sha512-${datei.hash}` : null,
        fundstelle: datei?.seiten ? `${seitenText(teil.seiten)} von ${datei.seiten}` : seitenText(teil.seiten),
      }
    }),
  )
}

/** The fact in the words of the person: what it is, whom it concerns, what they said. */
function tatsacheVon({ fact, person, aussage }: Pick<Anforderung, 'fact' | 'person' | 'aussage'>): string {
  const wer = [fact, person].filter(Boolean).join(' – ')
  return aussage ? `${wer}: ${aussage}` : wer
}

/**
 * Every change of the status of one requirement over the checks of a case, oldest first: the first
 * status it had, then each one that differed from the one before.
 */
function historieVon(id: string, pruefungen: readonly FruehePruefung[]): ManifestHistorie[] {
  const historie: ManifestHistorie[] = []
  for (const { erstelltAm, anforderungen } of pruefungen) {
    const status = anforderungen.find((anforderung) => anforderung.id === id)?.status
    if (status && status !== historie.at(-1)?.status) historie.push({ zeitpunkt: erstelltAm, status, ausloeser: AUSLOESER })
  }
  return historie
}

/** The manifest of a check, with what is known of the case it belongs to. */
export function baueManifest(
  ergebnis: ManifestEingabe,
  { fallId = null, aktenzeichen = null, frueher = [], paketDateien = new Map<string, string>() }: ManifestOptionen = {},
): Manifest {
  const { belegt, offen, unklar } = ergebnis.zusammenfassung
  const pruefungen = [...frueher, ergebnis]

  return {
    ...(fallId === null ? {} : { fallId }),
    ...(aktenzeichen === null ? {} : { aktenzeichen }),
    leistung: ergebnis.profil.id,
    profilVersion: ergebnis.profil.kennung,
    erstelltAm: ergebnis.erstelltAm,
    zusammenfassung: { belegt, offen, unklar },
    eintraege: ergebnis.anforderungen.filter((anforderung) => anforderung.status !== STATUS.ENTFAELLT).map((anforderung) => {
      const belege = belegeVon(anforderung, ergebnis.dateien, paketDateien)

      return {
        anforderungId: anforderung.id,
        tatsache: tatsacheVon(anforderung),
        // Where the fact stands in an application of the OneProof Format, as a JSON Pointer.
        ...(anforderung.stelle?.zeiger ? { stelle: anforderung.stelle.zeiger } : {}),
        ...(anforderung.person ? { personen: [anforderung.person] } : {}),
        status: anforderung.status,
        ...(anforderung.hint && anforderung.status === STATUS.OFFEN ? { hinweis: anforderung.hint } : {}),
        ...(anforderung.note ? { notiz: anforderung.note } : {}),
        ...(belege.length > 0 ? { beleg: belege[0], belege } : {}),
        historie: historieVon(anforderung.id, pruefungen),
      }
    }),
  }
}
