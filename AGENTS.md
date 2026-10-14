# Working on nustuf

## Versioning

One version number covers the whole project. These must always match:

- `package.json` `version`
- `version:` in the frontmatter of every `skills/*/SKILL.md` (`nustuf-buy`, `nustuf-publish`, `nustuf-discover`)

The skills are used together and call the same CLI, so they move in lockstep. Bump all of them in the same commit, even if a given skill's text did not change.

Pre-1.0 rules:

- Minor (`0.x.0`): behavior or interface changes, such as a new default, a new or renamed flag, or a change to how the CLI or skills work.
- Patch (`0.x.y`): fixes and docs-only changes.

Check that everything agrees:

```bash
pnpm check
```

`pnpm check` also runs the other repo checks (no machine-specific paths, skill command scope, download-code terminology, no comments in code). CI runs it on every push and pull request.

Commit the bump on its own, as `chore: bump version to X.Y.Z for <reason>`.

## Conventions

- Use pnpm for everything (`pnpm install`, `pnpm test`, `pnpm check`). `packageManager` in `package.json` pins the version.
- No comments in code files (`.js`, `.cjs`, `.sh`, `.sol`, `.html`, `.yml`). Put the explanation in names, tests and the docs instead. The only exceptions are lines tools read: shebangs, `// SPDX-License-Identifier`, and the `<xbar.*>`/`<swiftbar.*>` metadata header in `integrations/swiftbar/`. Vendored code (`contracts/lib/`, `assets/`) is exempt. `pnpm check` enforces this.
