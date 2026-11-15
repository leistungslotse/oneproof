/**
 * Reading one page with the OCR model (LightOnOCR 2 at IONOS).
 *
 * Port of the flow in `OcrMediaPage` for evidence pages. A page image goes in, the text of the page
 * comes out. What the original does around the model call is kept:
 *
 *  - the instruction asks for every checkbox, and the model sometimes echoes the instruction as a
 *    line of its own → {@link ohnePromptEcho},
 *  - a model in a repetition loop writes the same block until the token limit → {@link entdopple},
 *  - an answer that hit the limit gets ONE second attempt, unless it was only a loop (then the text
 *    before the loop is complete and a second attempt would loop again),
 *  - a page that still ends at the limit is marked as cut off, so that nobody takes the text for
 *    the whole page.
 *
 * The re-read for missing checkbox glyphs applies to application forms only and is not needed for
 * evidence.
 */
import type { ChatAntwort, ChatEingabe } from '../ionos/client.ts'
import { endeteInWiederholung, entdopple, ohnePromptEcho } from './bereinigen.ts'

/** The instruction sent with every page. It contains the marker word `ohnePromptEcho` looks for. */
export const OCR_ANWEISUNG =
  'Gib jede Checkbox/jedes Ankreuzkästchen des Formulars IMMER explizit aus: angekreuzt als ☑, leer als ☐ — direkt vor der zugehörigen Beschriftung (z. B. ☑ Nein ☐ Ja). Lasse niemals ein Kästchen weg.'

/** A page of text fits well below this; a loop fills it. */
export const OCR_MAX_TOKENS = 8192

/** Of the answer of the model, reading a page needs the text, and whether it was cut off. */
export interface SeitenAntwort extends Pick<ChatAntwort, 'text' | 'abgeschnitten'> {
  /** The answer as the model wrote it; where a stand-in leaves it out, `text` is taken. */
  roh?: string
}

/** The part of the AI client that reading a page uses. */
export interface SeitenLeser {
  chat(eingabe: ChatEingabe): Promise<SeitenAntwort>
}

/** What {@link leseSeite} needs to know. */
export interface LeseSeiteOptionen {
  client: SeitenLeser
  modell: string
  /** Data URL of the page image. */
  bild: string
  signal?: AbortSignal
}

/** The text of one page and whether it is complete: what a check keeps of a page it has read. */
export interface SeitenText {
  text: string
  /** The page is fuller than the model could write down; the text is not the whole page. */
  abgeschnitten: boolean
}

/** What reading a page yields. */
export interface LeseErgebnis extends SeitenText {
  /** How often the model was asked: 2 after an answer that hit the token limit. */
  versuche: number
}

export async function leseSeite({ client, modell, bild, signal }: LeseSeiteOptionen): Promise<LeseErgebnis> {
  const frage = () =>
    client.chat({
      modell,
      nachrichten: [
        {
          role: 'user',
          content: [
            { type: 'text', text: OCR_ANWEISUNG },
            { type: 'image_url', image_url: { url: bild } },
          ],
        },
      ],
      maxTokens: OCR_MAX_TOKENS,
      temperatur: 0.2,
      signal,
    })

  // The page as the model wrote it: a reader that does not reason has no reasoning to strip, and a
  // document that itself contains "<think>" must keep the text after it.
  const seitenText = (antwort: SeitenAntwort): string => antwort.roh ?? antwort.text

  let antwort = await frage()
  let versuche = 1

  if (antwort.abgeschnitten) {
    const roh = ohnePromptEcho(seitenText(antwort))
    if (!endeteInWiederholung(roh, entdopple(roh))) {
      const nochmal = await frage()
      versuche = 2
      if (!nochmal.abgeschnitten) antwort = nochmal
    }
  }

  const roh = ohnePromptEcho(seitenText(antwort))
  const text = entdopple(roh)

  return {
    text,
    abgeschnitten: antwort.abgeschnitten && !endeteInWiederholung(roh, text),
    versuche,
  }
}
