/** Narrowing for request bodies whose every fault has its own problem type, so no schema can reject them wholesale. */
export const asObject = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

export const asString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
