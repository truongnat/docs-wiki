const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const TypeScript = require('tree-sitter-typescript').typescript;
const Tsx = require('tree-sitter-typescript').tsx;
const Python = require('tree-sitter-python');
const Go = require('tree-sitter-go');
const Rust = require('tree-sitter-rust');

function visit(node, callback) {
  callback(node);
  for (const child of node.namedChildren) {
    visit(child, callback);
  }
}

function getNodeText(source, node) {
  return source.slice(node.startIndex, node.endIndex);
}

function getLineRange(node) {
  return {
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
  };
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function headerBeforeBody(source, node, bodyFieldName) {
  const bodyNode = node.childForFieldName(bodyFieldName);
  if (!bodyNode) {
    return normalizeWhitespace(getNodeText(source, node));
  }

  return normalizeWhitespace(source.slice(node.startIndex, bodyNode.startIndex));
}

function enclosingScope(node) {
  let current = node.parent;
  while (current) {
    if (
      current.type === 'function_declaration' ||
      current.type === 'function_definition' ||
      current.type === 'method_definition' ||
      current.type === 'method_declaration' ||
      current.type === 'arrow_function' ||
      current.type === 'function_expression' ||
      current.type === 'class_declaration' ||
      current.type === 'class_definition' ||
      current.type === 'impl_item'
    ) {
      return current.type;
    }
    current = current.parent;
  }
  return null;
}

function isTopLevelVariableFunction(node) {
  if (node.type !== 'variable_declarator') {
    return false;
  }

  const valueNode = node.childForFieldName('value');
  if (!valueNode || !['arrow_function', 'function_expression'].includes(valueNode.type)) {
    return false;
  }

  return !enclosingScope(node.parent);
}

function hasAncestorType(node, types) {
  let current = node.parent;
  while (current) {
    if (types.includes(current.type)) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function isJavaScriptExported(node) {
  return hasAncestorType(node, ['export_statement']);
}

function isPythonExported(name) {
  return !name.startsWith('_');
}

function isGoExported(name) {
  return /^[A-Z]/.test(name);
}

function isRustExported(node, source) {
  const header = normalizeWhitespace(getNodeText(source, node).split('{', 1)[0]);
  return /\bpub\b/.test(header);
}

function buildSymbol({ kind, name, signature, node, source, exported = false }) {
  return {
    kind,
    name,
    signature: signature || name,
    exported,
    code: getNodeText(source, node),
    ...getLineRange(node),
  };
}

function extractJavaScriptLike(rootNode, source) {
  const symbols = [];

  visit(rootNode, (node) => {
    if (node.type === 'function_declaration') {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) return;
      symbols.push(buildSymbol({
        kind: 'function',
        name: getNodeText(source, nameNode),
        signature: headerBeforeBody(source, node, 'body'),
        exported: isJavaScriptExported(node),
        node,
        source,
      }));
      return;
    }

    if (node.type === 'class_declaration') {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) return;
      symbols.push(buildSymbol({
        kind: 'class',
        name: getNodeText(source, nameNode),
        signature: headerBeforeBody(source, node, 'body'),
        exported: isJavaScriptExported(node),
        node,
        source,
      }));
      return;
    }

    if (node.type === 'method_definition') {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) return;
      symbols.push(buildSymbol({
        kind: 'method',
        name: normalizeWhitespace(getNodeText(source, nameNode)),
        signature: headerBeforeBody(source, node, 'body'),
        exported: isJavaScriptExported(node),
        node,
        source,
      }));
      return;
    }

    if (node.type === 'interface_declaration') {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) return;
      symbols.push(buildSymbol({
        kind: 'interface',
        name: getNodeText(source, nameNode),
        signature: headerBeforeBody(source, node, 'body'),
        exported: isJavaScriptExported(node),
        node,
        source,
      }));
      return;
    }

    if (node.type === 'type_alias_declaration') {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) return;
      symbols.push(buildSymbol({
        kind: 'type',
        name: getNodeText(source, nameNode),
        signature: normalizeWhitespace(getNodeText(source, node)),
        exported: isJavaScriptExported(node),
        node,
        source,
      }));
      return;
    }

    if (node.type === 'enum_declaration') {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) return;
      symbols.push(buildSymbol({
        kind: 'enum',
        name: getNodeText(source, nameNode),
        signature: headerBeforeBody(source, node, 'body'),
        exported: isJavaScriptExported(node),
        node,
        source,
      }));
      return;
    }

    if (isTopLevelVariableFunction(node)) {
      const nameNode = node.childForFieldName('name');
      const valueNode = node.childForFieldName('value');
      if (!nameNode || !valueNode) return;
      const signature = `${getNodeText(source, nameNode)} = ${normalizeWhitespace(source.slice(valueNode.startIndex, Math.min(valueNode.endIndex, valueNode.startIndex + 80)))}`;
      symbols.push(buildSymbol({
        kind: 'function',
        name: getNodeText(source, nameNode),
        signature,
        exported: isJavaScriptExported(node),
        node,
        source,
      }));
    }
  });

  return symbols;
}

function extractPython(rootNode, source) {
  const symbols = [];

  visit(rootNode, (node) => {
    if (node.type !== 'function_definition' && node.type !== 'async_function_definition' && node.type !== 'class_definition') {
      return;
    }

    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const parentKind = node.parent && node.parent.parent ? node.parent.parent.type : null;
    const kind = node.type === 'class_definition' ? 'class' : parentKind === 'class_definition' ? 'method' : 'function';
    const name = getNodeText(source, nameNode);

    symbols.push(buildSymbol({
      kind,
      name,
      signature: headerBeforeBody(source, node, 'body'),
      exported: isPythonExported(name),
      node,
      source,
    }));
  });

  return symbols;
}

function extractGo(rootNode, source) {
  const symbols = [];

  visit(rootNode, (node) => {
    if (node.type === 'function_declaration' || node.type === 'method_declaration') {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) return;
      symbols.push(buildSymbol({
        kind: node.type === 'method_declaration' ? 'method' : 'function',
        name: getNodeText(source, nameNode),
        signature: headerBeforeBody(source, node, 'body'),
        exported: isGoExported(getNodeText(source, nameNode)),
        node,
        source,
      }));
      return;
    }

    if (node.type === 'type_spec') {
      const nameNode = node.childForFieldName('name');
      const typeNode = node.childForFieldName('type');
      if (!nameNode || !typeNode) return;
      const kind = typeNode.type === 'struct_type' ? 'struct' : typeNode.type === 'interface_type' ? 'interface' : 'type';
      symbols.push(buildSymbol({
        kind,
        name: getNodeText(source, nameNode),
        signature: normalizeWhitespace(getNodeText(source, node)),
        exported: isGoExported(getNodeText(source, nameNode)),
        node,
        source,
      }));
    }
  });

  return symbols;
}

function extractRust(rootNode, source) {
  const symbols = [];

  visit(rootNode, (node) => {
    if (node.type === 'function_item') {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) return;
      const kind = node.parent && node.parent.parent && node.parent.parent.type === 'impl_item' ? 'method' : 'function';
      symbols.push(buildSymbol({
        kind,
        name: getNodeText(source, nameNode),
        signature: headerBeforeBody(source, node, 'body'),
        exported: isRustExported(node, source),
        node,
        source,
      }));
      return;
    }

    if (node.type === 'struct_item' || node.type === 'enum_item' || node.type === 'trait_item') {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) return;
      const kindMap = {
        struct_item: 'struct',
        enum_item: 'enum',
        trait_item: 'trait',
      };
      symbols.push(buildSymbol({
        kind: kindMap[node.type],
        name: getNodeText(source, nameNode),
        signature: normalizeWhitespace(getNodeText(source, node).split('{', 1)[0]),
        exported: isRustExported(node, source),
        node,
        source,
      }));
      return;
    }

    if (node.type === 'impl_item') {
      const header = normalizeWhitespace(getNodeText(source, node).split('{', 1)[0]);
      symbols.push(buildSymbol({
        kind: 'impl',
        name: header,
        signature: header,
        exported: isRustExported(node, source),
        node,
        source,
      }));
    }
  });

  return symbols;
}

const MAX_PLAIN_TEXT_BYTES = 480 * 1024;

function truncatePlainSource(source) {
  if (source.length <= MAX_PLAIN_TEXT_BYTES) {
    return source;
  }
  return `${source.slice(0, MAX_PLAIN_TEXT_BYTES)}\n\n/* … truncated by docs-wiki (${source.length} characters total) */`;
}

function extractPlainTextFile(_rootNode, source) {
  const body = truncatePlainSource(source);
  const lines = body.split(/\r?\n/);
  return [{
    kind: 'source',
    name: '(file)',
    signature: `Plain-text index (${lines.length} line${lines.length === 1 ? '' : 's'})`,
    exported: true,
    code: body,
    startLine: 1,
    endLine: Math.max(1, lines.length),
  }];
}

const LANGUAGE_CONFIGS = {
  '.js': {
    label: 'JavaScript',
    grammar: JavaScript,
    codeFence: 'js',
    extractSymbols: extractJavaScriptLike,
  },
  '.cjs': {
    label: 'JavaScript',
    grammar: JavaScript,
    codeFence: 'js',
    extractSymbols: extractJavaScriptLike,
  },
  '.mjs': {
    label: 'JavaScript',
    grammar: JavaScript,
    codeFence: 'js',
    extractSymbols: extractJavaScriptLike,
  },
  '.jsx': {
    label: 'JavaScript',
    grammar: JavaScript,
    codeFence: 'jsx',
    extractSymbols: extractJavaScriptLike,
  },
  '.ts': {
    label: 'TypeScript',
    grammar: TypeScript,
    codeFence: 'ts',
    extractSymbols: extractJavaScriptLike,
  },
  '.tsx': {
    label: 'TypeScript',
    grammar: Tsx,
    codeFence: 'tsx',
    extractSymbols: extractJavaScriptLike,
  },
  '.py': {
    label: 'Python',
    grammar: Python,
    codeFence: 'py',
    extractSymbols: extractPython,
  },
  '.go': {
    label: 'Go',
    grammar: Go,
    codeFence: 'go',
    extractSymbols: extractGo,
  },
  '.rs': {
    label: 'Rust',
    grammar: Rust,
    codeFence: 'rust',
    extractSymbols: extractRust,
  },
  '.vue': {
    label: 'Vue',
    plainText: true,
    codeFence: 'vue',
    extractSymbols: extractPlainTextFile,
  },
  '.svelte': {
    label: 'Svelte',
    plainText: true,
    codeFence: 'svelte',
    extractSymbols: extractPlainTextFile,
  },
  '.css': {
    label: 'CSS',
    plainText: true,
    codeFence: 'css',
    extractSymbols: extractPlainTextFile,
  },
  '.scss': {
    label: 'SCSS',
    plainText: true,
    codeFence: 'scss',
    extractSymbols: extractPlainTextFile,
  },
  '.less': {
    label: 'Less',
    plainText: true,
    codeFence: 'less',
    extractSymbols: extractPlainTextFile,
  },
  '.json': {
    label: 'JSON',
    plainText: true,
    codeFence: 'json',
    extractSymbols: extractPlainTextFile,
  },
  '.yaml': {
    label: 'YAML',
    plainText: true,
    codeFence: 'yaml',
    extractSymbols: extractPlainTextFile,
  },
  '.yml': {
    label: 'YAML',
    plainText: true,
    codeFence: 'yaml',
    extractSymbols: extractPlainTextFile,
  },
  '.swift': {
    label: 'Swift',
    plainText: true,
    codeFence: 'swift',
    extractSymbols: extractPlainTextFile,
  },
  '.kt': {
    label: 'Kotlin',
    plainText: true,
    codeFence: 'kotlin',
    extractSymbols: extractPlainTextFile,
  },
  '.kts': {
    label: 'Kotlin',
    plainText: true,
    codeFence: 'kotlin',
    extractSymbols: extractPlainTextFile,
  },
  '.dart': {
    label: 'Dart (Flutter)',
    plainText: true,
    codeFence: 'dart',
    extractSymbols: extractPlainTextFile,
  },
  '.java': {
    label: 'Java',
    plainText: true,
    codeFence: 'java',
    extractSymbols: extractPlainTextFile,
  },
};

function createParser(extension) {
  const config = LANGUAGE_CONFIGS[extension];
  if (!config || config.plainText) {
    return null;
  }

  const parser = new Parser();
  parser.setLanguage(config.grammar);
  return parser;
}

module.exports = {
  LANGUAGE_CONFIGS,
  createParser,
};
