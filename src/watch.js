const path = require('node:path');
const chokidar = require('chokidar');

const WATCH_IGNORES = [
  `${path.sep}.git${path.sep}`,
  `${path.sep}node_modules${path.sep}`,
  `${path.sep}dist${path.sep}`,
  `${path.sep}build${path.sep}`,
  `${path.sep}coverage${path.sep}`,
  `${path.sep}.next${path.sep}`,
  `${path.sep}.turbo${path.sep}`,
  `${path.sep}.venv${path.sep}`,
  `${path.sep}venv${path.sep}`,
  `${path.sep}__pycache__${path.sep}`,
  `${path.sep}target${path.sep}`,
];

function shouldIgnorePath(watchedPath, rootDir, outDir) {
  const absolutePath = path.resolve(watchedPath);
  const outputRoot = path.resolve(rootDir, outDir);

  if (absolutePath === outputRoot || absolutePath.startsWith(`${outputRoot}${path.sep}`)) {
    return true;
  }

  return WATCH_IGNORES.some((segment) => absolutePath.includes(segment));
}

async function runWatch({ rootDir, outDir, build }) {
  let running = false;
  let queued = false;
  let timer = null;

  async function trigger(reason) {
    if (running) {
      queued = true;
      return;
    }

    running = true;
    try {
      console.log(`[watch] ${reason}`);
      await build();
    } catch (error) {
      const message = error && error.stack ? error.stack : String(error);
      console.error(message);
    } finally {
      running = false;
      if (queued) {
        queued = false;
        trigger('Rebuilding queued changes...');
      }
    }
  }

  function schedule(eventName, watchedPath) {
    if (shouldIgnorePath(watchedPath, rootDir, outDir)) {
      return;
    }

    clearTimeout(timer);
    timer = setTimeout(() => {
      trigger(`Change detected (${eventName}: ${path.relative(rootDir, watchedPath) || watchedPath})`);
    }, 150);
  }

  const watcher = chokidar.watch(rootDir, {
    ignored: (watchedPath) => shouldIgnorePath(watchedPath, rootDir, outDir),
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 150,
      pollInterval: 50,
    },
  });

  watcher.on('add', (watchedPath) => schedule('add', watchedPath));
  watcher.on('change', (watchedPath) => schedule('change', watchedPath));
  watcher.on('unlink', (watchedPath) => schedule('unlink', watchedPath));
  watcher.on('addDir', (watchedPath) => schedule('addDir', watchedPath));
  watcher.on('unlinkDir', (watchedPath) => schedule('unlinkDir', watchedPath));
  watcher.on('error', (error) => {
    const message = error && error.stack ? error.stack : String(error);
    console.error(message);
  });

  console.log('[watch] watching for changes. Press Ctrl+C to stop.');

  const shutdown = async () => {
    clearTimeout(timer);
    await watcher.close();
  };

  process.once('SIGINT', async () => {
    await shutdown();
    process.exit(0);
  });

  process.once('SIGTERM', async () => {
    await shutdown();
    process.exit(0);
  });

  return new Promise(() => {});
}

module.exports = {
  runWatch,
};
