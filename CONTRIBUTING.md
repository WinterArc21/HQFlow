# Contributing to HQFlow

Thanks for wanting to help. This project stays small and local-first on purpose.

## How to propose a change

1. Open an issue first for anything larger than a typo or tiny bugfix (layout engine, schema, CLI behavior).
2. Fork the repo and create a branch off `dev`.
3. Keep the change focused — one concern per PR.
4. Run what you can locally before opening the PR:

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm test
```

5. Open a pull request **into `dev`** (not `main`). Describe what changed and how you verified it.

Direct pushes to `main` and `dev` are blocked. Maintainers merge via pull request.

## Releasing (maintainers)

1. Merge the release-ready changes into `main`.
2. Run the **Prepare release** workflow on `main` and choose `patch`, `minor`, or `major`.
3. Review the generated `Release vX.Y.Z` pull request and merge it after CI passes.
4. The **Publish release** workflow then validates `main`, publishes the package to npm,
   creates the matching Git tag, and creates the GitHub Release.

The publish workflow is safe to rerun. If npm publishing succeeded but tagging or the GitHub
Release did not, a rerun skips the completed work and finishes the missing steps.

## Project conventions

- **No LLM inside the product.** HQFlow renders agent-authored `.codehq` files; it never uploads repository code.
- **Workflow JSON never carries visuals.** No coordinates, colors, fonts, or layout hints in schema files — the renderer owns that.
- **Prefer the story over encyclopedias.** Maps should stay at product height by default; proof (files, types, symbols) belongs in expanded cards and the drawer.
- Match existing TypeScript, CSS Modules, and test patterns. Avoid drive-by refactors.

## Reporting security issues

See [SECURITY.md](./SECURITY.md).
