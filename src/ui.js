const path = require('node:path');

let cachedVersion;
function getVersion() {
  if (!cachedVersion) {
    try {
      cachedVersion = require(path.join(__dirname, '..', 'package.json')).version;
    } catch (_e) {
      cachedVersion = '0.0.0';
    }
  }
  return cachedVersion;
}

function printBanner() {
  const version = getVersion();
  const verPad = version.length <= 22 ? version : version.slice(0, 22);
  const lines = [
    '',
    '  ╭──────────────────────────────────────────╮',
    `  │  docs-wiki  ${verPad.padEnd(22)}  │`,
    '  │  Tree-sitter → Markdown → VitePress      │',
    '  ╰──────────────────────────────────────────╯',
    '',
  ];
  console.error(lines.join('\n'));
}

function truncatePath(value, maxLen = 48) {
  if (!value || value.length <= maxLen) {
    return value || '';
  }
  return `…${value.slice(-(maxLen - 1))}`;
}

/**
 * @param {{ enabled: boolean }} opts
 */
function createRunProgress(opts) {
  const enabled = Boolean(opts.enabled && process.stderr.isTTY);
  let inPhase = false;

  function clearLine() {
    if (enabled) {
      process.stderr.write('\r\x1b[K');
    }
  }

  return {
    /**
     * @param {string} title
     */
    phaseStart(title) {
      if (!enabled) {
        return;
      }
      if (inPhase) {
        process.stderr.write('\n');
      }
      console.error(`→ ${title}`);
      inPhase = true;
    },

    /**
     * @param {{ current: number, total: number, detail?: string }} p
     */
    phaseProgress(p) {
      if (!enabled) {
        return;
      }
      const { current, total, detail } = p;
      const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 100;
      const barW = 22;
      const filled = Math.round((pct / 100) * barW);
      const bar = `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, barW - filled))}`;
      const d = truncatePath(detail || '', 44);
      process.stderr.write(`\r  ${bar} ${String(pct).padStart(3)}%  (${current}/${total})  ${d}`.padEnd(88));
    },

    phaseEnd() {
      if (!enabled) {
        return;
      }
      clearLine();
      process.stderr.write('\n');
      inPhase = false;
    },

    /**
     * @param {string} line
     */
    info(line) {
      if (!enabled) {
        return;
      }
      if (inPhase) {
        clearLine();
      }
      console.error(`  ${line}`);
    },
  };
}

module.exports = {
  getVersion,
  printBanner,
  createRunProgress,
  truncatePath,
};
