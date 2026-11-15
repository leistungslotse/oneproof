/**
 * The package of a submission: what "Antrag einreichen" hands over.
 *
 *   antrag.xml               the application as a FIM instance, with a reference to every document
 *                            at the place the check filed it at (`fim/verweise.ts`) — or
 *   antrag.json              the application in the OneProof Format, its attachments listing the
 *                            files of the package with the values they support (`oneproof/anlagen.ts`)
 *   oneproof-manifest.json   the result per requirement: status, evidence, place in it, history
 *   inhalt.txt               the same for a person: every file, where it comes from, where it is
 *                            referenced, and why not where it is not
 *   <dokument>.pdf           one file per grouped document, its pages in the order of the document
 *
 * One document is one file, however its pages came in: three payslips in one scan, one contract
 * spread over two uploads. Every uploaded page ends up in exactly one file of the package — the
 * pages nothing could be made of in `nicht-zugeordnete-seiten.pdf`, a file that could not be
 * opened as it was uploaded. Nothing is lost on the way to the authority.
 *
 * Everything that needs the browser (putting pages together into a PDF) is passed in, so that the
 * package is built and tested the same way without one.
 */

import { baueManifest } from '../manifest.ts'
import type { FruehePruefung, Manifest } from '../manifest.ts'
import type { Pruefergebnis, UngeoeffneteDatei } from '../pipeline.ts'
import type { Profil } from '../profil/laden.ts'
import { seitenJeDatei, seitenText } from '../zuordnung/posten.ts'
import type { DokumentInfo, Seite } from '../zuordnung/posten.ts'
import type { Ort } from '../zuordnung/ziele.ts'
import type { Ort as FimOrt } from '../fim/zugang.ts'
import type { Schema } from '../fim/schema.ts'
import { schreibeVerweise } from '../fim/verweise.ts'
import { schreibeAnlagen } from '../oneproof/anlagen.ts'
import type { AnlagenDatei, SchreibeAnlagenEingabe } from '../oneproof/anlagen.ts'
import { istOneProofSchema } from '../oneproof/schema.ts'
import { dokumentName, eindeutig, originalName } from './dateinamen.ts'
import { packeZip } from './zip.ts'

/** The application in the package, by its format. */
export const ANTRAG_DATEIEN = Object.freeze({ fim: 'antrag.xml', oneproof: 'antrag.json' })
export const ANTRAG_DATEI = ANTRAG_DATEIEN.fim
export const MANIFEST_DATEI = 'oneproof-manifest.json'
export const INHALT_DATEI = 'inhalt.txt'

/** The case number the package is delivered under, and the case it belongs to. */
export interface PaketEingang {
  aktenzeichen: string
  fallId: string
}

/** What {@link bauePaket} is given. */
export interface BauePaketOptionen {
  /** The result of the check. */
  ergebnis: Pruefergebnis
  /** The application as it was uploaded (FIM or OneProof Format). One of `antragText` and `antragXml` is needed. */
  antragText?: string
  /** The same, by its earlier name. */
  antragXml?: string
  profil: Profil
  eingang: PaketEingang
  /** Earlier checks of the case, for the history. */
  frueher?: readonly FruehePruefung[]
  /** One PDF of these pages, in this order. */
  setzeZusammen: (seiten: readonly Seite[]) => Promise<Uint8Array>
  /** An upload as it is. */
  original: (fileId: string) => Promise<Uint8Array>
  DOMParser?: typeof globalThis.DOMParser
  XMLSerializer?: typeof globalThis.XMLSerializer
  jetzt?: () => Date
  fortschritt?: (fertig: number, gesamt: number) => void
}

/** Where the application refers to a file of the package: the place in words, and where it stands in the application. */
export interface PaketVerweis {
  bezeichnung: string
  /** An element path in FIM, a JSON Pointer in the OneProof Format. */
  stelle: string
}

/** One file of the package besides the application, as the page shows it. */
export interface PaketDatei {
  name: string
  groesse: number
  /** What the file is, in words. */
  art: string
  /** The number of pages; `null` for a file delivered as it was uploaded. */
  seiten: number | null
  /** Where the pages come from: „scan.pdf, Seiten 2, 5, 9“. */
  herkunft: string | null
  /** The id of the document the file holds; `null` for an upload delivered as it was. */
  dokument: string | null
  /** The id of the upload; only for a file that could not be opened and is delivered as it was. */
  upload: string | null
  /** Where the application refers to the file. */
  verweise: PaketVerweis[]
  /** Why the application does not refer to the file, where it does not. */
  ohneVerweis: string | null
}

/** The package of a submission. */
export interface Antragspaket {
  /** `<Aktenzeichen>-antragspaket.zip`. */
  name: string
  /** The ZIP archive. */
  daten: Uint8Array<ArrayBuffer>
  manifest: Manifest
  /** The name of the application in the package: `antrag.xml` or `antrag.json`. */
  antragsdatei: string
  /** The application is in the OneProof Format (JSON). */
  oneproof: boolean
  /** What the page shows of the package: every file, and where the application refers to it. */
  dateien: PaketDatei[]
  hinweise: string[]
}

/** A file of the package before it is described: its content, and where it comes from. */
type PaketEintrag =
  | { name: string; daten: Uint8Array<ArrayBuffer>; dokument: DokumentInfo; upload: null }
  | { name: string; daten: Uint8Array<ArrayBuffer>; dokument: null; upload: UngeoeffneteDatei }

/** A file of the package in words, with the document and the upload it stands for. */
type BeschriebeneDatei = Omit<PaketDatei, 'dokument' | 'upload'> & { dokument: DokumentInfo | null; upload: UngeoeffneteDatei | null }

export async function bauePaket({
  ergebnis,
  antragText,
  antragXml,
  profil,
  eingang,
  frueher = [],
  setzeZusammen,
  original,
  DOMParser,
  XMLSerializer,
  jetzt = () => new Date(),
  fortschritt = () => {},
}: BauePaketOptionen): Promise<Antragspaket> {
  const hinweise: string[] = []
  const oneproof = ergebnis.antrag.format === 'oneproof'
  const antragsdatei = oneproof ? ANTRAG_DATEIEN.oneproof : ANTRAG_DATEIEN.fim
  const nichtGeoeffnet = ergebnis.dateien.filter((datei): datei is UngeoeffneteDatei => Boolean(datei.fehler))
  const dokumente = ergebnis.dokumente.filter((dokument) => dokument.seiten.length > 0)

  // The names first: the references in the application are these names.
  const namen = eindeutig(
    [...dokumente.map(dokumentName), ...nichtGeoeffnet.map((datei) => originalName(datei.name))],
    [...Object.values(ANTRAG_DATEIEN), MANIFEST_DATEI, INHALT_DATEI],
  )
  /** The name `eindeutig` gave to the entry at this position: it returns one for every name it was given. */
  const nameAn = (index: number): string => {
    const name = namen[index]
    if (name === undefined) throw new Error(`Für die Datei an Stelle ${index} wurde kein Name vergeben.`)
    return name
  }
  const nameVon = new Map(dokumente.map((dokument, index): [string, string] => [dokument.id, nameAn(index)]))

  const dateien: PaketEintrag[] = []
  for (const [index, dokument] of dokumente.entries()) {
    fortschritt(index, dokumente.length)
    dateien.push({ name: nameAn(index), daten: alsPuffer(await setzeZusammen(dokument.seiten)), dokument, upload: null })
  }
  for (const [index, datei] of nichtGeoeffnet.entries()) {
    dateien.push({ name: nameAn(dokumente.length + index), daten: alsPuffer(await original(datei.id)), dokument: null, upload: datei })
    hinweise.push(`„${datei.name}“ konnte nicht geöffnet werden und liegt dem Paket unverändert bei.`)
  }
  fortschritt(dokumente.length, dokumente.length)

  const { schema, version } = ergebnis.antrag
  const abgelegt = ergebnis.ablage.flatMap((eintrag) => {
    const datei = nameVon.get(eintrag.dokument)
    return datei === undefined ? [] : [{ ...eintrag, datei }]
  })
  const verweise = abgelegt.filter(({ grund }) => !grund).map(({ datei, ort, bezeichnung }) => ({ datei, ort, bezeichnung }))
  const antrag = oneproof
    ? await schreibeAnlagen(await anlagenEingabe({ text: antragText ?? antragXml ?? '', profil, schema, dateien, verweise }))
    : alsInhalt(
        schreibeVerweise({
          xml: antragText ?? antragXml ?? '',
          schema: await schemaVon(profil, schema),
          verweise: verweise.map(({ ort, ...rest }) => ({ ...rest, ort: fimOrt(ort) })),
          abbildung: ergebnis.antrag.urspruenglicheVersion ? await profil.ladeAbbildung(schema, ergebnis.antrag.urspruenglicheVersion) : null,
          DOMParser,
          XMLSerializer,
        }),
      )
  // Placed by the check, but in the name of someone else than the place is for: no reference there.
  const fremd = abgelegt.flatMap(({ datei, grund }) => (grund ? [{ datei, grund }] : []))

  const manifest = baueManifest(ergebnis, { ...eingang, frueher, paketDateien: nameVon })
  const erstellt = jetzt()
  const beschrieben = dateien.map((datei) => beschreibe(datei, ergebnis, antrag, fremd))
  const inhalt = inhaltstext({ ergebnis, eingang, beschrieben, antrag, antragsdatei, erstellt, version: ergebnis.antrag.urspruenglicheVersion ?? version })

  const daten = packeZip(
    [
      { name: antragsdatei, daten: antrag.inhalt },
      { name: MANIFEST_DATEI, daten: `${JSON.stringify(manifest, null, 2)}\n` },
      { name: INHALT_DATEI, daten: inhalt },
      ...dateien.map(({ name, daten: bytes }) => ({ name, daten: bytes })),
    ],
    erstellt,
  )

  return {
    name: `${eingang.aktenzeichen}-antragspaket.zip`,
    daten,
    manifest,
    /** The name of the application in the package: `antrag.xml` or `antrag.json`. */
    antragsdatei,
    oneproof,
    /** What the page shows of the package: every file, and where the application refers to it. */
    dateien: beschrieben.map(({ dokument, upload, ...datei }) => ({
      ...datei,
      dokument: dokument?.id ?? null,
      upload: upload?.id ?? null,
    })),
    hinweise,
  }
}

/** What {@link anlagenEingabe} is given. */
interface AnlagenEingabe {
  text: string
  profil: Profil
  /** The application type. */
  schema: string
  dateien: AnlagenDatei[]
  /** Where each file is referred to, at the places the check filed it at. */
  verweise: { datei: string; ort: Ort; bezeichnung: string }[]
}

/**
 * What `schreibeAnlagen` takes. An application in the OneProof Format has its schemas in the
 * profile; where the profile has none for this application type there is nothing to write against.
 */
async function anlagenEingabe({ text, profil, schema, dateien, verweise }: AnlagenEingabe): Promise<SchreibeAnlagenEingabe> {
  const schemata = await profil.ladeJsonSchema(schema)
  const kompakt = await schemaVon(profil, schema)
  if (!schemata || !istOneProofSchema(kompakt)) throw new Error(`Das Profil hat kein Schema im OneProof Format für den Antrag „${schema}“.`)
  // An application in the OneProof Format has places in that format; one of FIM has no value to point to.
  return { text, schemata, schema: kompakt, dateien, verweise: verweise.map((verweis) => ({ ...verweis, ort: 'stelle' in verweis.ort ? verweis.ort : { stelle: null } })) }
}

/** The compact schema of an application type. An application the check could read has one. */
async function schemaVon(profil: Profil, schema: string): Promise<Schema> {
  const kompakt = await profil.ladeSchema(schema)
  if (!kompakt) throw new Error(`Das Profil hat kein Schema für den Antrag „${schema}“.`)
  return kompakt
}

/** The place of a reference in an application in FIM: the place of the check is one of FIM there. */
function fimOrt(ort: Ort): FimOrt {
  if (!('feld' in ort)) throw new Error('Der Antrag liegt in FIM, die Ablage nennt aber keine Stelle in FIM.')
  return ort
}

/** The bytes in an `ArrayBuffer` of their own, which is what hashing them (Web Crypto) takes; the same bytes. */
function alsPuffer(daten: Uint8Array): Uint8Array<ArrayBuffer> {
  return daten.buffer instanceof ArrayBuffer ? new Uint8Array(daten.buffer, daten.byteOffset, daten.byteLength) : new Uint8Array(daten)
}

/** A file the application does not refer to, and why. */
interface NichtGeschrieben {
  datei: string
  grund: string
}

/** The application with references, as both writers give it: the text as `inhalt`. */
interface AntragMitVerweisen {
  inhalt: string
  geschrieben: { datei: string; bezeichnung: string; stelle: string }[]
  nichtGeschrieben: NichtGeschrieben[]
  entfernt: { feld: string; wert: string }[]
}

/** The FIM application with references, in the form both writers give: the text as `inhalt`. */
const alsInhalt = ({ xml, ...rest }: Omit<AntragMitVerweisen, 'inhalt'> & { xml: string }): AntragMitVerweisen => ({ ...rest, inhalt: xml })

/* ---------------------------------------------------------------------------------------------
 * inhalt.txt
 * ------------------------------------------------------------------------------------------- */

const zahl = (anzahl: number, eins: string, mehr: string): string => `${anzahl} ${anzahl === 1 ? eins : mehr}`

/** Where the pages of a document come from: „scan.pdf, Seiten 2, 5, 9“. */
function herkunft(dokument: DokumentInfo, ergebnis: Pruefergebnis): string {
  return seitenJeDatei(dokument.seiten)
    .map(({ fileId, seiten }) => `${ergebnis.dateien.find(({ id }) => id === fileId)?.name ?? fileId}, ${seitenText(seiten)}`)
    .join('; ')
}

/** Why a document has no reference: the reason of the check, or of the package. */
function ohneVerweis(dokument: DokumentInfo, ergebnis: Pruefergebnis, nichtGeschrieben: readonly NichtGeschrieben[]): string {
  if (nichtGeschrieben.length > 0) return [...new Set(nichtGeschrieben.map(({ grund }) => grund))].join(' ')
  const eintrag = ergebnis.nichtZugeordnet.find((kandidat) => kandidat.dokument === dokument.id)
  if (eintrag?.grund) return eintrag.grund
  return 'Der Antrag nennt dazu keine passende Stelle.'
}

/**
 * One file of the package in words: what it is, where its pages come from, where the application
 * refers to it — or why it does not.
 */
function beschreibe(eintrag: PaketEintrag, ergebnis: Pruefergebnis, antrag: AntragMitVerweisen, fremd: readonly NichtGeschrieben[]): BeschriebeneDatei {
  const { name, daten } = eintrag
  const geschrieben = antrag.geschrieben.filter(({ datei }) => datei === name)
  const nichtGeschrieben = [...antrag.nichtGeschrieben, ...fremd].filter(({ datei }) => datei === name)

  if (eintrag.upload) {
    return {
      name,
      groesse: daten.length,
      dokument: eintrag.dokument,
      upload: eintrag.upload,
      art: `unverändert hochgeladene Datei „${eintrag.upload.name}“`,
      seiten: null,
      herkunft: null,
      verweise: [],
      ohneVerweis: `Die Datei konnte nicht geöffnet werden: ${eintrag.upload.fehler}`,
    }
  }
  const { dokument } = eintrag
  return {
    name,
    groesse: daten.length,
    dokument,
    upload: eintrag.upload,
    art: dokument.nichtZugeordnet
      ? 'Seiten, die keinem Dokument zugeordnet werden konnten'
      : [dokument.typLabel, dokument.person].filter(Boolean).join(' · '),
    seiten: dokument.seiten.length,
    herkunft: herkunft(dokument, ergebnis),
    verweise: geschrieben.map(({ bezeichnung, stelle }) => ({ bezeichnung, stelle })),
    ohneVerweis: geschrieben.length === 0 ? ohneVerweis(dokument, ergebnis, nichtGeschrieben) : null,
  }
}

/** What {@link inhaltstext} needs. */
interface InhaltstextEingabe {
  ergebnis: Pruefergebnis
  eingang: PaketEingang
  beschrieben: readonly BeschriebeneDatei[]
  antrag: AntragMitVerweisen
  antragsdatei: string
  erstellt: Date
  /** The schema version the application is written in. */
  version: string
}

function inhaltstext({ ergebnis, eingang, beschrieben, antrag, antragsdatei, erstellt, version }: InhaltstextEingabe): string {
  const oneproof = ergebnis.antrag.format === 'oneproof'
  const zeilen = [
    `Antragspaket ${eingang.aktenzeichen}`,
    `${ergebnis.antrag.name}${ergebnis.antrag.personen[0] ? ` · ${ergebnis.antrag.personen[0]}` : ''}`,
    `Erstellt am ${erstellt.toLocaleString('de-DE', { dateStyle: 'long', timeStyle: 'short' })} · Vorführung mit erfundenen Daten`,
    '',
    antragsdatei,
    ...(oneproof
      ? [
          `  Die Antragsdaten im OneProof Format (${ergebnis.antrag.schema}, Version ${version}) mit den Nachweisen als Anlagen.`,
          '  Jede Datei dieses Pakets ist eine Anlage; unter „bezuege“ stehen die Angaben des Antrags, die sie belegt, als JSON-Pointer.',
        ]
      : [
          `  Die Antragsdaten als FIM-Instanz (Schema ${ergebnis.antrag.schema}, Version ${version}) mit den Verweisen auf die Nachweise.`,
          '  Ein Verweis ist der Name einer Datei dieses Pakets im Feld „Nachweis“ an der Stelle, zu der sie gehört.',
        ]),
    ...(antrag.entfernt.length > 0
      ? [
          oneproof
            ? `  Ersetzt: ${zahl(antrag.entfernt.length, 'Anlage', 'Anlagen')} des hochgeladenen Antrags (${antrag.entfernt.map(({ wert }) => wert || 'ohne Namen').join(', ')}); an ihrer Stelle stehen die Dateien dieses Pakets.`
            : `  Entfernt: ${zahl(antrag.entfernt.length, 'Verweis', 'Verweise')} des hochgeladenen Antrags auf Dateien, die nicht im Paket liegen (${antrag.entfernt.map(({ wert }) => wert || 'ohne Namen').join(', ')}).`,
        ]
      : []),
    '',
    MANIFEST_DATEI,
    '  Das Ergebnis der Prüfung je zu belegender Angabe: Status, Beleg mit Datei, Fundstelle und Hash, Prüfhistorie.',
    '',
    `Nachweise (${beschrieben.length})`,
  ]

  for (const { name, groesse, art, seiten, herkunft: aus, verweise, ohneVerweis: grund } of beschrieben) {
    const umfang = [seiten ? zahl(seiten, 'Seite', 'Seiten') : null, `${Math.max(1, Math.round(groesse / 1024))} KB`].filter(Boolean).join(', ')
    zeilen.push('', `  ${name}`, `    ${art} (${umfang})`)
    if (aus) zeilen.push(`    aus: ${aus}`)
    for (const { stelle, bezeichnung } of verweise) zeilen.push(`    Verweis im Antrag: ${bezeichnung}`, `      ${stelle}`)
    if (grund) zeilen.push(`    ohne Verweis im Antrag: ${grund}`)
  }

  return `${zeilen.join('\n')}\n`
}
