import { describe, it, expect } from "vitest";
import { readServicesContext, SERVICES_CAPS } from "../src/lib/servicesContext";

type Tree = { [name: string]: string | Tree };
function fakeDir(name: string, tree: Tree): FileSystemDirectoryHandle {
  const entries = Object.entries(tree).map(([n, v]) =>
    typeof v === "string"
      ? { kind: "file", name: n, getFile: async () => ({ text: async () => v }) }
      : fakeDir(n, v));
  return {
    kind: "directory", name,
    async *values() { for (const e of entries) yield e; },
    async getFileHandle(n: string) {
      const e = entries.find((x) => x.kind === "file" && x.name === n);
      if (!e) throw new DOMException("nf", "NotFoundError");
      return e;
    },
  } as unknown as FileSystemDirectoryHandle;
}

describe("readServicesContext", () => {
  it("multiServiceFolder", async () => {
    const root = fakeDir("services", {
      b: { "package.json": JSON.stringify({ name: "b-svc", description: "Does B" }), "README.md": "# B readme" },
      a: { "go.mod": "module example.com/a\n\ngo 1.22\n", "readme.txt": "A readme" },
    });
    const out = await readServicesContext(root);
    expect(out).toContain("### a\nmanifest: module example.com/a\nREADME:\nA readme");
    expect(out).toContain("### b\nmanifest: b-svc — Does B\nREADME:\n# B readme");
    expect(out.indexOf("### a")).toBeLessThan(out.indexOf("### b"));
  });
  it("skipsDotAndNodeModules", async () => {
    const root = fakeDir("r", { ".hidden": {}, node_modules: {}, real: { "README.md": "x" } });
    const out = await readServicesContext(root);
    expect(out).toContain("### real");
    expect(out).not.toContain(".hidden");
    expect(out).not.toContain("node_modules");
  });
  it("singleRepoFolder", async () => {
    const root = fakeDir("myrepo", { "package.json": JSON.stringify({ name: "n" }), README: "hi", src: { "x.ts": "" } });
    const out = await readServicesContext(root);
    expect(out.match(/^### /gm)).toHaveLength(1);
    expect(out).toContain("### myrepo\nmanifest: n\nREADME:\nhi");
  });
  it("pyproject manifest and missing parts", async () => {
    const root = fakeDir("r", { p: { "pyproject.toml": 'name = "pp"\ndescription = "d"\nother = 1\n' }, q: {} });
    const out = await readServicesContext(root);
    expect(out).toContain('### p\nmanifest: name = "pp"\ndescription = "d"\nREADME:\n-');
    expect(out).toContain("### q\nmanifest: -\nREADME:\n-");
  });
  it("capsReadmeAndTotal", async () => {
    const big = fakeDir("r", { s: { "README.md": "x".repeat(10000) } });
    const out = await readServicesContext(big);
    expect(out).toContain("x".repeat(3000));
    expect(out).not.toContain("x".repeat(3001));

    const tree: Tree = {};
    for (let i = 0; i < 200; i++) tree[`svc${String(i).padStart(3, "0")}`] = { "README.md": "y".repeat(1000) };
    const o2 = await readServicesContext(fakeDir("r", tree), { ...SERVICES_CAPS, maxServices: 500 });
    expect(o2.endsWith("…(truncated)")).toBe(true);
    expect(o2.length).toBeLessThanOrEqual(40000 + 20);
  });
  it("maxServices", async () => {
    const tree: Tree = {};
    for (let i = 0; i < 5; i++) tree[`s${i}`] = {};
    const out = await readServicesContext(fakeDir("r", tree), { ...SERVICES_CAPS, maxServices: 2 });
    expect(out.match(/^### /gm)).toHaveLength(2);
  });
});
