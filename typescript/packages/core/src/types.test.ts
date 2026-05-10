import { describe, it, expect } from 'bun:test'
import { Schema } from './types'

describe('Schema', () => {
  it('creates a schema with checks', () => {
    const schema = new Schema({
      name: 'test',
      checks: [{ name: 'pass', run: async () => ({ checkName: 'pass', passed: true }) }],
    })
    expect(schema.name).toBe('test')
    expect(schema.checks).toHaveLength(1)
    expect(schema.failFast).toBe(false)
  })

  it('extends with additional checks', () => {
    const base = new Schema({
      name: 'base',
      checks: [{ name: 'check1', run: async () => ({ checkName: 'check1', passed: true }) }],
    })
    const extended = base.extend([
      { name: 'check2', run: async () => ({ checkName: 'check2', passed: true }) },
    ])
    expect(extended.checks).toHaveLength(2)
    expect(extended.name).toBe('base')
    expect(base.checks).toHaveLength(1) // original unchanged
  })

  it('respects failFast override in extend', () => {
    const base = new Schema({
      name: 'base',
      checks: [],
      failFast: false,
    })
    const extended = base.extend([], true)
    expect(extended.failFast).toBe(true)
  })
})
