import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { anzeigeName, comparisonKey, personDirectory, surnameKey } from '../../src/engine/zuordnung/personen.ts'

describe('Namensschlüssel', () => {
  it('ignores the order of the words, case, titles and punctuation', () => {
    assert.equal(comparisonKey('Einstein, Silvia'), comparisonKey('Silvia Einstein'))
    assert.equal(comparisonKey('Dr. Albert EINSTEIN'), comparisonKey('einstein albert'))
  })

  it('spells out German umlauts so that both spellings meet', () => {
    assert.equal(comparisonKey('Wilhelm Röntgen'), comparisonKey('Wilhelm Roentgen'))
    assert.equal(surnameKey('Straße, Hans'), surnameKey('Hans Strasse'))
  })

  it('takes the family name before a comma, otherwise the last word', () => {
    assert.equal(surnameKey('Einstein, Silvia'), 'einstein')
    assert.equal(surnameKey('Silvia Einstein'), 'einstein')
    assert.equal(surnameKey('von der Leyen, Ursula'), surnameKey('Ursula von der Leyen'))
  })
})

describe('Anzeigename', () => {
  it('turns "Nachname, Vorname" around and leaves other names alone', () => {
    assert.equal(anzeigeName('Einstein, Silvia'), 'Silvia Einstein')
    assert.equal(anzeigeName('  Silvia   Einstein '), 'Silvia Einstein')
    assert.equal(anzeigeName('Einstein,'), 'Einstein')
    assert.equal(anzeigeName(null), '')
  })
})

describe('Personenverzeichnis', () => {
  const household = personDirectory(['Svenja Einstein', 'Albert Einstein'])

  it('resolves the exact full name in any order', () => {
    assert.equal(household.match('Einstein, Albert').index, 1)
    assert.equal(household.match('SVENJA EINSTEIN').index, 0)
    assert.equal(household.match('Einstein, Albert').stufe, 'voll')
  })

  it('resolves by family name only if it is unambiguous', () => {
    const single = personDirectory(['Svenja Einstein', 'Max Planck'])
    assert.deepEqual(
      (({ index, stufe }) => ({ index, stufe }))(single.match('Planck')),
      { index: 1, stufe: 'nachname' },
    )
    // Two Einsteins: the family name alone decides nothing.
    const ambiguous = household.match('Einstein')
    assert.equal(ambiguous.index, null)
    assert.equal(ambiguous.bekannt, true)
    assert.deepEqual(ambiguous.kandidaten, [0, 1])
  })

  it('uses a matching given name or initial to tell apart persons with the same family name', () => {
    assert.equal(household.match('A. Einstein').index, 1)
    assert.equal(household.match('Einstein, S.').index, 0)
    assert.equal(household.match('Albert Konrad Einstein').index, 1)
    assert.equal(household.match('Albert Konrad Einstein').stufe, 'teil')
  })

  it('reports a person who shares nothing with the application as unknown', () => {
    const stranger = household.match('Einstein, Silvia')
    assert.equal(stranger.index, null)
    assert.equal(stranger.bekannt, false)
    assert.equal(household.match('Maria Curie').bekannt, false)
  })

  it('does not take a different given name for the only person with that family name', () => {
    const single = personDirectory(['Svenja Einstein'])
    const other = single.match('Silvia Einstein')
    assert.equal(other.index, null)
    assert.equal(other.bekannt, false)
    assert.equal(single.match('Einstein').index, 0)
  })

  it('returns no person for an empty name', () => {
    assert.equal(household.match('').index, null)
    assert.equal(household.match(null).index, null)
    assert.equal(household.match('   ').bekannt, true)
  })

  it('labels persons with their name or their role', () => {
    const named = personDirectory(['Svenja Einstein', null, null])
    assert.equal(named.label(0), 'Svenja Einstein')
    assert.equal(named.label(1), 'Haushaltsmitglied 1')
    assert.equal(personDirectory([null]).label(0), 'antragstellende Person')
  })
})

describe('Schreibweisen von Namen', () => {
  const haushalt = personDirectory([
    { vorname: 'Jörg', nachname: 'Weiß', anzeige: 'Jörg Weiß' },
    { vorname: 'Anna', nachname: 'Müller-Lüdenscheidt', geburtsname: 'Schmidt', anzeige: 'Anna Müller-Lüdenscheidt' },
    { vorname: 'Ursula', nachname: 'von der Leyen', anzeige: 'Ursula von der Leyen' },
  ])
  const index = (name: string) => haushalt.match(name).index

  it('takes an umlaut with and without its dots and its spelt-out form for the same', () => {
    for (const name of ['JORG WEISS', 'Jorg Weiß', 'Joerg Weiss', 'Weiß, Jörg']) assert.equal(index(name), 0, name)
  })

  it('finds a person by each part of a double name and by the birth name', () => {
    for (const name of ['Anna Muller-Ludenscheidt', 'Anna Müller', 'Müller-Lüdenscheidt, Anna', 'Anna Schmidt', 'Anna Müller geb. Schmidt']) {
      assert.equal(index(name), 1, name)
    }
  })

  it('ignores titles, suffixes and name particles', () => {
    assert.equal(index('Dr. Ursula von der Leyen'), 2)
    assert.equal(index('von der Leyen, Ursula'), 2)
    assert.equal(index('Herrn Jörg Weiß jun.'), 0)
  })

  it('returns the name as the application spells it', () => {
    assert.equal(haushalt.match('JOERG WEISS').anzeige, 'Jörg Weiß')
  })

  it('does not decide between two persons of the same name', () => {
    const vaterUndSohn = personDirectory(['Hans Müller', 'Hans Müller'])
    const treffer = vaterUndSohn.match('Hans Müller sen.')
    assert.equal(treffer.index, null)
    assert.equal(treffer.bekannt, true)
    assert.deepEqual(treffer.kandidaten, [0, 1])
  })
})

describe('Personen außerhalb des Haushalts und der Haushalt', () => {
  const verzeichnis = personDirectory(['Svenja Einstein', 'Albert Einstein'], {
    nebenpersonen: [
      { id: 'n1', vorname: 'Max', nachname: 'Planck', anzeige: 'Max Planck' },
      { id: 'n2', vorname: 'Hermann', nachname: 'Einstein', anzeige: 'Hermann Einstein' },
    ],
  })

  it('knows a person the application names outside the household', () => {
    const planck = verzeichnis.match('Planck, Max')
    assert.deepEqual([planck.index, planck.stufe, planck.bekannt, planck.neben], [null, 'neben', true, 'n1'])
    // Same family name as the household, but the given name of the deceased member.
    assert.equal(verzeichnis.match('Hermann Einstein').neben, 'n2')
  })

  it('takes a couple or a family for the household', () => {
    for (const name of ['Eheleute Einstein', 'Svenja und Albert Einstein', 'Familie Einstein', 'Svenja u. Albert Einstein']) {
      const treffer = verzeichnis.match(name)
      assert.deepEqual([treffer.index, treffer.stufe, treffer.bekannt], [null, 'haushalt', true], name)
    }
  })

  it('still reports someone the application does not name', () => {
    assert.equal(verzeichnis.match('Lise Meitner').bekannt, false)
    assert.equal(verzeichnis.match('Silvia Einstein').bekannt, false)
  })
})
