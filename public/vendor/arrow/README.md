# Vendored ArrowJS

This is ArrowJS core, the only third-party code in the browser (TECH-SPEC 3.1). It is copied here unchanged so pages load it from our own server, with no CDN and no package install.

| | |
|---|---|
| Package | `@arrow-js/core` |
| Version | 1.0.6 |
| Licence | MIT, see `LICENSE.txt` (Copyright 2022-2026 Justin Schroeder) |
| Source | npm tarball `@arrow-js/core@1.0.6`, integrity in `vendor.json` |
| Homepage | https://arrow-js.com |

## Files

- `index.mjs`: the ES module build (`dist/index.mjs`), unminified so it can be reviewed.
- `chunks/internal-DchK7S7v.mjs`: a chunk that `index.mjs` imports by relative path. Keep its name.
- `index.d.mts`: the package's `dist/index.d.ts`, renamed so `bun run typecheck` finds the types for `index.mjs`.
- `vendor.json`: version, source and SHA-256 of each file. `tests/vendor-arrow.test.ts` fails if a file changes without this being updated.

The two `.mjs` files end with a `sourceMappingURL` comment. The maps are not vendored, so browser dev tools may log a missing source map. That is harmless.

## Using it

Import it by absolute path from any page script that is a module. Import maps are not used, because the display baseline (Chromium 86 / Safari 14) does not support them.

```js
// @ts-check
import { html, reactive } from "/vendor/arrow/index.mjs";
```

`tsconfig.json` maps `/vendor/*` to `public/vendor/*` so the same path type-checks.

## Updating

Updating Arrow is a contract change: ask Cas first.

1. `npm pack @arrow-js/core@<version>` and check the tarball's integrity against `npm view @arrow-js/core@<version> dist.integrity`.
2. Copy the same files over unchanged. The chunk's file name may change; `index.mjs` already imports the new name.
3. Update `vendor.json` (version, integrity, every SHA-256) and the version in this file and TECH-SPEC 3.1.
4. Run `bun run typecheck` and `bun test`. The baseline test checks the new files against the display baseline.
