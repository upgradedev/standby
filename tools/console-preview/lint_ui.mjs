#!/usr/bin/env node
// lint_ui.mjs - heuristic UI checks for an ops console source folder.
//
// What it does:
//   Reads .tsx and .jsx files (and .ts/.js for the text-size rule) under --src
//   and reports likely accessibility, theming and testability problems with
//   file:line locations, grouped by rule, plus a summary.
//
// What it is not:
//   It is heuristic. It matches source text with patterns and a small tag
//   scanner; it does not build a syntax tree or follow components across
//   files. Expect some misses and some false alarms. Read each finding before
//   changing code. To silence one on purpose, put a comment containing
//   "lint-ui-ignore" (optionally followed by rule ids) on the line or the line
//   above, for example {/* lint-ui-ignore img-alt */}.
//
// Levels:
//   error   - accessibility blockers: unlabeled icon-only buttons, clickable
//             div/span that keyboards cannot reach, img without alt, positive
//             tabIndex.
//   warning - heuristics: raw colours, text under 11px, nav items without
//             data-testid, lists from an API result with no unavailable state.
//
// Requirements: Node 20 or newer. No dependencies. Works on Windows, macOS
// and Linux.
//
// Exit codes: 0 no errors (warnings allowed unless --strict), 1 at least one
// error, 2 usage error (for example --src not found).

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const HELP = `lint_ui.mjs - heuristic UI checks for an ops console

Usage:
  node <skill>/scripts/lint_ui.mjs [--src <dir>] [options]

Flags:
  --src <dir>       Source folder to scan (default: src).
  --ignore <list>   Comma-separated path parts to skip, for example
                    "generated,legacy". node_modules, dist, build, coverage,
                    .git and test files (*.test.*, *.spec.*) are always skipped.
  --strict          Count warnings as errors for the exit code.
  --json            Print findings as JSON instead of text.
  -h, --help        Show this help.

Rules (level):
  icon-button-label          (error)   icon-only <button> without aria-label,
                                       aria-labelledby or title
  clickable-non-interactive  (error)   onClick on <div>/<span> without role and
                                       tabIndex (backdrops marked aria-hidden
                                       or role="presentation" are skipped,
                                       since Escape is their keyboard path)
  img-alt                    (error)   <img> without alt (alt="" is fine for
                                       decorative images)
  positive-tabindex          (error)   tabIndex greater than 0
  raw-color                  (warning) hex, rgb(), hsl() and similar colour
                                       literals in .tsx/.jsx outside tokens files
  tiny-text                  (warning) Tailwind text-[..] or inline fontSize
                                       below 11px
  nav-testid                 (warning) links inside <nav> without data-testid
  unavailable-state          (warning) a component maps a list from an API
                                       result but never mentions 'unavailable'

Suppress one finding: a comment with "lint-ui-ignore [rule-id ...]" on the
same line or the line above.

These checks are heuristic: they read text with patterns, not a full parser.

Exit codes:
  0  no errors (warnings allowed unless --strict)
  1  at least one error (or warning with --strict)
  2  usage error
`;

const RULES = {
  'icon-button-label': {
    level: 'error',
    title: 'Icon-only button without an accessible name',
    why: 'A screen reader announces it as "button" with no name. Add aria-label (or title, or visually hidden text).',
  },
  'clickable-non-interactive': {
    level: 'error',
    title: 'onClick on <div> or <span> that keyboards cannot use',
    why: 'Keyboard users cannot reach or activate it. Prefer a <button>; otherwise add role, tabIndex={0} and a key handler.',
  },
  'img-alt': {
    level: 'error',
    title: '<img> without alt',
    why: 'A screen reader reads the file name instead. Describe the image, or use alt="" if it is decorative.',
  },
  'positive-tabindex': {
    level: 'error',
    title: 'Positive tabIndex',
    why: 'It pulls the element ahead of the natural tab order, which confuses keyboard users. Use 0 or -1.',
  },
  'raw-color': {
    level: 'warning',
    title: 'Raw colour value in a component',
    why: 'Colours should come from theme tokens (CSS variables) so light and dark themes change together.',
  },
  'tiny-text': {
    level: 'warning',
    title: 'Text smaller than 11px',
    why: 'Very small text is hard to read in dense tables. The smallest default Tailwind size, text-xs, is 12px.',
  },
  'nav-testid': {
    level: 'warning',
    title: 'Nav item without data-testid',
    why: 'Tests and QA scripts find nav items by data-testid="nav-<id>". Without it they fall back to fragile text matches.',
  },
  'unavailable-state': {
    level: 'warning',
    title: "List from an API result with no 'unavailable' state",
    why: 'When a backend or integration is absent, the page should say so instead of showing an empty list that looks like "no data".',
  },
};
const RULE_ORDER = Object.keys(RULES);

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.next', '.turbo', 'out']);
const JSX_EXT = new Set(['.tsx', '.jsx']);
const TEXT_SIZE_EXT = new Set(['.tsx', '.jsx', '.ts', '.js', '.mts', '.mjs']);

class UsageError extends Error {}

function parseArgs(argv) {
  const spec = { '--src': 'value', '--ignore': 'value', '--strict': 'flag', '--json': 'flag', '--help': 'flag', '-h': 'flag' };
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    const eq = raw.startsWith('--') ? raw.indexOf('=') : -1;
    const key = eq > 0 ? raw.slice(0, eq) : raw;
    const kind = spec[key];
    if (!kind) throw new UsageError(`Unknown argument: ${raw}`);
    const name = key === '-h' ? 'help' : key.slice(2);
    if (kind === 'flag') {
      if (eq > 0) throw new UsageError(`${key} takes no value`);
      out[name] = true;
    } else {
      const value = eq > 0 ? raw.slice(eq + 1) : argv[i + 1];
      if (eq < 0) i += 1;
      if (value === undefined || (eq < 0 && value.startsWith('--'))) throw new UsageError(`${key} needs a value`);
      out[name] = value;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Files

function collectFiles(root, ignoreParts) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (ignoreParts.some((p) => rel.includes(p))) continue;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!TEXT_SIZE_EXT.has(ext)) continue;
        if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name) || /\.d\.ts$/.test(entry.name)) continue;
        if (rel.split('/').includes('__tests__')) continue;
        files.push(full);
      }
    }
  };
  walk(root);
  return files.sort();
}

// ---------------------------------------------------------------------------
// Text helpers

// Replace comments with spaces (keeping line breaks) so patterns do not match
// commented-out code. Conservative: a "//" counts as a comment only when it is
// not inside quotes on its line and follows whitespace or punctuation.
function maskComments(src) {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  out = out
    .split('\n')
    .map((line) => {
      const re = /(^|[\s;,(){}])\/\//g;
      let m;
      while ((m = re.exec(line)) !== null) {
        const pos = m.index + m[1].length;
        const before = line.slice(0, pos).replace(/\\./g, '');
        const balanced = ['"', "'", '`'].every((q) => before.split(q).length % 2 === 1);
        if (balanced) return line.slice(0, pos) + ' '.repeat(line.length - pos);
      }
      return line;
    })
    .join('\n');
  return out;
}

function makeLocator(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i += 1) if (src[i] === '\n') starts.push(i + 1);
  return (index) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, col: index - starts[lo] + 1 };
  };
}

function suppressions(src) {
  const map = new Map();
  src.split('\n').forEach((line, i) => {
    const m = /lint-ui-ignore\b([^\n]*)/.exec(line);
    if (!m) return;
    const ids = (m[1].match(/[a-z][a-z-]+/g) ?? []).filter((id) => RULES[id]);
    const rules = ids.length ? new Set(ids) : null;
    for (const ln of [i + 1, i + 2]) {
      const prev = map.get(ln);
      map.set(ln, prev === null || rules === null ? null : new Set([...(prev ?? []), ...rules]));
    }
  });
  return (line, rule) => map.has(line) && (map.get(line) === null || map.get(line).has(rule));
}

// Index of the "}" matching the "{" at `start`, skipping JS strings.
function matchBrace(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      i += 1;
      while (i < text.length && text[i] !== c) {
        if (text[i] === '\\') i += 1;
        i += 1;
      }
    } else if (c === '{') {
      depth += 1;
    } else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return text.length - 1;
}

// Read a JSX opening tag that starts at `start` ("<"). Returns null when the
// text does not look like a tag.
function readTag(text, start) {
  const m = /^<([A-Za-z][\w.]*)/.exec(text.slice(start, start + 80));
  if (!m) return null;
  const name = m[1];
  let i = start + m[0].length;
  const limit = Math.min(text.length, start + 8000);
  while (i < limit) {
    const c = text[i];
    if (c === '{') {
      i = matchBrace(text, i) + 1;
    } else if (c === '"' || c === "'") {
      const end = text.indexOf(c, i + 1);
      if (end < 0) return null;
      i = end + 1;
    } else if (c === '>') {
      return { name, attrText: text.slice(start + m[0].length, i), start, end: i + 1, selfClosing: false };
    } else if (c === '/' && text[i + 1] === '>') {
      return { name, attrText: text.slice(start + m[0].length, i), start, end: i + 2, selfClosing: true };
    } else if (c === '<') {
      return null;
    } else {
      i += 1;
    }
  }
  return null;
}

function parseAttrs(text) {
  const attrs = new Map();
  let spread = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (c === '{') {
      const end = matchBrace(text, i);
      if (/^\{\s*\.\.\./.test(text.slice(i, end + 1))) spread = true;
      i = end + 1;
      continue;
    }
    const m = /^[A-Za-z_$][\w$:.-]*/.exec(text.slice(i));
    if (!m) {
      i += 1;
      continue;
    }
    const name = m[0];
    i += name.length;
    while (i < text.length && /\s/.test(text[i])) i += 1;
    if (text[i] !== '=') {
      attrs.set(name, true);
      continue;
    }
    i += 1;
    while (i < text.length && /\s/.test(text[i])) i += 1;
    const q = text[i];
    if (q === '"' || q === "'") {
      const end = text.indexOf(q, i + 1);
      const stop = end < 0 ? text.length : end + 1;
      attrs.set(name, text.slice(i, stop));
      i = stop;
    } else if (q === '{') {
      const end = matchBrace(text, i);
      attrs.set(name, text.slice(i, end + 1));
      i = end + 1;
    } else {
      attrs.set(name, '');
    }
  }
  return { attrs, spread };
}

function hasAttr(attrs, ...names) {
  const lower = new Set([...attrs.keys()].map((k) => k.toLowerCase()));
  return names.some((n) => lower.has(n.toLowerCase()));
}

// Classify button children: 'text' (has visible or hidden text), 'icon' (only
// icon components or svg), 'unknown' (an expression that may render text),
// or 'empty'.
function classifyChildren(children) {
  let text = '';
  let icon = false;
  let unknown = false;
  let i = 0;
  while (i < children.length) {
    const c = children[i];
    if (c === '{') {
      const end = matchBrace(children, i);
      const expr = children.slice(i + 1, end).trim();
      if (expr !== '') {
        const withoutAttrStrings = expr.replace(/\s[\w:-]+\s*=\s*(["'])[^"']*\1/g, ' ');
        if (/<\s*([A-Z][\w.]*|svg)\b/.test(expr) && !/["'`]/.test(withoutAttrStrings)) icon = true;
        else unknown = true;
      }
      i = end + 1;
      continue;
    }
    if (c === '<') {
      if (children[i + 1] === '/') {
        const close = children.indexOf('>', i);
        i = close < 0 ? children.length : close + 1;
        continue;
      }
      const tag = readTag(children, i);
      if (!tag) {
        text += c;
        i += 1;
        continue;
      }
      if (tag.name === 'svg') {
        icon = true;
        const close = children.indexOf('</svg>', tag.end);
        i = tag.selfClosing || close < 0 ? tag.end : close + 6;
        continue;
      }
      if (/^[A-Z]/.test(tag.name)) icon = true;
      i = tag.end;
      continue;
    }
    text += c;
    i += 1;
  }
  if (text.replace(/&nbsp;/g, ' ').trim() !== '') return 'text';
  if (unknown) return 'unknown';
  if (icon) return 'icon';
  return 'empty';
}

// ---------------------------------------------------------------------------
// Checks

function checkFile(file, rel) {
  const original = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
  const src = maskComments(original);
  const locate = makeLocator(src);
  const ignored = suppressions(original);
  const ext = path.extname(file).toLowerCase();
  const isJsx = JSX_EXT.has(ext);
  const base = path.basename(file).toLowerCase();
  const isTokens = /^tokens?\b/.test(base) || rel.split('/').includes('tokens');
  const findings = [];
  const add = (rule, index, message) => {
    const { line, col } = locate(index);
    if (ignored(line, rule)) return;
    findings.push({ rule, level: RULES[rule].level, file: rel, line, col, message });
  };

  // tiny-text: Tailwind arbitrary sizes and inline fontSize below 11px.
  for (const m of src.matchAll(/(?<![\w-])((?:[\w-]+:)*text-\[(\d*\.?\d+)(px|rem|em)\])/g)) {
    const px = m[3] === 'px' ? Number(m[2]) : Number(m[2]) * 16;
    if (px < 11) add('tiny-text', m.index, `${m[1]} is about ${Math.round(px * 10) / 10}px`);
  }
  for (const m of src.matchAll(/(?<![\w-])((?:[\w-]+:)*text-(?:2xs|3xs|xxs|tiny|micro))(?![\w-])/g)) {
    add('tiny-text', m.index, `${m[1]} is a custom size; check that it is at least 11px`);
  }
  for (const m of src.matchAll(/\bfontSize\s*:\s*(?:(\d*\.?\d+)(?=\s*[,}\n])|(["'`])(\d*\.?\d+)(px|rem|em)\2)/g)) {
    const px = m[1] !== undefined ? Number(m[1]) : m[4] === 'px' ? Number(m[3]) : Number(m[3]) * 16;
    if (px < 11) add('tiny-text', m.index, `inline fontSize is about ${Math.round(px * 10) / 10}px`);
  }

  if (!isJsx) return findings;

  // raw-color: hex and colour functions outside tokens files.
  if (!isTokens) {
    for (const m of src.matchAll(/(?<![\w&#/-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g)) {
      const before = src.slice(Math.max(0, m.index - 10), m.index);
      if (/(href|to|id|htmlFor)=\s*["'`{]?$/.test(before)) continue;
      add('raw-color', m.index, `${m[0]}; use a token such as var(--color-...) or a theme class`);
    }
    for (const m of src.matchAll(/\b(rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(\s*(?!var\()/g)) {
      add('raw-color', m.index, `${m[1]}(...) literal; use a token`);
    }
  }

  // positive-tabindex
  for (const m of src.matchAll(/\btabIndex\s*=\s*(?:\{\s*["']?|["'])\s*\+?(\d+)/gi)) {
    if (Number(m[1]) > 0) add('positive-tabindex', m.index, `tabIndex is ${m[1]}`);
  }

  // Tag based rules.
  for (const m of src.matchAll(/<(button|div|span|img)(?=[\s/>])/g)) {
    const tag = readTag(src, m.index);
    if (!tag) continue;
    const { attrs, spread } = parseAttrs(tag.attrText);
    if (spread) continue;
    if (tag.name === 'img') {
      if (!hasAttr(attrs, 'alt')) add('img-alt', m.index, '<img> has no alt attribute');
    } else if (tag.name === 'div' || tag.name === 'span') {
      // A click-to-close backdrop marked aria-hidden (or role presentation/none)
      // is a mouse shortcut for something the keyboard does with Escape, so it
      // is skipped rather than pushed into the tab order.
      const decorative = /^["'{]\s*["']?(true|presentation|none)["']?\s*}?["']?$/;
      const hidden = decorative.test(String(attrs.get('aria-hidden') ?? '')) || /^["']?(presentation|none)["']?$/.test(String(attrs.get('role') ?? ''));
      if (hasAttr(attrs, 'onClick') && !hidden) {
        const missing = [];
        if (!hasAttr(attrs, 'role')) missing.push('role');
        if (!hasAttr(attrs, 'tabIndex')) missing.push('tabIndex');
        if (missing.length) add('clickable-non-interactive', m.index, `<${tag.name} onClick> has no ${missing.join(' and no ')}`);
      }
    } else if (tag.name === 'button') {
      if (hasAttr(attrs, 'aria-label', 'aria-labelledby', 'title')) continue;
      let kind;
      if (tag.selfClosing) {
        kind = 'empty';
      } else {
        const close = src.slice(tag.end).search(/<\/button\s*>/);
        if (close < 0) continue;
        kind = classifyChildren(src.slice(tag.end, tag.end + close));
      }
      if (kind === 'icon') add('icon-button-label', m.index, '<button> contains only an icon and has no aria-label or title');
      else if (kind === 'empty') add('icon-button-label', m.index, '<button> has no text and no aria-label or title');
    }
  }

  // nav-testid: links (and buttons that mark the current page) inside <nav>.
  for (const m of src.matchAll(/<nav(?=[\s>])/g)) {
    const tag = readTag(src, m.index);
    if (!tag || tag.selfClosing) continue;
    const { attrs } = parseAttrs(tag.attrText);
    const label = `${attrs.get('aria-label') ?? ''} ${attrs.get('aria-labelledby') ?? ''}`;
    if (/breadcrumb|pagination|pager|steps|tabs/i.test(label)) continue;
    let depth = 1;
    let end = src.length;
    const re = /<(\/?)nav(?=[\s>])/g;
    re.lastIndex = tag.end;
    let n;
    while ((n = re.exec(src)) !== null) {
      depth += n[1] ? -1 : 1;
      if (depth === 0) {
        end = n.index;
        break;
      }
    }
    const body = src.slice(tag.end, end);
    for (const item of body.matchAll(/<(a|Link|NavLink|button)(?=[\s/>])/g)) {
      const at = tag.end + item.index;
      const itemTag = readTag(src, at);
      if (!itemTag) continue;
      const parsed = parseAttrs(itemTag.attrText);
      if (parsed.spread || hasAttr(parsed.attrs, 'data-testid')) continue;
      if (itemTag.name === 'button') {
        const onClick = String(parsed.attrs.get('onClick') ?? '');
        const navLike = hasAttr(parsed.attrs, 'aria-current') || /navigate|setPage|setRoute|push\(|go\(/.test(onClick);
        if (!navLike) continue;
      }
      add('nav-testid', at, `<${itemTag.name}> inside <nav> has no data-testid (expected data-testid="nav-<id>")`);
    }
  }

  // unavailable-state: file maps a list in JSX and reads an API result.
  const mapMatch = /\.map\(\s*(?:\([^)]*\)|[\w$]+)\s*=>\s*(?:\(\s*)?</.exec(src);
  if (mapMatch) {
    const imports = [...src.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((x) => x[1]);
    const importsApi = imports.some((p) => /(^|\/)api(\.[\w]+)?$/.test(p) || /\/api\//.test(p));
    const callsApi = /\b(fetch|useQuery|useSWR|useApi|useResource|useFetch|useLoader|useAsync)\s*\(/.test(src) || /\bapi\.\w+\s*\(/.test(src);
    const delegates = /\b(DataState|ResultState|StateView|ResultView|AsyncState|StateSwitch|renderState)\b/.test(src);
    if ((importsApi || callsApi) && !delegates && !/unavailable/i.test(src)) {
      const missing = ['unavailable'];
      if (!/\bempty\b|EmptyState/i.test(src)) missing.push('empty');
      if (!/\berror\b|ErrorState/i.test(src)) missing.push('error');
      add('unavailable-state', mapMatch.index, `renders a list from an API result but never handles: ${missing.join(', ')}`);
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`lint_ui: ${err.message}\nRun with --help to see the flags.`);
    return 2;
  }
  if (args.help) {
    console.log(HELP);
    return 0;
  }
  const srcDir = path.resolve(args.src ?? 'src');
  if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
    console.error(`lint_ui: source folder not found: ${srcDir}\nPass --src <dir>.`);
    return 2;
  }
  const ignoreParts = (args.ignore ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const files = collectFiles(srcDir, ignoreParts);
  const cwd = process.cwd();
  const display = (file) => {
    const rel = path.relative(cwd, file);
    return (rel.startsWith('..') || path.isAbsolute(rel) ? file : rel).split(path.sep).join('/');
  };

  const findings = [];
  for (const file of files) {
    const relToSrc = path.relative(srcDir, file).split(path.sep).join('/');
    for (const f of checkFile(file, relToSrc)) findings.push({ ...f, file: display(file) });
  }
  const errors = findings.filter((f) => f.level === 'error').length;
  const warnings = findings.length - errors;
  const failed = errors > 0 || (args.strict && warnings > 0);

  if (args.json) {
    console.log(JSON.stringify({ heuristic: true, src: srcDir, filesScanned: files.length, errors, warnings, failed, findings }, null, 2));
    return failed ? 1 : 0;
  }

  console.log('lint_ui: heuristic checks. They read source text with patterns, not a full parser,');
  console.log('so expect some misses and some false alarms. Read each finding before changing code.');
  console.log(`Scanned ${files.length} file(s) under ${display(srcDir) || '.'}`);
  console.log('');
  const ordered = [...RULE_ORDER].sort((a, b) => (RULES[a].level === RULES[b].level ? 0 : RULES[a].level === 'error' ? -1 : 1));
  for (const rule of ordered) {
    const list = findings.filter((f) => f.rule === rule);
    if (list.length === 0) continue;
    console.log(`${RULES[rule].level.toUpperCase()}  ${rule}  (${list.length})  ${RULES[rule].title}`);
    console.log(`  Why: ${RULES[rule].why}`);
    for (const f of list) console.log(`  ${f.file}:${f.line}:${f.col}  ${f.message}`);
    console.log('');
  }
  const perRule = ordered
    .map((r) => [r, findings.filter((f) => f.rule === r).length])
    .filter(([, n]) => n > 0)
    .map(([r, n]) => `${r} ${n}`)
    .join(', ');
  console.log(`Summary: ${errors} error(s), ${warnings} warning(s) in ${files.length} file(s)${perRule ? ` (${perRule})` : ''}.`);
  if (findings.length === 0) console.log('No findings. That does not prove the UI is accessible; also run shoot.mjs --axe --keyboard.');
  if (failed) console.log(args.strict && errors === 0 ? 'Failing because --strict counts warnings.' : 'Failing because of error-level findings.');
  return failed ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (err) {
  console.error(`lint_ui: unexpected error: ${err && err.message ? err.message : String(err)}`);
  process.exitCode = 2;
}
