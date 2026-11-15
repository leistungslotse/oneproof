import assert from 'node:assert/strict'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { loadRegistry } from '../src/registry/load.ts'
import { DATA, start } from './helpers.ts'

describe('Registry from JSON files', () => {
  let dir: string
  const writePerson = (file: string, content: object) => writeFile(join(dir, 'persons', file), JSON.stringify(content))

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'noots-mock-'))
    await cp(DATA, dir, { recursive: true })
  })
  after(() => rm(dir, { recursive: true }))

  it('reads the example data', async () => {
    const registry = await loadRegistry(DATA)
    assert.equal(registry.evidenceTypes.length, 6)
    assert.equal(registry.persons.length, 6)
    assert.equal(registry.findPerson({ givenName: ' nora', familyName: 'FELDMANN', dateOfBirth: '1994-03-14' })?.givenName, 'Nora')
  })

  it('serves a person from a file dropped into persons/', async () => {
    await writePerson('tom-neumann.json', {
      givenName: 'Tom',
      familyName: 'Neumann',
      dateOfBirth: '1979-12-24',
      evidence: { residenceCertificate: { address: { street: 'Birkenallee 3', city: 'Auenthal' }, movedIn: '2024-02-01' } },
    })
    const mock = await start(dir)
    try {
      const { json } = await mock.call('POST', '/dca/v1/evidence-requests', {
        dataConsumer: { name: 'Wohngeldstelle Auenthal' },
        legalBasis: 'WoGG § 23',
        consent: true,
        subject: { givenName: 'Tom', familyName: 'Neumann', dateOfBirth: '1979-12-24' },
        evidence: [{ evidenceType: 'residenceCertificate' }],
      })
      assert.equal(json.results[0].status, 'delivered')
      assert.match(json.results[0].evidence.content, /<sample:street>Birkenallee 3</)
      const persons = (await mock.call('GET', '/mock/persons')).json
      assert.ok(persons.some((person: { givenName: string }) => person.givenName === 'Tom'))
    } finally {
      await mock.close()
    }
  })

  it('refuses a file that names an unknown evidence type or lacks a field', async () => {
    await writePerson('zz-broken.json', {
      givenName: 'Ida',
      familyName: 'Falsch',
      dateOfBirth: '1980-01-01',
      evidence: { drivingLicence: {} },
    })
    await assert.rejects(loadRegistry(dir), /zz-broken\.json: unknown evidence type drivingLicence/)
    await writePerson('zz-broken.json', { givenName: 'Ida', familyName: 'Falsch' })
    await assert.rejects(loadRegistry(dir), /zz-broken\.json:[\s\S]*dateOfBirth/)
  })
})
