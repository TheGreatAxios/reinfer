import { z } from 'zod'

/**
 * A benchmark scenario: a prompt + expected schema to validate against.
 * Designed to test common failure modes for structured output generation.
 */
export interface Scenario {
  /** Human-readable name for the scenario */
  name: string
  /** Model to use on OpenRouter */
  model: string
  /** The prompt sent to the model */
  systemPrompt: string
  /** User message */
  userPrompt: string
  /** Schema to validate against (for generateObject-style validation) */
  schema: z.ZodSchema
  /** Expected shape description (for reporting) */
  expectedShape: string
  /** True if we expect the model to pass on first try (not strict assert, for stats) */
  likelyFirstTry?: boolean
}

/** Default model for scenarios (free on OpenRouter). */
const DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b:free'

/**
 * All benchmark scenarios.
 * These are designed to test real-world failure modes:
 * - Simple JSON → should pass
 * - Nested JSON → deeper nesting increases failure rate
 * - Arrays → common struggle point
 * - Strict types → enum/number mismatches
 * - Edge cases → empty strings, nulls
 */
export const SCENARIOS: Scenario[] = [
  // ── Simple JSON ──
  {
    name: 'simple-object',
    model: DEFAULT_MODEL,
    systemPrompt: 'You are a helpful assistant. Always respond with valid JSON matching the required schema. No prose, no markdown fences, just the JSON object.',
    userPrompt: 'Return a JSON object with "city" (string) and "temperature" (number). Example: {"city": "NYC", "temperature": 72}',
    schema: z.object({
      city: z.string(),
      temperature: z.number(),
    }),
    expectedShape: '{ city: string, temperature: number }',
    likelyFirstTry: true,
  },

  // ── Nested JSON ──
  {
    name: 'nested-object',
    model: DEFAULT_MODEL,
    systemPrompt: 'You are a helpful assistant. Always respond with valid JSON. No prose, no markdown fences.',
    userPrompt: 'Return a JSON object with "user" containing "name" (string), "address" containing "street" (string) and "zip" (string). Example: {"user": {"name": "Alice", "address": {"street": "123 Main St", "zip": "10001"}}}',
    schema: z.object({
      user: z.object({
        name: z.string(),
        address: z.object({
          street: z.string(),
          zip: z.string(),
        }),
      }),
    }),
    expectedShape: '{ user: { name, address: { street, zip } } }',
  },
  {
    name: 'deeply-nested',
    model: DEFAULT_MODEL,
    systemPrompt: 'You are a helpful assistant. Always respond with valid JSON. No prose, no markdown fences.',
    userPrompt: 'Return JSON: {"level1": {"level2": {"level3": {"value": "deep"}}}}',
    schema: z.object({
      level1: z.object({
        level2: z.object({
          level3: z.object({
            value: z.string(),
          }),
        }),
      }),
    }),
    expectedShape: '3 levels of nesting',
  },

  // ── Arrays ──
  {
    name: 'simple-array',
    model: DEFAULT_MODEL,
    systemPrompt: 'You are a helpful assistant. Always respond with valid JSON. No prose, no markdown fences.',
    userPrompt: 'Return a JSON object with "products" (array of objects with "name" string and "price" number). Make up 3 products.',
    schema: z.object({
      products: z.array(z.object({
        name: z.string(),
        price: z.number(),
      })),
    }),
    expectedShape: '{ products: [{ name, price }] }',
  },
  {
    name: 'array-of-strings',
    model: DEFAULT_MODEL,
    systemPrompt: 'You are a helpful assistant. Always respond with valid JSON. No prose, no markdown fences.',
    userPrompt: 'Return a JSON object with "tags" (array of strings, exactly 4 tags) and "count" (number).',
    schema: z.object({
      tags: z.array(z.string()).length(4),
      count: z.number(),
    }),
    expectedShape: '{ tags: string[4], count: number }',
  },

  // ── Strict types ──
  {
    name: 'enum-field',
    model: DEFAULT_MODEL,
    systemPrompt: 'You are a helpful assistant. Always respond with valid JSON. No prose, no markdown fences.',
    userPrompt: 'Return a JSON object with "status" which must be one of: "active", "inactive", "pending". Also include "id" (number). Example: {"status": "active", "id": 1}',
    schema: z.object({
      status: z.enum(['active', 'inactive', 'pending']),
      id: z.number(),
    }),
    expectedShape: '{ status: "active"|"inactive"|"pending", id: number }',
    likelyFirstTry: true,
  },
  {
    name: 'boolean-and-number',
    model: DEFAULT_MODEL,
    systemPrompt: 'You are a helpful assistant. Always respond with valid JSON. No prose, no markdown fences.',
    userPrompt: 'Return JSON with: "is_active" (boolean), "score" (number), "name" (string), "count" (integer).',
    schema: z.object({
      is_active: z.boolean(),
      score: z.number(),
      name: z.string(),
      count: z.number().int(),
    }),
    expectedShape: '{ is_active: bool, score: number, name: string, count: int }',
  },

  // ── Edge cases ──
  {
    name: 'optional-fields',
    model: DEFAULT_MODEL,
    systemPrompt: 'You are a helpful assistant. Always respond with valid JSON. No prose, no markdown fences.',
    userPrompt: 'Return JSON with: "id" (number required), "name" (string required), "description" (string optional, may be null or omitted).',
    schema: z.object({
      id: z.number(),
      name: z.string(),
      description: z.string().nullable().optional(),
    }),
    expectedShape: '{ id: number, name: string, description?: string | null }',
  },
  {
    name: 'empty-object',
    model: DEFAULT_MODEL,
    systemPrompt: 'Respond with exactly this JSON: {}',
    userPrompt: 'Just return an empty JSON object',
    schema: z.object({}).strict(),
    expectedShape: '{}',
    likelyFirstTry: true,
  },

  // ── Prose wrapping stress test ──
  {
    name: 'prose-wrapped',
    model: DEFAULT_MODEL,
    systemPrompt: 'You are a helpful assistant. Answer naturally. Include the data in your response.',
    userPrompt: 'What is the weather in NYC and Tokyo? Return the data as JSON inside your natural response.',
    schema: z.object({
      cities: z.array(z.object({
        name: z.string(),
        temperature: z.number(),
        condition: z.string(),
      })),
    }),
    expectedShape: 'JSON extracted from prose via auto-fix',
    likelyFirstTry: false,
  },

  // ── Tricky prompts to trigger edge cases ──
  {
    name: 'numeric-strings',
    model: DEFAULT_MODEL,
    systemPrompt: 'You are a helpful assistant. Always respond with valid JSON. No prose, no markdown fences.',
    userPrompt: 'Return JSON: {"user_id": "12345", "order_id": 67890, "items": [{"sku": "ABC-123", "quantity": 2}]}',
    schema: z.object({
      user_id: z.string(),
      order_id: z.number(),
      items: z.array(z.object({
        sku: z.string(),
        quantity: z.number(),
      })),
    }),
    expectedShape: 'Mixed string/number types',
    likelyFirstTry: true,
  },
]
