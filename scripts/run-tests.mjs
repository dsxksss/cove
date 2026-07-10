/**
 * Lightweight test runner (no vitest install required).
 * Uses esbuild (already in node_modules via Vite) to bundle each *.test.ts
 * with a tiny vitest-compatible shim, then executes it in Node.
 */
import { createRequire } from "node:module";
import { readdirSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const scratch =
  process.env.GROK_SCRATCH ||
  join(process.env.TEMP || "/tmp", "grok-goal-4b3fd40b0461", "implementer");
const outDir = join(scratch, "test-build");

function findEsbuild() {
  try {
    return require.resolve("esbuild");
  } catch {
    // pnpm nested path
    const pnpm = join(root, "node_modules", ".pnpm");
    try {
      const dirs = readdirSync(pnpm).filter((d) => d.startsWith("esbuild@"));
      for (const d of dirs) {
        const candidate = join(pnpm, d, "node_modules", "esbuild");
        try {
          return require.resolve(candidate);
        } catch {
          /* continue */
        }
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (name.name === "node_modules" || name.name.startsWith("tmp-") || name.name === "dist") {
      continue;
    }
    const p = join(dir, name.name);
    if (name.isDirectory()) walk(p, acc);
    else if (name.name.endsWith(".test.ts") || name.name.endsWith(".test.tsx")) acc.push(p);
  }
  return acc;
}

const esbuildPath = findEsbuild();
if (!esbuildPath) {
  console.error("esbuild not found — cannot run tests");
  process.exit(1);
}
const esbuild = require(esbuildPath);

mkdirSync(outDir, { recursive: true });
mkdirSync(scratch, { recursive: true });

const shimPath = join(outDir, "vitest-shim.mjs");
writeFileSync(
  shimPath,
  `
const suites = [];
let current = null;
let currentTest = null;

export function describe(name, fn) {
  const suite = { name, tests: [], hooks: { beforeEach: [], afterEach: [] } };
  const prev = current;
  current = suite;
  fn();
  current = prev;
  suites.push(suite);
}
export function it(name, fn) {
  if (!current) throw new Error("it() outside describe: " + name);
  current.tests.push({ name, fn });
}
export const test = it;
export function beforeEach(fn) {
  if (!current) throw new Error("beforeEach outside describe");
  current.hooks.beforeEach.push(fn);
}
export function afterEach(fn) {
  if (!current) throw new Error("afterEach outside describe");
  current.hooks.afterEach = current.hooks.afterEach || [];
  current.hooks.afterEach.push(fn);
}
export const vi = {
  fn(impl) {
    const calls = [];
    const f = (...args) => {
      calls.push(args);
      return impl ? impl(...args) : undefined;
    };
    f.mock = { calls };
    f.mockClear = () => { calls.length = 0; };
    return f;
  },
  stubGlobal(key, value) {
    globalThis.__origGlobals = globalThis.__origGlobals || {};
    globalThis.__origGlobals[key] = globalThis[key];
    globalThis[key] = value;
  },
  unstubAllGlobals() {
    const orig = globalThis.__origGlobals || {};
    for (const k of Object.keys(orig)) globalThis[k] = orig[k];
    globalThis.__origGlobals = {};
  },
};

function isObject(x) { return x !== null && typeof x === "object"; }
function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const ak = Object.keys(a), bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

export function expect(received) {
  const make = (negated) => {
    const pass = (cond, msg) => {
      if (negated ? cond : !cond) throw new Error(msg);
    };
    return {
      toBe(expected) {
        pass(Object.is(received, expected), "Expected " + JSON.stringify(expected) + " but got " + JSON.stringify(received));
      },
      toEqual(expected) {
        pass(deepEqual(received, expected), "Expected " + JSON.stringify(expected) + " but got " + JSON.stringify(received));
      },
      toBeCloseTo(expected, precision = 2) {
        const tol = Math.pow(10, -precision) / 2;
        pass(Math.abs(received - expected) <= tol, "Expected " + received + " close to " + expected);
      },
      toContain(item) {
        let ok = false;
        if (typeof received === "string") ok = received.includes(item);
        else if (Array.isArray(received)) ok = received.includes(item);
        else throw new Error("toContain on non-string/array");
        pass(ok, "Expected to contain " + item + " (negated=" + negated + ")");
      },
      toMatch(re) {
        pass(re.test(String(received)), "Expected " + received + " to match " + re);
      },
      toBeGreaterThanOrEqual(n) {
        pass(received >= n, "Expected " + received + " >= " + n);
      },
      toBeGreaterThan(n) {
        pass(received > n, "Expected " + received + " > " + n);
      },
      toBeLessThan(n) {
        pass(received < n, "Expected " + received + " < " + n);
      },
      toBeLessThanOrEqual(n) {
        pass(received <= n, "Expected " + received + " <= " + n);
      },
      toHaveLength(n) {
        pass(received?.length === n, "Expected length " + n + " got " + received?.length);
      },
      toBeTypeOf(t) {
        pass(typeof received === t, "Expected typeof " + t + " got " + typeof received);
      },
      toHaveBeenCalledTimes(n) {
        const calls = received?.mock?.calls?.length ?? 0;
        pass(calls === n, "Expected " + n + " calls, got " + calls);
      },
      toHaveBeenCalled() {
        const calls = received?.mock?.calls?.length ?? 0;
        pass(calls > 0, "Expected mock to have been called");
      },
      toBeUndefined() {
        pass(received === undefined, "Expected undefined got " + JSON.stringify(received));
      },
      toBeTruthy() {
        pass(!!received, "Expected truthy");
      },
      toBeFalsy() {
        pass(!received, "Expected falsy");
      },
      get not() {
        return make(true);
      },
    };
  };
  return make(false);
}

// localStorage polyfill
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(String(k), String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

export async function __runAll() {
  let passed = 0, failed = 0;
  const failures = [];
  for (const suite of suites) {
    for (const t of suite.tests) {
      try {
        for (const h of suite.hooks.beforeEach) await h();
        try {
          await t.fn();
          passed++;
          console.log("  ✓ " + suite.name + " > " + t.name);
        } finally {
          for (const h of suite.hooks.afterEach || []) await h();
        }
      } catch (e) {
        failed++;
        failures.push({ suite: suite.name, name: t.name, error: e });
        console.log("  ✗ " + suite.name + " > " + t.name);
        console.log("    " + (e && e.stack ? e.stack.split("\\n").slice(0, 4).join("\\n    ") : e));
      }
    }
  }
  return { passed, failed, failures };
}
`
);

const tests = walk(join(root, "src"));
if (tests.length === 0) {
  console.error("No *.test.ts files found under src/");
  process.exit(1);
}

console.log(`Found ${tests.length} test file(s)`);
let totalPassed = 0;
let totalFailed = 0;

for (const testFile of tests) {
  const rel = relative(root, testFile).replace(/\\/g, "/");
  const outFile = join(outDir, rel.replace(/\//g, "__") + ".mjs");
  const entryFile = join(outDir, rel.replace(/\//g, "__") + ".entry.mjs");
  mkdirSync(dirname(outFile), { recursive: true });

  // Wrapper entry so describe() and __runAll() share one vitest shim instance.
  // Use absolute filesystem paths (not file:// URLs) so esbuild can resolve them.
  writeFileSync(
    entryFile,
    `import ${JSON.stringify(testFile.replace(/\\/g, "/"))};\n` +
      `import { __runAll } from ${JSON.stringify(shimPath.replace(/\\/g, "/"))};\n` +
      `const r = await __runAll();\n` +
      `console.log(JSON.stringify({ file: ${JSON.stringify(rel)}, passed: r.passed, failed: r.failed }));\n` +
      `if (r.failed) process.exitCode = 1;\n`
  );

  const result = await esbuild.build({
    entryPoints: [entryFile],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: outFile,
    sourcemap: "inline",
    packages: "bundle",
    alias: {
      vitest: shimPath,
    },
    loader: { ".ts": "ts", ".tsx": "tsx", ".mjs": "js" },
    jsx: "automatic",
    logLevel: "silent",
  });

  if (result.errors?.length) {
    console.error("Bundle failed for", rel, result.errors);
    totalFailed++;
    continue;
  }

  console.log(`\n▶ ${rel}`);
  const run = spawnSync(process.execPath, [outFile], {
    encoding: "utf8",
    cwd: root,
    env: { ...process.env },
  });
  process.stdout.write(run.stdout || "");
  process.stderr.write(run.stderr || "");
  if (run.status !== 0) totalFailed++;
  try {
    const lines = (run.stdout || "").trim().split(/\n/);
    const last = lines.reverse().find((l) => l.startsWith("{"));
    if (last) {
      const summary = JSON.parse(last);
      totalPassed += summary.passed || 0;
      // don't double-count failed via exit code + summary
      if (summary.failed) {
        /* already reflected in status */
      }
    }
  } catch {
    /* summary parse optional */
  }
}

const report = { totalPassed, totalFailed, tests: tests.length, at: new Date().toISOString() };
writeFileSync(join(scratch, "test-report.json"), JSON.stringify(report, null, 2));
console.log("\n========");
console.log(`Passed assertions (approx): ${totalPassed}`);
console.log(`Failed: ${totalFailed}`);
console.log(`Report: ${join(scratch, "test-report.json")}`);
process.exit(totalFailed > 0 ? 1 : 0);
