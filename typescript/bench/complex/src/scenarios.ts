import { z } from 'zod'

/**
 * Complex benchmark scenarios — structural validation only.
 *
 * Every scenario is designed so the model WILL produce JSON,
 * but may make specific, fixable structural mistakes:
 *   - trailing commas, unquoted keys, single quotes
 *   - prose wrapping ("Here's the JSON: ...")
 *   - missing 1-2 required fields in a large object
 *   - wrong types (string "true" vs boolean true)
 *   - wrong enum casing (Active vs active)
 *   - think-tag wrapping (DeepSeek)
 *   - truncation mid-structure
 *
 * These are the exact things auto-fix + retry-with-diagnostics fix.
 */

export interface Scenario {
  name: string
  systemPrompt: string
  userPrompt: string
  schema: z.ZodSchema
  expectedShape: string
  tags: string[]
  /** Known failure modes this scenario is designed to trigger */
  expectedFailureModes: string[]
}

export const SCENARIOS: Scenario[] = [

  // ── 1. Large object — model likely misses 1-3 fields ──
  {
    name: 'large-profile-missing-fields',
    tags: ['missing-fields'],
    systemPrompt: 'Return valid JSON. Every field is required. No prose, no markdown fences, just the JSON object.',
    userPrompt: `Generate a user profile JSON with these 15 fields, all populated with realistic data:
id (number), username (string), email (string), displayName (string), age (number), role (string, one of: admin, user, moderator), plan (string, one of: free, pro, enterprise), isActive (boolean), score (number), tags (array of 3 strings), address (object with: street, city, zip), phone (string), bio (string, min 10 chars), createdAt (string, ISO date), metadata (object with: version string, enabled boolean, lastLogin string)`,
    schema: z.object({
      id: z.number(),
      username: z.string().min(1),
      email: z.string().email(),
      displayName: z.string().min(1),
      age: z.number().int().positive(),
      role: z.enum(['admin', 'user', 'moderator']),
      plan: z.enum(['free', 'pro', 'enterprise']),
      isActive: z.boolean(),
      score: z.number(),
      tags: z.array(z.string()).length(3),
      address: z.object({
        street: z.string(),
        city: z.string(),
        zip: z.string(),
      }),
      phone: z.string().min(5),
      bio: z.string().min(10),
      createdAt: z.string().min(1),
      metadata: z.object({
        version: z.string(),
        enabled: z.boolean(),
        lastLogin: z.string(),
      }),
    }),
    expectedShape: '15-field profile — model may miss 1-3 nested fields',
    expectedFailureModes: ['missing_nested_fields', 'missing_address_fields', 'wrong_enum'],
  },

  // ── 2. Nested array with specific lengths and types ──
  {
    name: 'product-catalog-typed',
    tags: ['types', 'arrays'],
    systemPrompt: 'Return valid JSON. Types must be exact: booleans as true/false, numbers not strings. No prose.',
    userPrompt: `Generate a product catalog with:
- storeName (string)
- currency (string, 3-letter code)
- products (array of exactly 3 products)
Each product: id (number), name (string), price (number), inStock (boolean), category (one of: electronics, clothing, food), tags (array of exactly 2 strings), ratings (object with: average number 0-5, count number), description (string, min 20 chars)`,
    schema: z.object({
      storeName: z.string(),
      currency: z.string().length(3),
      products: z.array(z.object({
        id: z.number(),
        name: z.string(),
        price: z.number().positive(),
        inStock: z.boolean(),
        category: z.enum(['electronics', 'clothing', 'food']),
        tags: z.array(z.string()).length(2),
        ratings: z.object({
          average: z.number().min(0).max(5),
          count: z.number().int(),
        }),
        description: z.string().min(20),
      })).length(3),
    }),
    expectedShape: '3 products with typed fields — model may use "true" not true, or miss tags length',
    expectedFailureModes: ['string_instead_of_boolean', 'string_instead_of_number', 'missing_fields', 'wrong_array_length'],
  },

  // ── 3. Prose-wrapped JSON (most common real-world failure) ──
  {
    name: 'prose-wrapped-json',
    tags: ['prose', 'auto-fix'],
    systemPrompt: 'You are a helpful assistant. Answer the question naturally, but include the requested data as a JSON object within your response.',
    userPrompt: `What are 3 good books to read? For each, provide: title, author, year, genre, and a one-sentence reason.
Include this data in a JSON array of objects within your natural response.
The JSON should be at the end of your response, formatted cleanly.`,
    schema: z.object({
      books: z.array(z.object({
        title: z.string(),
        author: z.string(),
        year: z.number().int(),
        genre: z.string(),
        reason: z.string().min(10),
      })).length(3),
    }),
    expectedShape: 'JSON array wrapped in prose — tests stripProse auto-fix',
    expectedFailureModes: ['prose_wrapping', 'markdown_fences', 'wrong_field_names'],
  },

  // ── 4. Syntax stress: model told "no markdown" but may still produce it ──
  {
    name: 'syntax-edge-cases',
    tags: ['syntax', 'auto-fix'],
    systemPrompt: 'Return valid JSON. No markdown fences. No trailing commas. Use double quotes, not single quotes.',
    userPrompt: `Return a JSON object with: name (string "test"), value (number 42), active (boolean true), items (array ["a","b","c"]), config (object with: timeout 3000, retry true, endpoint "https://api.test.com")`,
    schema: z.object({
      name: z.string(),
      value: z.number(),
      active: z.boolean(),
      items: z.array(z.string()).length(3),
      config: z.object({
        timeout: z.number(),
        retry: z.boolean(),
        endpoint: z.string().url(),
      }),
    }),
    expectedShape: 'Standard JSON — model may still add trailing commas or unquoted keys',
    expectedFailureModes: ['trailing_comma', 'unquoted_keys', 'single_quotes'],
  },

  // ── 5. Deep nesting (3 levels) — most models handle this but 4+ causes drift ──
  {
    name: 'deeply-nested-config',
    tags: ['nesting'],
    systemPrompt: 'Return valid JSON matching the schema. No prose, no markdown fences.',
    userPrompt: `Return a nested configuration JSON with this exact structure:
app (object):
  name (string), version (string), debug (boolean)
  database (object):
    host (string), port (number), name (string)
    credentials (object):
      user (string), password (string)
  cache (object):
    enabled (boolean), ttl (number), provider (string)
    redis (object):
      host (string), port (number), db (number)
  features (object):
    logging (boolean), monitoring (boolean)
    alerts (object):
      email (object):
        enabled (boolean), recipients (array of 2 strings)`,
    schema: z.object({
      app: z.object({
        name: z.string(),
        version: z.string(),
        debug: z.boolean(),
        database: z.object({
          host: z.string(),
          port: z.number(),
          name: z.string(),
          credentials: z.object({
            user: z.string(),
            password: z.string(),
          }),
        }),
        cache: z.object({
          enabled: z.boolean(),
          ttl: z.number(),
          provider: z.string(),
          redis: z.object({
            host: z.string(),
            port: z.number(),
            db: z.number(),
          }),
        }),
        features: z.object({
          logging: z.boolean(),
          monitoring: z.boolean(),
          alerts: z.object({
            email: z.object({
              enabled: z.boolean(),
              recipients: z.array(z.string()).length(2),
            }),
          }),
        }),
      }),
    }),
    expectedShape: '4-level deep nested config — tests depth drift and missing nested fields',
    expectedFailureModes: ['missing_nested_fields', 'depth_drift', 'wrong_types'],
  },

  // ── 6. Mixed types — model often swaps types ──
  {
    name: 'mixed-types-strict',
    tags: ['types'],
    systemPrompt: 'Return valid JSON. Types are strict: use real booleans (not "yes"/"no"/"true" strings), real numbers (not strings), null (not "null" string). Arrays must use [] not "comma,separated".',
    userPrompt: `Return a JSON object:
id (number 42), title (string "Test"), published (boolean true), wordCount (number 1500)
rating (number 4.5), tags (array ["tech","ai"]), author (object: name "Alice", active boolean true, score null)
metadata (object: views number 1200, featured boolean false, category "blog")
config (object: comments boolean true, visibility "public", scheduled null)`,
    schema: z.object({
      id: z.number(),
      title: z.string(),
      published: z.boolean(),
      wordCount: z.number(),
      rating: z.number(),
      tags: z.array(z.string()).min(1),
      author: z.object({
        name: z.string(),
        active: z.boolean(),
        score: z.null(),
      }),
      metadata: z.object({
        views: z.number(),
        featured: z.boolean(),
        category: z.string(),
      }),
      config: z.object({
        comments: z.boolean(),
        visibility: z.string(),
        scheduled: z.null(),
      }),
    }),
    expectedShape: 'Mixed types with null and booleans — model often produces "null" or "true" as strings',
    expectedFailureModes: ['string_instead_of_boolean', 'string_instead_of_null', 'string_instead_of_number'],
  },

  // ── 7. Enum exact values — case sensitivity is a common model mistake ──
  {
    name: 'enum-exact-values',
    tags: ['enums'],
    systemPrompt: 'Return valid JSON. Enum values are case-sensitive and must match exactly. No prose, no markdown fences.',
    userPrompt: `Return a configuration object:
status (one of: pending, active, suspended, archived)
priority (one of: low, medium, high, critical)
environment (one of: development, staging, production)
logLevel (one of: debug, info, warn, error)
region (one of: us-east, us-west, eu-west, ap-southeast)
tier (one of: free, pro, enterprise, custom)
deployment (one of: blue, green, canary)
authMethod (one of: oauth, saml, basic, apikey)

All values must be lowercase exactly as specified.`,
    schema: z.object({
      status: z.enum(['pending', 'active', 'suspended', 'archived']),
      priority: z.enum(['low', 'medium', 'high', 'critical']),
      environment: z.enum(['development', 'staging', 'production']),
      logLevel: z.enum(['debug', 'info', 'warn', 'error']),
      region: z.enum(['us-east', 'us-west', 'eu-west', 'ap-southeast']),
      tier: z.enum(['free', 'pro', 'enterprise', 'custom']),
      deployment: z.enum(['blue', 'green', 'canary']),
      authMethod: z.enum(['oauth', 'saml', 'basic', 'apikey']),
    }),
    expectedShape: '8 enum fields — models often use wrong case (Active vs active)',
    expectedFailureModes: ['wrong_enum_case', 'wrong_enum_value'],
  },

  // ── 8. Truncation: long array that models often cut off ──
  {
    name: 'long-list-truncation',
    tags: ['truncation'],
    systemPrompt: 'Return valid JSON. Be thorough and include ALL items requested. No prose. No markdown fences.',
    userPrompt: `Generate a JSON object with a "countries" array of exactly 10 country objects.
Each country has: name (string), capital (string), population (number in millions, like 331.9), continent (string), language (string), currency (string), isG20 (boolean).
Make each country realistic. Include ALL 10 countries.`,
    schema: z.object({
      countries: z.array(z.object({
        name: z.string(),
        capital: z.string(),
        population: z.number(),
        continent: z.string(),
        language: z.string(),
        currency: z.string(),
        isG20: z.boolean(),
      })).length(10),
    }),
    expectedShape: '10-item array — longer responses may truncate mid-array',
    expectedFailureModes: ['truncation', 'missing_items'],
  },

  // ── 9. Think-tag simulation (DeepSeek-style) ──
  // We tell the model to include reasoning first, then JSON
  {
    name: 'reasoning-then-json',
    tags: ['prose', 'auto-fix'],
    systemPrompt: 'First reason step-by-step about your answer inside <reasoning> tags, then output the JSON result. The JSON must be after the </reasoning> tag.',
    userPrompt: `Analyze this data and return a JSON summary.
Data: In Q1 we had 1000 users, Q2 1500 users, Q3 2200 users, Q4 3400 users.
Return JSON with: total (number), average (number), growth (number as percentage), bestQuarter (string), quarters (array of objects with: quarter string, users number).
Put your reasoning inside <reasoning> tags first, then the JSON.`,
    schema: z.object({
      total: z.number(),
      average: z.number(),
      growth: z.number(),
      bestQuarter: z.string(),
      quarters: z.array(z.object({
        quarter: z.string(),
        users: z.number(),
      })).length(4),
    }),
    expectedShape: 'Reasoning text before JSON — tests auto-fix stripping of reasoning blocks',
    expectedFailureModes: ['reasoning_tags', 'prose_around_json', 'markdown_fences'],
  },
]
