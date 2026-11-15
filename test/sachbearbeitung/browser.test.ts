import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mitZwischenspeicher } from '../../src/browser.ts'

describe('Zwischenspeicher für Dateien der Seite', () => {
  it('asks once for each address', async () => {
    const gefragt: string[] = []
    const lesen = mitZwischenspeicher(async (adresse) => (gefragt.push(adresse), { adresse }))

    assert.deepEqual(await lesen('/a'), { adresse: '/a' })
    assert.deepEqual(await lesen('/a'), { adresse: '/a' })
    assert.deepEqual(await lesen('/b'), { adresse: '/b' })
    assert.deepEqual(gefragt, ['/a', '/b'])
  })

  it('does not ask twice while the first answer is still on its way', async () => {
    let gefragt = 0
    const lesen = mitZwischenspeicher(async () => (gefragt++, 'ja'))
    await Promise.all([lesen('/a'), lesen('/a'), lesen('/a')])
    assert.equal(gefragt, 1)
  })

  it('does not keep a failure', async () => {
    let versuche = 0
    const lesen = mitZwischenspeicher(async () => {
      if (++versuche === 1) throw new Error('keine Verbindung')
      return 'da'
    })
    await assert.rejects(lesen('/a'), /keine Verbindung/)
    assert.equal(await lesen('/a'), 'da')
    assert.equal(versuche, 2)
  })
})
