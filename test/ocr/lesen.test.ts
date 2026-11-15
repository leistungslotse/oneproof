import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ChatEingabe } from '../../src/engine/ionos/client.ts'
import { OCR_ANWEISUNG, OCR_MAX_TOKENS, leseSeite } from '../../src/engine/ocr/lesen.ts'
import type { LeseSeiteOptionen, SeitenLeser } from '../../src/engine/ocr/lesen.ts'

/** What the fake model answers: the text, and whether it hit the token limit. */
interface Vorgabe {
  text: string
  abgeschnitten?: boolean
}

/** A model client that answers from a queue. */
function falscherClient(...antworten: Vorgabe[]) {
  const aufrufe: ChatEingabe[] = []
  return {
    aufrufe,
    async chat(eingabe: ChatEingabe) {
      aufrufe.push(eingabe)
      const antwort = antworten.length > 1 ? antworten.shift() : antworten[0]
      if (antwort === undefined) throw new Error('falscherClient: no answer was prepared')
      return { text: antwort.text, abgeschnitten: antwort.abgeschnitten ?? false }
    },
  } satisfies SeitenLeser & { aufrufe: ChatEingabe[] }
}

const eingabe = (client: SeitenLeser): LeseSeiteOptionen => ({ client, modell: 'ocr-modell', bild: 'data:image/jpeg;base64,AAAA' })

describe('Seite lesen', () => {
  it('sends the instruction and the image as a vision request', async () => {
    const client = falscherClient({ text: 'Mietvertrag' })
    const ergebnis = await leseSeite(eingabe(client))

    assert.deepEqual(ergebnis, { text: 'Mietvertrag', abgeschnitten: false, versuche: 1 })
    assert.equal(client.aufrufe.length, 1)

    const [aufruf] = client.aufrufe
    assert.ok(aufruf)
    assert.equal(aufruf.modell, 'ocr-modell')
    assert.equal(aufruf.maxTokens, OCR_MAX_TOKENS)
    assert.deepEqual(aufruf.nachrichten[0]?.content, [
      { type: 'text', text: OCR_ANWEISUNG },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
    ])
  })

  it('removes an echo of the instruction from the text', async () => {
    const client = falscherClient({ text: 'Kopf\nGib jede Checkbox/jedes Ankreuzkästchen IMMER aus\nMiete 950 €' })
    assert.equal((await leseSeite(eingabe(client))).text, 'Kopf\nMiete 950 €')
  })

  it('removes repeated lines', async () => {
    const client = falscherClient({ text: 'a\nb\nb\nb\nb\nb\nc' })
    assert.equal((await leseSeite(eingabe(client))).text, 'a\nb\nb\nc')
  })

  it('reads again once if the answer hit the token limit, and takes the complete second answer', async () => {
    const voll = Array.from({ length: 60 }, (_, i) => `Zeile ${i} mit eigenem Inhalt`).join('\n')
    const client = falscherClient({ text: voll.slice(0, 400), abgeschnitten: true }, { text: voll })

    const ergebnis = await leseSeite(eingabe(client))

    assert.equal(client.aufrufe.length, 2)
    assert.equal(ergebnis.versuche, 2)
    assert.equal(ergebnis.abgeschnitten, false)
    assert.equal(ergebnis.text, voll)
  })

  it('keeps the first text and marks it as cut off if the second answer is cut off as well', async () => {
    const lang = Array.from({ length: 60 }, (_, i) => `Zeile ${i} mit eigenem Inhalt`).join('\n')
    const client = falscherClient({ text: lang, abgeschnitten: true })

    const ergebnis = await leseSeite(eingabe(client))

    assert.equal(client.aufrufe.length, 2)
    assert.equal(ergebnis.abgeschnitten, true)
    assert.equal(ergebnis.text, lang)
  })

  it('does not read again after a repetition loop: the text before the loop is complete', async () => {
    const schleife = ['Mietvertrag', 'Miete 950 €', ...Array.from({ length: 300 }, () => 'dieselbe Zeile wieder')].join('\n')
    const client = falscherClient({ text: schleife, abgeschnitten: true })

    const ergebnis = await leseSeite(eingabe(client))

    assert.equal(client.aufrufe.length, 1)
    assert.equal(ergebnis.abgeschnitten, false)
    assert.ok(ergebnis.text.startsWith('Mietvertrag\nMiete 950 €'))
    assert.ok(ergebnis.text.length < 100)
  })

  it('returns an empty text for a blank page', async () => {
    const ergebnis = await leseSeite(eingabe(falscherClient({ text: '' })))
    assert.deepEqual(ergebnis, { text: '', abgeschnitten: false, versuche: 1 })
  })

  it('lets an error of the client through', async () => {
    const client = {
      chat: async () => {
        throw new Error('weg')
      },
    }
    await assert.rejects(leseSeite(eingabe(client)), /weg/)
  })
})
