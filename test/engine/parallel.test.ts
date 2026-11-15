import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mitBegrenzung } from '../../src/engine/parallel.ts'

const pause = (ms = 1) => new Promise((erfuellt) => setTimeout(erfuellt, ms))

describe('Begrenzte Parallelität', () => {
  it('works through every entry', async () => {
    const gesehen: number[] = []
    await mitBegrenzung([1, 2, 3, 4, 5], 2, async (eintrag) => void gesehen.push(eintrag))
    assert.deepEqual(gesehen.sort(), [1, 2, 3, 4, 5])
  })

  it('never runs more jobs at the same time than allowed', async () => {
    let gleichzeitig = 0
    let hoechstens = 0
    await mitBegrenzung(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
      gleichzeitig++
      hoechstens = Math.max(hoechstens, gleichzeitig)
      await pause(2)
      gleichzeitig--
    })
    assert.equal(hoechstens, 3)
  })

  it('copes with an empty list and with a limit larger than the list', async () => {
    await mitBegrenzung([], 3, async () => assert.fail('nothing to do'))
    const gesehen: number[] = []
    await mitBegrenzung([1], 8, async (eintrag) => void gesehen.push(eintrag))
    assert.deepEqual(gesehen, [1])
  })

  it('throws the first error, starts nothing new and tells the others to stop', async () => {
    let gestartet = 0
    let gestoppt = 0

    await assert.rejects(
      mitBegrenzung(Array.from({ length: 10 }, (_, i) => i), 2, async (eintrag, signal) => {
        gestartet++
        if (eintrag === 0) throw new Error('erster')
        await new Promise<void>((erfuellt) => {
          signal.addEventListener('abort', () => {
            gestoppt++
            erfuellt()
          })
        })
        throw new Error('folge')
      }),
      /erster/,
    )

    assert.equal(gestartet, 2)
    assert.equal(gestoppt, 1)
  })

  it('stops when the caller cancels, and starts nothing after that', async () => {
    const aussen = new AbortController()
    let gestartet = 0

    await mitBegrenzung(Array.from({ length: 10 }, (_, i) => i), 1, async () => {
      gestartet++
      aussen.abort()
    }, aussen.signal)

    assert.equal(gestartet, 1)
  })

  it('does not start at all if the caller has cancelled already', async () => {
    const aussen = new AbortController()
    aussen.abort()
    await mitBegrenzung([1, 2], 2, async () => assert.fail('must not start'), aussen.signal)
  })
})
