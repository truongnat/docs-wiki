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

module.exports = {
  escapeAngleBracketsForVueMarkdown,
  markdownFencedInlineCode,
  createFence,
};
