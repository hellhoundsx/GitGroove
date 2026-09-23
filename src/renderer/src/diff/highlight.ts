import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import dart from 'highlight.js/lib/languages/dart';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import graphql from 'highlight.js/lib/languages/graphql';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import less from 'highlight.js/lib/languages/less';
import lua from 'highlight.js/lib/languages/lua';
import makefile from 'highlight.js/lib/languages/makefile';
import markdown from 'highlight.js/lib/languages/markdown';
import objectivec from 'highlight.js/lib/languages/objectivec';
import perl from 'highlight.js/lib/languages/perl';
import php from 'highlight.js/lib/languages/php';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import r from 'highlight.js/lib/languages/r';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scala from 'highlight.js/lib/languages/scala';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import type { DiffHunk, DiffLine, WordSpan } from './parseDiff';

/**
 * Syntax colour for the diff view (asked for by Ricardo).
 *
 * highlight.js rather than a TextMate engine: it runs synchronously and needs no `eval` or WASM,
 * which the renderer's CSP forbids, and only the languages registered here are bundled. What it
 * produces is reduced to a handful of token kinds, coloured by `--syn-*` in `tokens.css`, so the
 * palette is ours and one list of tokens per line is all `DiffView` ever sees.
 *
 * A hunk is highlighted **one side at a time** — the old file's lines (context and removals) and
 * the new file's (context and additions) — so a string or comment that runs across lines is
 * followed correctly on each side. A hunk starts part-way through a file, so one that opens inside
 * a block comment is highlighted as if it did not; every diff viewer that shows hunks shares that.
 */

const LANGUAGES = {
  bash, c, cpp, csharp, css, dart, diff, dockerfile, go, graphql, ini, java, javascript, json, kotlin, less, lua,
  makefile, markdown, objectivec, perl, php, powershell, python, r, ruby, rust, scala, scss, sql, swift, typescript, xml, yaml,
};
for (const [name, lang] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, lang);

const BY_EXTENSION: Record<string, string> = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  json: 'json', jsonc: 'json', css: 'css', scss: 'scss', less: 'less',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml', md: 'markdown', markdown: 'markdown',
  py: 'python', php: 'php', yml: 'yaml', yaml: 'yaml', sh: 'bash', bash: 'bash', zsh: 'bash',
  go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin', swift: 'swift',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', cs: 'csharp',
  sql: 'sql', rb: 'ruby', ini: 'ini', toml: 'ini', cfg: 'ini', conf: 'ini', graphql: 'graphql', gql: 'graphql',
  lua: 'lua', dart: 'dart', scala: 'scala', pl: 'perl', pm: 'perl', r: 'r', m: 'objectivec', mm: 'objectivec',
  ps1: 'powershell', diff: 'diff', patch: 'diff', dockerfile: 'dockerfile',
};
const BY_NAME: Record<string, string> = { dockerfile: 'dockerfile', makefile: 'makefile', gnumakefile: 'makefile' };

/** The highlight.js language for a repository path, or null to draw it as plain text. */
export function languageFor(path: string): string | null {
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  if (BY_NAME[base]) return BY_NAME[base]!;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return null; // no extension, or a dotfile such as `.gitignore`
  return BY_EXTENSION[base.slice(dot + 1)] ?? null;
}

/** What a token is drawn as; `null` is the line's own text colour. */
export type SynKind = 'keyword' | 'string' | 'comment' | 'number' | 'function' | 'type' | 'attr' | 'tag' | 'meta' | 'regexp' | 'variable';

export interface SynToken {
  text: string;
  kind: SynKind | null;
}

/** highlight.js scope → our kind. `undefined` inherits the enclosing span's; `null` resets to plain. */
function kindOf(classes: string): SynKind | null | undefined {
  const [first = '', ...rest] = classes.split(/\s+/).map((c) => c.replace(/^hljs-/, ''));
  switch (first) {
    case 'keyword': case 'bullet': case 'selector-pseudo': return 'keyword';
    case 'string': case 'template-tag': case 'quote': return 'string';
    case 'comment': case 'doctag': return 'comment';
    case 'number': case 'literal': case 'symbol': return 'number';
    case 'title': return rest.includes('function_') ? 'function' : 'type';
    case 'type': case 'built_in': case 'class': case 'section': return 'type';
    case 'attr': case 'attribute': case 'property': return 'attr';
    case 'tag': case 'name': case 'selector-tag': case 'selector-id': case 'selector-class': return 'tag';
    case 'meta': return 'meta';
    case 'regexp': case 'link': return 'regexp';
    case 'variable': case 'template-variable': case 'params': return 'variable';
    case 'subst': return null;
    default: return undefined;
  }
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'" };
const decode = (s: string): string => s.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (e) => ENTITIES[e]!);

/**
 * highlight.js's markup as one list of tokens per line. It only ever emits `<span class="…">`,
 * `</span>` and escaped text, so a small reader is enough: a stack of kinds for the open spans,
 * and a new line wherever the text holds a newline — which is how a span that crosses lines ends
 * up as one token on each of them, with the same kind.
 */
export function splitHighlighted(html: string): SynToken[][] {
  const lines: SynToken[][] = [[]];
  const stack: (SynKind | null)[] = [];
  const push = (text: string): void => {
    if (!text) return;
    const kind = stack.length ? stack[stack.length - 1]! : null;
    const line = lines[lines.length - 1]!;
    const last = line[line.length - 1];
    if (last && last.kind === kind) last.text += text;
    else line.push({ text, kind });
  };
  for (const m of html.matchAll(/<span class="([^"]*)">|<\/span>|[^<]+/g)) {
    if (m[1] !== undefined) {
      const k = kindOf(m[1]);
      stack.push(k === undefined ? (stack[stack.length - 1] ?? null) : k);
    } else if (m[0] === '</span>') stack.pop();
    else {
      const parts = decode(m[0]).split('\n');
      parts.forEach((part, i) => {
        if (i > 0) lines.push([]);
        push(part);
      });
    }
  }
  return lines;
}

/** Past these, a hunk is drawn plain rather than spend a frame on colour. */
const MAX_HUNK_LINES = 4000;
const MAX_LINE_LENGTH = 2000;

function highlightSide(lines: DiffLine[], lang: string, into: Map<DiffLine, SynToken[]>): void {
  if (!lines.length) return;
  const html = hljs.highlight(lines.map((l) => l.text).join('\n'), { language: lang, ignoreIllegals: true }).value;
  const split = splitHighlighted(html);
  if (split.length !== lines.length) return; // never pair tokens with the wrong line
  lines.forEach((line, i) => into.set(line, split[i]!));
}

/**
 * The tokens for every code line of one hunk, keyed by the line object both layouts hold — the
 * way `hunkWordSpans` keys its marks, so switching layout recolours nothing. Context lines take the
 * new side's tokens; a language highlight.js was not given, or a hunk past the limits, is empty.
 */
export function hunkSyntax(hunk: DiffHunk, lang: string): Map<DiffLine, SynToken[]> {
  const out = new Map<DiffLine, SynToken[]>();
  if (!hljs.getLanguage(lang) || hunk.lines.length > MAX_HUNK_LINES || hunk.lines.some((l) => l.text.length > MAX_LINE_LENGTH)) return out;
  highlightSide(hunk.lines.filter((l) => l.type === 'context' || l.type === 'del'), lang, out);
  highlightSide(hunk.lines.filter((l) => l.type === 'context' || l.type === 'add'), lang, out);
  return out;
}

/** One run of a drawn line: its text, its syntax kind, and whether it is part of what changed. */
export interface Mark {
  text: string;
  kind: SynKind | null;
  changed: boolean;
}

/**
 * The syntax tokens and the changed-word runs of one line, cut into runs that each have one of
 * both. The two lists spell out the same text with different boundaries, so this walks them side
 * by side and cuts wherever either one changes.
 */
export function mergeMarks(text: string, tokens: SynToken[] | undefined, words: WordSpan[] | undefined): Mark[] {
  const syn = tokens ?? [{ text, kind: null }];
  const runs = words ?? [{ text, changed: false }];
  const out: Mark[] = [];
  let si = 0, so = 0, wi = 0, wo = 0;
  while (si < syn.length && wi < runs.length) {
    const s = syn[si]!, w = runs[wi]!;
    const take = Math.min(s.text.length - so, w.text.length - wo);
    if (take > 0) {
      const piece = s.text.slice(so, so + take);
      const last = out[out.length - 1];
      if (last && last.kind === s.kind && last.changed === w.changed) last.text += piece;
      else out.push({ text: piece, kind: s.kind, changed: w.changed });
    }
    so += take;
    wo += take;
    if (so >= s.text.length) { si++; so = 0; }
    if (wo >= w.text.length) { wi++; wo = 0; }
  }
  return out;
}
