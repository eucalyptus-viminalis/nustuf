# Working on nustuf

## Versioning

One version number covers the whole project. These must always match:

- `package.json` `version`
- `package-lock.json` `version` (top level) and `packages[""].version`
- `version:` in the frontmatter of every `skills/*/SKILL.md` (`nustuf-buy`, `nustuf-publish`, `nustuf-discover`)

The skills are used together and call the same CLI, so they move in lockstep. Bump all of them in the same commit, even if a given skill's text did not change.

Pre-1.0 rules:

- Minor (`0.x.0`): behavior or interface changes, such as a new default, a new or renamed flag, or a change to how the CLI or skills work.
- Patch (`0.x.y`): fixes and docs-only changes.

Check that everything agrees:

```bash
grep -h '^version:' skills/*/SKILL.md; grep -m1 '"version"' package.json package-lock.json; nustuf --version
```

Commit the bump on its own, as `chore: bump version to X.Y.Z for <reason>`.
