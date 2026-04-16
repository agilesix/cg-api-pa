# Known `cg check spec` discrepancies

This document catalogs every discrepancy between the auto-generated OpenAPI spec (`/openapi.json`) and the CommonGrants base protocol as reported by `cg check spec` from `@common-grants/cli@0.3.1`.

**All discrepancies are `cg check spec` comparison limitations — not SDK, rendering, or implementation bugs.** The generated spec and the base protocol are semantically equivalent; the CLI fails to normalize structurally different but equivalent JSON Schema representations before comparing.

Track the fix upstream in [`HHS/simpler-grants-protocol`](https://github.com/HHS/simpler-grants-protocol/issues).

## Summary

| Category                     | ~Count | Structural difference                                                  | Both mean the same thing? |
| ---------------------------- | ------ | ---------------------------------------------------------------------- | ------------------------- |
| Nullable type format         | ~132   | `type: [T, "null"]` vs `anyOf: [{type: T}, {type: "null"}]`            | Yes (JSON Schema 2020-12) |
| Event `required` composition | ~30    | Flattened `oneOf` with `required` vs `allOf` with inherited `required` | Yes                       |
| Filter operator enum format  | ~10    | Flat `enum: [...]` vs `anyOf` of `$ref`'d sub-enums                    | Yes                       |

## Category 1: Nullable type rendering (~132 issues)

Both the Python (Pydantic) and TypeScript (Zod) SDKs model optional fields as nullable — intentionally, for cross-language compatibility.

The two frameworks render this differently in OpenAPI 3.1:

**Pydantic v2 (FastAPI template) — passes `cg check spec`:**

```json
{ "anyOf": [{ "$ref": "#/components/schemas/OppFunding" }, { "type": "null" }] }
```

**zod-openapi (this project) — fails `cg check spec`:**

```json
{ "type": ["object", "null"] }
```

Both are valid and equivalent in OpenAPI 3.1 / JSON Schema 2020-12. The `type` array is the JSON Schema shorthand for a type union. `cg check spec` only handles the `anyOf` pattern.

**Fix:** Update `cg check spec`'s comparator to normalize both nullable representations before diffing.

## Category 2: Event `required` composition (~30 issues)

The CLI reports `eventType`, `date`, and `name` as "missing required properties" on event schemas.

**Generated spec (correct):** Each `oneOf` variant has a flattened `required` array:

```json
{
  "oneOf": [{
    "type": "object",
    "properties": { "name": {...}, "eventType": {...}, "date": {...} },
    "required": ["name", "eventType", "date"]
  }]
}
```

**Base protocol spec:** Uses `allOf` composition where `name` and `eventType` are required on `EventBase`, and each variant adds its own required fields:

```yaml
SingleDateEvent:
  required: [eventType, date]
  allOf:
    - $ref: '#/components/schemas/EventBase' # has required: [name, eventType]
```

Both express the same constraint: `name`, `eventType`, and `date` are all required on `SingleDateEvent`. The generated spec flattens the inheritance; the base spec uses composition. `cg check spec` doesn't resolve the `allOf` inheritance when comparing required arrays.

**Fix:** Update `cg check spec` to resolve `allOf` required-property inheritance before comparing.

## Category 3: Filter operator enum format (~10 issues)

The CLI reports extra enum values (`gt`, `gte`, `lt`, `lte`, `in`, `notIn`, `like`, `notLike`, `between`, `outside`) on `customFilters[prop].operator`.

**Generated spec:** A single flat enum with all 12 operators:

```json
{
  "enum": [
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "in",
    "notIn",
    "like",
    "notLike",
    "between",
    "outside"
  ]
}
```

**Base protocol spec:** An `anyOf` of 5 `$ref`'d sub-enums that together include the same 12 operators:

```yaml
operator:
  anyOf:
    - $ref: '#/components/schemas/EquivalenceOperators' # eq, neq
    - $ref: '#/components/schemas/ComparisonOperators' # gt, gte, lt, lte
    - $ref: '#/components/schemas/ArrayOperators' # in, notIn
    - $ref: '#/components/schemas/StringOperators' # like, notLike
    - $ref: '#/components/schemas/RangeOperators' # between, outside
    - $ref: '#/components/schemas/AllOperators' # eq..outside (10, missing like/notLike)
```

Note: `AllOperators` only has 10 values (missing `like`, `notLike`), but `StringOperators` covers those. The `anyOf` union of all sub-enums yields the same 12 values as the flat enum. `cg check spec` compares the flat enum against `AllOperators` alone instead of resolving the full `anyOf` union.

**Fix:** Update `cg check spec` to resolve `anyOf` enum unions before comparing allowed values.

## Recommended CLI changes

All three categories reduce to one class of fix: **normalize equivalent JSON Schema representations before comparing**. Specifically:

1. **Nullable normalization:** Treat `type: [T, "null"]` as equivalent to `anyOf: [{type: T}, {type: "null"}]`.
2. **Required inheritance:** Resolve `allOf` chains to collect the full `required` set before comparing.
3. **Enum union resolution:** Resolve `anyOf` of `$ref`'d enums into a single flat value set before comparing.
