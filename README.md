# Lumina Workshop SDK

[English](README.md) · [简体中文](README_CN.md) · [Install](#install-v110) · [Quick start](#quick-start) · [Capabilities](#capabilities-and-manifest) · [Module guide](docs/module-development.md)

`@lumina/workshop-sdk` is the public SDK for building installable Creative Workshop modules in [Lumina Studio](https://github.com/lumina-layer-studio/Lumina-Layers).

Modules run in an isolated `ui/index.html` iframe and communicate with Lumina Studio over `MessagePort` to sync language and theme, pick images, read active LUT or filament palettes, store local projects, run optional Python backend tasks, and send finished SVG or PNG artwork to Lumina's 3D print converter.

## What you can build

| Capability | SDK surface & manifest declaration |
| --- | --- |
| Host theme and locale sync | `client.ui.getState()`, `client.ui.subscribeState()` (`ui.stateChanged`), `applyWorkshopUiState()` |
| Image import & converter handoff | `image.pick` and `handoff.image` (PNG or native vector `svgBytes` + `recommendedTotalThicknessMm`) |
| Palette and filament preview | `color-library.read` |
| Saved projects & `.lum` snapshots | `project.storage`, plus optional `client.projectSnapshots` (`projectSnapshots.register`, `projectSnapshots.changed`) |
| Local Python task backends | `"manifestVersion": 2`, `backend.tasks`, and `lumina_workshop_backend` |

To scaffold a new module, copy [`templates/image-handoff`](templates/image-handoff) and run `pnpm install --frozen-lockfile`, `pnpm build`, and `pnpm check`. Full packaging details are in [`docs/module-development.md`](docs/module-development.md).

## Install (`v1.1.0`)

Release `v1.1.0` ships `lumina-workshop-sdk-1.1.0.tgz` (TypeScript/JS frontend SDK) and `lumina_workshop_backend-1.1.0-py3-none-any.whl` (Python backend SDK), each with a `.sha256` checksum:

```bash
gh release download v1.1.0 \
  --repo lumina-layer-studio/Lumina-Workshop-SDK \
  --pattern "lumina-workshop-sdk-1.1.0.tgz*" \
  --dir .workshop-sdk-release
cd .workshop-sdk-release
shasum -a 256 -c lumina-workshop-sdk-1.1.0.tgz.sha256
```

Pin the release tarball URL in `package.json` and commit your lockfile:

```json
{
  "dependencies": {
    "@lumina/workshop-sdk": "https://github.com/lumina-layer-studio/Lumina-Workshop-SDK/releases/download/v1.1.0/lumina-workshop-sdk-1.1.0.tgz"
  }
}
```

## Quick start

```ts
import { applyWorkshopUiState, connectWorkshop } from "@lumina/workshop-sdk";

const host = await connectWorkshop({
  moduleId: "studio.lumina.example",
  moduleVersion: "1.0.0",
});

const unsubscribe = host.ui.subscribeState(applyWorkshopUiState);
applyWorkshopUiState(await host.ui.getState());
await host.lifecycle.ready();
```

## Capabilities and manifest

- **Versions:** Frontend-only modules use manifest `1` (Workshop API `1.0.0`); modules requesting `backend.tasks` use manifest `2` (Workshop API `1.1.0`).
- **Package contents:** `ui/index.html`, `manifest.json`, `assets/icon.png`, `README.md`, and `LICENSE`.

### Live workspace snapshots (`client.projectSnapshots`)

Modules with `project.storage` can declare `"projectSnapshots": { "protocol": 1, "schemas": ["my-editor/v1"] }` in `manifest.json` and register before `host.lifecycle.ready()` so unsaved edits save and restore with host `.lum` files:

```ts
const unregister = host.projectSnapshots.register({
  capture: () => ({ schemaVersion: "my-editor/v1", state: editor.current() }),
  prepare: (snapshot) => editor.validateAndPrepare(snapshot),
  commit: (prepared) => editor.applyAndWaitForRender(prepared),
});

host.projectSnapshots.changed();
```

### Python module backends (`backend.tasks`)

Manifest v2 modules can pair their UI with a local Python worker declared alongside a wheels-only, hash-pinned PEP 751 `pylock.toml`:

```ts
const host = await connectWorkshop({
  moduleId: "studio.lumina.example",
  moduleVersion: "1.0.0",
  features: ["backend.tasks"],
});

const task = await host.backend.submit({ operation: "invert-alpha", params: {}, inputs });
const finished = await host.backend.waitFor(task.taskId);
```

Backends run as local processes under the user's account; declared capabilities inform consent and review and are not an OS sandbox. See [`docs/backend-protocol.md`](docs/backend-protocol.md) and [`python/README.md`](python/README.md).

## Contributing and local checks

Requires Node.js 22+, `pnpm@10.33.2`, and Python 3.12+:

```bash
pnpm install --frozen-lockfile
pnpm test
python3 -m unittest discover -s python/tests -v
python3 python/build_wheel.py --output dist-package
```

See [docs/module-development.md](docs/module-development.md), [Lumina Workshop Registry](https://github.com/lumina-layer-studio/Lumina-Workshop-Registry), [CONTRIBUTING.md](CONTRIBUTING.md), and [SECURITY.md](SECURITY.md).

## License

Licensed under **GPL-3.0-or-later**. See [LICENSE](LICENSE).
