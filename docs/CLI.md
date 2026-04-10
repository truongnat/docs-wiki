# docs-wiki CLI reference

## Invoking with `npx` (GitHub)

Use npm’s GitHub specifier. **`github:truongnat/docs-wiki`** comes **immediately after** `npx`, then the subcommand:

```bash
npx github:truongnat/docs-wiki <command> [options]
```

Examples:

| Action | Command |
|--------|---------|
| Generate wiki | `npx github:truongnat/docs-wiki` |
| With AI | `npx github:truongnat/docs-wiki --ai` |
| Dev server | `npx github:truongnat/docs-wiki serve` |
| Production build | `npx github:truongnat/docs-wiki build-site` |
| Preview build | `npx github:truongnat/docs-wiki preview` |
| Drift check | `npx github:truongnat/docs-wiki check` |
| Patch theme/Mermaid only (no re-scan) | `npx github:truongnat/docs-wiki hotfix-site` |
| Explicit site folder for hotfix | `npx github:truongnat/docs-wiki hotfix-site --site /path/to/.docs-wiki` |
| Deploy scaffolds | `npx github:truongnat/docs-wiki init-deploy --target github-pages` |

Run `npx github:truongnat/docs-wiki --help` for the full option list.

## npm registry shorthand

If the same tool is published on npm as `docs-wiki`, you can use:

```bash
npx docs-wiki …
```

## Local development (this repository)

From a clone:

```bash
node ./bin/docs-wiki.js --help
npm test
```
