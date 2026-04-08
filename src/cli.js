const path = require('node:path');
const { enrichWithAi, DEFAULT_AI_MODEL } = require('./ai');
const { loadUserConfig, resolveOptions, DEFAULT_THEME_PRESET, THEME_PRESETS } = require('./config');
const { scaffoldDeploy } = require('./deploy');
const { scanProject } = require('./scanner');
const { writeDocs } = require('./generator');
const { ensureVitePressRuntimeDeps, runVitePress, spawnVitePress } = require('./vitepress');

function printHelp() {
  console.log(`docs-wiki

Usage:
  npx docs-wiki
  npx docs-wiki ./path/to/project
  npx docs-wiki serve
  npx docs-wiki build-site
  npx docs-wiki preview
  npx docs-wiki init-deploy --target github-pages
  npx docs-wiki init-deploy --target vercel
  npx docs-wiki --root ./path/to/project --out-dir docs-wiki
  npx docs-wiki --ai
  npx docs-wiki --watch

Options:
  --root <path>         Root directory to scan. Defaults to the current working directory.
  --config <path>       Path to docs-wiki.config.json. Defaults to <root>/docs-wiki.config.json.
  --out-dir <path>      Output directory inside the scanned project. Defaults to docs-wiki.
  --port <n>            Port used by VitePress serve/preview.
  --open [path]         Open the browser when starting VitePress dev.
  --base <path>         Public base path forwarded to VitePress.
  --strict-port         Exit if the requested VitePress dev port is already in use.
  --force               Force VitePress dev to ignore optimizer cache.
  --target <name>       Deployment scaffold target: github-pages, vercel.
  --deploy-branch <n>   Branch used in generated GitHub Pages workflow. Defaults to main.
  --overwrite           Allow deploy scaffold commands to overwrite existing files.
  --template <name>     Output template: basic, detailed, api-first.
  --theme-preset <name> VitePress theme preset: ${THEME_PRESETS.join(', ')}. Defaults to ${DEFAULT_THEME_PRESET}.
  --max-files <n>       Limit the number of files scanned. Useful for smoke tests.
  --ai                  Enable AI-generated summaries.
  --no-ai               Disable AI summaries even if config enables them.
  --ai-provider <name>  AI provider: auto, ollama, openai.
  --ai-model <name>     OpenAI model used for summaries. Defaults to ${DEFAULT_AI_MODEL}.
  --ollama-model-strategy <name>
                       Ollama selection strategy: exact, family, first-available.
  --openai-api-key <k>  API key override. Defaults to OPENAI_API_KEY.
  --watch               Watch the repo and rebuild on changes.
  --no-watch            Disable watch mode.
  --incremental         Reuse the previous manifest and only rewrite changed pages when possible.
  --no-incremental      Disable incremental reuse.
  --help                Show this help message.
`);
}

function parseArgs(argv) {
  const options = {
    command: 'generate',
    root: process.cwd(),
    configPath: null,
    outDir: undefined,
    template: undefined,
    themePreset: undefined,
    maxFiles: undefined,
    ai: undefined,
    aiProvider: undefined,
    aiModel: undefined,
    ollamaModelStrategy: undefined,
    openAIApiKey: undefined,
    incremental: undefined,
    watch: undefined,
    port: undefined,
    open: undefined,
    base: undefined,
    strictPort: undefined,
    force: undefined,
    deployTarget: undefined,
    deployBranch: undefined,
    overwrite: false,
  };

  const commandNames = new Set(['serve', 'dev', 'preview', 'build-site', 'init-deploy']);

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (index === 0 && commandNames.has(current)) {
      options.command = current === 'dev' ? 'serve' : current;
      continue;
    }

    if (current === '--help' || current === '-h') {
      options.help = true;
      continue;
    }

    if (current === '--root') {
      options.root = path.resolve(argv[index + 1] || '');
      index += 1;
      continue;
    }

    if (current === '--config') {
      options.configPath = path.resolve(argv[index + 1] || '');
      index += 1;
      continue;
    }

    if (current === '--out-dir') {
      options.outDir = argv[index + 1] || undefined;
      index += 1;
      continue;
    }

    if (current === '--port') {
      const raw = Number(argv[index + 1]);
      if (!Number.isFinite(raw) || raw <= 0) {
        throw new Error('--port must be a positive number');
      }
      options.port = raw;
      index += 1;
      continue;
    }

    if (current === '--open') {
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        options.open = next;
        index += 1;
      } else {
        options.open = true;
      }
      continue;
    }

    if (current === '--base') {
      options.base = argv[index + 1] || undefined;
      index += 1;
      continue;
    }

    if (current === '--strict-port') {
      options.strictPort = true;
      continue;
    }

    if (current === '--force') {
      options.force = true;
      continue;
    }

    if (current === '--target') {
      options.deployTarget = argv[index + 1] || undefined;
      index += 1;
      continue;
    }

    if (current === '--deploy-branch') {
      options.deployBranch = argv[index + 1] || undefined;
      index += 1;
      continue;
    }

    if (current === '--overwrite') {
      options.overwrite = true;
      continue;
    }

    if (current === '--template') {
      options.template = argv[index + 1] || undefined;
      index += 1;
      continue;
    }

    if (current === '--theme-preset') {
      options.themePreset = argv[index + 1] || undefined;
      index += 1;
      continue;
    }

    if (current === '--max-files') {
      const raw = Number(argv[index + 1]);
      if (!Number.isFinite(raw) || raw <= 0) {
        throw new Error('--max-files must be a positive number');
      }
      options.maxFiles = raw;
      index += 1;
      continue;
    }

    if (current === '--ai') {
      options.ai = true;
      continue;
    }

    if (current === '--no-ai') {
      options.ai = false;
      continue;
    }

    if (current === '--ai-provider') {
      options.aiProvider = argv[index + 1] || undefined;
      index += 1;
      continue;
    }

    if (current === '--ai-model') {
      options.aiModel = argv[index + 1] || undefined;
      index += 1;
      continue;
    }

    if (current === '--ollama-model-strategy') {
      options.ollamaModelStrategy = argv[index + 1] || undefined;
      index += 1;
      continue;
    }

    if (current === '--openai-api-key') {
      options.openAIApiKey = argv[index + 1] || '';
      index += 1;
      continue;
    }

    if (current === '--watch') {
      options.watch = true;
      continue;
    }

    if (current === '--no-watch') {
      options.watch = false;
      continue;
    }

    if (current === '--incremental') {
      options.incremental = true;
      continue;
    }

    if (current === '--no-incremental') {
      options.incremental = false;
      continue;
    }

    if (current.startsWith('--')) {
      throw new Error(`Unknown option: ${current}`);
    }

    options.root = path.resolve(current);
  }

  return options;
}

function printResult(result, options) {
  console.log(`Scanned: ${result.rootDir}`);
  console.log(`Output:  ${path.resolve(result.rootDir, result.outDir)}`);
  console.log(`Files:   ${result.totals.filesParsed}/${result.totals.filesDiscovered}`);
  console.log(`Symbols: ${result.totals.symbols}`);
  console.log(`Modules: ${result.totals.directories}`);
  console.log(`Workspaces: ${result.totals.workspaces}`);
  console.log(`Mode:    ${result.incremental.mode}`);
  console.log(`Template: ${options.output.template}`);
  console.log(`Theme:   ${options.output.themePreset}`);

  if (options.config.loaded) {
    console.log(`Config:  ${options.config.path}`);
  }

  if (result.incremental.mode === 'incremental') {
    console.log(`Reused:  ${result.incremental.reusedFiles.length} files`);
    console.log(`Changed: ${result.incremental.changedFiles.length} files`);
  }

  if (result.ai && result.ai.enabled) {
    console.log(`AI:      ${result.ai.provider}/${result.ai.model} (${result.ai.summarizedFiles}/${result.totals.filesParsed} file summaries)`);
  }

  const errorCount = result.errors.length + (result.ai && Array.isArray(result.ai.errors) ? result.ai.errors.length : 0);
  if (errorCount > 0) {
    console.log(`Errors:  ${errorCount}`);
  }
}

function waitForChildExit(child, label) {
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${label} terminated with signal ${signal}.`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`${label} exited with code ${code}.`));
        return;
      }

      resolve();
    });
  });
}

async function build(cliOptions) {
  const loadedConfig = await loadUserConfig(cliOptions.root, cliOptions.configPath);
  const options = resolveOptions(cliOptions.root, cliOptions, loadedConfig);
  const { scanResult, previousManifest } = await scanProject(options.root, {
    outDir: options.outDir,
    maxFiles: options.maxFiles,
    include: options.include,
    ignore: options.ignore,
    incremental: options.incremental,
    cache: options.cache,
    settings: options.settings,
  });

  const enrichedResult = await enrichWithAi(scanResult, {
    enabled: options.ai.enabled,
    provider: options.ai.provider,
    model: options.ai.model,
    apiKey: options.ai.apiKey,
    baseURL: options.ai.baseURL,
    ollamaBaseURL: options.ai.ollamaBaseURL,
    ollamaModel: options.ai.ollamaModel,
    ollamaModelStrategy: options.ai.ollamaModelStrategy,
    ollamaApiKey: options.ai.ollamaApiKey,
    reasoningEffort: options.ai.reasoningEffort,
    filePrompt: options.ai.filePrompt,
    projectPrompt: options.ai.projectPrompt,
    previousManifest,
  });

  await writeDocs(enrichedResult, {
    previousManifest,
    output: options.output,
  });

  return {
    options,
    result: enrichedResult,
  };
}

async function runCli(argv) {
  const cliOptions = parseArgs(argv);
  if (cliOptions.command === 'serve' && cliOptions.watch === undefined) {
    cliOptions.watch = true;
  }

  if (cliOptions.help) {
    printHelp();
    return;
  }

  const initial = await build(cliOptions);
  printResult(initial.result, initial.options);

  const siteRoot = path.resolve(initial.result.rootDir, initial.result.outDir);
  const vitePressOptions = {
    port: cliOptions.port,
    open: cliOptions.open,
    base: cliOptions.base,
    strictPort: cliOptions.strictPort,
    force: cliOptions.force,
  };

  if (cliOptions.command === 'build-site') {
    await runVitePress('build', siteRoot, vitePressOptions);
    console.log(`VitePress build output: ${path.resolve(siteRoot, '.vitepress', 'dist')}`);
    return;
  }

  if (cliOptions.command === 'preview') {
    await runVitePress('build', siteRoot, vitePressOptions);
    await runVitePress('preview', siteRoot, vitePressOptions);
    return;
  }

  if (cliOptions.command === 'init-deploy') {
    if (!cliOptions.deployTarget) {
      throw new Error('init-deploy requires --target <github-pages|vercel>.');
    }

    const written = await scaffoldDeploy(initial.result.rootDir, {
      target: cliOptions.deployTarget,
      outDir: initial.result.outDir,
      branch: cliOptions.deployBranch || 'main',
      overwrite: cliOptions.overwrite,
    });

    for (const filePath of written) {
      console.log(`Scaffolded: ${filePath}`);
    }
    return;
  }

  if (cliOptions.command === 'serve') {
    await ensureVitePressRuntimeDeps(siteRoot);
    const server = spawnVitePress('dev', siteRoot, vitePressOptions);

    if (initial.options.watch) {
      const { runWatch } = require('./watch');
      await runWatch({
        rootDir: initial.options.root,
        outDir: initial.options.outDir,
        build: async () => {
          const next = await build(cliOptions);
          printResult(next.result, next.options);
        },
      });
      return;
    }

    await waitForChildExit(server, 'VitePress dev');
    return;
  }

  if (initial.options.watch) {
    const { runWatch } = require('./watch');
    await runWatch({
      rootDir: initial.options.root,
      outDir: initial.options.outDir,
      build: async () => {
        const next = await build(cliOptions);
        printResult(next.result, next.options);
      },
    });
  }
}

module.exports = {
  runCli,
};
