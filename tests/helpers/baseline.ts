// Scanner for the display browser baseline (TECH-SPEC 3.3): Chromium 56 / Safari 11.
// Not a parser: it strips comments, strings and regex literals, then looks for
// syntax and CSS features those engines do not have.

export interface Finding { file: string; line: number; rule: string; text: string }

const REGEX_BEFORE = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^", ""]);
const REGEX_KEYWORDS = /(?:^|[^\w$])(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;

/** Replaces comments, strings, template literals and regex literals with spaces (newlines kept). */
export function stripJs(code: string): string {
  const out = code.split("");
  const blank = (from: number, to: number) => { for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " "; };
  let i = 0;
  let lastSignificant = "";
  let lastWordEnd = "";
  while (i < code.length) {
    const ch = code[i]!;
    const next = code[i + 1];
    if (ch === "/" && next === "/") {
      const end = code.indexOf("\n", i);
      const stop = end === -1 ? code.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = code.indexOf("*/", i + 2);
      const stop = end === -1 ? code.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < code.length && code[j] !== ch) {
        if (code[j] === "\\") j++;
        else if (ch !== "`" && code[j] === "\n") break;
        j++;
      }
      blank(i + 1, j);
      i = j + 1;
      lastSignificant = ch;
      continue;
    }
    if (ch === "/" && (REGEX_BEFORE.has(lastSignificant) || REGEX_KEYWORDS.test(lastWordEnd))) {
      let j = i + 1;
      let inClass = false;
      while (j < code.length && code[j] !== "\n") {
        const c = code[j];
        if (c === "\\") { j += 2; continue; }
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) break;
        j++;
      }
      blank(i + 1, j);
      i = j + 1;
      while (i < code.length && /[a-z]/i.test(code[i]!)) i++;
      lastSignificant = "/";
      continue;
    }
    if (!/\s/.test(ch)) {
      lastSignificant = /[\w$]/.test(ch) ? "w" : ch;
      lastWordEnd = (lastWordEnd + ch).slice(-12);
    } else {
      lastWordEnd += " ";
    }
    i++;
  }
  return out.join("");
}

function lineOf(code: string, index: number): number {
  let n = 1;
  for (let k = 0; k < index; k++) if (code[k] === "\n") n++;
  return n;
}

/** Banned JS syntax for display pages and public/shared. */
export function scanJs(code: string, file = "<js>", lineOffset = 0): Finding[] {
  const s = stripJs(code);
  const found: Finding[] = [];
  const add = (index: number, rule: string, len = 2) =>
    found.push({ file, line: lineOf(s, index) + lineOffset, rule, text: code.slice(index, index + len + 20).split("\n")[0]! });

  for (const m of s.matchAll(/\?\.(?!\d)/g)) add(m.index!, "optional chaining (?.)");
  for (const m of s.matchAll(/\?\?/g)) add(m.index!, "nullish coalescing (??)");
  for (const m of s.matchAll(/#[A-Za-z_$]/g)) add(m.index!, "private class member (#name)");
  for (const m of s.matchAll(/(^|[;\n])\s*(import|export)\b/g)) add(m.index! + m[0].length - m[2]!.length, `${m[2]} statement (modules)`);
  for (const m of s.matchAll(/\bimport\s*\(/g)) add(m.index!, "dynamic import()");

  // Walk brackets: object spread/rest, class fields and top-level await.
  const stack: { ch: string; classBody: boolean; start: number }[] = [];
  let pendingClass = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (/[A-Za-z_$]/.test(ch) && (i === 0 || !/[\w$]/.test(s[i - 1]!))) {
      const word = /^[\w$]+/.exec(s.slice(i, i + 20))![0];
      if (word === "class") pendingClass = true;
      if (word === "await" && !stack.some((b) => b.ch === "{")) add(i, "top-level await", 5);
      i += word.length - 1;
      continue;
    }
    if (ch === "{" || ch === "(" || ch === "[") {
      stack.push({ ch, classBody: ch === "{" && pendingClass, start: i });
      if (ch === "{") pendingClass = false;
    } else if (ch === "}" || ch === ")" || ch === "]") {
      const open = stack.pop();
      if (open && open.classBody) {
        let body = s.slice(open.start + 1, i);
        let prev = "";
        while (prev !== body) { prev = body; body = body.replace(/\{[^{}]*\}/g, "{}").replace(/\([^()]*\)/g, "()"); }
        const field = /(?:^|[;}])\s*(?:static\s+)?[A-Za-z_$][\w$]*\s*(?:=(?!=)|;)/.exec(body);
        if (field) add(open.start + 1 + s.slice(open.start + 1).indexOf(field[0].replace(/^[;}]/, "").trim().split(/\s/)[0]!), "class field", 10);
      }
    } else if (ch === "." && s.startsWith("...", i)) {
      const top = stack[stack.length - 1];
      if (top && top.ch === "{") add(i, "object spread or rest ({...x})", 3);
      i += 2;
    }
  }
  return found;
}

/** Banned CSS features for display pages and public/shared. */
export function scanCss(code: string, file = "<css>", lineOffset = 0): Finding[] {
  const s = code.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  const rules: [RegExp, string][] = [
    [/display\s*:\s*(?:inline-)?grid\b/g, "CSS grid"],
    [/\bgrid-(?:template|area|column|row|auto)[\w-]*\s*:/g, "CSS grid"],
    [/(?:^|[;{\s])(?:row-|column-|grid-)?gap\s*:/g, "gap (flexbox or grid)"],
    [/\b(?:clamp|min|max)\(/g, "clamp(), min() or max()"],
    [/\baspect-ratio\s*:/g, "aspect-ratio"],
    [/:(?:is|where)\(/g, ":is() or :where()"],
    [/\bbackdrop-filter\s*:/g, "backdrop-filter"],
    [/\bcolor-mix\(/g, "color-mix()"],
  ];
  const found: Finding[] = [];
  for (const [re, rule] of rules) {
    for (const m of s.matchAll(re)) found.push({ file, line: lineOf(s, m.index!) + lineOffset, rule, text: m[0].trim() });
  }
  return found;
}

/** Scans <script> and <style> blocks in an HTML page; module scripts are banned outright. */
export function scanHtml(code: string, file = "<html>"): Finding[] {
  const found: Finding[] = [];
  for (const m of code.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const line = lineOf(code, m.index!);
    if (/type\s*=\s*["']?module/i.test(m[1]!)) found.push({ file, line, rule: 'module script (type="module")', text: m[0].slice(0, 40) });
    found.push(...scanJs(m[2]!, file, line - 1));
  }
  for (const m of code.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    found.push(...scanCss(m[1]!, file, lineOf(code, m.index!) - 1));
  }
  for (const m of code.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi)) {
    found.push(...scanCss(m[1]!, file, lineOf(code, m.index!) - 1));
  }
  return found;
}
