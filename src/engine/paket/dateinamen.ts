/**
 * The names under which the files of a package are delivered.
 *
 * The name of a file is also its reference in the application (`fim/verweise.ts`), so it has to be
 * the same in both places, unique, and harmless in any file system: lower case, ASCII, words joined
 * by hyphens — `lohn-gehaltsabrechnung-miriam-berger.pdf`. The PHP original names its files the
 * same way (`Str::slug` of type and person); German letters are written out here (ä → ae), not
 * dropped (ä → a).
 */

const UMSCHRIFT: Readonly<Record<string, string>> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', Ä: 'ae', Ö: 'oe', Ü: 'ue', ẞ: 'ss' }

/** What the name of a grouped document is made of. */
export interface DokumentNameEingabe {
  typLabel: string
  person?: string | null
  nichtZugeordnet?: boolean
}

/** Longest part of a name before the extension; type and person fit, a whole sentence does not. */
const LAENGSTER_NAME = 100

/** „Lohn-/Gehaltsabrechnung — Jürgen Groß“ → `lohn-gehaltsabrechnung-juergen-gross`. */
export function kurzform(text: string | null | undefined): string {
  return String(text ?? '')
    .replace(/[äöüßÄÖÜẞ]/g, (zeichen) => UMSCHRIFT[zeichen] ?? zeichen)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LAENGSTER_NAME)
    .replace(/-+$/g, '')
}

/** The file of a grouped document: type and person, or what is known of them. */
export function dokumentName(dokument: DokumentNameEingabe): string {
  if (dokument.nichtZugeordnet) return 'nicht-zugeordnete-seiten.pdf'
  const name = kurzform([dokument.typLabel, dokument.person].filter(Boolean).join(' '))
  return `${name || 'dokument'}.pdf`
}

/** An uploaded file that is delivered as it is: its own name, made harmless. */
export function originalName(name: string): string {
  const punkt = String(name).lastIndexOf('.')
  const stamm = punkt > 0 ? String(name).slice(0, punkt) : String(name)
  const endung = punkt > 0 ? kurzform(String(name).slice(punkt + 1)) : ''
  return `${kurzform(stamm) || 'datei'}${endung ? `.${endung}` : ''}`
}

const teile = (name: string): [stamm: string, endung: string] => {
  const punkt = name.lastIndexOf('.')
  return punkt > 0 ? [name.slice(0, punkt), name.slice(punkt)] : [name, '']
}

/**
 * Makes a list of names unique in place of their order: every name that occurs more than once is
 * numbered, the first included — `bescheid-1.pdf`, `bescheid-2.pdf` — as in the PHP original, so
 * that no file looks like "the" one. `vergeben` are names already taken by other files.
 *
 * @returns same length and order as `namen`
 */
export function eindeutig(namen: readonly string[], vergeben: Iterable<string> = []): string[] {
  const belegt = new Set([...vergeben, ...namen])
  const anzahl = new Map<string, number>()
  for (const name of namen) anzahl.set(name, (anzahl.get(name) ?? 0) + 1)
  const zaehler = new Map<string, number>()
  const reserviert = new Set(vergeben)

  return namen.map((name) => {
    if (anzahl.get(name) === 1 && !reserviert.has(name)) return name
    const [stamm, endung] = teile(name)
    let nummer = zaehler.get(name) ?? 0
    let kandidat: string
    do {
      nummer++
      kandidat = `${stamm}-${nummer}${endung}`
    } while (belegt.has(kandidat))
    zaehler.set(name, nummer)
    belegt.add(kandidat)
    return kandidat
  })
}
