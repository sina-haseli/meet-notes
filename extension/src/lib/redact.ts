// Secret masking and file-name rules for the code-location search.
//
// Masking (final-review ruling R3) is a set of linear, hand-written scans: no regex here runs an
// unbounded quantifier over a run of characters, so a 512 KB minified line masks in milliseconds.
//   1. Every line: URL credentials `scheme://user:pass@` -> `scheme://user:***@`.
//   2. A "secret line" is any line with a secret-ish name on it (see isSecretLine). On such a line
//      every non-empty string literal's content becomes *** (quotes kept) and every unquoted value after
//      `=`, `:=`, `:` or `=>` becomes ***. Bearer/Basic/Token keep the scheme word.
//   3. Every line: long random-looking runs and JWTs become ***; paths and URLs stay readable.

const SECRET_SEGMENTS = new Set([
  "key", "token", "secret", "password", "passwd", "pwd", "pass", "passphrase", "auth", "authorization",
  "credential", "credentials", "bearer", "apikey", "apitoken", "accesskey", "secretkey", "privatekey",
  "accesstoken", "authtoken", "clientsecret", "dsn",
]);
const MAX_SEGMENT = 13; // longest entry above ("authorization", "clientsecret" is 12)
const SECRET_COMPOUNDS = [
  "apikey", "apitoken", "accesskey", "secretkey", "privatekey", "accesstoken", "authtoken", "clientsecret", "passphrase",
];
const SCHEMES = new Set(["bearer", "basic", "token"]);
const MASK = "***";

const enum K { Low, Up, Digit, Other }
function kind(c: number): K {
  if (c >= 97 && c <= 122) return K.Low;
  if (c >= 65 && c <= 90) return K.Up;
  if (c >= 48 && c <= 57) return K.Digit;
  return K.Other;
}

/**
 * True when some word on the line is secret-ish: one of its segments (split on camelCase,
 * letter/digit changes and every non-alphanumeric character, lower-cased) is in SECRET_SEGMENTS, or
 * it contains a compound such as `apikey`. `monkey`, `author`, `keyboard`, `tokenizer`,
 * `passenger` and `compass` are not secret: a segment must match whole.
 */
export function isSecretLine(line: string): boolean {
  const lower = line.toLowerCase();
  for (const c of SECRET_COMPOUNDS) if (lower.includes(c)) return true;
  const n = line.length;
  let s = -1; // start of the current segment, -1 between segments
  for (let i = 0; i <= n; i++) {
    const t = i < n ? kind(line.charCodeAt(i)) : K.Other;
    if (s < 0) {
      if (t !== K.Other) s = i;
      continue;
    }
    const p = kind(line.charCodeAt(i - 1));
    const cut =
      t === K.Other ||
      (t === K.Digit) !== (p === K.Digit) ||
      (t === K.Up && p === K.Low) ||
      (t === K.Up && p === K.Up && i + 1 < n && kind(line.charCodeAt(i + 1)) === K.Low); // APIKey -> API|Key
    if (!cut) continue;
    if (i - s <= MAX_SEGMENT && SECRET_SEGMENTS.has(lower.slice(s, i))) return true;
    s = t === K.Other ? -1 : i;
  }
  return false;
}

const isSpace = (ch: string) => ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || ch === "\f" || ch === "\v";
const isQuote = (ch: string) => ch === '"' || ch === "'" || ch === "`";

/** Length of an assignment separator (`=`, `:=`, `:`, `=>`) at i, or 0. `==`, `!=`, `<=`, `::`, `://` are not. */
function separatorAt(line: string, i: number): number {
  const c = line[i];
  const prev = i > 0 ? line[i - 1] : "";
  const next = line[i + 1] ?? "";
  if (c === ":") {
    if (next === "=") return 2;
    if (next === ":" || prev === ":") return 0;
    if (next === "/" && line[i + 2] === "/") return 0;
    return 1;
  }
  if (c === "=") {
    if (prev === "=" || prev === "!" || prev === "<" || prev === ">") return 0;
    if (next === "=") return 0;
    return next === ">" ? 2 : 1;
  }
  return 0;
}

const VALUE_END = new Set([",", ";", ")", "}"]);
const NO_VALUE_START = new Set([",", ";", ")", "}", "{", "(", "["]);
const SCHEME_PREFIX = /^(bearer|basic|token)(\s+)/i;

function valueEnd(line: string, i: number): number {
  let j = i;
  while (j < line.length && !isSpace(line[j]) && !VALUE_END.has(line[j]) && !isQuote(line[j])) j++;
  return j;
}
function skipSpaces(line: string, i: number): number {
  while (i < line.length && isSpace(line[i])) i++;
  return i;
}

/** The content of a string literal on a secret line: all of it, except a leading auth scheme word. */
function maskStringContent(content: string): string {
  if (content === "") return content;
  const m = SCHEME_PREFIX.exec(content);
  return m ? `${m[1]}${m[2]}${MASK}` : MASK;
}

function maskSecretLine(line: string): string {
  const n = line.length;
  const out: string[] = [];
  let last = 0; // line[last, i) not yet copied to out
  const noClose = new Set<string>(); // quote kinds that never close again on this line
  let i = 0;
  while (i < n) {
    const c = line[i];
    if (isQuote(c)) {
      let end = -1;
      if (!noClose.has(c)) {
        for (let j = i + 1; j < n; j++) {
          if (line[j] === "\\") j++;
          else if (line[j] === c) { end = j; break; }
        }
        // From any later quote of this kind the scan would see the same characters: never closes.
        if (end < 0) noClose.add(c);
      }
      if (end > 0) {
        out.push(line.slice(last, i + 1), maskStringContent(line.slice(i + 1, end)));
        last = end;
        i = end + 1;
        continue;
      }
      i++;
      continue;
    }
    const sep = separatorAt(line, i);
    if (sep === 0) { i++; continue; }
    i = skipSpaces(line, i + sep);
    if (i >= n || NO_VALUE_START.has(line[i]) || isQuote(line[i])) continue;
    let j = valueEnd(line, i);
    let word = line.slice(i, j);
    if (SCHEMES.has(word.toLowerCase())) {
      i = skipSpaces(line, j);
      if (i >= n || NO_VALUE_START.has(line[i]) || isQuote(line[i])) continue;
      j = valueEnd(line, i);
      word = line.slice(i, j);
    } else {
      // `name: Type = value`: the type stays readable, the value after `=` is masked next.
      const k = skipSpaces(line, j);
      if (k < n && ((line[k] === "=" && separatorAt(line, k) === 1) || (line[k] === ":" && line[k + 1] === "="))) {
        i = j;
        continue;
      }
    }
    out.push(line.slice(last, i), MASK);
    last = j;
    i = j;
  }
  out.push(line.slice(last));
  return out.join("");
}

/** `scheme://user:pass@host` -> `scheme://user:***@host` anywhere on the line. */
function maskUrlCreds(line: string): string {
  const n = line.length;
  const out: string[] = [];
  let last = 0;
  let from = 0;
  for (;;) {
    const k = line.indexOf("://", from);
    if (k === -1) break;
    const start = k + 3;
    let e = start;
    let at = -1;
    let colon = -1;
    while (e < n) {
      const ch = line[e];
      if (ch === "/" || ch === "?" || ch === "#" || ch === "<" || ch === ">" || isSpace(ch) || isQuote(ch)) break;
      if (ch === "@") at = e;
      else if (ch === ":" && colon < 0) colon = e;
      e++;
    }
    const schemeOk = k > 0 && /[A-Za-z0-9+.-]/.test(line[k - 1]);
    if (schemeOk && at > 0 && colon >= 0 && colon + 1 < at) {
      out.push(line.slice(last, colon + 1), MASK);
      last = at;
    }
    from = Math.max(start, e - 2); // a `://` right at the stop character is still found
  }
  out.push(line.slice(last));
  return out.join("");
}

// Characters of a "run" (URL, path, token, base64) and the separators a run is split on.
const RUN_CHARS = new Uint8Array(128);
for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=_.:@?&%-") RUN_CHARS[ch.charCodeAt(0)] = 1;
const isRunChar = (code: number) => code < 128 && RUN_CHARS[code] === 1;
const RUN_SEP = new Set(["/", ".", ":", "@", "?", "&", "=", "%"]);
const JWT_PART = /^[A-Za-z0-9_-]{8,}$/; // tested on one segment of a run: linear
const hasLetter = (s: string) => /[A-Za-z]/.test(s);
const hasDigit = (s: string) => /[0-9]/.test(s);
const mixed = (s: string) => hasLetter(s) && hasDigit(s);

function maskRun(r: string): string {
  // A long run with upper, lower and digits and no dot is a key or a blob, not a path or host.
  if (r.length >= 30 && !r.includes(".") && /[A-Z]/.test(r) && /[a-z]/.test(r) && hasDigit(r)) return MASK;
  // parts: token, sep, token, sep, ..., token
  const parts: string[] = [];
  let s = 0;
  for (let i = 0; i <= r.length; i++) {
    if (i === r.length || RUN_SEP.has(r[i])) {
      parts.push(r.slice(s, i));
      if (i < r.length) parts.push(r[i]);
      s = i + 1;
    }
  }
  const out: string[] = [];
  let t = 0;
  while (t < parts.length) {
    // The longest streak of 8+ char [A-Za-z0-9_-] tokens joined by "." starting at t (a JWT has 3).
    let u = t + 2;
    if (JWT_PART.test(parts[t])) while (u < parts.length && parts[u - 1] === "." && JWT_PART.test(parts[u])) u += 2;
    if ((u - t) / 2 >= 3 && mixed(parts.slice(t, u - 1).join(""))) {
      out.push(MASK);
    } else {
      // Every later start inside this streak gives a shorter, no more mixed streak: skip them all.
      for (let x = t; x < u - 1 && x < parts.length; x++) {
        const p = parts[x];
        out.push(x % 2 === 0 && p.length >= 16 && mixed(p) ? MASK : p);
      }
    }
    if (u - 1 < parts.length) out.push(parts[u - 1]);
    t = u;
  }
  return out.join("");
}

function maskLongRuns(line: string): string {
  const n = line.length;
  const out: string[] = [];
  let last = 0;
  let i = 0;
  while (i < n) {
    if (!isRunChar(line.charCodeAt(i))) { i++; continue; }
    let j = i + 1;
    while (j < n && isRunChar(line.charCodeAt(j))) j++;
    const run = line.slice(i, j);
    const masked = maskRun(run);
    if (masked !== run) {
      out.push(line.slice(last, i), masked);
      last = j;
    }
    i = j;
  }
  out.push(line.slice(last));
  return out.join("");
}

/**
 * Masks secrets in one line of code. `secretLine` forces the secret-line rule (the caller saw a
 * secret-ish name elsewhere on a longer line this text was cut from).
 */
export function maskSecrets(line: string, secretLine = false): string {
  let s = maskUrlCreds(line);
  if (secretLine || isSecretLine(s)) s = maskSecretLine(s);
  return maskLongRuns(s);
}

const CONFIG_EXT = new Set([".toml", ".yaml", ".yml", ".json", ".xml"]);
export const READ_EXTENSIONS: ReadonlySet<string> = new Set([
  ".go", ".ts", ".tsx", ".js", ".jsx", ".py", ".php", ".java", ".kt", ".cs", ".rb", ".rs",
  ".proto", ".sql", ".toml", ".yaml", ".yml", ".json", ".xml", ".md", ".graphql",
]);
const LOCKFILES = new Set(["package-lock.json", "go.sum", "yarn.lock", "pnpm-lock.yaml"]);

function ext(name: string): string {
  const i = name.lastIndexOf(".");
  return i <= 0 ? "" : name.slice(i).toLowerCase();
}

export function isConfigFile(name: string): boolean {
  return name === "Dockerfile" || CONFIG_EXT.has(ext(name));
}

export function isForbiddenFile(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n.startsWith(".env") ||
    n.endsWith(".pem") ||
    n.endsWith(".key") ||
    n.endsWith(".lock") ||
    n.includes("secret") ||
    n.includes("credential") ||
    LOCKFILES.has(n)
  );
}

export function isReadable(name: string): boolean {
  return (READ_EXTENSIONS.has(ext(name)) || name === "Dockerfile") && !isForbiddenFile(name);
}
