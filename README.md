# docs-wiki

`docs-wiki` is a zero-config CLI that scans the project in your current working directory and generates a Markdown wiki from source code structure using Tree-sitter.

The generated Markdown is now VitePress-friendly by default:

- every page includes VitePress frontmatter
- generated pages disable edit links and last-updated timestamps by default
- file pages emit deep outlines for symbol-heavy pages
- `docs-wiki/vitepress.schema.json` describes the custom `docsWiki` frontmatter payload
- `docs-wiki/.vitepress/config.mjs` enables VitePress local search out of the box
- `docs-wiki/search-index.json` provides a portable local search index for custom UIs
- `docs-wiki/public/docs-wiki.css` provides generated visual theming for the wiki pages
- the CLI can run bundled VitePress commands directly through `serve`, `build-site`, and `preview`
- the generated `index.md` uses VitePress `layout: home` with hero and feature cards

## Usage

```bash
npx docs-wiki
```

That command scans `process.cwd()` and writes the generated docs to `./docs-wiki` inside the same project.

Start a local VitePress dev server for the generated docs:

```bash
npx docs-wiki serve
```

Build the generated docs as a production VitePress site:

```bash
npx docs-wiki build-site
```

Preview the production build locally:

```bash
npx docs-wiki preview
```

Scaffold deployment config:

```bash
npx docs-wiki init-deploy --target github-pages
npx docs-wiki init-deploy --target vercel
```

Generate richer docs with AI summaries:

```bash
OPENAI_API_KEY=... npx docs-wiki --ai
```

If you do not have an API key, `docs-wiki` will try a local Ollama server first:

```bash
npx docs-wiki --ai
```

By default it probes `http://127.0.0.1:11434/v1` and uses `llama3.2`.

If that exact Ollama tag is not installed, `docs-wiki` will try to pick the closest available family variant such as `llama3.2:1b`.

You can also point it at another directory:

```bash
npx docs-wiki ../my-project --out-dir wiki
```

## Supported Languages

- JavaScript: `.js`, `.cjs`, `.mjs`, `.jsx`
- TypeScript: `.ts`, `.tsx`
- Python: `.py`
- Go: `.go`
- Rust: `.rs`

## Output

By default the CLI writes:

- `docs-wiki/SUMMARY.md`: top-level wiki navigation
- `docs-wiki/index.md`: project overview, language breakdown, key modules
- `docs-wiki/.vitepress/config.mjs`: VitePress config scaffold with `search.provider = 'local'`
- `docs-wiki/vitepress.schema.json`: JSON Schema for the generated VitePress frontmatter
- `docs-wiki/search-index.json`: local JSON search index for overview/module/workspace/file pages
- `docs-wiki/public/docs-wiki.css`: generated CSS theme assets scoped to `docs-wiki` pages
- `docs-wiki/modules/index.md`: module directory index
- `docs-wiki/modules/**/*.md`: one page per module/directory
- `docs-wiki/workspaces/index.md`: workspace or package index for monorepos
- `docs-wiki/workspaces/**/*.md`: one page per detected workspace/package boundary
- `docs-wiki/files/**/*.md`: one page per source file with extracted symbols and code snippets
- `docs-wiki/manifest.json`: machine-readable scan result and incremental cache

## Config File

Place a `docs-wiki.config.json` file in the project root, or pass `--config /path/to/docs-wiki.config.json`.

Example:

```json
{
  "ignore": ["**/*.test.ts", "**/dist/**"],
  "incremental": true,
  "watch": false,
  "template": "api-first",
  "themePreset": "warm",
  "output": {
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
- `themePreset` (`clean`, `warm`, `enterprise`)
- `output.includeCodeBlocks`
- `output.includeAiSections`
- `output.includeUsageNotes`
- `output.highlightPublicApi`
- `ai.enabled`
- `ai.provider` (`auto`, `ollama`, `openai`)
- `ai.model`
- `ai.ollamaBaseURL`
- `ai.ollamaModel`
- `ai.ollamaModelStrategy` (`exact`, `family`, `first-available`)
- `ai.reasoningEffort`
- `ai.baseURL`
- `ai.filePrompt`
- `ai.projectPrompt`

Templates:

- `basic`: structural docs only, no AI sections or code blocks
- `detailed`: richer pages with AI sections, usage notes, and public API highlighting
- `api-first`: emphasize exported/public symbols without embedding code blocks

Theme presets:

- `clean`: balanced teal/orange default
- `warm`: orange/amber gradient with warmer surfaces
- `enterprise`: blue/teal palette with more conservative contrast

## Incremental Mode

Incremental mode is enabled by default. On repeated runs, `docs-wiki`:

- reuses parse results for unchanged source files
- reuses AI summaries for unchanged files when AI settings match
- removes pages for deleted files/modules/workspaces
- rewrites only changed file/module/workspace pages when render settings are compatible

CLI flags:

```bash
npx docs-wiki --incremental
npx docs-wiki --no-incremental
```

## Watch Mode

To keep the wiki updated while you work:

```bash
npx docs-wiki --watch
```

Watch mode ignores common generated directories and the output directory itself, then reruns the incremental pipeline on changes.

## AI Summaries

When `--ai` is enabled, `docs-wiki` resolves providers in this order:

1. If `ai.provider` or `--ai-provider` is `ollama`, use Ollama.
2. If provider is `auto` and there is no OpenAI API key, try Ollama first.
3. Otherwise use OpenAI when `OPENAI_API_KEY` is available.

Ollama uses the OpenAI-compatible chat completions endpoint in JSON mode. OpenAI uses the Responses API with structured outputs.

For local Ollama models, `docs-wiki` also applies a normalization pass so slightly malformed JSON responses can still be coerced into the expected docs schema when possible.

Generated AI content includes:

- file-level summaries
- file responsibilities and usage notes
- symbol-level summaries
- a project-level overview with key modules

Flags:

```bash
npx docs-wiki --ai --ai-provider ollama
npx docs-wiki --ai --ollama-model-strategy family
npx docs-wiki --ai --ai-provider openai
npx docs-wiki --ai --ai-model gpt-5.4-mini
npx docs-wiki --ai --openai-api-key sk-...
```

Environment variables:

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL` (optional)
- `DOCS_WIKI_OPENAI_MODEL` (optional)
- `DOCS_WIKI_REASONING_EFFORT` (optional, default `none`)
- `OLLAMA_BASE_URL` (optional, default `http://127.0.0.1:11434/v1`)
- `OLLAMA_MODEL` (optional, default `llama3.2`)
- `OLLAMA_MODEL_STRATEGY` (optional, default `family`)
- `OLLAMA_API_KEY` (optional, default `ollama`)

## VitePress Integration

Each generated page includes frontmatter similar to:

```yaml
---
title: "src/index.ts"
description: "TypeScript source file with 3 symbols."
layout: "doc"
outline: "deep"
editLink: false
lastUpdated: false
pageClass: "docs-wiki docs-wiki--file"
docsWiki:
  schemaVersion: "1.0.0"
  kind: "file"
  project: "my-app"
  template: "detailed"
  generatedAt: "2026-04-07T16:00:00.000Z"
  relativePath: "src/index.ts"
  module: "src"
  workspace: ""
  language: "TypeScript"
  symbolCount: 3
---
```

The custom `docsWiki` object is intended for VitePress theme extensions and page-level UI logic through `$frontmatter` or `useData()`.

The generated landing page uses the official VitePress home layout:

```yaml
---
layout: home
sidebar: false
aside: false
hero:
  name: "my-app"
  text: "Internal docs wiki"
features:
  - title: "Structure Map"
    details: "Module and workspace indexes"
---
```

Generated `docs-wiki/.vitepress/config.mjs` enables VitePress local search using the official default theme search provider:

```js
export default {
  transformPageData(pageData, { siteConfig }) {
    pageData.frontmatter.head ??= []
    pageData.frontmatter.head.push([
      'link',
      { rel: 'stylesheet', href: `${siteConfig.site.base}docs-wiki.css` }
    ])
  },
  themeConfig: {
    search: {
      provider: 'local'
    }
  }
}
```

`docs-wiki/search-index.json` is separate from VitePress's own build-time index. It is intended for custom search UIs, external ingestion, or debugging the searchable content that `docs-wiki` emits.

`docs-wiki/public/docs-wiki.css` is the generated theme asset layer. It sets VitePress brand variables and adds scoped styling for overview/module/workspace/file pages through the emitted `pageClass` values.

## Built-in VitePress Commands

The CLI bundles VitePress and forwards a focused subset of the official CLI flags:

```bash
npx docs-wiki serve --port 4173 --open
npx docs-wiki serve --base /internal-docs/ --strict-port
npx docs-wiki build-site --base /internal-docs/
npx docs-wiki preview --port 4174
```

Supported forwarded flags:

- `--port`
- `--open`
- `--base`
- `--strict-port`
- `--force`

When serving generated docs, the CLI also prepares the generated site with access to the bundled VitePress runtime dependencies so local dev starts cleanly.

## Deploy Scaffolds

Generate a GitHub Pages workflow:

```bash
npx docs-wiki init-deploy --target github-pages
```

This writes `.github/workflows/docs-wiki-pages.yml` in the target project root. The generated workflow builds `docs-wiki/.vitepress/dist` and deploys it with the current GitHub Pages actions stack. It defaults to branch `main`; override with `--deploy-branch`.

Generate a Vercel config:

```bash
npx docs-wiki init-deploy --target vercel
```

This writes `vercel.json` with:

- `buildCommand: "npx --yes docs-wiki build-site"`
- `outputDirectory: "docs-wiki/.vitepress/dist"`

Use `--overwrite` if you intentionally want to replace an existing scaffold file.

## Development

```bash
npm install
npm test
node ./bin/docs-wiki.js --help
```
# docs-wiki
