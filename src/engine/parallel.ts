/**
 * Work through a list with at most `grenze` jobs at the same time.
 *
 * Built for calls to a rate-limited service: a few in flight, the rest waiting. If one job throws,
 * the others are told to stop (through the signal they get) and nothing new is started; once they
 * are done the FIRST error is thrown. A job that can fail without consequence handles that itself
 * and does not throw.
 *
 * @param signal  from outside: stops the whole run
 */
export async function mitBegrenzung<T>(
  eintraege: readonly T[],
  grenze: number,
  arbeit: (eintrag: T, signal: AbortSignal) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const steuerung = new AbortController()
  const beiAbbruch = () => steuerung.abort(signal?.reason)

  if (signal?.aborted) steuerung.abort(signal.reason)
  else signal?.addEventListener('abort', beiAbbruch, { once: true })

  const warteschlange = [...eintraege]
  let gescheitert = false
  let ersterFehler: unknown

  const arbeiter = async () => {
    while (!gescheitert && !steuerung.signal.aborted && warteschlange.length > 0) {
      try {
        // The queue is not empty (checked above), so this is a `T`, even where `T` itself allows `undefined`.
        await arbeit(warteschlange.shift() as T, steuerung.signal)
      } catch (fehler) {
        if (!gescheitert) {
          gescheitert = true
          ersterFehler = fehler
        }
        steuerung.abort()
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.max(1, Math.min(grenze, eintraege.length)) }, arbeiter))
  } finally {
    signal?.removeEventListener('abort', beiAbbruch)
  }

  if (gescheitert) throw ersterFehler
}
