import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ADJUSTMENT, REJECTION, Slot, place } from '../../src/engine/zuordnung/platzierung.ts'
import type { Item, Target } from '../../src/engine/zuordnung/platzierung.ts'

// The engine knows neither a benefit nor a schema: all cases work with invented arts and
// features. That is the precondition for using it with any further application type.

const slotsOf = (items: Item[], targets: Target[]): Record<string, string[]> => place(items, targets).bySlot

describe('Platzierung', () => {
  it('places evidence at the only slot that qualifies', () => {
    const bySlot = slotsOf([{ name: 'Mietvertrag.pdf', art: 'miete' }], [{ slot: 'miete', art: 'miete' }])
    assert.deepEqual(bySlot, { miete: ['Mietvertrag.pdf'] })
  })

  it('rejects evidence whose art has no slot, with a reason', () => {
    const plan = place([{ name: 'Kontoauszug.pdf', art: 'konto' }], [{ slot: 'miete', art: 'miete' }])
    assert.deepEqual(plan.bySlot, {})
    assert.equal(plan.rejections.length, 1)
    assert.equal(plan.rejections[0]?.reason, REJECTION.NO_TARGET)
    assert.equal(plan.rejections[0]?.art, 'konto')
  })

  it('collects several items at the same slot', () => {
    const bySlot = slotsOf(
      [
        { name: 'Januar.pdf', art: 'einnahmen' },
        { name: 'Februar.pdf', art: 'einnahmen' },
      ],
      [{ slot: 'einnahmen#p0#e0', art: 'einnahmen' }],
    )
    assert.deepEqual(bySlot, { 'einnahmen#p0#e0': ['Januar.pdf', 'Februar.pdf'] })
  })

  it('takes the first slot when several similar slots qualify and says so', () => {
    const plan = place(
      [{ name: 'Abrechnung.pdf', art: 'einnahmen', merkmale: { income_type: 'salary' } }],
      [
        { slot: 'einnahmen#p0#e0', art: 'einnahmen', person: 0, merkmale: { income_type: 'salary' }, label: 'Einnahme 1' },
        { slot: 'einnahmen#p0#e1', art: 'einnahmen', person: 0, merkmale: { income_type: 'salary' }, label: 'Einnahme 2' },
      ],
    )
    assert.deepEqual(plan.bySlot, { 'einnahmen#p0#e0': ['Abrechnung.pdf'] })
    assert.equal(plan.adjustments.length, 1)
    assert.equal(plan.adjustments[0]?.kind, ADJUSTMENT.FIRST_OF_SEVERAL)
    assert.equal(plan.adjustments[0]?.candidates, 2)
    assert.equal(plan.adjustments[0]?.placedAt, 'Einnahme 1')
  })

  it('prefers the slot the evidence explicitly confirms, even if another comes first', () => {
    const plan = place(
      [{ name: 'Rente.pdf', art: 'einnahmen', person: 1, merkmale: { income_type: 'pension' } }],
      [
        { slot: 'einnahmen#p0#e0', art: 'einnahmen', person: 0, merkmale: { income_type: 'pension' } },
        { slot: 'einnahmen#p1#e0', art: 'einnahmen', person: 1, merkmale: { income_type: 'pension' } },
      ],
    )
    assert.deepEqual(plan.bySlot, { 'einnahmen#p1#e0': ['Rente.pdf'] })
    assert.deepEqual(plan.adjustments, [])
  })

  it('makes no remark when a later slot fits better than two equal ones before it', () => {
    const plan = place(
      [{ name: 'A.pdf', art: 'einnahmen', person: 2 }],
      [
        { slot: 'e#p0', art: 'einnahmen', person: null },
        { slot: 'e#p1', art: 'einnahmen', person: null },
        { slot: 'e#p2', art: 'einnahmen', person: 2 },
      ],
    )
    assert.deepEqual(plan.bySlot, { 'e#p2': ['A.pdf'] })
    assert.deepEqual(plan.adjustments, [])
  })

  it('separates similar slots by a feature', () => {
    const bySlot = slotsOf(
      [{ name: 'Rente.pdf', art: 'einnahmen', merkmale: { income_type: 'pension' } }],
      [
        { slot: 'einnahmen#p0#e0', art: 'einnahmen', person: 0, merkmale: { income_type: 'salary' } },
        { slot: 'einnahmen#p0#e1', art: 'einnahmen', person: 0, merkmale: { income_type: 'pension' } },
      ],
    )
    assert.deepEqual(bySlot, { 'einnahmen#p0#e1': ['Rente.pdf'] })
  })

  it('separates similar slots by person', () => {
    const bySlot = slotsOf(
      [{ name: 'Albert.pdf', art: 'einnahmen', person: 1 }],
      [
        { slot: 'einnahmen#p0#e0', art: 'einnahmen', person: 0 },
        { slot: 'einnahmen#p1#e0', art: 'einnahmen', person: 1 },
      ],
    )
    assert.deepEqual(bySlot, { 'einnahmen#p1#e0': ['Albert.pdf'] })
  })

  it('does not exclude a nameless item while only one slot remains', () => {
    const bySlot = slotsOf(
      [{ name: 'Namenlos.pdf', art: 'einnahmen', person: null }],
      [{ slot: 'einnahmen#p1#e0', art: 'einnahmen', person: 1 }],
    )
    assert.deepEqual(bySlot, { 'einnahmen#p1#e0': ['Namenlos.pdf'] })
  })

  it('keeps an item bound to a person away from a foreign person', () => {
    const plan = place(
      [{ name: 'Albert.pdf', art: 'einnahmen', person: 1 }],
      [{ slot: 'einnahmen#p0#e0', art: 'einnahmen', person: 0 }],
    )
    assert.deepEqual(plan.bySlot, {})
    assert.equal(plan.rejections[0]?.reason, REJECTION.NO_TARGET)
  })

  it('lets a household-wide slot take an item with a person', () => {
    const bySlot = slotsOf([{ name: 'Albert.pdf', art: 'miete', person: 1 }], [{ slot: 'miete', art: 'miete', person: null }])
    assert.deepEqual(bySlot, { miete: ['Albert.pdf'] })
  })

  it('does not treat a feature only one side knows as a contradiction', () => {
    const bySlot = slotsOf(
      [{ name: 'Beleg.pdf', art: 'einnahmen' }],
      [{ slot: 'einnahmen#p0#e0', art: 'einnahmen', merkmale: { income_type: 'salary' } }],
    )
    assert.deepEqual(bySlot, { 'einnahmen#p0#e0': ['Beleg.pdf'] })
  })

  it('allows several values for a feature when the evidence does not distinguish further', () => {
    const item: Item = { name: 'EUR.pdf', art: 'einnahmen', merkmale: { income_type: ['freelance', 'agri'] } }
    assert.deepEqual(slotsOf([item], [{ slot: 'x#e0', art: 'einnahmen', merkmale: { income_type: 'agri' } }]), { 'x#e0': ['EUR.pdf'] })
    assert.deepEqual(slotsOf([item], [{ slot: 'x#e0', art: 'einnahmen', merkmale: { income_type: 'salary' } }]), {})
  })

  it('lets one entry of the application stand for several values', () => {
    const target: Target = { slot: 'x#e0', art: 'einnahmen', merkmale: { income_type: ['student_support', 'vocational_allowance'] } }
    const bafoeg: Item = { name: 'a', art: 'einnahmen', merkmale: { income_type: 'student_support' } }
    const bab: Item = { name: 'b', art: 'einnahmen', merkmale: { income_type: 'vocational_allowance' } }
    const salary: Item = { name: 'c', art: 'einnahmen', merkmale: { income_type: 'salary' } }
    assert.deepEqual(slotsOf([bafoeg, bab, salary], [target]), { 'x#e0': ['a', 'b'] })
  })

  it('takes the first matching slot when both allowed values occur', () => {
    const plan = place(
      [{ name: 'EUR.pdf', art: 'einnahmen', merkmale: { income_type: ['freelance', 'agri'] } }],
      [
        { slot: 'x#e0', art: 'einnahmen', merkmale: { income_type: 'agri' } },
        { slot: 'x#e1', art: 'einnahmen', merkmale: { income_type: 'freelance' } },
      ],
    )
    assert.deepEqual(plan.bySlot, { 'x#e0': ['EUR.pdf'] })
    assert.equal(plan.adjustments[0]?.kind, ADJUSTMENT.FIRST_OF_SEVERAL)
  })

  it('falls back to the coarser slot if the exact one does not exist in this application', () => {
    const plan = place(
      [{ name: 'Hausgeld.pdf', art: 'aufwendung', coarserArt: 'belastung' }],
      [{ slot: 'belastung', art: 'belastung', label: 'Belastung' }],
    )
    assert.deepEqual(plan.bySlot, { belastung: ['Hausgeld.pdf'] })
    assert.equal(plan.adjustments[0]?.kind, ADJUSTMENT.COARSER_ART)
    assert.equal(plan.adjustments[0]?.placedArt, 'belastung')
  })

  it('prefers the exact slot as long as it exists', () => {
    const bySlot = slotsOf(
      [{ name: 'Hausgeld.pdf', art: 'aufwendung', coarserArt: 'belastung' }],
      [
        { slot: 'belastung', art: 'belastung' },
        { slot: 'aufwendung#p0#e0', art: 'aufwendung' },
      ],
    )
    assert.deepEqual(bySlot, { 'aufwendung#p0#e0': ['Hausgeld.pdf'] })
  })

  it('does not become coarser with several exact slots but takes the first exact one', () => {
    const bySlot = slotsOf(
      [{ name: 'Hausgeld.pdf', art: 'aufwendung', coarserArt: 'belastung' }],
      [
        { slot: 'belastung', art: 'belastung' },
        { slot: 'aufwendung#p0#e0', art: 'aufwendung' },
        { slot: 'aufwendung#p0#e1', art: 'aufwendung' },
      ],
    )
    assert.deepEqual(bySlot, { 'aufwendung#p0#e0': ['Hausgeld.pdf'] })
  })

  it('takes a catch-all slot if the application names no slot for the evidence', () => {
    const plan = place(
      [{ name: 'Ausweis.pdf', art: 'schwerbehinderung', person: 0 }],
      [{ slot: 'schwerbehinderung#p0', art: 'schwerbehinderung', person: 0, opensSection: true, label: 'antragstellende Person' }],
    )
    assert.deepEqual(plan.bySlot, { 'schwerbehinderung#p0': ['Ausweis.pdf'] })
    assert.equal(plan.opening.has('schwerbehinderung#p0'), true)
    assert.equal(plan.adjustments[0]?.kind, ADJUSTMENT.SECTION_OPENED)
  })

  it('remembers a catch-all as opened for the evidence but an ordinary named slot not', () => {
    const named = place([{ name: 'a', art: 'x' }], [{ slot: 'x', art: 'x' }])
    assert.equal(named.opening.size, 0)
    const caught = place([{ name: 'a', art: 'x' }], [{ slot: 'x', art: 'x', opensSection: true }])
    assert.equal(caught.opening.has('x'), true)
  })

  it('prefers a named slot to a catch-all — even behind it in the order', () => {
    const bySlot = slotsOf(
      [{ name: 'a', art: 'x' }],
      [
        { slot: 'x#p0', art: 'x', opensSection: true },
        { slot: 'x#p1', art: 'x' },
      ],
    )
    assert.deepEqual(bySlot, { 'x#p1': ['a'] })
  })

  it('does not prefer the named slot of another person to the catch-all of the right person', () => {
    const bySlot = slotsOf(
      [{ name: 'a', art: 'x', person: 1 }],
      [
        { slot: 'x#p0', art: 'x', person: 0 },
        { slot: 'x#p1', art: 'x', person: 1, opensSection: true },
      ],
    )
    assert.deepEqual(bySlot, { 'x#p1': ['a'] })
  })

  it('takes the coarser named slot before the exact catch-all', () => {
    const bySlot = slotsOf(
      [{ name: 'a', art: 'fein', coarserArt: 'grob' }],
      [
        { slot: 'fein', art: 'fein', opensSection: true },
        { slot: 'grob', art: 'grob' },
      ],
    )
    assert.deepEqual(bySlot, { grob: ['a'] })
  })

  it('takes the exact catch-all if there is no named slot', () => {
    const bySlot = slotsOf([{ name: 'a', art: 'fein', coarserArt: 'grob' }], [{ slot: 'fein', art: 'fein', opensSection: true }])
    assert.deepEqual(bySlot, { fein: ['a'] })
  })

  it('does not admit a catch-all across a contradiction', () => {
    const plan = place(
      [{ name: 'a', art: 'x', person: 1 }],
      [{ slot: 'x#p0', art: 'x', person: 0, opensSection: true }],
    )
    assert.deepEqual(plan.bySlot, {})
    assert.equal(plan.rejections.length, 1)
  })

  it('lets the reference keep the group of a named slot without remarking on it', () => {
    const plan = place([{ name: 'a', art: 'x' }], [{ slot: 'x', art: 'x', keepsSection: true }])
    assert.equal(plan.opening.has('x'), true)
    assert.deepEqual(plan.adjustments, [])
  })

  it('prefers a named slot that merely has to keep its group to a catch-all', () => {
    const bySlot = slotsOf(
      [{ name: 'a', art: 'x' }],
      [
        { slot: 'x#p0', art: 'x', opensSection: true },
        { slot: 'x#p1', art: 'x', keepsSection: true },
      ],
    )
    assert.deepEqual(bySlot, { 'x#p1': ['a'] })
  })

  it('builds slot keys for all three levels by one rule', () => {
    assert.equal(Slot.household('miete'), 'miete')
    assert.equal(Slot.person('transferleistung', 2), 'transferleistung#p2')
    assert.equal(Slot.entry('einnahmen', 0, 3), 'einnahmen#p0#e3')
  })

  it('accounts for an item without a recognisable art instead of skipping it', () => {
    const plan = place(
      [
        { name: 'Unbekannt.pdf', art: null, bezeichnung: 'Kontoauszug' },
        { name: 'Ohne.pdf', art: null },
      ],
      [{ slot: 'miete', art: 'miete' }],
    )
    assert.deepEqual(plan.bySlot, {})
    assert.deepEqual(
      plan.rejections.map((r) => [r.name, r.reason, r.bezeichnung]),
      [
        ['Unbekannt.pdf', REJECTION.UNCLASSIFIED, 'Kontoauszug'],
        ['Ohne.pdf', REJECTION.UNCLASSIFIED, null],
      ],
    )
  })

  it('lists every delivered item in exactly one of the two lists', () => {
    const items: Item[] = [
      { name: 'a.pdf', art: 'miete' },
      { name: 'b.pdf', art: 'konto' },
      { name: 'c.pdf', art: null },
      { name: 'd.pdf', art: 'miete' },
    ]
    const plan = place(items, [{ slot: 'miete', art: 'miete' }])
    const placed = Object.values(plan.bySlot).flat()
    const rejected = plan.rejections.map((r) => r.name)
    assert.deepEqual([...placed, ...rejected].sort(), items.map((i) => i.name).sort())
    assert.equal(new Set([...placed, ...rejected]).size, items.length)
  })

  it('does not report an adjustment for evidence at the one slot that exists', () => {
    const plan = place([{ name: 'a', art: 'x' }], [{ slot: 'x', art: 'x' }])
    assert.deepEqual(plan.adjustments, [])
  })

  it('lists several adjustments of the same evidence individually', () => {
    const plan = place(
      [{ name: 'a', art: 'fein', coarserArt: 'grob' }],
      [
        { slot: 'grob#p0', art: 'grob', opensSection: true, label: 'P0' },
        { slot: 'grob#p1', art: 'grob', opensSection: true, label: 'P1' },
      ],
    )
    assert.deepEqual(plan.adjustments.map((a) => a.kind).sort(), [
      ADJUSTMENT.COARSER_ART,
      ADJUSTMENT.FIRST_OF_SEVERAL,
      ADJUSTMENT.SECTION_OPENED,
    ])
  })
})
