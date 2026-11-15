/** Where in the check something went wrong; the page offers a different way on for each. */
export type Bereich = 'antrag' | 'nachweise' | 'ki' | 'abbruch' | 'intern'

/** What a {@link PruefFehler} may carry besides its message. */
export interface PruefFehlerOptionen {
  /** The kind of an AI error (see `IonosFehler`). */
  art?: string | null
  /** Trying again may help. */
  wiederholbar?: boolean
  /** What was thrown originally, kept as the `cause`. */
  ursache?: unknown
}

/**
 * The one error type of a check.
 *
 * Everything that can stop a check is turned into this, so that the page needs to know exactly
 * one thing: the message is ready for a person, and `bereich` and `wiederholbar` say what to offer.
 */
export class PruefFehler extends Error {
  readonly bereich: Bereich
  readonly art: string | null
  readonly wiederholbar: boolean

  /**
   * @param bereich  where it went wrong
   * @param nachricht  German, for display
   */
  constructor(bereich: Bereich, nachricht: string, { art = null, wiederholbar = false, ursache }: PruefFehlerOptionen = {}) {
    super(nachricht, ursache === undefined ? undefined : { cause: ursache })
    this.name = 'PruefFehler'
    this.bereich = bereich
    this.art = art
    this.wiederholbar = wiederholbar
  }
}

/** The AI errors after which the whole check has no point: the next page would fail the same way. */
export const GRUNDSAETZLICHE_KI_FEHLER: ReadonlySet<string> = new Set(['auth', 'nicht-eingerichtet', 'modell', 'abgebrochen'])

/**
 * The message of whatever was thrown: an error's own, otherwise the thing itself as text. For the
 * places that must report a failure to a person but cannot know what they caught.
 */
export function meldungVon(fehler: unknown): string {
  if (typeof fehler === 'object' && fehler !== null && 'message' in fehler && typeof fehler.message === 'string') return fehler.message
  return String(fehler)
}
