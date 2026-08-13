# Lumina Workshop SDK

`@lumina/workshop-sdk` is the public, versioned contract between Lumina Studio
and installable Creative Workshop modules.

Modules run inside a restricted iframe. They never import Lumina Studio source
files or call private APIs. Instead, they connect through the SDK and request
explicit capabilities such as image selection, project storage, the current
color library, and image handoff.

## Install the immutable v1 release

Lumina publishes the SDK only as a versioned GitHub Release asset. Verify the
checksum before adding the exact tarball URL to a module:

```text
https://github.com/lumina-layer-studio/Lumina-Workshop-SDK/releases/download/v1.0.2/lumina-workshop-sdk-1.0.2.tgz
```

```bash
gh release download v1.0.2 \
  --repo lumina-layer-studio/Lumina-Workshop-SDK \
  --pattern "lumina-workshop-sdk-1.0.2.tgz*" \
  --dir .workshop-sdk-release
cd .workshop-sdk-release
shasum -a 256 -c lumina-workshop-sdk-1.0.2.tgz.sha256
```

Pin that exact immutable asset in `package.json`:

```json
{
  "dependencies": {
    "@lumina/workshop-sdk": "https://github.com/lumina-layer-studio/Lumina-Workshop-SDK/releases/download/v1.0.2/lumina-workshop-sdk-1.0.2.tgz"
  }
}
```

There is no npm publication, floating release asset, or unversioned download
URL. A module repository should commit its lockfile so the resolved SDK
artifact remains reviewable.

## Package contract

- API version: `1.0.0`
- Manifest version: `1`
- UI entry point: `ui/index.html`
- Runtime transport: a host-provided `MessagePort`

The module manifest must declare every requested permission and explain why it
is needed. Lumina Studio remains responsible for user confirmation, storage
quotas, converter handoff, and runtime isolation.

SDK 1.0.2 adds optional native `svgBytes` and
`recommendedTotalThicknessMm` image-handoff fields, plus live host UI updates
through `ui.stateChanged` and `client.ui.subscribeState()`. PNG remains the
compatible image fallback, and `ui.getState()` remains available for hosts
that do not push events.

The complete bilingual module-development and packaging guide is published at
[`docs/module-development.md`](docs/module-development.md).

## Minimal connection fixture

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

// Call unsubscribe() before tearing down a long-lived module view.
```

This initialization order is race-safe in SDK 1.0.2. The client caches the
latest valid UI event from connection time, replays it synchronously when a
listener subscribes, and prevents a late `getState()` snapshot from replacing
a newer event. Once such an event exists, it is authoritative for that
connection and later `getState()` calls return the cached event. With an older
host that sends no events, every `getState()` call continues to use the RPC
snapshot as before.

The host validates the module identity, negotiates only declared permissions,
and activates a candidate only after this ready handshake succeeds.
