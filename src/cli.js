const path = require('node:path');
const { enrichWithAi, enrichFeaturesWithAi, DEFAULT_AI_MODEL } = require('./ai');
const { loadUserConfig, resolveOptions, DEFAULT_THEME_PRESET, THEME_PRESETS, FLOW_DIAGRAM_MODES, DEFAULT_FLOW_DIAGRAM_MODE } = require('./config');
const { scaffoldDeploy } = require('./deploy');
const { enrichWithDesign } = require('./design');
const { checkDocsDrift, formatDriftReport } = require('./drift');
const { clusterFeatures, formatFeatureDebug } = require('./featureClusterer');
const { scanProject } = require('./scanner');
const { writeDocs } = require('./generator');
const { ensureVitePressRuntimeDeps, runVitePress, spawnVitePress } = require('./vitepress');
const { printBanner, createRunProgress } = require('./ui');

function printHelp() {
  console.log(`docs-wiki

Usage (from GitHub — put github:truongnat/docs-wiki immediately after npx):
  npx github:truongnat/docs-wiki
  npx github:truongnat/docs-wiki ./path/to/project
  npx github:truongnat/docs-wiki serve
  npx github:truongnat/docs-wiki build-site
  npx github:truongnat/docs-wiki preview
  npx github:truongnat/docs-wiki check
  npx github:truongnat/docs-wiki hotfix-site
  npx github:truongnat/docs-wiki init-deploy --target github-pages
  npx github:truongnat/docs-wiki init-deploy --target vercel
  npx github:truongnat/docs-wiki --root ./path/to/project --out-dir .docs-wiki
  npx github:truongnat/docs-wiki --ai
  npx github:truongnat/docs-wiki --watch

If the package is installed from npm as "docs-wiki", use: npx docs-wiki …

Options:
  --root <path>         Root directory to scan. Defaults to the current working directory.
  --config <path>       Path to docs-wiki.config.json. Defaults to <root>/docs-wiki.config.json.
  --out-dir <path>      Output directory inside the scanned project. Defaults to .docs-wiki.
  --site <path>         With hotfix-site: path to generated site folder (contains .vitepress). Overrides --root/--out-dir.
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
  --flow-diagram <name> Flow-diagram mode for inferred flows: ${FLOW_DIAGRAM_MODES.join(', ')}. Defaults to ${DEFAULT_FLOW_DIAGRAM_MODE}.
  --max-files <n>       Limit the number of files scanned. Useful for smoke tests.
  --max-files-per-feature <n>
                       Split large features when the cluster grows beyond this file count. Defaults to 40.
  --split-by-action     Split large domains into action-level features such as login/register/reset.
  --no-split-by-action  Keep one feature per domain even when the cluster is large.
  --debug-features      Print clustered feature metadata to stdout after the scan.
  --ai                  Enable AI-generated summaries.
  --no-ai               Disable AI summaries even if config enables them.
  --ai-provider <name>  AI provider: auto, ollama, openai, anthropic, gemini, deepseek.
  --ai-model <name>     Model name for the selected provider.
  --openai-api-key <k>  OpenAI API key override. Defaults to OPENAI_API_KEY.
  --anthropic-api-key <k>
                       Anthropic API key override. Defaults to ANTHROPIC_API_KEY.
  --gemini-api-key <k>  Gemini API key override. Defaults to GEMINI_API_KEY.
  --deepseek-api-key <k> DeepSeek API key override. Defaults to DEEPSEEK_API_KEY.
  --locale <en|vi>      Language for AI-generated prose (default: en). Overrides ai.locale and DOCS_WIKI_LOCALE.
  --watch               Watch the repo and rebuild on changes.
  --no-watch            Disable watch mode.
  --incremental         Reuse the previous manifest and only rewrite changed pages when possible.
  --no-incremental      Disable incremental reuse.
  --verbose, -v         Progress on stderr plus a report of non-indexed file extensions after the scan.
  --no-progress         Disable banner and progress UI (for CI or logs).
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
    flowDiagram: undefined,
    maxFiles: undefined,
    maxFilesPerFeature: undefined,
    splitByAction: undefined,
    ai: undefined,
    aiProvider: undefined,
    aiModel: undefined,
    ollamaModelStrategy: undefined,
    openAIApiKey: undefined,
    anthropicApiKey: undefined,
    anthropicModel: undefined,
    geminiApiKey: undefined,
    geminiModel: undefined,
    deepseekApiKey: undefined,
    deepseekModel: undefined,
    locale: undefined,
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
    debugFeatures: false,
    verbose: false,
    progress: undefined,
    hotfixSitePath: null,
  };

  const commandNames = new Set(['serve', 'dev', 'preview', 'build-site', 'check', 'init-deploy', 'hotfix-site']);

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if ((index === 0 || options.command === 'generate') && commandNames.has(current)) {
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

    if (current === '--site') {
      options.hotfixSitePath = path.resolve(argv[index + 1] || '');
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

    if (current === '--flow-diagram') {
      options.flowDiagram = argv[index + 1] || undefined;
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

    if (current === '--max-files-per-feature') {
      const raw = Number(argv[index + 1]);
      if (!Number.isFinite(raw) || raw <= 0) {
        throw new Error('--max-files-per-feature must be a positive number');
      }
      options.maxFilesPerFeature = raw;
      index += 1;
      continue;
    }

    if (current === '--split-by-action') {
      options.splitByAction = true;
      continue;
    }

    if (current === '--no-split-by-action') {
      options.splitByAction = false;
      continue;
    }

    if (current === '--debug-features') {
      options.debugFeatures = true;
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

    if (current === '--anthropic-api-key') {
      options.anthropicApiKey = argv[index + 1] || '';
      index += 1;
      continue;
    }

    if (current === '--gemini-api-key') {
      options.geminiApiKey = argv[index + 1] || '';
      index += 1;
      continue;
    }

    if (current === '--deepseek-api-key') {
      options.deepseekApiKey = argv[index + 1] || '';
      index += 1;
      continue;
    }

    if (current === '--locale') {
      options.locale = argv[index + 1] || undefined;
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

    if (current === '--verbose' || current === '-v') {
      options.verbose = true;
      continue;
    }

    if (current === '--no-progress') {
      options.progress = false;
      continue;
    }

    if (current.startsWith('--')) {
      throw new Error(`Unknown option: ${current}`);
    }

    options.root = path.resolve(current);
  }

  return options;
}

function printResult(result, options, cliOpts = {}) {
  console.log(`Scanned: ${result.rootDir}`);
  console.log(`Output:  ${path.resolve(result.rootDir, result.outDir)}`);
  console.log(`Files:   ${result.totals.filesParsed}/${result.totals.filesDiscovered}`);
  console.log(`Symbols: ${result.totals.symbols}`);
  console.log(`Modules: ${result.totals.directories}`);
  console.log(`Workspaces: ${result.totals.workspaces}`);
  console.log(`Features: ${Array.isArray(result.features) ? result.features.length : 0}`);
  console.log(`Mode:    ${result.incremental.mode}`);
  console.log(`Template: ${options.output.template}`);
  console.log(`Theme:   ${options.output.themePreset}`);
  console.log(`Flow diagrams: ${options.output.flowDiagram}`);

  if (options.config.loaded) {
    console.log(`Config:  ${options.config.path}`);
  }

  if (result.incremental.mode === 'incremental') {
    console.log(`Reused:  ${result.incremental.reusedFiles.length} files`);
    console.log(`Changed: ${result.incremental.changedFiles.length} files`);
  }

  if (result.ai && result.ai.enabled) {
    const moduleCount = Array.isArray(result.ai.modules) ? result.ai.modules.filter((entry) => entry && entry.capability).length : 0;
    const featureCount = Array.isArray(result.ai.features) ? result.ai.features.filter((entry) => entry && entry.id).length : 0;
    console.log(`AI:      ${result.ai.provider}/${result.ai.model} (${result.ai.summarizedFiles}/${result.totals.filesParsed} file summaries, ${moduleCount}/${result.totals.directories} module summaries, ${featureCount}/${Array.isArray(result.features) ? result.features.length : 0} feature summaries)`);
  }

  const errorCount = result.errors.length + (result.ai && Array.isArray(result.ai.errors) ? result.ai.errors.length : 0);
  if (errorCount > 0) {
    console.log(`Errors:  ${errorCount}`);
  }

  if (cliOpts.verbose && result.discoveryHints && result.discoveryHints.unindexedFileCount > 0) {
    console.log('');
    console.log('Other files in the repo use extensions docs-wiki does not parse yet:');
    const top = result.discoveryHints.otherExtensions.slice(0, 18).map(([ext, n]) => `${ext}×${n}`);
    console.log(`  ${top.join(', ')}${result.discoveryHints.otherExtensions.length > 18 ? ' …' : ''}`);
    console.log('  Tip: Tree-sitter symbols: .js/.cjs/.mjs/.jsx/.ts/.tsx/.py/.go/.rs. Plain-text index (full file): .vue/.dart/.svelte/.css/.scss/.json/.yaml/.swift/.kt/.java, etc.');
  }
}

function createProgressBridge(useProgress) {
  const ui = createRunProgress({ enabled: useProgress });
  let aiHandshake = false;

  function scan(evt) {
    if (!useProgress || !evt) {
      return;
    }
    switch (evt.type) {
      case 'discover_start':
        ui.phaseStart('Discovering source files');
        break;
      case 'discover_done':
        ui.phaseEnd();
        ui.info(`Matched ${evt.count} source file(s).`);
        break;
      case 'parse_progress':
        if (evt.current === 1) {
          ui.phaseStart('Tree-sitter parse');
        }
        ui.phaseProgress({
          current: evt.current,
          total: evt.total,
          detail: evt.file,
        });
        break;
      case 'parse_done':
        ui.phaseEnd();
        if (evt.discovered === 0) {
          ui.info('No files matched supported extensions (.ts, .js, .py, .go, .rs, …).');
        } else if (evt.parsed < evt.discovered) {
          ui.info(`Indexed ${evt.parsed}/${evt.discovered} file(s); others failed to read or parse.`);
        }
        break;
      default:
        break;
    }
  }

  function ai(evt) {
    if (!useProgress || !evt) {
      return;
    }
    if (evt.type === 'ai_resolve') {
      aiHandshake = false;
      ui.phaseStart('AI provider');
      return;
    }
    if (evt.type === 'ai_progress') {
      if (!aiHandshake) {
        ui.phaseEnd();
        ui.phaseStart('AI summaries');
        aiHandshake = true;
      }
      ui.phaseProgress({
        current: evt.current,
        total: evt.total,
        detail: `${evt.mode === 'cached' ? 'reuse ' : ''}${evt.file}`,
      });
      if (evt.current === evt.total) {
        ui.phaseEnd();
      }
    }
  }

  function write(evt) {
    if (!useProgress || !evt || evt.type !== 'write_progress') {
      return;
    }
    if (evt.current === 1) {
      ui.phaseStart('Writing documentation');
    }
    ui.phaseProgress({
      current: evt.current,
      total: evt.total,
      detail: evt.detail,
    });
    if (evt.current === evt.total) {
      ui.phaseEnd();
    }
  }

  return { scan, ai, write };
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

async function build(cliOptions, buildMeta = {}) {
  const { showBanner = true } = buildMeta;
  const useProgress = cliOptions.progress !== false && process.stderr.isTTY;
  const verbose = Boolean(cliOptions.verbose);

  const loadedConfig = await loadUserConfig(cliOptions.root, cliOptions.configPath);
  const options = resolveOptions(cliOptions.root, cliOptions, loadedConfig);

  if (showBanner && useProgress) {
    printBanner();
  }

  const { scan, ai, write } = createProgressBridge(useProgress);

  const { scanResult, previousManifest } = await scanProject(options.root, {
    outDir: options.outDir,
    maxFiles: options.maxFiles,
    include: options.include,
    ignore: options.ignore,
    incremental: options.incremental,
    cache: options.cache,
    settings: options.settings,
    onProgress: scan,
    scanDiagnostics: verbose,
  });

  const enrichedResult = await enrichWithAi(scanResult, {
    enabled: options.ai.enabled,
    provider: options.ai.provider,
    model: options.ai.model,
    apiKey: options.ai.apiKey,
    baseURL: options.ai.baseURL,
    anthropicApiKey: options.ai.anthropicApiKey,
    anthropicModel: options.ai.anthropicModel,
    geminiApiKey: options.ai.geminiApiKey,
    geminiModel: options.ai.geminiModel,
    deepseekApiKey: options.ai.deepseekApiKey,
    deepseekBaseURL: options.ai.deepseekBaseURL,
    deepseekModel: options.ai.deepseekModel,
    ollamaBaseURL: options.ai.ollamaBaseURL,
    ollamaModel: options.ai.ollamaModel,
    ollamaModelStrategy: options.ai.ollamaModelStrategy,
    ollamaApiKey: options.ai.ollamaApiKey,
    reasoningEffort: options.ai.reasoningEffort,
    filePrompt: options.ai.filePrompt,
    modulePrompt: options.ai.modulePrompt,
    projectPrompt: options.ai.projectPrompt,
    locale: options.ai.locale,
    previousManifest,
    onProgress: ai,
  });

  const designedResult = enrichWithDesign(enrichedResult);
  const clusteredResult = clusterFeatures(designedResult, options.features);
  const finalResult = await enrichFeaturesWithAi(clusteredResult, {
    enabled: options.ai.enabled,
    provider: options.ai.provider,
    model: options.ai.model,
    apiKey: options.ai.apiKey,
    baseURL: options.ai.baseURL,
    anthropicApiKey: options.ai.anthropicApiKey,
    anthropicModel: options.ai.anthropicModel,
    geminiApiKey: options.ai.geminiApiKey,
    geminiModel: options.ai.geminiModel,
    deepseekApiKey: options.ai.deepseekApiKey,
    deepseekBaseURL: options.ai.deepseekBaseURL,
    deepseekModel: options.ai.deepseekModel,
    ollamaBaseURL: options.ai.ollamaBaseURL,
    ollamaModel: options.ai.ollamaModel,
    ollamaModelStrategy: options.ai.ollamaModelStrategy,
    ollamaApiKey: options.ai.ollamaApiKey,
    reasoningEffort: options.ai.reasoningEffort,
    featurePrompt: options.ai.featurePrompt,
    locale: options.ai.locale,
    previousManifest,
  });

  if (cliOptions.debugFeatures) {
    console.log(formatFeatureDebug(finalResult.features));
  }

  await writeDocs(finalResult, {
    previousManifest,
    output: options.output,
    onProgress: write,
  });

  return {
    options,
    result: finalResult,
  };
}

async function runCheck(cliOptions) {
  const useProgress = cliOptions.progress !== false && process.stderr.isTTY;
  const verbose = Boolean(cliOptions.verbose);
  const loadedConfig = await loadUserConfig(cliOptions.root, cliOptions.configPath);
  const options = resolveOptions(cliOptions.root, cliOptions, loadedConfig);

  if (useProgress) {
    printBanner();
  }

  const { scan } = createProgressBridge(useProgress);
  const { scanResult, previousManifest } = await scanProject(options.root, {
    outDir: options.outDir,
    maxFiles: options.maxFiles,
    include: options.include,
    ignore: options.ignore,
    incremental: true,
    cache: options.cache,
    settings: options.settings,
    onProgress: scan,
    scanDiagnostics: verbose,
  });

  const report = checkDocsDrift(scanResult, previousManifest, options);
  console.log(formatDriftReport(report));

  if (!report.ok) {
    process.exitCode = 1;
  }
}

async function runHotfixSite(cliOptions) {
  const loadedConfig = await loadUserConfig(cliOptions.root, cliOptions.configPath);
  const options = resolveOptions(cliOptions.root, cliOptions, loadedConfig);
  const siteRoot = cliOptions.hotfixSitePath
    ? path.resolve(cliOptions.hotfixSitePath)
    : path.resolve(options.root, options.outDir);

  const { applySiteHotfix } = require('./siteHotfix');
  const result = await applySiteHotfix(siteRoot, { output: options.output });

  console.log('docs-wiki hotfix-site: patched VitePress client files and sanitized markdown (no codebase re-scan).');
  console.log(`  theme:   ${result.themePath}`);
  console.log(`  mermaid: ${result.mermaidPath}`);
  console.log(`  styles:  ${result.stylesPath}`);
  console.log(`  markdown: ${result.markdownFilesPatched}/${result.markdownFilesScanned} file(s) patched`);
  console.log('Restart `docs-wiki serve` or run `docs-wiki build-site` to pick up changes.');
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

  if (cliOptions.command === 'check') {
    await runCheck(cliOptions);
    return;
  }

  if (cliOptions.command === 'hotfix-site') {
    await runHotfixSite(cliOptions);
    return;
  }

  const initial = await build(cliOptions, { showBanner: true });
  printResult(initial.result, initial.options, cliOptions);

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
          const next = await build(cliOptions, { showBanner: false });
          printResult(next.result, next.options, cliOptions);
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
        const next = await build(cliOptions, { showBanner: false });
        printResult(next.result, next.options, cliOptions);
      },
    });
  }
}

module.exports = {
  runCli,
};
