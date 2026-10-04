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

SDK versions, the Workshop API, and module versions are separate. Lumina's
current host pins SDK 1.0.1 for its own reproducible dependency graph while
supporting the SDK 1.0.2 extensions above. New modules should pin SDK 1.0.2 and
declare their tested host/API range in the manifest. For older hosts without
extension support, omit `svgBytes` and `recommendedTotalThicknessMm` and send only
base PNG handoff fields; PNG alongside unknown fields is not a fallback. Use
`ui.getState()` when UI events are unavailable. The offline official bead seed remains 1.0.1;
the signed catalog also offers the reviewed 1.0.8 update, which users install
through the normal candidate/update flow.

SDK、协议与模块版本分别管理。当前 Lumina 宿主锁定 SDK 1.0.1，但已支持上述 1.0.2
扩展；新模块推荐锁定 SDK 1.0.2，并声明实际测试过的宿主兼容范围。支持不认识扩展的旧
宿主时，应省略 `svgBytes` 和 `recommendedTotalThicknessMm`，只发送基础 PNG 字段；
同时提供 PNG 不会让旧宿主接受未知字段。没有界面事件时使用 `ui.getState()`。
官方离线预装拼豆包
仍为 1.0.1，用户可从签名目录安装已审核的 1.0.8 更新；启动时不会强制升级预装包。

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
