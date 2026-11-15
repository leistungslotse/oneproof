/**
 * Which person of the application does a name on a document belong to?
 *
 * A document spells a name its own way: "Einstein, Albert", "ALBERT EINSTEIN", "Dr. A. Einstein",
 * "Jorg Weiss" for Jörg Weiß, "Anna Schmidt geb. Müller", "Müller-Lüdenscheidt, Anna", "Hans
 * Müller jun.". The comparison therefore works on the parts of a name, not on the string:
 *
 *  - case, accents, titles ("Dr.", "Herr") and suffixes ("jun.", "sen.") do not count, and an
 *    umlaut equals its spelling with and without "e" (ö = oe = o, ß = ss = s);
 *  - the family name may stand first or last, with or without a comma; each part of a double name
 *    counts, a birth name ("geb. Müller") too;
 *  - a given name must not contradict: "Lisa Müller" is not Anna Müller. A further given name is no
 *    contradiction ("Albert Konrad Einstein"), an initial is the beginning of a given name.
 *
 * The result says more than "found" or "not found". A name that fits several persons equally
 * (the family name alone, father and son of the same name) is ambiguous, not unknown. A name the
 * application gives for someone outside the household — a deceased member, a flatmate, the
 * recipient of maintenance — is known, though it is no person of the household. "Eheleute
 * Einstein" or "Svenja und Albert Einstein" is the household. Only a name that fits nobody the
 * application names is reported as unknown, so that the result can say so instead of silently
 * placing someone else's document.
 */

/** A name in parts, as an application of the OneProof Format gives it. */
export interface NameInTeilen {
  vorname?: string
  nachname?: string
  geburtsname?: string
  /** The name as the application spells it. */
  anzeige?: string
}

/** A person of the household as the application names them: in parts, as text, or not at all. */
export type Haushaltsname = string | NameInTeilen | null | undefined

/** A person the application names outside the household (a flatmate, a deceased member, …). */
export interface Nebenperson extends NameInTeilen {
  id: string
  anzeige: string
}

/** How a name on a document fits one name of the application, from the best fit down. */
type Passung = 'voll' | 'teil' | 'nachname'

/** A name taken apart into the words that are compared. */
interface Antragsname {
  vorname: string[]
  familie: string[]
  geburt: string[]
}

/** A name on a document: its words, and the words of its birth name. */
interface GelesenerName {
  worte: string[]
  geburt: string[]
}

/** How a name on a document was matched to the persons of the application. */
export interface PersonMatch {
  /** Person of the household, `null` if none is certain. */
  index: number | null
  /** How it was resolved. */
  stufe: Passung | 'neben' | 'haushalt' | null
  /** `false` if the name fits nobody the application names. */
  bekannt: boolean
  /** Persons of the household the name could mean. */
  kandidaten: number[]
  /** Id of a person outside the household the application names. */
  neben: string | null
  /** The name as the application spells it, where it is certain. */
  anzeige: string | null
}

/** The persons an application names, and how to find the one a name on a document means. */
export interface PersonDirectory {
  /** The names of the household as the application spells them, by index. */
  names: (string | null)[]
  nebenpersonen: { id: string; anzeige: string }[]
  match: (name: string | null | undefined) => PersonMatch
  /** The name of a person as the result should print it, or a role as fallback. */
  label: (index: number, roles?: { applicant?: string; member?: string }) => string
}

const TITEL = new Set([
  'dr', 'prof', 'dipl', 'ing', 'med', 'jur', 'rer', 'nat', 'phil', 'mag', 'hon', 'habil',
  'herr', 'herrn', 'frau', 'hr', 'fr', 'mr', 'mrs', 'ms', 'msc', 'bsc', 'mba', 'phd',
])

/** Words after a name that tell father and son apart, but are no part of the name in the application. */
const ZUSAETZE = new Set(['jun', 'jr', 'junior', 'sen', 'sr', 'senior'])

/** Particles of a family name ("von der Leyen"): never the distinguishing part. */
const PARTIKEL = new Set(['von', 'vom', 'van', 'der', 'den', 'de', 'del', 'di', 'da', 'zu', 'zum', 'zur', 'ten', 'ter', 'la', 'le', 'af'])

/** Words that name a couple or a family rather than one person. */
const VERBINDUNG = new Set(['und', 'eheleute', 'ehepaar', 'familie', 'fam', 'geschwister'])

/** The same in the text as written; "u." and "&" only between words, never as an initial. */
const NENNT_MEHRERE = /(^|[\s,])(und|eheleute|ehepaar|familie|fam\.|geschwister)(?=[\s,.]|$)|\s(u\.|&|\+)\s/i

const UMSCHRIFT: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', å: 'a' }

/**
 * One word as it is compared: lower case, without accents, and with every way of writing an umlaut
 * brought to the same form — "Jörg", "Joerg" and "Jorg" all become `jorg`, "Weiß" and "Weiss" `weis`.
 */
function vergleichsform(wort: string): string {
  return String(wort)
    .toLowerCase()
    .replace(/[äöüßæœøå]/g, (zeichen) => UMSCHRIFT[zeichen] ?? zeichen)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}]+/gu, '')
    .replace(/ae/g, 'a')
    .replace(/oe/g, 'o')
    .replace(/ue/g, 'u')
    .replace(/ss/g, 's')
}

/**
 * Degrees written with dots ("h.c.", "M.A.", "B.Sc."). Only in this form are they taken out: "Ma"
 * or "Li" without dots is a family name, and a single letter with a dot is an initial.
 */
const GRADE_MIT_PUNKTEN = /(^|[\s,(])(?:h\.\s?c|[mb]\.\s?(?:a|sc|eng|ed)|ll\.\s?[mb]|dipl\.-[a-zäöü]+)\.(?=[\s,)]|$)/gi

/** The words of a text that carry a name: no titles, no suffixes, no punctuation. */
function woerter(text: string | null | undefined): string[] {
  return String(text ?? '')
    .replace(GRADE_MIT_PUNKTEN, '$1 ')
    .split(/[\s,;/&+()-]+|(?<=\.)/)
    .map(vergleichsform)
    .filter((wort) => wort !== '' && !TITEL.has(wort) && !ZUSAETZE.has(wort))
}

const ohnePartikel = (liste: string[]): string[] => liste.filter((wort) => !PARTIKEL.has(wort))

/** "Anna Schmidt geb. Müller" → the name and the birth name. */
function trenneGeburtsname(text: string | null | undefined): { name: string; geburt: string } {
  const ganz = String(text ?? '')
  const treffer = /[\s,]+(?:geb\.|geborene?r?\b|geb\b)\s*/i.exec(ganz)
  if (!treffer) return { name: ganz, geburt: '' }
  return { name: ganz.slice(0, treffer.index), geburt: ganz.slice(treffer.index + treffer[0].length) }
}

/**
 * A name as the application has it: given names, family name, birth name. A free-text name
 * ("Einstein, Albert", "Albert Einstein") is taken apart the way people write it: the family name
 * before a comma, otherwise the last word.
 */
function zerlegeAntragsname(name: Haushaltsname): Antragsname {
  if (name !== null && typeof name === 'object') {
    return {
      vorname: ohnePartikel(woerter(name.vorname)),
      familie: ohnePartikel(woerter(name.nachname)),
      geburt: ohnePartikel(woerter(name.geburtsname)),
    }
  }

  const { name: rest, geburt } = trenneGeburtsname(name)
  const komma = rest.indexOf(',')
  if (komma >= 0) {
    return {
      vorname: ohnePartikel(woerter(rest.slice(komma + 1))),
      familie: ohnePartikel(woerter(rest.slice(0, komma))),
      geburt: ohnePartikel(woerter(geburt)),
    }
  }

  // The last word that is no suffix is the family name; a double name stays together there.
  const roh = rest.trim().split(/\s+/).filter((wort) => woerter(wort).length > 0)
  return {
    vorname: ohnePartikel(woerter(roh.slice(0, -1).join(' '))),
    familie: ohnePartikel(woerter(roh.at(-1) ?? '')),
    geburt: ohnePartikel(woerter(geburt)),
  }
}

/** The display form of a name: "Einstein, Silvia" → "Silvia Einstein". */
export function anzeigeName(name: string | null | undefined): string {
  const text = String(name ?? '').replace(/\s+/g, ' ').trim()
  const komma = text.indexOf(',')
  if (komma < 0) return text
  const vorn = text.slice(komma + 1).trim()
  const hinten = text.slice(0, komma).trim()
  return vorn === '' ? hinten : `${vorn} ${hinten}`
}

/** Order-independent key of a full name: "Einstein, Silvia" and "Silvia Einstein" are equal. */
export function comparisonKey(name: string | null | undefined): string {
  return woerter(trenneGeburtsname(name).name).sort().join(' ')
}

/** Key of the family name: before a comma, otherwise the last word ("von der Leyen" → `leyen`). */
export function surnameKey(name: string | null | undefined): string {
  return zerlegeAntragsname(trenneGeburtsname(name).name).familie.at(-1) ?? ''
}

/** Is `wort` (a given name or an initial) one of the given names? */
const passtZuVorname = (wort: string, vornamen: string[]): boolean =>
  vornamen.includes(wort) || (wort.length === 1 && vornamen.some((vorname) => vorname.startsWith(wort)))

/**
 * How a name on a document fits one name of the application.
 *
 * Returns `voll` for the same given names, `teil` for a common given name or initial, `nachname` for
 * the family name alone, `widerspricht` for the same family name but another given name, and `null`
 * if there is nothing in common.
 */
function vergleiche(gelesen: GelesenerName, person: Antragsname): Passung | 'widerspricht' | null {
  const familien = new Set([...person.familie, ...person.geburt])
  if (familien.size === 0) return null

  const worte = ohnePartikel(gelesen.worte)
  if (!worte.some((wort) => familien.has(wort)) && !gelesen.geburt.some((wort) => familien.has(wort))) return null

  const vornamen = worte.filter((wort) => !familien.has(wort) && !VERBINDUNG.has(wort))
  if (vornamen.length === 0) return 'nachname'
  if (person.vorname.length === 0) return 'nachname'

  if (!vornamen.some((wort) => passtZuVorname(wort, person.vorname))) return 'widerspricht'

  const gleich = vornamen.length === person.vorname.length && vornamen.every((wort) => person.vorname.includes(wort))
  return gleich ? 'voll' : 'teil'
}

const RANG: Record<Passung, number> = { voll: 3, teil: 2, nachname: 1 }

/**
 * Among the names of the application, the ones a name on a document fits best.
 */
function besteTreffer(
  gelesen: GelesenerName,
  eintraege: (Antragsname | null)[],
): { stufe: Passung | 'widerspricht'; treffer: number[] } | null {
  let bester = 0
  let besteStufe: Passung | null = null
  let treffer: number[] = []
  const widersprechen: number[] = []

  for (const [position, eintrag] of eintraege.entries()) {
    if (!eintrag) continue
    const stufe = vergleiche(gelesen, eintrag)
    if (stufe === 'widerspricht') widersprechen.push(position)
    if (stufe === null || stufe === 'widerspricht') continue
    if (RANG[stufe] > bester) {
      bester = RANG[stufe]
      besteStufe = stufe
      treffer = [position]
    } else if (RANG[stufe] === bester) {
      treffer.push(position)
    }
  }

  if (besteStufe !== null) return { stufe: besteStufe, treffer }
  if (widersprechen.length > 0) return { stufe: 'widerspricht', treffer: widersprechen }
  return null
}

/**
 * @param names  persons of the household, by index (0 = applicant, 1.. = members); entries may be empty
 * @param weitere  `nebenpersonen`: persons the application names outside the household (a flatmate,
 *   a deceased member, …)
 */
export function personDirectory(names: Haushaltsname[], { nebenpersonen = [] }: { nebenpersonen?: Nebenperson[] } = {}): PersonDirectory {
  const anzeigen = names.map((name) => (name && typeof name === 'object' ? (name.anzeige ?? null) : (name ?? null)))
  const haushalt = names.map((name) => (name ? zerlegeAntragsname(name) : null))
  const neben = nebenpersonen.map((person) => ({ ...person, teile: zerlegeAntragsname(person) }))

  return {
    names: anzeigen,
    nebenpersonen: neben.map(({ id, anzeige }) => ({ id, anzeige })),

    match(name) {
      const leer: PersonMatch = { index: null, stufe: null, bekannt: true, kandidaten: [], neben: null, anzeige: null }
      const text = String(name ?? '').trim()
      if (text === '') return leer

      const { name: ohneGeburt, geburt } = trenneGeburtsname(text)
      const gelesen = { worte: woerter(ohneGeburt), geburt: ohnePartikel(woerter(geburt)) }
      if (gelesen.worte.length === 0) return leer

      // "Eheleute Einstein", "Svenja und Albert Einstein": the household, not one of its persons.
      const imHaushalt = besteTreffer(gelesen, haushalt)
      if (NENNT_MEHRERE.test(text) && imHaushalt) {
        return { ...leer, stufe: 'haushalt', kandidaten: imHaushalt.treffer }
      }

      if (imHaushalt && imHaushalt.stufe !== 'widerspricht') {
        const [index, ...weitere] = imHaushalt.treffer
        if (index !== undefined && weitere.length === 0) {
          return { ...leer, index, stufe: imHaushalt.stufe, kandidaten: imHaushalt.treffer, anzeige: anzeigen[index] ?? null }
        }
        // Several persons fit equally well: plausible, but not resolvable.
        return { ...leer, kandidaten: imHaushalt.treffer }
      }

      const ausserhalb = besteTreffer(gelesen, neben.map(({ teile }) => teile))
      if (ausserhalb && ausserhalb.stufe !== 'widerspricht') {
        const [position, ...weitere] = ausserhalb.treffer
        const person = position !== undefined && weitere.length === 0 ? neben[position] : undefined
        if (person) return { ...leer, stufe: 'neben', neben: person.id, anzeige: person.anzeige }
        return { ...leer }
      }

      return { ...leer, bekannt: false, kandidaten: imHaushalt?.treffer ?? [] }
    },

    label(index, roles = {}) {
      const name = anzeigen[index]
      if (name) return name
      return index === 0 ? (roles.applicant ?? 'antragstellende Person') : `${roles.member ?? 'Haushaltsmitglied'} ${index}`
    },
  }
}
