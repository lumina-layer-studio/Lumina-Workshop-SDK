# Image handoff template

Copy this directory into a new module repository. Edit `manifest.json` for your
module identity and version, and replace the example license and icon. Install
with `pnpm install --frozen-lockfile`, then run `pnpm build` and
`pnpm check dist/<id>-<version>.lumina-workshop`. Set `CHROME_PATH` to a local
Chrome executable if Playwright's Chromium is not installed.

The build includes this module's license and the installed SDK's full license.
The SDK is pinned to the immutable 1.1.0 release; never replace a published
release asset. The checker executes trusted module code in a fresh, offline,
sandboxed browser and checks its handshake and licenses. It is not a security
review or a replacement for the Registry's static checks and code review.
