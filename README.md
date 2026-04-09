# docs-wiki

`docs-wiki` is a CLI that scans a codebase and generates a VitePress-ready internal wiki from source code.

The goal is not only code reference. The generated output tries to answer four questions:

- What modules exist in this project?
- What business capability does each module appear to implement?
- What request and business flows exist in the code?
- What HTTP API contracts can be inferred from route handlers?

`docs-wiki` runs against the project in the current working directory by default and writes output into `./docs-wiki` inside that same project.

## What It Generates

The generated site is VitePress-first and includes:

- feature pages grouped by inferred business capability
- project overview pages
- reference indexes for modules and files
- one page per source file and module in the reference section
- Basic Design and Detail Design pages
- inferred business/request flows with Mermaid diagrams
- inferred API contract pages with request/response summaries
- endpoint-level flow and sequence diagrams
- local VitePress search config
- a portable `search-index.json`
- a machine-readable `manifest.json`

## Quick Start

Run against the current project:

```bash
npx docs-wiki
```

Generate docs with AI enrichment:

```bash
npx docs-wiki --ai
```

Serve the generated wiki locally with VitePress:

```bash
npx docs-wiki serve
```

Build a production site:

```bash
npx docs-wiki build-site
```

Preview the production build:

```bash
npx docs-wiki preview
```

Run against another directory:

```bash
npx docs-wiki ../my-project --out-dir wiki
```

## Requirements

- Node.js `>=18`

If AI is enabled, use one of these:

- OpenAI via `OPENAI_API_KEY`
- local Ollama server at `http://127.0.0.1:11434/v1`

## Main Commands

Generate docs:

```bash
npx docs-wiki
npx docs-wiki ./path/to/project
npx docs-wiki --root ./path/to/project --out-dir docs-wiki
```

Serve the generated VitePress site:

```bash
npx docs-wiki serve
npx docs-wiki serve --port 4173 --open
```

Build and preview:

```bash
npx docs-wiki build-site --base /internal-docs/
npx docs-wiki preview --port 4174
```

Check whether the generated docs are stale:

```bash
npx docs-wiki check
```

Deploy scaffold:

```bash
npx docs-wiki init-deploy --target github-pages
npx docs-wiki init-deploy --target vercel
```

Watch mode:

```bash
npx docs-wiki --watch
```

## CLI Options

The CLI currently supports:

- `--root <path>`
- `--config <path>`
- `--out-dir <path>`
- `--port <n>`
- `--open [path]`
- `--base <path>`
- `--strict-port`
- `--force`
- `--target <github-pages|vercel>`
- `--deploy-branch <name>`
- `--overwrite`
- `--template <basic|detailed|api-first>`
- `--theme-preset <clean|warm|enterprise>`
- `--flow-diagram <flow|sequence|both|none>`
- `--max-files <n>`
- `--max-files-per-feature <n>`
- `--split-by-action`
- `--no-split-by-action`
- `--debug-features`
- `--ai`
- `--no-ai`
- `--ai-provider <auto|ollama|openai>`
- `--ai-model <name>`
- `--ollama-model-strategy <exact|family|first-available>`
- `--openai-api-key <key>`
- `--watch`
- `--no-watch`
- `--incremental`
- `--no-incremental`
- `--verbose`
- `--no-progress`
- `--help`

Default flow diagram mode is `flow`.

## Configuration

Place `docs-wiki.config.json` in the target project root, or pass `--config /path/to/docs-wiki.config.json`.

Example:

```json
{
  "ignore": ["**/*.test.ts", "**/dist/**"],
  "incremental": true,
  "watch": false,
  "template": "api-first",
  "themePreset": "warm",
  "features": {
    "enabled": true,
    "maxFilesPerFeature": 30,
    "splitByAction": true,
    "customDomains": {
      "billing": ["invoice", "subscription"]
    }
  },
  "output": {
    "flowDiagram": "flow",
    "includeCodeBlocks": true,
    "includeAiSections": true,
    "includeUsageNotes": false,
    "highlightPublicApi": true
  },
  "ai": {
    "enabled": false,
    "provider": "auto",
    "model": "gpt-5.4-mini",
    "ollamaBaseURL": "http://127.0.0.1:11434/v1",
    "ollamaModel": "llama3.2",
    "ollamaModelStrategy": "family",
    "reasoningEffort": "none",
    "filePrompt": "Describe contracts and side effects.",
    "modulePrompt": "Emphasize business capability, actors, and request flow.",
    "featurePrompt": "Write user stories, edge cases, and cross-workspace boundaries.",
    "projectPrompt": "Emphasize runtime architecture and boundaries."
  }
}
```

Supported config keys:

- `outDir`
- `include`
- `ignore`
- `maxFiles`
- `incremental`
- `watch`
- `template`
- `themePreset`
- `features.enabled`
- `features.maxFilesPerFeature`
- `features.splitByAction`
- `features.customDomains`
- `output.flowDiagram`
- `output.includeCodeBlocks`
- `output.includeAiSections`
- `output.includeUsageNotes`
- `output.highlightPublicApi`
- `ai.enabled`
- `ai.provider`
- `ai.model`
- `ai.baseURL`
- `ai.ollamaBaseURL`
- `ai.ollamaModel`
- `ai.ollamaModelStrategy`
- `ai.reasoningEffort`
- `ai.filePrompt`
- `ai.modulePrompt`
- `ai.featurePrompt`
- `ai.projectPrompt`

## Templates

- `basic`: structural docs, no AI sections, no embedded code blocks
- `detailed`: richer output with AI sections, usage notes, and public API emphasis
- `api-first`: focus on exported/public symbols and endpoint/API surfaces

## Theme Presets

- `clean`: teal/orange default
- `warm`: orange/amber emphasis
- `enterprise`: blue/teal conservative theme

## Diagram Modes

- `flow`: render flowcharts only
- `sequence`: render sequence diagrams only
- `both`: render both flowcharts and sequence diagrams
- `none`: omit flow diagrams in flow sections

This setting applies to inferred flow sections and endpoint-level API flow rendering.

## AI Providers

When `--ai` is enabled, provider resolution works like this:

1. If `--ai-provider ollama` or `ai.provider = "ollama"`, use Ollama.
2. If provider is `auto` and no OpenAI key is present, try Ollama first.
3. Otherwise, use OpenAI when `OPENAI_API_KEY` is available.

OpenAI:

- uses the OpenAI SDK already included in the package
- supports `--ai-model`
- supports `OPENAI_BASE_URL` if needed

Ollama:

- uses the OpenAI-compatible API surface
- defaults to `http://127.0.0.1:11434/v1`
- defaults to model family `llama3.2`
- can auto-pick a nearest installed variant such as `llama3.2:1b`
- applies a repair/normalization pass for imperfect JSON outputs

Environment variables:

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `DOCS_WIKI_OPENAI_MODEL`
- `DOCS_WIKI_REASONING_EFFORT`
- `OLLAMA_BASE_URL`
- `OLLAMA_MODEL`
- `OLLAMA_MODEL_STRATEGY`
- `OLLAMA_API_KEY`

## Output Structure

By default the CLI writes:

- `docs-wiki/SUMMARY.md`
- `docs-wiki/index.md`
- `docs-wiki/features/index.md`
- `docs-wiki/features/*.md`
- `docs-wiki/design/index.md`
- `docs-wiki/design/basic-design.md`
- `docs-wiki/design/detail-design.md`
- `docs-wiki/design/api-contracts.md`
- `docs-wiki/design/flows.md`
- `docs-wiki/reference/index.md`
- `docs-wiki/reference/modules/index.md`
- `docs-wiki/reference/modules/**/*.md`
- `docs-wiki/workspaces/index.md`
- `docs-wiki/workspaces/**/*.md`
- `docs-wiki/reference/files/**/*.md`
- `docs-wiki/modules/**/*.md` as redirect stubs for old URLs
- `docs-wiki/files/**/*.md` as redirect stubs for old URLs
- `docs-wiki/.vitepress/config.mjs`
- `docs-wiki/.vitepress/theme/index.mjs`
- `docs-wiki/public/docs-wiki.css`
- `docs-wiki/search-index.json`
- `docs-wiki/vitepress.schema.json`
- `docs-wiki/manifest.json`

## What The Tool Infers

### 1. Source Structure

From Tree-sitter and text indexing, `docs-wiki` extracts:

- files
- symbols
- modules/directories
- workspaces/packages
- local imports
- lightweight file-to-file interaction edges

### 2. Design Views

The design layer builds:

- `Basic Design`: actors, top capabilities, context-level view
- `Detail Design`: runtime shape, module responsibilities, interaction graph
- `Flow Catalog`: business/request flows inferred from structure and local edges
- feature pages: user stories, related flows, related files, basic/detail design, API contracts, and edge cases for each inferred business capability

The design model uses two kinds of evidence:

- structural heuristics: names, folders, exported symbols, common role patterns like route/service/repository
- graph evidence: local imports and lightweight imported-symbol call detection

### 3. API Contracts

The API layer currently infers:

- Express-style handlers like `router.post("/login", loginHandler)`
- chained route declarations like `router.route("/x").post(handler)`
- Next.js file-based routes in `app/api/**/route.ts`
- Next.js `pages/api/**`

It extracts, when possible:

- HTTP method
- path
- handler name
- request body keys
- query keys
- path params
- headers
- response status codes
- top-level response keys
- endpoint grouping by dominant domain such as `auth`, `orders`, `payment`

### 4. Schema References

The contract layer also tries to resolve request and response schemas from code.

Currently supported inference includes:

- Zod parsers such as `loginSchema.parse(req.body)`
- Zod parsers such as `loginSchema.parse(body)` after `body = await request.json()`
- `safeParse(...)`
- local TypeScript interfaces and type aliases used as DTO-like contracts
- response generics such as `NextApiResponse<LoginResponse>`
- `NextResponse.json<LoginResponse>(...)`

When a referenced schema or DTO can be resolved locally, the generated docs include the schema name and top-level field names.

### 5. Endpoint-Level Flows

For each inferred endpoint, `docs-wiki` builds an endpoint-specific flow using:

- the endpoint entry file
- local call/dependency handoffs
- inferred data-store and integration signals

That output appears in API docs as:

- endpoint steps
- endpoint flow diagram
- endpoint sequence diagram

## Supported Languages

### Full symbol extraction via Tree-sitter

- JavaScript: `.js`, `.cjs`, `.mjs`, `.jsx`
- TypeScript: `.ts`, `.tsx`
- Python: `.py`
- Go: `.go`
- Rust: `.rs`

### Plain-text indexed files

These are still documented as files, but without full AST-based symbol extraction:

- Dart / Flutter: `.dart`
- Vue / Svelte / styles: `.vue`, `.svelte`, `.css`, `.scss`, `.less`
- config/data: `.json`, `.yaml`, `.yml`
- mobile/JVM text-indexed files: `.swift`, `.kt`, `.kts`, `.java`

Common generated directories are ignored automatically, including build caches, `node_modules`, `.next`, `.dart_tool`, iOS Pods, Android Gradle outputs, and the generated `docs-wiki/` folder itself.

## VitePress Integration

Generated docs are VitePress-ready out of the box.

Included pieces:

- `docs-wiki/.vitepress/config.mjs`
- `docs-wiki/.vitepress/theme/index.mjs`
- `docs-wiki/public/docs-wiki.css`
- VitePress frontmatter on every page
- Mermaid rendering support
- local search config
- generated home page at `index.md`

Useful commands:

```bash
npx docs-wiki serve --port 4173 --open
npx docs-wiki build-site --base /internal-docs/
npx docs-wiki preview --port 4174
```

## Incremental Mode

Incremental mode is enabled by default.

On repeated runs, `docs-wiki` attempts to:

- reuse parse results for unchanged files
- reuse AI summaries when AI settings still match
- reuse feature AI summaries when the feature hash is unchanged
- remove pages for deleted files/modules/workspaces
- rewrite only changed pages when possible

Disable it if you want a full clean pass:

```bash
npx docs-wiki --no-incremental
```

## Drift Check

Use `check` in CI or before commits when you want to know whether the committed wiki output is stale.

```bash
npx docs-wiki check
```

The command compares the current codebase against the previously generated `docs-wiki/manifest.json` and fails when:

- source files changed or were deleted
- feature clusters changed
- inferred API contracts changed
- render settings changed
- AI output is expected but the current manifest is missing matching AI summaries

This gives you a simple CI gate for “docs must be regenerated”.

## Watch Mode

Use watch mode during development inside a target project:

```bash
npx docs-wiki --watch
```

This reruns the generation pipeline on changes and ignores the output directory itself.

## Deploy Scaffolds

Generate GitHub Pages workflow:

```bash
npx docs-wiki init-deploy --target github-pages
```

Generate Vercel config:

```bash
npx docs-wiki init-deploy --target vercel
```

Use `--overwrite` if the target file already exists and you intentionally want to replace it.

## Example Workflow For A New User

Inside a project you want to document:

```bash
npx docs-wiki --ai --flow-diagram both
npx docs-wiki serve
```

Then inspect these pages first:

1. `docs-wiki/index.md`
2. `docs-wiki/features/index.md`
3. `docs-wiki/design/basic-design.md`
4. `docs-wiki/design/detail-design.md`
5. `docs-wiki/design/api-contracts.md`
6. `docs-wiki/design/flows.md`
7. `docs-wiki/reference/index.md`

## Repository Layout

For contributors to this repository:

- `bin/docs-wiki.js`: CLI entry point
- `src/cli.js`: command parsing and orchestration
- `src/scanner.js`: discovery, parsing, dependency extraction, API/schema inference
- `src/design.js`: design model, flow inference, endpoint sequence generation
- `src/featureClusterer.js`: deterministic feature clustering across modules and workspaces
- `src/generator.js`: Markdown, VitePress, search index, and page rendering
- `src/ai.js`: OpenAI/Ollama integration and normalization
- `src/config.js`: config and option resolution
- `src/drift.js`: stale-doc detection used by `docs-wiki check`
- `src/vitepress.js`: local VitePress execution wrapper
- `src/deploy.js`: deploy scaffold generation
- `test/smoke.test.js`: end-to-end smoke tests

## Local Development

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm test
```

Run the CLI from source:

```bash
node ./bin/docs-wiki.js --help
node ./bin/docs-wiki.js
node ./bin/docs-wiki.js serve
```

Recommended contributor loop:

1. update scanner/design/generator code
2. run `npm test`
3. run a local smoke generation against a fixture repo
4. run `node ./bin/docs-wiki.js build-site` against a sample project if VitePress output changed

## Current Limits

`docs-wiki` is intentionally heuristic-first. That keeps setup simple, but it has limits.

Current important limits:

- call graph quality is strongest for JS/TS
- Python support is lighter for interaction inference
- Go and Rust are more dependency-oriented than semantic call-graph oriented
- API contract extraction is strongest for JS/TS server code
- nested schema inference is still shallow; top-level fields are the main reliable output
- endpoint and business flows are inferred, not runtime-traced
- AI improves wording and business framing, but should not be treated as ground truth

## Status

This repository is usable as a working CLI package, but it is still evolving.

If you are extending it, prefer improving the scan/design model first, then the Markdown renderer second. Most downstream features depend on better scan results, not on more template logic.
