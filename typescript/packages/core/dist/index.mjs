//#region src/types.ts
/** A named collection of validation checks. */
var Schema = class Schema {
	name;
	checks;
	failFast;
	constructor(config) {
		this.name = config.name;
		this.checks = config.checks;
		this.failFast = config.failFast ?? false;
	}
	/** Create a new Schema that extends this one with additional checks. */
	extend(extraChecks, failFast) {
		return new Schema({
			name: this.name,
			checks: [...this.checks, ...extraChecks],
			failFast: failFast ?? this.failFast
		});
	}
};
//#endregion
//#region src/validator.ts
/**
* Core validator engine.
* Runs a value through a Schema's checks, collecting results and violations.
*/
async function validate(value, schema, attempt = 1) {
	const results = [];
	for (const check of schema.checks) {
		const result = await check.run(value);
		results.push(result);
		if (!result.passed && schema.failFast) break;
	}
	const violations = results.filter((r) => !r.passed);
	return {
		passed: violations.length === 0,
		schemaName: schema.name,
		rawValue: value,
		results,
		violations,
		attempt
	};
}
/**
* Extract a string from a raw response, stripping prose wrapping if needed.
* Returns the extracted string or null if no extractable content found.
*/
function extractString(raw, stripProse = true) {
	if (typeof raw !== "string") return null;
	if (!stripProse) return raw;
	const trimmed = raw.trim();
	if (trimmed.length === 0) return null;
	const firstBrace = trimmed.indexOf("{");
	const firstBracket = trimmed.indexOf("[");
	if (firstBrace === -1 && firstBracket === -1) return trimmed;
	const start = (() => {
		if (firstBrace >= 0 && firstBracket >= 0) return Math.min(firstBrace, firstBracket);
		if (firstBrace >= 0) return firstBrace;
		return firstBracket;
	})();
	const lastBrace = trimmed.lastIndexOf("}");
	const lastBracket = trimmed.lastIndexOf("]");
	const end = Math.max(lastBrace, lastBracket);
	if (end >= 0 && end < trimmed.length - 1) return trimmed.substring(start, end + 1).trim();
	if (start > 0) return trimmed.substring(start).trim();
	return trimmed;
}
/**
* Collect violation messages into a human-readable string.
*/
function formatViolations(violations) {
	return violations.map((v) => `• [${v.checkName}] ${v.message ?? "validation failed"}`).join("\n");
}
//#endregion
//#region src/auto-fix.ts
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
*/
function autoFixJson(raw) {
	const fixes = [];
	let text = raw.trim();
	if (text.length === 0) return {
		fixed: null,
		fixes: []
	};
	if (text.includes("<think>")) {
		if (text.includes("</think>")) text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
		else text = text.replace("<think>", "").trim();
		fixes.push("stripped_think_tags");
	}
	const fenced = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
	if (fenced) {
		text = fenced[1].trim();
		fixes.push("stripped_markdown_fences");
	}
	if (text && !"{[".includes(text[0])) {
		const startCandidates = [text.indexOf("{"), text.indexOf("[")].filter((i) => i >= 0);
		if (startCandidates.length > 0) {
			const start = Math.min(...startCandidates);
			if (Number.isFinite(start) && start > 0) {
				text = text.substring(start);
				fixes.push("stripped_leading_prose");
			}
		}
	}
	if (text) {
		const lastBrace = text.lastIndexOf("}");
		const lastBracket = text.lastIndexOf("]");
		const end = Math.max(lastBrace, lastBracket);
		if (end >= 0 && end < text.length - 1) {
			text = text.substring(0, end + 1);
			fixes.push("stripped_trailing_text");
		}
	}
	text = text.trim();
	try {
		JSON.parse(text);
		return {
			fixed: text,
			fixes
		};
	} catch {}
	let attempt = text.replace(/,\s*([}\]])/g, "$1");
	try {
		JSON.parse(attempt);
		return {
			fixed: attempt,
			fixes: [...fixes, "removed_trailing_commas"]
		};
	} catch {}
	attempt = text.replace(/'/g, "\"");
	try {
		JSON.parse(attempt);
		return {
			fixed: attempt,
			fixes: [...fixes, "single_to_double_quotes"]
		};
	} catch {}
	attempt = text.replace(/(?<=[{,])\s*([a-zA-Z_]\w*)\s*:/g, " \"$1\":");
	try {
		JSON.parse(attempt);
		return {
			fixed: attempt,
			fixes: [...fixes, "quoted_keys"]
		};
	} catch {}
	attempt = text.replace(/,\s*([}\]])/g, "$1").replace(/'/g, "\"").replace(/(?<=[{,])\s*([a-zA-Z_]\w*)\s*:/g, " \"$1\":");
	const openBraces = (attempt.match(/{/g) || []).length - (attempt.match(/}/g) || []).length;
	const openBrackets = (attempt.match(/\[/g) || []).length - (attempt.match(/\]/g) || []).length;
	if (openBraces > 0 || openBrackets > 0) attempt = attempt + "}".repeat(Math.max(0, openBraces)) + "]".repeat(Math.max(0, openBrackets));
	try {
		JSON.parse(attempt);
		return {
			fixed: attempt,
			fixes: [...fixes, "combined_fixes"]
		};
	} catch {}
	const justBraces = text.match(/{/g) || [];
	const justClosed = text.match(/}/g) || [];
	const openB = justBraces.length - justClosed.length;
	const justBrackets = text.match(/\[/g) || [];
	const justClosedBrackets = text.match(/\]/g) || [];
	const openK = justBrackets.length - justClosedBrackets.length;
	if (openB > 0 || openK > 0) {
		attempt = text + "}".repeat(Math.max(0, openB)) + "]".repeat(Math.max(0, openK));
		try {
			JSON.parse(attempt);
			return {
				fixed: attempt,
				fixes: [...fixes, "closed_missing_braces"]
			};
		} catch {}
	}
	return {
		fixed: null,
		fixes: []
	};
}
//#endregion
//#region src/retry.ts
/**
* Build a retry feedback string from validation violations.
*/
function buildRetryFeedback(validation, options) {
	const parts = [];
	if (validation.violations.length > 0) {
		parts.push("Your previous response had validation errors:\n");
		parts.push(formatViolations(validation.violations));
	}
	if (options?.includeRaw && typeof validation.rawValue === "string") parts.push(`\n\nYour response was:\n${validation.rawValue}`);
	parts.push("\n\nPlease fix the issues and respond again.");
	return parts.join("");
}
/**
* Build tool-call retry feedback.
*/
function buildToolCallRetryFeedback(functionName, violations, toolCallId) {
	return {
		message: `Your tool call to '${functionName}' had argument errors:\n${formatViolations(violations)}\n\nPlease call the function again with corrected arguments.`,
		toolCallId
	};
}
/**
* Generic retry message template for AI SDK-style interfaces.
* Returns a prompt string that can be appended to the original prompt.
*/
function buildRetryPrompt(originalPrompt, errorMessage) {
	return `${originalPrompt}\n\nYour previous response failed validation:\n${errorMessage}\n\nPlease fix the issues and respond with valid output matching the schema.`;
}
//#endregion
//#region src/schemas/registry.ts
/**
* Global schema registry.
* Holds built-in schemas and user-registered schemas.
*/
var SchemaRegistry = class {
	schemas = /* @__PURE__ */ new Map();
	register(schema) {
		this.schemas.set(schema.name, schema);
	}
	get(name) {
		return this.schemas.get(name);
	}
	has(name) {
		return this.schemas.has(name);
	}
	/** Create or replace a schema entry. */
	set(name, schema) {
		this.schemas.set(name, schema);
	}
	/** Merge user-provided schemas into the registry. */
	merge(schemas) {
		if (!schemas) return;
		for (const [name, schema] of Object.entries(schemas)) this.schemas.set(name, schema);
	}
	/** Clear all schemas (useful for testing). */
	clear() {
		this.schemas.clear();
	}
};
/** Global singleton registry. */
const registry = new SchemaRegistry();
//#endregion
//#region src/schemas/json-schema.ts
/**
* Check: value is valid JSON.
*/
function validJson() {
	return {
		name: "valid_json",
		run: async (value) => {
			try {
				JSON.parse(value);
				return {
					checkName: "valid_json",
					passed: true
				};
			} catch (err) {
				return {
					checkName: "valid_json",
					passed: false,
					message: err instanceof Error ? err.message : "Invalid JSON"
				};
			}
		}
	};
}
/**
* Check: parsed JSON is an object (not array, string, number).
*/
function isObject() {
	return {
		name: "is_object",
		run: async (value) => {
			if (typeof value === "object" && value !== null && !Array.isArray(value)) return {
				checkName: "is_object",
				passed: true
			};
			return {
				checkName: "is_object",
				passed: false,
				message: "Expected a JSON object, got " + typeof value
			};
		}
	};
}
/**
* Check: required fields exist in the parsed object.
*/
function requiredFields(fields) {
	return {
		name: `required_fields[${fields.join(",")}]`,
		run: async (value) => {
			const missing = fields.filter((f) => !(f in value) || value[f] === void 0 || value[f] === null);
			if (missing.length === 0) return {
				checkName: `required_fields`,
				passed: true
			};
			return {
				checkName: `required_fields`,
				passed: false,
				message: `Missing required fields: ${missing.join(", ")}`
			};
		}
	};
}
/**
* Check: field types match expected schema.
* Simple type checking: 'string', 'number', 'boolean', 'object', 'array'.
*/
function fieldTypes(fieldTypes) {
	return {
		name: "field_types",
		run: async (value) => {
			for (const [field, expectedType] of Object.entries(fieldTypes)) {
				const actual = value[field];
				if (actual === void 0 || actual === null) continue;
				const actualType = Array.isArray(actual) ? "array" : typeof actual;
				if (actualType !== expectedType) return {
					checkName: "field_types",
					passed: false,
					message: `Field '${field}' should be type '${expectedType}', got '${actualType}'`
				};
			}
			return {
				checkName: "field_types",
				passed: true
			};
		}
	};
}
/**
* Check: enum values match allowed set.
*/
function enumValues(field, allowed) {
	return {
		name: `enum_values[${field}]`,
		run: async (value) => {
			const actual = value[field];
			if (actual === void 0 || actual === null) return {
				checkName: `enum_values[${field}]`,
				passed: true
			};
			if (!allowed.includes(String(actual))) return {
				checkName: `enum_values[${field}]`,
				passed: false,
				message: `Field '${field}' value '${actual}' is not allowed. Allowed: ${allowed.join(", ")}`
			};
			return {
				checkName: `enum_values[${field}]`,
				passed: true
			};
		}
	};
}
//#endregion
export { Schema, autoFixJson, buildRetryFeedback, buildRetryPrompt, buildToolCallRetryFeedback, enumValues, extractString, fieldTypes, formatViolations, isObject, registry, requiredFields, validJson, validate };

//# sourceMappingURL=index.mjs.map