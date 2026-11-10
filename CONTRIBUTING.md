# Contributing

The Workshop SDK is a public compatibility contract. Changes must preserve
released behavior or introduce a clearly versioned compatibility boundary.

1. Create a topic branch and open a pull request against `main`.
2. Use Node.js 22 and pnpm 10.33.2, plus Python 3.12 for the backend SDK.
3. Run `pnpm install --frozen-lockfile` and `pnpm test`, then
   `python3 -m unittest discover -s python/tests` and
   `python3 python/build_wheel.py --output dist-package`.
4. Add contract tests for every externally observable change.
5. Never commit generated archives, credentials, local paths, or Lumina private
   source.

Release tags and assets are immutable. Do not reuse a version or replace an
existing GitHub Release asset.
