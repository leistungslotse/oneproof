import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { dateiArt } from '../../src/pdf/art.ts'

describe('Art einer Nachweisdatei', () => {
  it('goes by the media type', () => {
    assert.equal(dateiArt({ name: 'x', type: 'application/pdf' }), 'pdf')
    assert.equal(dateiArt({ name: 'x', type: 'image/jpeg' }), 'bild')
    assert.equal(dateiArt({ name: 'x', type: 'image/png' }), 'bild')
  })

  it('goes by the ending if the system reports no usable type', () => {
    assert.equal(dateiArt({ name: 'Scan.PDF', type: '' }), 'pdf')
    assert.equal(dateiArt({ name: 'foto.JPG', type: 'application/octet-stream' }), 'bild')
    assert.equal(dateiArt({ name: 'foto.jpeg', type: '' }), 'bild')
    assert.equal(dateiArt({ name: 'bild.png', type: '' }), 'bild')
  })

  it('refuses anything else', () => {
    assert.equal(dateiArt({ name: 'brief.docx', type: '' }), null)
    assert.equal(dateiArt({ name: 'brief.pdf', type: 'text/plain' }), null)
    assert.equal(dateiArt({ name: 'ohne-endung', type: '' }), null)
    assert.equal(dateiArt({ name: 'x', type: 'constructor' }), null)
    assert.equal(dateiArt({ name: 'x.constructor', type: '' }), null)
  })
})
