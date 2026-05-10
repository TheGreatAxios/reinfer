import type { AutoFixResult } from './types'

export interface AutoFixOptions {
  /**
   * Try to convert YAML-like output to JSON when JSON parsing fails.
   * Uses a deterministic line-based parser (no eval, no deps).
   * Default: false
   *
   * Handles common LLM YAML patterns:
   *   key: value, key: 42, key: true, key: null
   *   key: [a, b], nested:\n  sub: value
   *   - item (array entries)
   */
  yamlConversion?: boolean
}

/**
 * Attempt high-confidence syntactic fixes on malformed JSON.
 *
 * Returns (fixed string, list of fixes applied) or (null, []) if unfixable.
 *
 * Pipeline order:
 *   1. Strip <think> tags (DeepSeek reasoning traces)
 *   2. Strip markdown fences (```json ... ```)
 *   3. Extract JSON from prose wrapping (strip leading text before first { or [)
 *   4. Strip trailing non-JSON text after last } or ]
 *   5. Try parsing as-is
 *   6. Fix trailing commas
 *   7. Fix single quotes → double quotes
 *   8. Fix unquoted keys
 *   9. Combined high-confidence fixes
 *  10. Fix missing closing braces (medium confidence)
 *  11. [optional] YAML → JSON conversion
 */
export function autoFixJson(raw: string, options?: AutoFixOptions): AutoFixResult {
  const fixes: string[] = []
  let text = raw.trim()

  if (text.length === 0) return { fixed: null, fixes: [] }

  // ── Fix: Strip <think> tags (DeepSeek reasoning) ──
  if (text.includes('<think>')) {
    if (text.includes('</think>')) {
      text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
    } else {
      // Unclosed think tag — remove the opening tag marker only;
      // the rest may still contain JSON content for the prose extraction step
      text = text.replace('<think>', '').trim()
    }
    fixes.push('stripped_think_tags')
  }

  // ── Fix: Strip markdown fences ──
  const fenced = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/)
  if (fenced) {
    text = fenced[1].trim()
    fixes.push('stripped_markdown_fences')
  }

  // ── Fix: Extract JSON from prose wrapping ──
  if (text && !'{['.includes(text[0])) {
    const startCandidates = [text.indexOf('{'), text.indexOf('[')].filter(i => i >= 0)
    if (startCandidates.length > 0) {
      const start = Math.min(...startCandidates)
      if (Number.isFinite(start) && start > 0) {
        text = text.substring(start)
        fixes.push('stripped_leading_prose')
      }
    }
  }

  // ── Fix: Strip trailing non-JSON text ──
  if (text) {
    const lastBrace = text.lastIndexOf('}')
    const lastBracket = text.lastIndexOf(']')
    const end = Math.max(lastBrace, lastBracket)
    if (end >= 0 && end < text.length - 1) {
      text = text.substring(0, end + 1)
      fixes.push('stripped_trailing_text')
    }
  }

  text = text.trim()

  // ── Try parsing as-is ──
  try {
    JSON.parse(text)
    return { fixed: text, fixes }
  } catch {
    // continue to fixes
  }

  // ── Fix: Trailing commas ──
  let attempt = text.replace(/,\s*([}\]])/g, '$1')
  try {
    JSON.parse(attempt)
    return { fixed: attempt, fixes: [...fixes, 'removed_trailing_commas'] }
  } catch {
    // continue
  }

  // ── Fix: Single quotes → double quotes ──
  attempt = text.replace(/'/g, '"')
  try {
    JSON.parse(attempt)
    return { fixed: attempt, fixes: [...fixes, 'single_to_double_quotes'] }
  } catch {
    // continue
  }

  // ── Fix: Unquoted keys ──
  attempt = text.replace(/(?<=[{,])\s*([a-zA-Z_]\w*)\s*:/g, ' "$1":')
  try {
    JSON.parse(attempt)
    return { fixed: attempt, fixes: [...fixes, 'quoted_keys'] }
  } catch {
    // continue
  }

  // ── Combined high-confidence fixes ──
  attempt = text
    .replace(/,\s*([}\]])/g, '$1')               // trailing commas
    .replace(/'/g, '"')                           // single quotes
    .replace(/(?<=[{,])\s*([a-zA-Z_]\w*)\s*:/g, ' "$1":')  // unquoted keys

  const openBraces = (attempt.match(/{/g) || []).length - (attempt.match(/}/g) || []).length
  const openBrackets = (attempt.match(/\[/g) || []).length - (attempt.match(/\]/g) || []).length

  if (openBraces > 0 || openBrackets > 0) {
    attempt = attempt + '}'.repeat(Math.max(0, openBraces)) + ']'.repeat(Math.max(0, openBrackets))
  }

  try {
    JSON.parse(attempt)
    return { fixed: attempt, fixes: [...fixes, 'combined_fixes'] }
  } catch {
    // unfixable
  }

  // ── Fix: Missing closing braces only (medium confidence) ──
  const justBraces = text.match(/{/g) || []
  const justClosed = text.match(/}/g) || []
  const openB = justBraces.length - justClosed.length

  const justBrackets = text.match(/\[/g) || []
  const justClosedBrackets = text.match(/\]/g) || []
  const openK = justBrackets.length - justClosedBrackets.length

  if (openB > 0 || openK > 0) {
    attempt = text + '}'.repeat(Math.max(0, openB)) + ']'.repeat(Math.max(0, openK))
    try {
      JSON.parse(attempt)
      return { fixed: attempt, fixes: [...fixes, 'closed_missing_braces'] }
    } catch {
      // truly unfixable
    }
  }

  // ── Fix: YAML → JSON conversion (optional, default off) ──
  if (options?.yamlConversion) {
    const yamlResult = yamlToJson(text)
    if (yamlResult !== null) {
      try {
        JSON.parse(yamlResult)
        return { fixed: yamlResult, fixes: [...fixes, 'yaml_to_json'] }
      } catch {
        // converted YAML is still invalid JSON — give up
      }
    }
  }

  return { fixed: null, fixes: [] }
}

/**
 * Minimal deterministic YAML→JSON converter.
 * No deps, no eval, no code execution.
 * Handles the subset of YAML that LLMs commonly produce.
 *
 * Supported patterns:
 *   key: scalar          → {"key": "scalar"}
 *   key: 42              → {"key": 42}
 *   key: true/false/null → {"key": true/false/null}
 *   key: [a, b]          → {"key": ["a", "b"]}
 *   key: (indented)      → nested object
 *   - item               → array element
 *   key: |- / >-         → multiline string
 */
function yamlToJson(yaml: string): string | null {
  const lines = yaml.split('\n')
  if (lines.length === 0) return null

  // Check if this looks like YAML (key: value pattern without JSON braces)
  const looksLikeYaml = lines.some(l => /^\s*[a-zA-Z_][\w-]*\s*:/.test(l) && !l.includes('{') && !l.includes('}'))
  if (!looksLikeYaml) return null

  // Build nested structure using indentation tracking
  type YamlNode = string | number | boolean | null | YamlNode[] | { [key: string]: YamlNode }

  const root: YamlNode[] = [] // array of objects at root level
  const stack: { indent: number; obj: { [key: string]: YamlNode }; list?: boolean }[] = []
  let currentRootObj: { [key: string]: YamlNode } | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue

    const indent = line.length - trimmed.length

    // Array item: - value
    if (trimmed.startsWith('- ')) {
      const value = parseYamlScalar(trimmed.slice(2))

      // Add to current object if we're at the right indent
      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
        stack.pop()
      }

      if (currentRootObj && stack.length <= 1) {
        // Root-level array item in document without explicit root key
        // Just track it
      }

      if (stack.length > 0) {
        const parent = stack[stack.length - 1]
        // Create or append to array in the parent
        const lastKey = Object.keys(parent.obj).pop()
        if (lastKey && typeof value === 'object' && value !== null && !Array.isArray(value)) {
          // - key: value pattern — make array of objects
          if (!Array.isArray(parent.obj[lastKey])) {
            parent.obj[lastKey] = [value]
          } else {
            ;(parent.obj[lastKey] as YamlNode[]).push(value)
          }
        } else {
          // Plain array
          if (!Array.isArray(parent.obj.__items)) {
            parent.obj.__items = []
          }
          ;(parent.obj.__items as YamlNode[]).push(value)
        }
      } else {
        // Root-level - item
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          root.push(value)
        } else {
          root.push(value)
        }
      }
      continue
    }

    // Key: value pattern
    const colonIdx = trimmed.indexOf(':')
    if (colonIdx === -1) continue

    const key = trimmed.slice(0, colonIdx).trim()
    const valuePart = trimmed.slice(colonIdx + 1).trim()

    // Pop stack to correct indent level
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop()
    }

    // Determine parent object
    let parentObj: { [key: string]: YamlNode }
    if (stack.length === 0) {
      if (!currentRootObj) currentRootObj = {}
      parentObj = currentRootObj
    } else {
      let top = stack[stack.length - 1]
      // If there's a nested key without a value, the next indented block is its value
      parentObj = top.obj
    }

    if (valuePart === '' || valuePart === '|' || valuePart === '|-' || valuePart === '>' || valuePart === '>-') {
      // Nested object or multiline string — push to stack
      const nested: { [key: string]: YamlNode } = {}
      parentObj[key] = nested
      stack.push({ indent, obj: nested })
    } else if (valuePart.startsWith('[') && valuePart.endsWith(']')) {
      // Inline array: [a, b, c]
      const items = valuePart.slice(1, -1).split(',').map(s => parseYamlScalar(s.trim()))
      parentObj[key] = items
    } else {
      parentObj[key] = parseYamlScalar(valuePart)
    }
  }

  // Convert the structure to JSON
  let result: YamlNode
  if (root.length > 0) {
    // Array at root
    result = root
  } else if (currentRootObj) {
    result = currentRootObj
  } else {
    return null
  }

  // Replace __items markers with actual arrays
  function cleanNode(node: YamlNode): YamlNode {
    if (Array.isArray(node)) {
      return node.map(cleanNode)
    }
    if (typeof node === 'object' && node !== null) {
      const obj = node as { [key: string]: YamlNode }
      const items = obj.__items
      delete obj.__items
      const cleaned: { [key: string]: YamlNode } = {}
      for (const [k, v] of Object.entries(obj)) {
        cleaned[k] = cleanNode(v)
      }
      // If the only thing in this object was __items, return the array
      if (Object.keys(cleaned).length === 0 && items) {
        return cleanNode(items) as YamlNode
      }
      return cleaned
    }
    return node
  }

  result = cleanNode(result)

  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return null
  }
}

/** Parse a YAML scalar value to its JS type. */
function parseYamlScalar(value: string): string | number | boolean | null {
  const trimmed = value.trim()

  if (trimmed === '' || trimmed === '~') return null
  if (trimmed === 'null') return null
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'yes') return true
  if (trimmed === 'no') return false

  // Number detection
  const num = Number(trimmed)
  if (!isNaN(num) && trimmed !== '' && !isNaN(parseFloat(trimmed))) {
    // Make sure it's not just a string that looks like a number
    // e.g., zip codes like "10001" should stay strings if they have leading zeros
    if (String(num) === trimmed || /^-?\d+\.?\d*$/.test(trimmed)) {
      return num
    }
  }

  // Strip quotes
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}
