# Known Vulnerability: brace-expansion DoS (GHSA-mh99-v99m-4gvg) — allowlisted

**Status:** Deliberately allowlisted — not fixed, because it is not fixable.
**Found:** 2026-07-27, when `npm run audit` reported 27 high findings.
**Impact:** None — the vulnerability is reachable only through the `devDependencies` tree; it never
enters the running service (prod `node_modules`).
**Urgency:** Low — it will close by itself when upstream `minimatch` moves to its next major.

---

## 1. The problem

`brace-expansion` does not bound the number of combinations it produces when expanding patterns like
`{a,b}`. An attacker-controlled glob pattern (`{a,b}{a,b}{a,b}...`) can take the process down with an
OOM.

- Advisory: <https://github.com/advisories/GHSA-mh99-v99m-4gvg>
- Vulnerable range: `<= 5.0.7`
- **The only patched release: `5.0.8`** — there is **no** backport to the 1.x and 2.x lines.

## 2. Why `npm audit` shows 21 separate findings

One advisory is counted through 21 different dependency paths. All of them bottom out in the same
chain:

```
<dev tool> → minimatch@3 / @5 / @9 → brace-expansion@1.x / @2.x
```

The dev tools that reach it: `eslint`, `@eslint/eslintrc`, `@nestjs/cli`
(→ `fork-ts-checker-webpack-plugin`), `@swc/cli`, `@stoplight/spectral-*`, `openapi-typescript`
(→ `@redocly/openapi-core`), `@rollup/plugin-commonjs`.

`npm audit --omit=dev` reports **0 findings**: no link of this chain exists in the prod tree.

## 3. Why an override cannot fix it

The obvious fix would be `"overrides": { "brace-expansion": "^5.0.8" }`. **It does not work — it
breaks running code.** The CommonJS entry of `brace-expansion@5` exports a namespace object instead
of the module itself:

```js
// brace-expansion@5.0.8
const be = require('brace-expansion');
typeof be; // 'object'  ← NOT a function
typeof be.expand; // 'function'
```

`minimatch@3/5/9` call the module directly (`braceExpand(pattern)`), so a global override would take
the entire ESLint / Nest CLI / SWC chain down with a runtime `TypeError`. Bulk-upgrading `minimatch`
to 10.x is a breakage of the same class (v10's CJS export shape differs from v3's).

The override was therefore narrowed to the consumers that are **already compatible**:

```jsonc
// package.json
"overrides": {
    "minimatch@>=10": { "brace-expansion": "^5.0.8" }
}
```

`minimatch@10` already depends on `brace-expansion@^5`, so this bump is safe; it closed 3 of the 27
findings. For the remaining 21 no patched release exists.

## 4. The decision taken

**Only this advisory** was allowlisted in `audit-ci.jsonc`. `--skip-dev` was deliberately **not**
chosen: that flag would also be blind to every future dev-dependency vulnerability, while the
allowlist silences only this one known entry and the rest of the audit keeps running.

`show-not-found: true` is enabled in the config — audit-ci warns when an allowlist entry no longer
matches anything. **The moment that warning appears, this file and the allowlist entry must be
deleted.**

## 5. When it closes

When the dev tools above move to `minimatch@>=10` (and therefore `brace-expansion@^5`). To check:

```bash
npm ls brace-expansion --all   # no version other than 5.0.8 should remain
npm run audit                  # the allowlist should produce a "not found" warning
```
