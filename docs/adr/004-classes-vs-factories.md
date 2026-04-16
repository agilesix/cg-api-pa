# ADR 004: Classes vs factory closures

**Status:** Accepted (2026-04-15)

## Context

TypeScript supports two primary patterns for objects with behavior and state:

1. **Classes** — `class Foo implements IFoo { constructor(private db: Db) {} }`
2. **Factory closures** — `function createFoo(db: Db): IFoo { return { ... } }`

This project currently uses classes for all stateful objects (`SqliteOppRepo`, `ProxyOppRepo`, `PaSourceClient`, `BucketSnapshotStore`, `OpportunityService`). The question is whether this is the right long-term choice, especially given the goal of making these components separately installable npm packages (like the Astro integration ecosystem).

## Decision

**Keep classes for now.** Switch to factory closures later when components are extracted to packages, if profiling shows a bundle-size benefit.

## Rationale

### Why classes are fine today

- **State management is the core use case.** Every "class" in this project holds state that outlives a single function call — a DB handle, an HTTP base URL, a TTL cache. Classes are the natural TypeScript idiom for this.
- **No `this` binding issues.** Methods aren't detached and passed as callbacks — they're always called as `repo.findById(id)`, not `const { findById } = repo`.
- **No deep inheritance.** All classes directly implement interfaces; there's no class hierarchy.
- **Familiar to contributors.** The `class implements Interface` pattern is immediately readable to anyone with TypeScript experience.

### Why factory closures matter for the future

The long-term goal is to make each layer (adapter, storage tier, snapshot store) a separately installable npm package. When a downstream consumer installs `@common-grants/storage-d1` but not `@common-grants/storage-proxy`, they shouldn't pay for proxy code in their bundle. This is where **tree-shakability** matters.

#### What is tree-shakability?

Tree-shaking is a bundler optimization (esbuild, Rollup, Webpack) that eliminates unused code from the final bundle. It works by tracing `import` → `export` chains and dropping any export that no one imports.

**Classes resist tree-shaking** because:

- A class is a single declaration — the bundler can eliminate the _entire class_ if it's unused, but it **cannot eliminate individual methods** within a used class.
- If you import `SqliteOppRepo` and only call `findById`, the bundle still includes `search`, `upsert`, `logSyncStart`, etc.

**Factory closures enable finer tree-shaking** because:

- Each method is a separate binding inside the closure.
- If the returned object is destructured (`const { findById } = createRepo(db)`), a bundler _can_ eliminate the unused method bodies.
- In practice, this requires the consumer to destructure (not always realistic for an `IOppRepo`).

#### When does this matter?

| Scenario                                                        | Tree-shaking impact                                                                                                                                                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **App code** (this project)                                     | Minimal — all methods of `SqliteOppRepo` are used by the service layer. No dead code to eliminate.                                                                                                                        |
| **Library code** (future `@common-grants/storage-d1`)           | Moderate — a consumer might use only `findById` + `search` but not the sync_log methods. Factory closures let the bundler drop unused methods.                                                                            |
| **Large integration ecosystem** (many storage/adapter packages) | Significant — consumers install multiple packages but only use one. Tree-shaking eliminates the unused packages' code. Classes work fine here too (whole-class elimination), but factory closures give finer granularity. |

### The decision boundary

Switch from classes to factory closures when ALL of these are true:

1. A component is extracted to its own npm package (not just a directory).
2. Consumers are bundling it into a frontend or edge runtime where bundle size matters.
3. Profiling (e.g., `npx esbuild --bundle --analyze`) shows the class methods are a meaningful fraction of the unused code.

Until then, classes are simpler, more familiar, and have no practical downside.

## Consequences

- Contributors use the `class implements Interface` pattern consistently.
- No refactoring needed today.
- When components become separately installable, the factory pattern is documented as the target, with a clear decision boundary for when to migrate.
- This ADR can be referenced in future package-extraction PRs to explain the style shift.
