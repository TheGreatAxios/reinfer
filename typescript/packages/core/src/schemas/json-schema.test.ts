import { describe, it, expect } from 'bun:test'
import { validJson, isObject, requiredFields, fieldTypes, enumValues } from './json-schema'

describe('validJson', () => {
  it('passes for valid JSON', async () => {
    const result = await validJson().run('{"a": 1}')
    expect(result.passed).toBe(true)
  })

  it('fails for invalid JSON', async () => {
    const result = await validJson().run('{invalid}')
    expect(result.passed).toBe(false)
    expect(result.message).toBeTruthy()
  })

  it('passes for valid JSON array', async () => {
    const result = await validJson().run('[1, 2, 3]')
    expect(result.passed).toBe(true)
  })
})

describe('isObject', () => {
  it('passes for objects', async () => {
    expect((await isObject().run({})).passed).toBe(true)
    expect((await isObject().run({ a: 1 })).passed).toBe(true)
  })

  it('fails for arrays', async () => {
    expect((await isObject().run([])).passed).toBe(false)
  })

  it('fails for primitives', async () => {
    expect((await isObject().run('string')).passed).toBe(false)
    expect((await isObject().run(42)).passed).toBe(false)
    expect((await isObject().run(null)).passed).toBe(false)
  })
})

describe('requiredFields', () => {
  it('passes when all required fields exist', async () => {
    const result = await requiredFields(['name', 'age']).run({ name: 'Alice', age: 30 })
    expect(result.passed).toBe(true)
  })

  it('fails when a required field is missing', async () => {
    const result = await requiredFields(['name', 'age']).run({ name: 'Alice' })
    expect(result.passed).toBe(false)
    expect(result.message).toContain('age')
  })

  it('fails when a required field is null', async () => {
    const result = await requiredFields(['name']).run({ name: null })
    expect(result.passed).toBe(false)
  })

  it('fails when a required field is undefined', async () => {
    const result = await requiredFields(['name']).run({ name: undefined })
    expect(result.passed).toBe(false)
  })
})

describe('fieldTypes', () => {
  it('passes when all fields match expected types', async () => {
    const result = await fieldTypes({ name: 'string', age: 'number' }).run({ name: 'Alice', age: 30 })
    expect(result.passed).toBe(true)
  })

  it('fails when a field type does not match', async () => {
    const result = await fieldTypes({ age: 'number' }).run({ age: '30' })
    expect(result.passed).toBe(false)
    expect(result.message).toContain('age')
    expect(result.message).toContain('number')
    expect(result.message).toContain('string')
  })

  it('skips missing fields (handled by requiredFields)', async () => {
    const result = await fieldTypes({ age: 'number' }).run({})
    expect(result.passed).toBe(true)
  })
})

describe('enumValues', () => {
  it('passes when value is in allowed list', async () => {
    const result = await enumValues('status', ['active', 'inactive']).run({ status: 'active' })
    expect(result.passed).toBe(true)
  })

  it('fails when value is not allowed', async () => {
    const result = await enumValues('status', ['active', 'inactive']).run({ status: 'banned' })
    expect(result.passed).toBe(false)
    expect(result.message).toContain('banned')
    expect(result.message).toContain('active')
  })

  it('skips missing field', async () => {
    const result = await enumValues('status', ['active']).run({})
    expect(result.passed).toBe(true)
  })
})
