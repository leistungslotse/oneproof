import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pdfMitBild } from '../../src/pdf/bildseite.ts'

/** Enough of a JPEG for the writer, which takes the bytes as they are. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9])
const text = (bytes: Uint8Array): string => new TextDecoder('latin1').decode(bytes)

describe('pdfMitBild', () => {
  it('writes a PDF of one A4 page with the image as it is', () => {
    const pdf = pdfMitBild({ jpeg: JPEG, breite: 1000, hoehe: 1414 })
    const inhalt = text(pdf)
    assert.match(inhalt, /^%PDF-1\.4\n/)
    assert.match(inhalt, /\/MediaBox \[0 0 595\.28 841\.89\]/)
    assert.match(inhalt, /\/Width 1000 \/Height 1414 .*\/Filter \/DCTDecode \/Length 10 >>/)
    assert.ok(inhalt.includes(text(JPEG)), 'the JPEG is embedded unchanged')
    assert.match(inhalt, /%%EOF\n$/)
  })

  it('turns the page for an image that is wider than high, and keeps a margin', () => {
    const inhalt = text(pdfMitBild({ jpeg: JPEG, breite: 3000, hoehe: 1000 }))
    assert.match(inhalt, /\/MediaBox \[0 0 841\.89 595\.28\]/)
    const treffer = /q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm/.exec(inhalt)
    assert.ok(treffer)
    const [, b, h, x, y] = treffer.map(Number)
    assert.ok(b !== undefined && h !== undefined && x !== undefined && y !== undefined)
    assert.ok(Math.abs(b / h - 3) < 0.01, 'proportions kept')
    assert.ok(x >= 28 && y >= 28, 'inside the margin')
    assert.ok(Math.abs(x + b + x - 841.89) < 0.02, 'centred')
  })

  it('has a cross-reference table that points at every object', () => {
    const pdf = pdfMitBild({ jpeg: JPEG, breite: 10, hoehe: 10 })
    const inhalt = text(pdf)
    const [, startwert] = /startxref\n(\d+)\n/.exec(inhalt) ?? []
    assert.ok(startwert)
    const start = Number(startwert)
    assert.equal(inhalt.slice(start, start + 4), 'xref')
    const orte = [...inhalt.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map(([, ort]) => Number(ort))
    assert.equal(orte.length, 5)
    orte.forEach((ort, index) => assert.equal(inhalt.slice(ort, ort + `${index + 1} 0 obj`.length), `${index + 1} 0 obj`))
  })

  it('refuses what is no JPEG or has no size', () => {
    assert.throws(() => pdfMitBild({ jpeg: new Uint8Array([0x89, 0x50]), breite: 10, hoehe: 10 }), /kein JPEG/)
    assert.throws(() => pdfMitBild({ jpeg: JPEG, breite: 0, hoehe: 10 }), /keine Größe/)
  })
})
