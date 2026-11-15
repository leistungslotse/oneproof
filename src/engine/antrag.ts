/**
 * Reads an application, whatever its format: a FIM instance (XML) or a file in the OneProof Format
 * (JSON). The content decides, not the name of the file.
 *
 * Both give an application with `format`, `schemaId` (the application type of the profile),
 * `version` and `anhaenge`. A FIM application carries the tree of its elements (`root`), one in the
 * OneProof Format its data (`daten`). From here on only the access to the application differs
 * (`fim/zugang.ts`, `oneproof/zugang.ts`); the check is the same.
 */

import { InstanceError, readInstance } from './fim/instanz.ts'
import type { Instance, ReadInstanceOptionen } from './fim/instanz.ts'
import { istJson, leseOneProofAntrag } from './oneproof/lesen.ts'
import type { OneProofAntrag } from './oneproof/lesen.ts'

/** The formats an application may come in, as the page names them. */
export const FORMAT_NAME = Object.freeze({
  'fim-instanz': 'FIM-Instanz (XML)',
  'leistungslotse-export': 'FIM-Export von LeistungsLotse (XML)',
  oneproof: 'OneProof Format (JSON)',
})

/** An application of either format: a FIM instance or one in the OneProof Format; `format` tells which. */
export type Antrag = Instance | OneProofAntrag

/**
 * Is this text, read as UTF-8, a file saved as UTF-16 (the default of Windows PowerShell 5)? It has a
 * zero byte beside every character, after a byte order mark that is no UTF-8 (two replacement
 * characters). Neither JSON nor XML, though it is one of them. Another file with a zero byte — a PDF,
 * a photo put into the field by mistake — is something else, and is no application either.
 */
const istUtf16 = (text: string): boolean => /^(?:\uFFFD\uFFFD|\uFEFF)?(?:[^\0]\0[^\0]\0|\0[^\0]\0[^\0])/.test(text)

export function leseAntrag(text: string, optionen: ReadInstanceOptionen = {}): Antrag {
  if (istUtf16(String(text ?? ''))) {
    throw new InstanceError('Die Antragsdatei ist nicht als UTF-8 gespeichert. Bitte speichern Sie sie als UTF-8 und laden Sie sie erneut hoch.')
  }
  return istJson(text) ? leseOneProofAntrag(text) : readInstance(text, optionen)
}
