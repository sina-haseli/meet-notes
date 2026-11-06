// Secret masking and file-name rules for the code-location search.

const SECRET_SEGMENTS = new Set([
  "key", "token", "secret", "password", "passwd", "pwd", "auth", "authorization", "credential", "credentials", "bearer",
]);
const ASSIGNMENT =
  /(?<![A-Za-z0-9_])(["']?)([A-Za-z_][A-Za-z0-9_-]*)\1((?:\s+[A-Za-z_][\w.[\]*]*)?\s*(?::=|=>|=(?![=>])|:(?!:))\s*)(?:((?:Bearer|Basic|Token)\s+)?("[^"\\]*(?:\\.[^"\\]*)*"|'[^']*'|[^\s"',;)]+))/gi;
const URL_CREDS = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]*:)[^\s@/]+@/gi;
const JWT = /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const LONG_RUN = /[A-Za-z0-9+/=_.-]{20,}/g;

function isSecretName(name: string): boolean {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((seg) => SECRET_SEGMENTS.has(seg));
}

const mixed = (t: string) => /[A-Za-z]/.test(t) && /[0-9]/.test(t);

export function maskSecrets(line: string): string {
  return line
    .replace(URL_CREDS, "$1***@")
    .replace(ASSIGNMENT, (m, q: string, name: string, sep: string, scheme: string | undefined) =>
      isSecretName(name) ? `${q}${name}${q}${sep}${scheme ?? ""}***` : m)
    .replace(JWT, (t) => (mixed(t) ? "***" : t))
    .replace(LONG_RUN, (t) => (!t.includes("/") && !t.includes(".") && mixed(t) ? "***" : t));
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
