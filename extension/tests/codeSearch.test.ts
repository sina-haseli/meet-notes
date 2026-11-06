import { describe, it, expect } from "vitest";
import { searchCode, CODE_LIMITS } from "../src/lib/codeSearch";

type Tree = { [name: string]: string | Tree };
interface Log {
  getFile: string[];
  text: string[];
  listed: string[];
  onGetFile?: (path: string) => void;
  throwOn?: (path: string) => boolean;
}
const newLog = (extra: Partial<Log> = {}): Log => ({ getFile: [], text: [], listed: [], ...extra });

function fakeDir(name: string, tree: Tree, log: Log = newLog(), path = name): FileSystemDirectoryHandle {
  const entries = Object.entries(tree).map(([n, v]) => {
    const p = `${path}/${n}`;
    return typeof v === "string"
      ? {
          kind: "file", name: n,
          getFile: async () => {
            log.getFile.push(p);
            log.onGetFile?.(p);
            if (log.throwOn?.(p)) throw new Error(`must not read ${p}`);
            return { size: v.length, text: async () => { log.text.push(p); return v; } };
          },
        }
      : fakeDir(n, v, log, p);
  });
  return {
    kind: "directory", name,
    async *values() { log.listed.push(path); for (const e of entries) yield e; },
  } as unknown as FileSystemDirectoryHandle;
}

const paths = (r: Awaited<ReturnType<typeof searchCode>>) => r.services.flatMap((s) => s.files.map((f) => f.path));

describe("searchCode", () => {
  it("findsKavenegarInMaserati", async () => {
    const root = fakeDir("services", {
      maserati: {
        "go.mod": "module maserati\n",
        plugins: {
          kavenegar: { "informing.go": "package kavenegar\n\nfunc Send(to string) error { // send sms via kavenegar\n\treturn nil\n}\n" },
        },
        internal: { "notify.go": "package internal\n// uses Kavenegar client\n" },
      },
      audi: { "main.go": "package main\nfunc main() {}\n" },
    });
    const r = await searchCode(root, ["kavenegar"]);
    expect(r.limitHit).toBe(false);
    expect(r.services.map((s) => s.service)).toEqual(["maserati"]);
    const svc = r.services[0];
    expect(svc.keywords).toEqual(["kavenegar"]);
    expect(svc.files[0].path).toBe("maserati/plugins/kavenegar/informing.go");
    expect(svc.files[0].snippets.some((s) => s.includes("kavenegar"))).toBe(true);
    expect(svc.files.map((f) => f.path)).toContain("maserati/internal/notify.go");
  });

  it("configFilesGivePathsOnly", async () => {
    const root = fakeDir("services", {
      maserati: { configs: { "conf.toml": 'kavenegar_api_key = "Xk29fj38dk2kd93kd02k"\n' } },
    });
    const r = await searchCode(root, ["kavenegar"]);
    expect(r.services[0].files).toEqual([{ path: "maserati/configs/conf.toml", snippets: [] }]);
    expect(r.services[0].keywords).toEqual(["kavenegar"]);
  });

  it("snippetsAreMasked", async () => {
    const root = fakeDir("services", {
      maserati: { "client.go": 'kavenegarApiKey := "Zx9abc123def456ghi789"\n' },
    });
    const r = await searchCode(root, ["kavenegar"]);
    const snip = r.services[0].files[0].snippets[0];
    expect(snip).toContain("kavenegarApiKey");
    expect(snip).toContain("***");
    expect(snip).not.toContain("Zx9abc123def456ghi789");
  });

  it("skipsVendorNodeModulesAndDotDirs", async () => {
    const log = newLog();
    const hit = "// kavenegar\n";
    const root = fakeDir("services", {
      maserati: {
        vendor: { "kavenegar.go": hit },
        node_modules: { kavenegar: { "index.js": hit } },
        ".git": { "kavenegar.md": hit },
        ".cache": { "kavenegar.go": hit },
        dist: { "kavenegar.js": hit },
        __pycache__: { "kavenegar.py": hit },
        src: { "kavenegar.go": hit },
      },
      node_modules: { "kavenegar.js": hit },
      ".hidden": { "kavenegar.go": hit },
    }, log);
    const r = await searchCode(root, ["kavenegar"]);
    expect(paths(r)).toEqual(["maserati/src/kavenegar.go"]);
    expect(log.getFile).toEqual(["services/maserati/src/kavenegar.go"]);
    expect(log.listed.some((p) => /vendor|node_modules|\.git|\.cache|dist|__pycache__|\.hidden/.test(p))).toBe(false);
  });

  it("neverReadsSecretFilesOrLockfiles", async () => {
    const forbidden = /(\.env|\.env\.local|go\.sum|package-lock\.json|yarn\.lock|secrets\.yaml|server\.pem|credentials\.json|Cargo\.lock)$/;
    const log = newLog({ throwOn: (p) => forbidden.test(p) });
    const hit = "kavenegar = 1\n";
    const root = fakeDir("services", {
      maserati: {
        ".env": hit, ".env.local": hit, "go.sum": hit, "package-lock.json": hit, "yarn.lock": hit,
        "secrets.yaml": hit, "server.pem": hit, "credentials.json": hit, "Cargo.lock": hit,
        "image.png": hit, "main.go": "// kavenegar\n",
      },
    }, log);
    const r = await searchCode(root, ["kavenegar"]);
    expect(paths(r)).toEqual(["maserati/main.go"]);
    expect(log.getFile).toEqual(["services/maserati/main.go"]);
  });

  it("skipsLargeFiles", async () => {
    const log = newLog();
    const root = fakeDir("services", {
      maserati: { "big.go": "// kavenegar\n" + "x".repeat(600 * 1024), "small.go": "// kavenegar\n" },
    }, log);
    const r = await searchCode(root, ["kavenegar"]);
    expect(log.text).not.toContain("services/maserati/big.go");
    expect(paths(r)).toEqual(["maserati/small.go"]);
  });

  it("rankingAndCaps", async () => {
    const long = "// kavenegar " + "y".repeat(300);
    const root = fakeDir("services", {
      alpha: {
        "a1.go": [long, long, long, long, long].join("\n"),
        "a2.go": "sms kavenegar\n", "a3.go": "sms kavenegar\n", "a4.go": "sms kavenegar\n", "a5.go": "sms kavenegar\n",
        "kavenegar_x.go": "package x\n", "kavenegar_y.go": "package x\n", "kavenegar_z.go": "package x\n",
      },
      beta: { "b.go": "// kavenegar one\n// kavenegar two\n// kavenegar three\n" },
      gamma: { sms: { "handler.go": "package sms\n" } },
      delta: { "d.go": "// sms\n" },
    });
    const r = await searchCode(root, ["kavenegar", "sms"]);
    expect(r.services.map((s) => s.service)).toEqual(["alpha", "gamma", "beta"]);
    const alpha = r.services[0];
    expect(alpha.keywords).toEqual(["kavenegar", "sms"]);
    expect(alpha.files.map((f) => f.path)).toEqual([
      "alpha/kavenegar_x.go", "alpha/kavenegar_y.go", "alpha/kavenegar_z.go", "alpha/a1.go", "alpha/a2.go",
    ]);
    const a1 = alpha.files[3];
    expect(a1.snippets).toHaveLength(2);
    for (const s of a1.snippets) expect(s.length).toBeLessThanOrEqual(200);
    expect(r.services[1].keywords).toEqual(["sms"]);
    expect(r.services[2].files[0].snippets).toEqual(["// kavenegar one", "// kavenegar two"]);
  });

  it("stopsAtLimitsAndKeepsResults", async () => {
    let t = 0;
    const log = newLog({ onGetFile: () => { t += 1000; } });
    const tree: Tree = {};
    for (let i = 1; i <= 6; i++) tree[`f${i}.go`] = "// kavenegar\n";
    const root = fakeDir("services", { svc: tree }, log);
    const r = await searchCode(root, ["kavenegar"], { ...CODE_LIMITS, maxMs: 3000 }, () => t);
    expect(r.limitHit).toBe(true);
    expect(paths(r)).toEqual(["svc/f1.go", "svc/f2.go", "svc/f3.go"]);
    expect(log.getFile).toHaveLength(3);
  });

  it("stopsAtFileAndByteLimits", async () => {
    const tree: Tree = {};
    for (let i = 1; i <= 6; i++) tree[`f${i}.go`] = "// kavenegar\n";
    const byFiles = await searchCode(fakeDir("services", { svc: tree }), ["kavenegar"], { ...CODE_LIMITS, maxFiles: 2 });
    expect(byFiles.limitHit).toBe(true);
    expect(paths(byFiles)).toEqual(["svc/f1.go", "svc/f2.go"]);

    const byBytes = await searchCode(fakeDir("services", { svc: tree }), ["kavenegar"], { ...CODE_LIMITS, maxBytes: 20 });
    expect(byBytes.limitHit).toBe(true);
    expect(paths(byBytes)).toEqual(["svc/f1.go", "svc/f2.go"]);
  });

  it("emptyKeywordsNoWalk", async () => {
    const log = newLog();
    const root = fakeDir("services", { svc: { "a.go": "x" } }, log);
    expect(await searchCode(root, [])).toEqual({ services: [], limitHit: false });
    expect(await searchCode(root, ["  ", ""])).toEqual({ services: [], limitHit: false });
    expect(log.listed).toEqual([]);
  });

  it("singleRepoFolder", async () => {
    const root = fakeDir("myrepo", {
      "go.mod": "module myrepo\n",
      internal: { "kavenegar.go": "package internal\n" },
      vendor: { "kavenegar.go": "x" },
    });
    const r = await searchCode(root, ["Kavenegar"]);
    expect(r.services.map((s) => s.service)).toEqual(["myrepo"]);
    expect(paths(r)).toEqual(["myrepo/internal/kavenegar.go"]);
    expect(r.services[0].keywords).toEqual(["Kavenegar"]);
  });

  it("unreadableSubfolderIsSkipped", async () => {
    const bad = {
      kind: "directory", name: "locked",
      async *values() { throw new DOMException("denied", "NotAllowedError"); },
    } as unknown as FileSystemHandle;
    const good = fakeDir("ok", { "k.go": "// kavenegar\n" }) as unknown as FileSystemHandle;
    const root = { kind: "directory", name: "services", async *values() { yield bad; yield good; } } as unknown as FileSystemDirectoryHandle;
    const r = await searchCode(root, ["kavenegar"]);
    expect(paths(r)).toEqual(["ok/k.go"]);
  });
});
