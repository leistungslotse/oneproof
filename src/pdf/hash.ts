/**
 * SHA-512 of a file, as the OneProof manifest wants it ("SHA-512 über das Original, wie in
 * FIT-Connect"). The browser only offers `crypto.subtle` on secure origins (https, localhost); on
 * a plain-http address there is no hash, and the caller has to cope with `null`.
 *
 * @returns 128 hex characters, or `null` if the browser cannot compute it
 */
export async function sha512Hex(daten: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<string | null> {
  const rechner = globalThis.crypto?.subtle
  if (!rechner) return null

  const hash = new Uint8Array(await rechner.digest('SHA-512', daten))
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
