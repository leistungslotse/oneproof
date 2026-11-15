/**
 * Places evidence deterministically at the evidence slots of an application.
 *
 * Port of the placement engine of the LeistungsLotse evidence engine
 * (`EvidencePlacementEngine`). It is deliberately free of any knowledge about a benefit, a
 * schema or a document type: it only knows `items` (what is there) and `targets` (where it could
 * go). Any further benefit is carried by the same code as soon as a profile delivers these two
 * lists.
 *
 * The rule: every item with a recognisable `art` gets exactly ONE slot — the best one that
 * exists. If several fit equally well, the first one in the order of the targets wins (product
 * decision of 23 Oct 2026: a reference at the first of several possible slots is better than
 * none, because the case worker finds the file in the right section instead of only in the
 * attachment).
 *
 * A slot qualifies when three conditions hold at once:
 *
 *  1. The same `art`.
 *  2. No contradiction in the person. A household-wide slot (`person === null`) takes every item;
 *     a person slot only takes an item of the same person or of an unknown one.
 *  3. No contradiction in the features (`merkmale`). Only what BOTH sides know is compared; what
 *     only one side knows never restricts — missing knowledge must not look like a contradiction.
 *
 * Among the qualifying slots the one the item confirms most explicitly wins (one point for the
 * matching person, one for each feature both sides know); ties go to the first slot.
 *
 * A *named* slot belongs to a fact the application states. A *catch-all* slot
 * (`opensSection: true`) also exists where the application does not state it, so that e.g. a
 * disability certificate does not get lost just because the application mentions no disability.
 * A catch-all is only used when no named slot qualifies: the application has priority over the
 * evidence, not the other way round. The order of attempts is: named slot of the exact art, named
 * slot of the coarser art, catch-all of the exact art, catch-all of the coarser art.
 *
 * Every item ends up in the result — as an assignment or as a rejection with a reason. There is
 * no third outcome.
 */

import type { Merkmale } from '../profil/laden.ts'

/** Reasons why an item has no slot. Values are kept from the original engine. */
export const REJECTION = Object.freeze({
  /** The application does not state the fact (or not for this person). */
  NO_TARGET: 'no_target',
  /** The art of the evidence could not be determined, or the profile has no slot for its type. */
  UNCLASSIFIED: 'unclassified',
})

/** One of the values of {@link REJECTION}. */
export type RejectionReason = (typeof REJECTION)[keyof typeof REJECTION]

/** What the placement did differently from what the application would have offered by itself. */
export const ADJUSTMENT = Object.freeze({
  FIRST_OF_SEVERAL: 'first_of_several',
  SECTION_OPENED: 'section_opened',
  COARSER_ART: 'coarser_art',
})

/** One of the values of {@link ADJUSTMENT}. */
export type AdjustmentKind = (typeof ADJUSTMENT)[keyof typeof ADJUSTMENT]

/** Slot keys: `art`, `art#p<person>`, `art#p<person>#e<entry>`. */
export const Slot = Object.freeze({
  household: (art: string): string => art,
  person: (art: string, person: number): string => `${art}#p${person}`,
  entry: (art: string, person: number, entry: number): string => `${art}#p${person}#e${entry}`,
})

/** One piece of evidence the placement has to account for. */
export interface Item {
  /** Unique name of the evidence. */
  name: string
  /** Kind of evidence, `null` if unrecognisable. */
  art: string | null
  /** Index of the person, `null` if unknown. */
  person?: number | null
  /** Features; several allowed values may be given. */
  merkmale?: Merkmale
  /** Art to try if the exact art has no target. */
  coarserArt?: string | null
  /** Name of the document type, only passed through. */
  bezeichnung?: string | null
}

/** A place at which evidence may be referenced. */
export interface Target {
  /** See {@link Slot}. */
  slot: string
  art: string
  /** `null` = household-wide. */
  person?: number | null
  /** A list = the entry stands for several values. */
  merkmale?: Merkmale
  /** Catch-all for a section the application does not state. */
  opensSection?: boolean
  /** Named slot whose group could stay empty. */
  keepsSection?: boolean
  label?: string | null
}

/** An item that got no slot, with the reason. */
export interface Rejection {
  name: string
  art: string | null
  reason: RejectionReason
  bezeichnung: string | null
}

/** Where the placement did differently from what the application would have offered by itself. */
export interface Adjustment {
  name: string
  art: string
  kind: AdjustmentKind
  /** The art of the slot the item landed at (the coarser one for `coarser_art`). */
  placedArt: string
  /** How many slots fitted equally well (1 unless `first_of_several`). */
  candidates: number
  /** Label of the slot. */
  placedAt: string | null
  placedSlot: string
  /** The other slots that fitted just as well (only for `first_of_several`). */
  alternatives?: string[]
}

/** The result of the placement: every item is either in `bySlot` or in `rejections`. */
export interface Plan {
  /** Slot → names of the evidence placed there. */
  bySlot: Record<string, string[]>
  rejections: Rejection[]
  /** Slots whose section the evidence opens or keeps. */
  opening: Set<string>
  adjustments: Adjustment[]
}

/** The slot an item was assigned to, and how precisely. */
interface Wahl {
  target: Target
  /** The art the slot was found for (the coarser one, where the exact one had none). */
  art: string
  /** How many slots fitted equally well. */
  ties: number
  /** Those slots, the chosen one included. */
  tied: Target[]
}

/**
 * @param items    in delivery order
 * @param targets  all slots this application can have, in the order in which the first one wins on a tie
 */
export function place(items: readonly Item[], targets: readonly Target[]): Plan {
  const plan: Plan = { bySlot: {}, rejections: [], opening: new Set(), adjustments: [] }

  for (const item of items) {
    // Without an art there is nothing to compare — the item is accounted for, not placed.
    if (item.art == null) {
      plan.rejections.push({
        name: item.name,
        art: null,
        reason: REJECTION.UNCLASSIFIED,
        bezeichnung: item.bezeichnung ?? null,
      })
      continue
    }

    const choice = choose(item, item.art, targets)

    if (choice === null) {
      plan.rejections.push({
        name: item.name,
        art: item.art,
        reason: REJECTION.NO_TARGET,
        bezeichnung: item.bezeichnung ?? null,
      })
      continue
    }

    const { target } = choice
    ;(plan.bySlot[target.slot] ??= []).push(item.name)

    if (target.opensSection || target.keepsSection) plan.opening.add(target.slot)

    plan.adjustments.push(...adjustmentsFor(item, item.art, choice))
  }

  return plan
}

function choose(item: Item, art: string, targets: readonly Target[]): Wahl | null {
  const arts = item.coarserArt == null ? [art] : [art, item.coarserArt]

  // Outer loop: the kind of slot; inner loop: the precision. A named slot of the coarser art goes
  // before a catch-all of the exact art — the application states the fact, if less finely than
  // the evidence proves it.
  for (const opensSection of [false, true]) {
    for (const candidateArt of arts) {
      const [first, ...rest] = candidatesFor(item, candidateArt, opensSection, targets)
      if (first) {
        const [target, ties, tied] = mostSpecific(item, first, rest)
        return { target, art: candidateArt, ties, tied }
      }
    }
  }

  return null
}

/** @param itemArt  the exact art of the item, which `item.art` states but the compiler cannot carry over */
function adjustmentsFor(item: Item, itemArt: string, { target, art, ties, tied = [] }: Wahl): Adjustment[] {
  const adjustments: Adjustment[] = []
  const placedAt = target.label ?? null
  const base = { name: item.name, art: itemArt, placedArt: art, candidates: 1, placedAt, placedSlot: target.slot }

  if (art !== itemArt) adjustments.push({ ...base, kind: ADJUSTMENT.COARSER_ART })
  if (target.opensSection) adjustments.push({ ...base, kind: ADJUSTMENT.SECTION_OPENED })
  if (ties > 1) {
    // Addition to the original, which only counted: the other slots that fitted just as well, so
    // that they can say a document may be theirs.
    const alternatives = tied.filter((kandidat) => kandidat !== target).map((kandidat) => kandidat.slot)
    adjustments.push({ ...base, kind: ADJUSTMENT.FIRST_OF_SEVERAL, candidates: ties, alternatives })
  }

  return adjustments
}

function candidatesFor(item: Item, art: string, opensSection: boolean, targets: readonly Target[]): Target[] {
  return targets.filter(
    (target) =>
      target.art === art &&
      Boolean(target.opensSection) === opensSection &&
      personMatches(item, target) &&
      merkmaleMatch(item, target),
  )
}

/**
 * The slot the item confirms most explicitly — on a tie the first one. Also returns how many
 * slots fitted equally well (the chosen one included); it is above one only where the order, not
 * the evidence, decided.
 *
 * @param first  the first candidate; `rest` are the others, in order
 */
function mostSpecific(item: Item, first: Target, rest: Target[]): [Target, number, Target[]] {
  let best = first
  let bestScore = specificity(item, best)
  let tied = [best]

  for (const candidate of rest) {
    const score = specificity(item, candidate)

    // Strictly greater: on a tie the earlier slot stays.
    if (score > bestScore) {
      best = candidate
      bestScore = score
      tied = [candidate]
    } else if (score === bestScore) {
      tied.push(candidate)
    }
  }

  return [best, tied.length, tied]
}

/**
 * How much the item explicitly knows about this slot: one point for the person and one for each
 * feature both sides know. The slots arriving here passed the contradiction test, so a feature
 * both know agrees.
 */
function specificity(item: Item, target: Target): number {
  const itemPerson = item.person ?? null
  let score = itemPerson !== null && itemPerson === (target.person ?? null) ? 1 : 0

  for (const key of Object.keys(item.merkmale ?? {})) {
    if (Object.hasOwn(target.merkmale ?? {}, key)) score++
  }

  return score
}

function personMatches(item: Item, target: Target): boolean {
  const targetPerson = target.person ?? null
  const itemPerson = item.person ?? null
  return targetPerson === null || itemPerson === null || targetPerson === itemPerson
}

function merkmaleMatch(item: Item, target: Target): boolean {
  const known = target.merkmale ?? {}

  for (const [key, value] of Object.entries(item.merkmale ?? {})) {
    if (!Object.hasOwn(known, key)) continue

    // An item may allow SEVERAL values where it does not distinguish more finely (a profit
    // statement proves self-employed as well as agricultural income). A contradiction is only
    // what fits none of the allowed values — and if the application has both rows, the first wins.
    // A target may likewise stand for several values (one entry of the application that covers
    // e.g. student grants and vocational training allowance): one common value is enough.
    const allowed = Array.isArray(value) ? value : [value]
    const bekannt = known[key]
    const accepted = Array.isArray(bekannt) ? bekannt : [bekannt]
    if (!allowed.some((candidate) => accepted.includes(candidate))) return false
  }

  return true
}
