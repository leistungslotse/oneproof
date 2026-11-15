/**
 * Groups the pages of the uploaded files into documents.
 *
 * The model is asked once: which pages belong together, what kind of document is it, whose is it.
 * Its answer is then checked ({@link pruefeDokumente}) and finished by fixed rules
 * ({@link bearbeiteDokumente}) — the order of the original:
 *
 *   model → validate → correct confused types → cut a file with many payslips into months →
 *   merge the single pieces of one kind into a series → catch the pages nobody took
 *
 * The model is also what makes this step the only one that can fail without a reason in the data:
 * it may answer in a form nobody can read, name pages it was never given, or run into its token
 * limit while reasoning. Then it is asked once more, and only after that is the failure reported.
 */
import { IonosFehler, istWiederholbar } from '../ionos/client.ts'
import type { ChatClient, Verbrauch } from '../ionos/client.ts'
import type { PersonDirectory } from '../zuordnung/personen.ts'
import { antwortBudget, baueEingabe, baueSystemAnweisung } from './anweisung.ts'
import type { GruppierDatei, PromptPerson } from './anweisung.ts'
import { haengeRestAn, liesManifest, pruefeDokumente } from './antwort.ts'
import type { Document, PageRef, PageTexts } from './dokument.ts'
import { schneideAbrechnungsmonate } from './monate.ts'
import { fuehreReihenZusammen } from './reihen.ts'
import type { Katalog, Katalogeintrag } from './typ-bezeichnung.ts'
import { korrigiereTypen } from './typ-korrektur.ts'

/**
 * The client may try again after an overloaded or unreachable service — but not after the time
 * limit: one call may take minutes, and a second one as long would leave the user waiting twice.
 */
const nichtNachZeitlimit = (fehler: unknown): boolean => istWiederholbar(fehler) && fehler instanceof IonosFehler && fehler.art !== 'zeitlimit'

/** File name → file id, for a model that names a page by its file; only names that are unique. */
function dateiIdsNachName(dateien: GruppierDatei[]): Map<string, string> {
  const zaehler = new Map<string, number>()
  for (const { name } of dateien) zaehler.set(name, (zaehler.get(name) ?? 0) + 1)
  return new Map(dateien.filter(({ name }) => zaehler.get(name) === 1).map(({ id, name }): [string, string] => [name, id]))
}

/** What the grouping needs to know of the profile: its name and the catalogue of document types. */
export interface Gruppierungsprofil {
  name: string
  typen: ReadonlyMap<string, Katalogeintrag>
  katalog: Katalog
}

/** What {@link gruppiere} is given. */
export interface GruppiereOptionen {
  client: ChatClient
  modell: string
  profil: Gruppierungsprofil
  /** household persons whose name the application knows */
  personen: PromptPerson[]
  /** persons the application names outside the household */
  nebenpersonen?: PromptPerson[]
  /** what the application says about the applicant's situation */
  antragslage?: string[]
  /** name or role of every person, by index */
  anzeigeNamen: string[]
  verzeichnis: PersonDirectory
  dateien: GruppierDatei[]
  /** context window of the model in tokens, if known */
  kontextfenster?: number | null
  versuche?: number
  beiVersuch?: (versuch: number, grund: string) => void
  signal?: AbortSignal
}

/** The answer of the model the grouping rests on. */
export interface GruppierAntwort {
  text: string
  begruendung: string
  usage: Verbrauch | null
  versuche: number
}

/** What {@link gruppiere} returns. */
export interface Gruppierung {
  dokumente: Document[]
  erfundeneTypen: string[]
  /** the page universe: every page the model was given */
  seiten: PageRef[]
  antwort: GruppierAntwort
}

export async function gruppiere({
  client,
  modell,
  profil,
  personen,
  nebenpersonen = [],
  antragslage = [],
  anzeigeNamen,
  verzeichnis,
  dateien,
  kontextfenster = null,
  versuche = 2,
  beiVersuch = () => {},
  signal,
}: GruppiereOptionen): Promise<Gruppierung> {
  const eingabe = baueEingabe({ typen: profil.typen, personen, nebenpersonen, antragslage, dateien })
  const system = baueSystemAnweisung(`Antrags auf ${profil.name}`)

  const maxTokens = antwortBudget({ fenster: kontextfenster, zeichen: system.length + eingabe.text.length })
  if (maxTokens === null) {
    throw new IonosFehler(
      'kontext',
      `Die Nachweise sind zu umfangreich, um sie in einem Schritt zuzuordnen: Das Sprachmodell verarbeitet höchstens ${kontextfenster?.toLocaleString('de-DE')} Token. Bitte prüfen Sie weniger Unterlagen auf einmal.`,
    )
  }

  const erlaubt = new Map<string, Set<number>>()
  for (const { fileId, page } of eingabe.seiten) erlaubt.set(fileId, (erlaubt.get(fileId) ?? new Set<number>()).add(page))
  const dateiIds = dateiIdsNachName(dateien)

  let grund = ''
  for (let versuch = 1; versuch <= versuche; versuch++) {
    if (versuch > 1) beiVersuch(versuch, grund)

    const antwort = await client.chat({
      modell,
      nachrichten: [
        { role: 'system', content: system },
        { role: 'user', content: eingabe.text },
      ],
      maxTokens,
      signal,
      wiederholen: nichtNachZeitlimit,
    })

    const manifest = liesManifest(antwort.text)

    if (manifest !== null && Array.isArray(manifest.documents)) {
      const { dokumente, erfundeneTypen } = pruefeDokumente({
        manifest,
        erlaubt,
        katalog: profil.katalog,
        verzeichnis,
        personen: anzeigeNamen,
        dateiIds,
      })

      // An empty list means "nothing to group". A list whose documents name none of the pages that
      // were sent means the model lost the page headers — that is no answer.
      if (manifest.documents.length === 0 || dokumente.length > 0) {
        return {
          dokumente,
          erfundeneTypen,
          seiten: eingabe.seiten,
          antwort: { text: antwort.text, begruendung: antwort.begruendung, usage: antwort.usage, versuche: versuch },
        }
      }
      grund = 'Die Antwort der KI nannte keine der gesendeten Seiten.'
    } else {
      grund = antwort.abgeschnitten
        ? 'Die Antwort der KI wurde am Token-Limit abgebrochen.'
        : 'Die Antwort der KI enthielt keine lesbare Dokumentliste.'
    }
  }

  throw new IonosFehler('antwort', `Die KI hat keine auswertbare Gruppierung geliefert. ${grund}`)
}

/** What {@link bearbeiteDokumente} is given. */
export interface BearbeiteOptionen {
  dokumente: Document[]
  seitenTexte: PageTexts
  katalog: Katalog
  /** every page of every file, also the unreadable */
  alleSeiten: PageRef[]
}

/** The fixed rules after the model. */
export function bearbeiteDokumente({ dokumente, seitenTexte, katalog, alleSeiten }: BearbeiteOptionen): Document[] {
  const korrigiert = korrigiereTypen(dokumente, seitenTexte, katalog)
  const geschnitten = schneideAbrechnungsmonate(korrigiert, seitenTexte)
  const zusammen = fuehreReihenZusammen(geschnitten, katalog)
  return haengeRestAn(zusammen, alleSeiten)
}
