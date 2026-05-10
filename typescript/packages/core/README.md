# reinfer

Shared validation engine for reinfer. Zero runtime dependencies.

## Install

```bash
bun add reinfer
```

## Usage

```typescript
import { Schema, validate, autoFixJson, validJson, requiredFields } from 'reinfer'

// Create a schema with checks
const schema = new Schema({
  name: 'person',
  checks: [
    validJson(),
    requiredFields(['name', 'age']),
  ],
})

// Validate against a schema
const result = await validate('{"name": "Alice", "age": 30}', schema)
console.log(result.passed) // true
console.log(result.violations) // []

// Auto-fix malformed JSON
const { fixed, fixes } = autoFixJson('{"name": "Alice",}') 
console.log(fixed) // '{"name": "Alice"}'
console.log(fixes) // ['removed_trailing_commas']
```

## API

See [AGENTS.md](./AGENTS.md) for detailed module documentation.
