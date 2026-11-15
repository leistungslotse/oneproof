/**
 * What the pages need from the browser and from the site they are served from — shared by the
 * evidence check and the department's page, so that neither reaches into the other.
 */

/** A JSON file of the site, with an error a person can read if it is not there. */
export async function liesJson(adresse: string): Promise<unknown> {
  let antwort: Response
  try {
    antwort = await fetch(adresse)
  } catch {
    throw new Error(`„${adresse}“ konnte nicht geladen werden. Bitte die Verbindung prüfen.`)
  }
  if (!antwort.ok) throw new Error(`„${adresse}“ konnte nicht geladen werden (HTTP ${antwort.status}).`)
  try {
    return await antwort.json()
  } catch {
    throw new Error(`„${adresse}“ ist keine gültige JSON-Datei.`)
  }
}

/**
 * A reader that asks the site once for each address and remembers the answer — for a page that loads
 * the same catalogue and schemas again and again (checking a draft after every change).
 */
export function mitZwischenspeicher<T>(lies: (adresse: string) => Promise<T>): (adresse: string) => Promise<T> {
  const gelesen = new Map<string, Promise<T>>()
  return (adresse) => {
    let antwort = gelesen.get(adresse)
    if (!antwort) {
      // A failure is not kept: the next try should ask again.
      antwort = lies(adresse).catch((fehler: unknown) => {
        gelesen.delete(adresse)
        throw fehler
      })
      gelesen.set(adresse, antwort)
    }
    return antwort
  }
}

/** A file of the site as it is served, byte for byte. */
export async function holeBytes(adresse: string): Promise<Uint8Array<ArrayBuffer>> {
  let antwort: Response
  try {
    antwort = await fetch(adresse)
  } catch {
    throw new Error(`„${adresse}“ konnte nicht geladen werden. Bitte die Verbindung prüfen.`)
  }
  if (!antwort.ok) throw new Error(`„${adresse}“ konnte nicht geladen werden (HTTP ${antwort.status}).`)
  return new Uint8Array(await antwort.arrayBuffer())
}

/** Offers a file to the person to save. `inhalt` is text or bytes. */
export function speichereDatei(name: string, inhalt: string | Uint8Array<ArrayBuffer>, typ = 'application/json'): void {
  const istText = typeof inhalt === 'string'
  const adresse = URL.createObjectURL(new Blob([inhalt], { type: istText ? `${typ};charset=utf-8` : typ }))
  const anker = Object.assign(document.createElement('a'), { href: adresse, download: name })
  document.body.append(anker)
  anker.click()
  anker.remove()
  // The download has started by the time this runs; the address is no longer needed.
  setTimeout(() => URL.revokeObjectURL(adresse), 10_000)
}

/**
 * The storage of the browser for what a person keeps between visits — or `null` where the browser
 * withholds it (blocked site data), in which case nothing is kept.
 */
export function browserSpeicher(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}
