/**
 * "Antrag einreichen" in the browser: the package of the engine (`engine/paket/paket.ts`), its PDFs
 * put together by pdf.js from the files the person uploaded. Nothing leaves the machine; the
 * package is offered to the person to save.
 */
import type { FruehePruefung } from '../engine/manifest.ts'
import { bauePaket } from '../engine/paket/paket.ts'
import type { Antragspaket, PaketEingang } from '../engine/paket/paket.ts'
import type { Pruefergebnis } from '../engine/pipeline.ts'
import type { Profil } from '../engine/profil/laden.ts'
import { zusammensteller } from '../pdf/zusammenstellen.ts'
import type { AntragErkennung } from './steuerung.ts'

/** A submission as the page shows it: the file number and case id the package carries, and the date. */
export interface Eingang extends PaketEingang {
  /** The day of receipt, in words. */
  datum: string
}

/** What {@link erstelleAntragspaket} needs. */
export interface PaketEingabe {
  /** The result of the check. */
  ergebnis: Pruefergebnis
  /** The application, as `erkenneAntrag` read it. */
  antrag: Pick<AntragErkennung, 'text' | 'xml'>
  profil: Profil
  /** The files of THIS result, in the order the check read them. */
  nachweise: readonly File[]
  eingang: PaketEingang
  /** Earlier checks of the case. */
  frueher?: readonly FruehePruefung[]
  fortschritt?: (fertig: number, gesamt: number) => void
}

export async function erstelleAntragspaket({ ergebnis, antrag, profil, nachweise, eingang, frueher = [], fortschritt }: PaketEingabe): Promise<Antragspaket> {
  // The check calls the n-th file `fn`. Another list of files would put foreign pages into a document.
  const passend =
    nachweise.length === ergebnis.dateien.length &&
    ergebnis.dateien.every(({ id, name }) => nachweise[Number(id.slice(1)) - 1]?.name === name)
  if (!passend) throw new Error('Die Nachweise haben sich seit der Prüfung geändert. Bitte prüfen Sie erneut und reichen Sie dann ein.')

  const { setzeZusammen, original } = zusammensteller(nachweise)
  return bauePaket({
    ergebnis,
    antragText: antrag.text ?? antrag.xml,
    profil,
    eingang,
    frueher,
    setzeZusammen,
    original,
    DOMParser: globalThis.DOMParser,
    XMLSerializer: globalThis.XMLSerializer,
    fortschritt,
  })
}
