import { decodeJwt, generateKeyPair, jwtVerify, SignJWT } from 'jose'
import type { JWTPayload } from 'jose'

/** Tokens as the NOOTS components seal them: JWS compact serialization, ES256. */
export interface Tokens {
  sign(payload: JWTPayload): Promise<string>
  /** The payload of a token this mock sealed and that has not expired, else null. */
  verify(token: string): Promise<JWTPayload | null>
}

/** The key lives as long as the process. */
export async function createTokens(): Promise<Tokens> {
  const { privateKey, publicKey } = await generateKeyPair('ES256')
  return {
    sign: (payload) => new SignJWT(payload).setProtectedHeader({ alg: 'ES256', typ: 'JWT' }).sign(privateKey),
    async verify(token) {
      try {
        return (await jwtVerify(token, publicKey, { algorithms: ['ES256'], requiredClaims: ['exp'] })).payload
      } catch {
        return null
      }
    },
  }
}

/** The payload of a token, without checking who sealed it. */
export function decodeToken(token: string): JWTPayload | null {
  try {
    return decodeJwt(token)
  } catch {
    return null
  }
}

export const nowSeconds = () => Math.floor(Date.now() / 1000)
