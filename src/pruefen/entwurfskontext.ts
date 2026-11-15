import { createContext } from 'react'
import type { Entwurf } from '../engine/profil/entwurf.ts'
import type { Profil } from '../engine/profil/laden.ts'

/** What the views know of a check against a draft: the profile made from it, and the draft itself. */
export interface EntwurfKontextWert {
  profil: Profil
  entwurf: Entwurf
}

/**
 * Set while the check runs against a draft of the department instead of a released profile:
 * `{profil, entwurf}`, otherwise `null`. Every view of the check shows the note, so it is a context
 * and not a property of each view.
 */
export const EntwurfKontext = createContext<EntwurfKontextWert | null>(null)
