// Minimal check harness.
//
// It exists so a red run says WHAT WAS MEASURED rather than merely exiting non-zero.
// A crash and a failed assertion are different things and must not look the same:
// if the module under test cannot even be imported, every check in the file is
// counted as failed and the count is still printed. "0/23 checks passed" is
// evidence; a stack trace and exit 1 is not.

export function suite(name) {
  const checks = [];
  return {
    check(label, fn) {
      checks.push({ label, fn });
    },
    async run() {
      let passed = 0;
      const failures = [];
      for (const { label, fn } of checks) {
        try {
          await fn();
          passed += 1;
        } catch (err) {
          failures.push({ label, err });
        }
      }
      for (const { label, err } of failures) {
        console.log(`FAIL  ${label}`);
        console.log(`      ${err && err.message ? err.message : err}`);
      }
      console.log(`${name}: ${passed}/${checks.length} checks passed`);
      return passed === checks.length && checks.length > 0;
    },
  };
}

export function eq(actual, expected, what) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
}

export function ok(cond, what) {
  if (!cond) throw new Error(`${what}: expected truthy, got falsy`);
}

// Import a module that may not exist yet. Returns a proxy whose every access
// throws the original import error, so each check fails individually with a
// readable message instead of the whole file dying at load time.
//
// `base` must be the CALLER's import.meta.url: a bare relative specifier would
// otherwise resolve against this file's directory, not the test's.
//
// The `then` key is deliberately excluded from the trap. `await` probes for it
// to decide whether the value is thenable, and a trap that answered with a
// throwing function would fire that throw outside any check's try block and
// take the whole run down with it — which is exactly the failure this proxy
// exists to prevent.
export async function softImport(specifier, base) {
  const url = base ? new URL(specifier, base).href : specifier;
  try {
    return await import(url);
  } catch (err) {
    const msg = `module ${specifier} could not be imported: ${err.message.split('\n')[0]}`;
    return new Proxy({}, {
      get(_t, key) {
        if (key === 'then' || typeof key === 'symbol') return undefined;
        return () => { throw new Error(msg); };
      },
    });
  }
}
