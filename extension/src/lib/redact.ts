// Secret masking and file-name rules for the code-location search.

const ASSIGNMENT =
  /([A-Za-z0-9_.\-]*(?:key|token|secret|password|passwd|pwd|auth|credential|bearer)[A-Za-z0-9_.\-]*"?\s*(?::=|=|:)\s*)("(?:[^"\\]|\\.)*"|'[^']*'|\S+)/gi;
const LONG_RUN = /[A-Za-z0-9+/=_-]{20,}/g;

export function maskSecrets(line: string): string {
  return line
    .replace(ASSIGNMENT, "$1***")
    .replace(LONG_RUN, (run) => (/[A-Za-z]/.test(run) && /[0-9]/.test(run) ? "***" : run));
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
