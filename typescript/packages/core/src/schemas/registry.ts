import { Schema } from '../types'

/**
 * Global schema registry.
 * Holds built-in schemas and user-registered schemas.
 */
class SchemaRegistry {
  private schemas = new Map<string, Schema>()

  register(schema: Schema): void {
    this.schemas.set(schema.name, schema)
  }

  get(name: string): Schema | undefined {
    return this.schemas.get(name)
  }

  has(name: string): boolean {
    return this.schemas.has(name)
  }

  /** Create or replace a schema entry. */
  set(name: string, schema: Schema): void {
    this.schemas.set(name, schema)
  }

  /** Merge user-provided schemas into the registry. */
  merge(schemas?: Record<string, Schema>): void {
    if (!schemas) return
    for (const [name, schema] of Object.entries(schemas)) {
      this.schemas.set(name, schema)
    }
  }

  /** Clear all schemas (useful for testing). */
  clear(): void {
    this.schemas.clear()
  }
}

/** Global singleton registry. */
export const registry = new SchemaRegistry()
