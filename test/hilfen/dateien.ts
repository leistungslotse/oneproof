// Reads files below public/ the way the browser would fetch them.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const oeffentlich = fileURLToPath(new URL('../../public', import.meta.url))
const hierher = fileURLToPath(new URL('..', import.meta.url))

/**
 * Parsed JSON from `public/<path>`, with the path given as a URL path like `/profile/index.json`.
 * The file is trusted test data: the caller names what it holds (`lies<Katalog>(…)`), nothing is checked.
 */
export async function lies<T = unknown>(pfad: string): Promise<T> {
  return JSON.parse(await readFile(oeffentlich + pfad, 'utf8'))
}

/** The bytes of `public/<path>`, as the server would send them. */
export async function leseBytes(pfad: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(oeffentlich + pfad))
}

/** The text of `public/<path>`, as it stands in the file. */
export const leseText = (pfad: string): Promise<string> => readFile(oeffentlich + pfad, 'utf8')

/** Text of a fixture below `test/fixtures/`. */
export const fixture = (name: string): Promise<string> => readFile(`${hierher}/fixtures/${name}`, 'utf8')

export const WOHNGELD = '/profile/wohngeld/2026-11-07/'
