/**
 * VitePress compiles Markdown as Vue templates. Raw `<` / `>` in prose (e.g. AI text,
 * generics mentioned outside code spans) can trigger vue/compiler errors. Escape HTML
 * entities in any user- or model-generated text that is emitted outside fenced blocks.
 */
function escapeAngleBracketsForVueMarkdown(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * CommonMark inline code with a long enough backtick fence so inner ` characters do not break.
 */
function markdownFencedInlineCode(text) {
  const value = String(text);
  let maxRun = 0;
  const re = /`+/g;
  let m;
  while ((m = re.exec(value)) !== null) {
    maxRun = Math.max(maxRun, m[0].length);
  }
  const fence = '`'.repeat(maxRun + 1);
  const pad = value.startsWith('`') || value.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${value}${pad}${fence}`;
}

/**
 * Fenced code block with a fence length that survives arbitrary backtick runs in `code`.
 */
function createFence(code, language) {
  const body = String(code);
  let maxRun = 0;
  for (const m of body.matchAll(/`+/g)) {
    maxRun = Math.max(maxRun, m[0].length);
  }
  const delim = '`'.repeat(Math.max(3, maxRun + 1));
  return `${delim}${language}\n${body}\n${delim}`;
}

/**
 * VitePress treats top-level `import` / `export` lines in Markdown as Vue SFC ESM.
 * Some generated text (especially multiline parser errors) can accidentally emit those
 * lines outside code fences and break the build. Prefix those lines with a zero-width
 * marker entity so they render as plain text while preserving readability.
 */
function neutralizeTopLevelMarkdownEsm(markdown) {
  const lines = String(markdown || '').split('\n');
  const fenceRegex = /^(\s*)([`~]{3,})(.*)$/;
  const esmRegex = /^(\s*)(import|export)\s+/;
  let activeFence = null;

  return lines.map((line) => {
    const fenceMatch = line.match(fenceRegex);
    if (fenceMatch) {
      const marker = fenceMatch[2];
      const fenceChar = marker[0];
      const fenceLength = marker.length;
      if (!activeFence) {
        activeFence = { fenceChar, fenceLength };
        return line;
      }
      if (activeFence.fenceChar === fenceChar && marker.length >= activeFence.fenceLength) {
        activeFence = null;
      }
      return line;
    }

    if (!activeFence) {
      const esmMatch = line.match(esmRegex);
      if (esmMatch) {
        const indent = esmMatch[1] || '';
        const trimmed = line.slice(indent.length);
        return `${indent}&#8203;${trimmed}`;
      }
    }
    return line;
  }).join('\n');
}

module.exports = {
  escapeAngleBracketsForVueMarkdown,
  markdownFencedInlineCode,
  createFence,
  neutralizeTopLevelMarkdownEsm,
};
