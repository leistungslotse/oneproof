/**
 * Reading helpers for the compact schema files under `public/profile/<profile>/<version>/schema/`.
 *
 * Such a file is the XDatenfelder-3 schema reduced to what the evidence check needs: the
 * hierarchy of groups and fields with ids, labels, multiplicity (`anzahl`), kind of field (`art`),
 * data type (`typ`) and the values of selection fields.
 */

export interface SchemaNode {
  id: string
  name: string
  /** Output label, if it differs from the name. */
  bezeichnung?: string
  /** Input label (the question), if it differs. */
  frage?: string
  /** `min:max` as in the schema, `*` for unbounded. */
  anzahl?: string
  /** Kind of field: input, select, label, … */
  art?: string
  /** Data type: text, date, num_currency, file, … */
  typ?: string
  /** Code → name for selection fields. */
  werte?: Record<string, string>
  kinder?: SchemaNode[]
}

export interface Schema {
  schemaId: string
  version: string
  name: string
  kinder: SchemaNode[]
}

/** The label to show for a node. */
export const labelOf = (node: SchemaNode): string => node.bezeichnung ?? node.name

/** Can the node occur more than once? */
export function isRepeatable(node: SchemaNode): boolean {
  const max = (node.anzahl ?? '1:1').split(':')[1]
  return max === '*' || Number(max) > 1
}

/**
 * Every field of the data type `file` with the path of schema nodes from the top-level group down
 * to the field itself, in schema order.
 */
export function fileFields(schema: Schema): { field: SchemaNode; path: SchemaNode[] }[] {
  const found: { field: SchemaNode; path: SchemaNode[] }[] = []

  const walk = (node: Schema | SchemaNode, path: SchemaNode[]) => {
    for (const child of node.kinder ?? []) {
      const here = [...path, child]
      if (child.typ === 'file') found.push({ field: child, path: here })
      if (child.kinder) walk(child, here)
    }
  }

  walk(schema, [])
  return found
}

/**
 * The key a profile uses to name a position of evidence: the group the file field hangs in and
 * the field itself. Two ids are enough to find the position again in every schema of a benefit —
 * the groups above it differ from one application type to another, these two do not.
 *
 * @param path  path as returned by {@link fileFields}
 */
export function positionKey(path: SchemaNode[]): string {
  const field = path.at(-1)
  if (!field) throw new Error('A position is named by at least its field.')
  return `${path.at(-2)?.id ?? ''}/${field.id}`
}

/** Index of all nodes by id (the same id may occur at several places). */
export function indexById(schema: Schema): Map<string, SchemaNode[][]> {
  const index = new Map<string, SchemaNode[][]>()

  const walk = (node: Schema | SchemaNode, path: SchemaNode[]) => {
    for (const child of node.kinder ?? []) {
      const here = [...path, child]
      const list = index.get(child.id) ?? []
      list.push(here)
      index.set(child.id, list)
      if (child.kinder) walk(child, here)
    }
  }

  walk(schema, [])
  return index
}
