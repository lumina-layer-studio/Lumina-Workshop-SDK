# Lumina Workshop SDK

[English](README.md) · [简体中文](README_CN.md) · [Install](#install-v110) · [Quick start](#quick-start) · [Capabilities](#capabilities-and-manifest) · [Module guide](docs/module-development.md)

`@lumina/workshop-sdk` is the public SDK for building installable Creative Workshop modules in [Lumina Studio](https://github.com/lumina-layer-studio/Lumina-Layers).

Workshop modules run inside an isolated `ui/index.html` iframe and talk to Lumina Studio over a `MessagePort` channel. Through the SDK, a module can follow the host's language and theme, pick input images, read the user's active LUT or filament library, store local projects, run optional Python backend tasks, and hand finished SVG or PNG artwork back to Lumina's 3D print converter.

## What you can build

| Capability | SDK surface & manifest declaration |
| --- | --- |
| Host theme and locale sync | `client.ui.getState()`, `client.ui.subscribeState()` (`ui.stateChanged`), and `applyWorkshopUiState()` |
| Image import | `image.pick` permission |
| Palette and filament preview | `color-library.read` permission |
| Converter handoff (PNG or vector SVG) | `handoff.image` permission, including optional native `svgBytes` and `recommendedTotalThicknessMm` fields |
| Saved projects and live `.lum` snapshots | `project.storage` permission, plus optional `client.projectSnapshots` (`projectSnapshots.register` and `projectSnapshots.changed`) |
| Local Python task backends | `"manifestVersion": 2`, `backend.tasks` feature, and the companion `lumina_workshop_backend` Python wheel |

To scaffold a frontend-only module quickly, copy [`templates/image-handoff`](templates/image-handoff), then run `pnpm install --frozen-lockfile`, `pnpm build`, and `pnpm check` against the generated `.lumina-workshop` archive. Step-by-step packaging instructions are in [`docs/module-development.md`](docs/module-development.md).

## Install (`v1.1.0`)

Each SDK release is published as versioned GitHub Release assets with matching `.sha256` checksum files:

- **TypeScript / JavaScript frontend SDK:** `lumina-workshop-sdk-1.1.0.tgz`
- **Python backend SDK:** `lumina_workshop_backend-1.1.0-py3-none-any.whl`

Download and verify the `v1.1.0` tarball before adding it to your module:

```bash
gh release download v1.1.0 \
  --repo lumina-layer-studio/Lumina-Workshop-SDK \
  --pattern "lumina-workshop-sdk-1.1.0.tgz*" \
  --dir .workshop-sdk-release
cd .workshop-sdk-release
shasum -a 256 -c lumina-workshop-sdk-1.1.0.tgz.sha256
```

Then pin that exact release URL in your module's `package.json` and commit your lockfile:

```json
{
  "dependencies": {
    "@lumina/workshop-sdk": "https://github.com/lumina-layer-studio/Lumina-Workshop-SDK/releases/download/v1.1.0/lumina-workshop-sdk-1.1.0.tgz"
  }
}
```

During SDK development you can also install from a reviewed Git commit SHA (where `prepare` compiles TypeScript); published release tarballs ship precompiled `dist/` output directly.

## Quick start

Connect to Lumina Studio from `ui/index.html`, sync the initial host UI state, and signal readiness:

```ts
import {
  applyWorkshopUiState,
  connectWorkshop,
} from "@lumina/workshop-sdk";

const host = await connectWorkshop({
  moduleId: "studio.lumina.example",
  moduleVersion: "1.0.0",
});

const unsubscribe = host.ui.subscribeState(applyWorkshopUiState);
applyWorkshopUiState(await host.ui.getState());
await host.lifecycle.ready();

// Call unsubscribe() when unmounting a long-lived view.
```

Subscribing before calling `host.ui.getState()` keeps live `ui.stateChanged` updates in sync while remaining compatible with hosts that only answer snapshot queries. Once `host.lifecycle.ready()` resolves, Lumina Studio activates the module view and enables declared permissions.

## Capabilities and manifest

- **Workshop API version:** `1.0.0` for frontend-only modules; `1.1.0` when requesting `backend.tasks`.
- **Manifest version:** `1` for frontend-only modules; `2` for modules declaring a Python backend.
- **UI entry point:** `ui/index.html`, packaged alongside `manifest.json`, `assets/icon.png`, `README.md`, and `LICENSE`.
- **Permissions:** Declare every capability your module requests in `manifest.json` with a concise user-facing reason. When targeting older hosts that predate vector handoff extensions, send standard PNG handoff fields without `svgBytes` or `recommendedTotalThicknessMm`.

### Live workspace snapshots (`client.projectSnapshots`)

Modules with `project.storage` can optionally participate in host `.lum` document saves and restores by declaring `"projectSnapshots": { "protocol": 1, "schemas": ["my-editor/v1"] }` in `manifest.json` and registering a handler before `host.lifecycle.ready()`:

```ts
const unregister = host.projectSnapshots.register({
  capture: () => ({ schemaVersion: "my-editor/v1", state: editor.current() }),
  prepare: (snapshot) => editor.validateAndPrepare(snapshot),
  commit: (prepared) => editor.applyAndWaitForRender(prepared),
});

// Notify the host after user edits, including unsaved draft changes.
host.projectSnapshots.changed();

// Call unregister() on unmount.
```

`capture` returns the live editor state, `prepare` validates incoming data before mutating state, and `commit` applies the prepared snapshot. Hosts serialize structured data and source bytes into `.lum` files, while older hosts simply ignore the optional handshake capability.

### Python module backends (`backend.tasks`)

With manifest v2, a module can pair its UI with a local Python worker defined by a Python entry point and a hash-pinned, wheels-only PEP 751 `pylock.toml`:

```ts
const host = await connectWorkshop({
  moduleId: "studio.lumina.example",
  moduleVersion: "1.0.0",
  features: ["backend.tasks"],
});

const task = await host.backend.submit({
  operation: "invert-alpha",
  params: {},
  inputs,
});
const finished = await host.backend.waitFor(task.taskId);
```

Lumina Studio sets up the Python environment after user consent, starts the worker on demand for submitted tasks, and manages task files and cleanup. Backends run as local processes under the user's account; declared capabilities explain what the module needs for consent and review, and are not an OS sandbox. See [`docs/backend-protocol.md`](docs/backend-protocol.md) and [`python/README.md`](python/README.md) for the worker protocol.

## Documentation and ecosystem

- [Module development & packaging guide](docs/module-development.md) (bilingual)
- [Python backend protocol](docs/backend-protocol.md) and [Python SDK guide](python/README.md)
- [Lumina Workshop Registry](https://github.com/lumina-layer-studio/Lumina-Workshop-Registry) — signed public module catalog
- [Contributing](CONTRIBUTING.md) and [Security policy](SECURITY.md)

## Contributing and local checks

Requires Node.js 22+, `pnpm@10.33.2`, and Python 3.12+:

```bash
pnpm install --frozen-lockfile
pnpm test
python3 -m unittest discover -s python/tests -v
python3 python/build_wheel.py --output dist-package
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for compatibility guidelines.

## License

Licensed under **GPL-3.0-or-later**. See [LICENSE](LICENSE).
