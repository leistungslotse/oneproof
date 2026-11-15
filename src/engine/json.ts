/** Any value as `JSON.parse` yields it. */
export type Json = null | boolean | number | string | Json[] | JsonObjekt

/** A JSON object. */
export interface JsonObjekt {
  [schluessel: string]: Json
}

/**
 * Is this a plain object — not `null`, not an array? For probing data of which nothing is known
 * yet (a file the department uploaded, an answer of the language model): afterwards its members
 * can be read, each of them still `unknown`.
 */
export function istObjekt(wert: unknown): wert is Record<string, unknown> {
  return typeof wert === 'object' && wert !== null && !Array.isArray(wert)
}
