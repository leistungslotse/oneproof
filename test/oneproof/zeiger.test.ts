import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { binde, liegtUnter, musterVon, treffer, wertBei, zerlege, zusammen } from '../../src/engine/oneproof/zeiger.ts'

const daten = {
  personen: [{ id: 'p1' }, { id: 'p2' }],
  fachdaten: {
    'a/b': { '~x': 1 },
    personen: [
      { person: 'p1', einkommen: { vorhanden: true, eintraege: [{ betrag: 10 }, { betrag: 20 }] } },
      { person: 'p2', einkommen: { vorhanden: false } },
    ],
    leer: [],
  },
}

describe('JSON-Pointer', () => {
  it('splits and joins with the escapes of RFC 6901', () => {
    assert.deepEqual(zerlege('/fachdaten/a~1b/~0x'), ['fachdaten', 'a/b', '~x'])
    assert.deepEqual(zerlege(''), [])
    assert.equal(zerlege('ohne-schraegstrich'), null)
    assert.equal(zusammen(['fachdaten', 'a/b', '~x']), '/fachdaten/a~1b/~0x')
  })

  it('reads the value a pointer leads to, and nothing where the document has none', () => {
    assert.equal(wertBei(daten, '/fachdaten/a~1b/~0x'), 1)
    assert.equal(wertBei(daten, '/fachdaten/personen/0/einkommen/eintraege/1/betrag'), 20)
    assert.equal(wertBei(daten, '/fachdaten/personen/2'), undefined)
    assert.equal(wertBei(daten, '/fachdaten/personen/01'), undefined, 'no leading zero in an index')
    assert.equal(wertBei(daten, '/fachdaten/personen/0/einkommen/toString'), undefined, 'only own properties')
  })

  it('turns a pointer into its pattern', () => {
    assert.equal(musterVon('/fachdaten/personen/0/einkommen/eintraege/1', daten), '/fachdaten/personen/*/einkommen/eintraege/*')
    // Where the document ends, nothing tells an index from a key: it stays as it is.
    assert.equal(musterVon('/fachdaten/personen/1/einkommen/eintraege/0', daten), '/fachdaten/personen/*/einkommen/eintraege/0')
  })

  it('finds every place of a pattern, and where the document ends above it', () => {
    const gefunden = treffer(daten, '/fachdaten/personen/*/einkommen/eintraege/*').map(({ teile, fehlt }) => [zusammen(teile), fehlt])
    assert.deepEqual(gefunden, [
      ['/fachdaten/personen/0/einkommen/eintraege/0', []],
      ['/fachdaten/personen/0/einkommen/eintraege/1', []],
      ['/fachdaten/personen/1/einkommen', ['eintraege', '*']],
    ])
    assert.deepEqual(treffer(daten, '/fachdaten/leer/*'), [{ teile: ['fachdaten', 'leer'], fehlt: ['*'] }])
  })

  it('binds a pattern to a place as far as both run the same way', () => {
    const ort = zerlege('/fachdaten/personen/1/einkommen/eintraege/0')
    assert.ok(ort)
    const gebunden = (muster: string): string => {
      const teile = binde(muster, ort)
      assert.ok(teile)
      return zusammen(teile)
    }
    assert.equal(gebunden('/fachdaten/personen/*/einkommen/vorhanden'), '/fachdaten/personen/1/einkommen/vorhanden')
    assert.equal(gebunden('/fachdaten/vermoegen/vorhanden'), '/fachdaten/vermoegen/vorhanden')
    assert.equal(binde('/fachdaten/haushalt/mitbewohner/eintraege/*/vorname', ort), null, 'a list the place is not in names no single value')
    assert.equal(binde('/personen/*/name', ort), null)
  })

  it('knows what lies below a pointer', () => {
    assert.ok(liegtUnter('/fachdaten/personen/0/einkommen', '/fachdaten/personen/0'))
    assert.ok(liegtUnter('/fachdaten/personen/0', '/fachdaten/personen/0'))
    assert.ok(!liegtUnter('/fachdaten/personen/01', '/fachdaten/personen/0'))
  })
})
