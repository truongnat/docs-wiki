const path = require('node:path');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const PACKAGE_NODE_MODULES = path.join(PACKAGE_ROOT, 'node_modules');

function resolveVitePressBin() {
  try {
    const packagePath = require.resolve('vitepress/package.json');
    const packageJson = require(packagePath);
    const relativeBin = typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin.vitepress;
    return path.resolve(path.dirname(packagePath), relativeBin);
  } catch (error) {
    throw new Error(`VitePress is not installed or could not be resolved: ${error.message}`);
  }
}

function pushFlag(args, flag, value) {
  if (value === undefined || value === null || value === false || value === '') {
    return;
  }

  args.push(flag);
  if (value !== true) {
    args.push(String(value));
  }
}

function createVitePressArgs(command, rootDir, options = {}) {
  const args = [resolveVitePressBin(), command, rootDir];

  if (command === 'dev') {
    pushFlag(args, '--open', options.open);
    pushFlag(args, '--port', options.port);
    pushFlag(args, '--base', options.base);
    pushFlag(args, '--strictPort', options.strictPort);
    pushFlag(args, '--force', options.force);
  }

  if (command === 'build') {
    pushFlag(args, '--base', options.base);
    pushFlag(args, '--outDir', options.outDir);
  }

  if (command === 'preview') {
    pushFlag(args, '--base', options.base);
    pushFlag(args, '--port', options.port);
  }

  return args;
}

function spawnVitePress(command, rootDir, options = {}) {
  const args = createVitePressArgs(command, rootDir, options);
  return spawn(process.execPath, args, {
    cwd: options.cwd || PACKAGE_ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...options.env,
    },
  });
}

async function ensureVitePressRuntimeDeps(rootDir) {
  const target = path.join(rootDir, 'node_modules');

  try {
    const stats = await fs.lstat(target);
    if (stats.isSymbolicLink() || stats.isDirectory()) {
      return;
    }
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      throw error;
    }
  }

  try {
    await fs.symlink(PACKAGE_NODE_MODULES, target, 'dir');
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      return;
    }
    if (error && error.code === 'EPERM') {
      // On Windows, symlink may fail, skip for now
      return;
    }
    throw error;
  }
}

async function runVitePress(command, rootDir, options = {}) {
  await ensureVitePressRuntimeDeps(rootDir);
  return new Promise((resolve, reject) => {
    const child = spawnVitePress(command, rootDir, options);
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`VitePress ${command} terminated with signal ${signal}.`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`VitePress ${command} exited with code ${code}.`));
        return;
      }

      resolve();
    });
  });
}

module.exports = {
  createVitePressArgs,
  ensureVitePressRuntimeDeps,
  runVitePress,
  spawnVitePress,
};
