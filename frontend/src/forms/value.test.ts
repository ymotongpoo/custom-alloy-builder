import { describe, expect, it } from 'vitest'
import { inputToValue, valueToInput } from './value'

describe('form value conversion', () => {
  it('converts scalar inputs without writing empty optional values', () => {
    expect(inputToValue('', { kind: 'string' })).toBeUndefined()
    expect(inputToValue('15s', { kind: 'duration' })).toEqual({ t: 'string', v: '15s' })
    expect(inputToValue('42', { kind: 'number' })).toEqual({ t: 'number', v: 42 })
    expect(inputToValue('true', { kind: 'bool' })).toEqual({ t: 'bool', v: true })
  })

  it('converts list and map editor text', () => {
    expect(inputToValue('a\nb\n', { kind: 'list', elem: { kind: 'string' } })).toEqual({
      t: 'list',
      v: [
        { t: 'string', v: 'a' },
        { t: 'string', v: 'b' },
      ],
    })
    expect(inputToValue('team=infra\n', { kind: 'map', value: { kind: 'string' } })).toEqual({
      t: 'map',
      v: { team: { t: 'string', v: 'infra' } },
    })
  })

  it('renders existing values back into form text', () => {
    expect(valueToInput({ t: 'list', v: [{ t: 'string', v: 'one' }] }, { kind: 'list', elem: { kind: 'string' } })).toBe('one')
    expect(valueToInput({ t: 'map', v: { k: { t: 'number', v: 2 } } }, { kind: 'map', value: { kind: 'number' } })).toBe('k=2')
  })
})
