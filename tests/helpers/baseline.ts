// Scanner for the display browser baseline (TECH-SPEC 3.3): Chromium 86 / Safari 14.
// Not a parser: it strips comments, strings and regex literals, then looks for
// syntax, APIs and CSS features those engines do not have.

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

/** APIs newer than the baseline, matched on code with strings and comments removed. */
const BANNED_JS_APIS: [RegExp, string][] = [
  [/\.at\(/g, ".at() (Chromium 92, Safari 15.4)"],
  [/\bstructuredClone\(/g, "structuredClone() (Chromium 98, Safari 15.4)"],
  [/\bObject\.hasOwn\(/g, "Object.hasOwn() (Chromium 93, Safari 15.4)"],
  [/\.findLast(?:Index)?\(/g, ".findLast() (Chromium 97, Safari 15.4)"],
  [/\.(?:toSorted|toReversed|toSpliced)\(/g, "change-array-by-copy methods (Chromium 110, Safari 16)"],
  [/\bnew\s+(?:WeakRef|FinalizationRegistry)\b/g, "WeakRef (Safari 14.1)"],
];

/** Banned JS syntax and APIs for display pages, public/shared and public/vendor. */
export function scanJs(code: string, file = "<js>", lineOffset = 0): Finding[] {
  const s = stripJs(code);
  const found: Finding[] = [];
  const add = (index: number, rule: string, len = 2) =>
    found.push({ file, line: lineOf(s, index) + lineOffset, rule, text: code.slice(index, index + len + 20).split("\n")[0]! });

  for (const m of s.matchAll(/#[A-Za-z_$]/g)) add(m.index!, "private class member (#name)");
  for (const [re, rule] of BANNED_JS_APIS) for (const m of s.matchAll(re)) add(m.index!, rule);
  // Regex lookbehind (Safari 16.4) lives inside regex literals, which stripJs blanks, so check the raw code.
  for (const m of code.matchAll(/\(\?<[=!]/g)) add(m.index!, "regex lookbehind (Safari 16.4)");

  // Walk brackets: class fields and top-level await.
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
    }
  }
  return found;
}

/** Banned CSS features for display pages and public/shared. */
export function scanCss(code: string, file = "<css>", lineOffset = 0): Finding[] {
  const s = code.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  const rules: [RegExp, string][] = [
    [/(?:^|[;{\s])(?:row-|column-)?gap\s*:/g, "gap (flexbox gap is Safari 14.1; use grid-gap in a grid, or margins)"],
    [/\baspect-ratio\s*:/g, "aspect-ratio"],
    [/:(?:is|where|has)\(/g, ":is(), :where() or :has()"],
    [/:focus-visible\b/g, ":focus-visible"],
    [/\bbackdrop-filter\s*:/g, "backdrop-filter"],
    [/\bcolor-mix\(/g, "color-mix()"],
    [/\b(?:oklch|oklab|lch|lab)\(/g, "oklch(), lab() and other new colour functions"],
    [/(?:^|[;{\s])inset\s*:/g, "inset shorthand"],
    [/@(?:container|layer)\b/g, "@container or @layer"],
    [/\d(?:dvh|svh|lvh|dvw|svw|lvw)\b/g, "dynamic viewport units (dvh, svh, lvh)"],
  ];
  const found: Finding[] = [];
  for (const [re, rule] of rules) {
    for (const m of s.matchAll(re)) found.push({ file, line: lineOf(s, m.index!) + lineOffset, rule, text: m[0].trim() });
  }
  return found;
}

/** Scans <script> and <style> blocks in an HTML page; import maps are banned (Chromium 89, Safari 16.4). */
export function scanHtml(code: string, file = "<html>"): Finding[] {
  const found: Finding[] = [];
  for (const m of code.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const line = lineOf(code, m.index!);
    if (/type\s*=\s*["']?importmap/i.test(m[1]!)) { found.push({ file, line, rule: 'import map (type="importmap")', text: m[0].slice(0, 40) }); continue; }
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

/** HTML sinks that parse text as markup. Data must never reach them (TECH-SPEC 12.4). */
export function scanHtmlSinks(code: string, file = "<js>"): Finding[] {
  const s = stripJs(code);
  const found: Finding[] = [];
  for (const m of s.matchAll(/\.(innerHTML|outerHTML|insertAdjacentHTML)\b|\bdocument\.write(?:ln)?\s*\(|\bcreateContextualFragment\s*\(/g)) {
    found.push({ file, line: lineOf(s, m.index!), rule: "HTML sink (innerHTML and friends)", text: code.slice(m.index!, m.index! + 30).split("\n")[0]! });
  }
  return found;
}
