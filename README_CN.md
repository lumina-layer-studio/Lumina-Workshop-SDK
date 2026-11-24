# Lumina Workshop SDK

[English](README.md) · [简体中文](README_CN.md) · [安装](#安装v110) · [快速上手](#快速上手) · [能力与清单约定](#能力与清单约定) · [模块开发指南](docs/module-development.md)

`@lumina/workshop-sdk` 是为 [Lumina Studio](https://github.com/lumina-layer-studio/Lumina-Layers) 开发创意工坊模块的公开 SDK。

模块运行在独立的 `ui/index.html` iframe 中，通过 `MessagePort` 与 Lumina Studio 通信，可同步界面语言与主题、导入图片、读取当前 LUT 或耗材色库、保存本地工程、运行可选的 Python 后端任务，并将 SVG 或 PNG 图案交回 Lumina 的三维打印转换流程。

## 可以用它做什么

| 模块能力 | SDK 接口与清单声明 |
| --- | --- |
| 同步宿主主题与语言 | `client.ui.getState()`、`client.ui.subscribeState()`（`ui.stateChanged`）、`applyWorkshopUiState()` |
| 导入图片与交回转换器 | `image.pick` 与 `handoff.image`（PNG 或原生矢量 `svgBytes` + `recommendedTotalThicknessMm`） |
| 读取色库与耗材预览 | `color-library.read` |
| 本地工程与 `.lum` 快照 | `project.storage`，可选配合 `client.projectSnapshots`（`projectSnapshots.register`、`projectSnapshots.changed`） |
| 本地 Python 任务后端 | `"manifestVersion": 2`、`backend.tasks` 与 `lumina_workshop_backend` |

新建纯前端模块可直接复制 [`templates/image-handoff`](templates/image-handoff)，运行 `pnpm install --frozen-lockfile`、`pnpm build` 和 `pnpm check`。打包细节见 [`docs/module-development.md`](docs/module-development.md)。

## 安装（`v1.1.0`）

`v1.1.0` Release 提供前端包 `lumina-workshop-sdk-1.1.0.tgz` 与 Python 后端包 `lumina_workshop_backend-1.1.0-py3-none-any.whl`，均附带 `.sha256` 校验文件：

```bash
gh release download v1.1.0 \
  --repo lumina-layer-studio/Lumina-Workshop-SDK \
  --pattern "lumina-workshop-sdk-1.1.0.tgz*" \
  --dir .workshop-sdk-release
cd .workshop-sdk-release
shasum -a 256 -c lumina-workshop-sdk-1.1.0.tgz.sha256
```

在模块的 `package.json` 中锁定该 Release 地址并提交锁文件：

```json
{
  "dependencies": {
    "@lumina/workshop-sdk": "https://github.com/lumina-layer-studio/Lumina-Workshop-SDK/releases/download/v1.1.0/lumina-workshop-sdk-1.1.0.tgz"
  }
}
```

## 快速上手

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

## 能力与清单约定

- **版本约定：** 纯前端模块使用 manifest `1`（Workshop API `1.0.0`）；声明 `backend.tasks` 的后端模块使用 manifest `2`（Workshop API `1.1.0`）。
- **包内文件：** `ui/index.html`、`manifest.json`、`assets/icon.png`、`README.md` 与 `LICENSE`。

### 工程实时快照（`client.projectSnapshots`）

申请了 `project.storage` 的模块可在 `manifest.json` 中声明 `"projectSnapshots": { "protocol": 1, "schemas": ["my-editor/v1"] }`，并在 `host.lifecycle.ready()` 前注册处理器，使未落盘编辑随宿主 `.lum` 工程一并保存与恢复：

```ts
const unregister = host.projectSnapshots.register({
  capture: () => ({ schemaVersion: "my-editor/v1", state: editor.current() }),
  prepare: (snapshot) => editor.validateAndPrepare(snapshot),
  commit: (prepared) => editor.applyAndWaitForRender(prepared),
});

host.projectSnapshots.changed();
```

### Python 模块后端（`backend.tasks`）

Manifest v2 模块可配置本地 Python 任务后端及带哈希锁定的 PEP 751 `pylock.toml`：

```ts
const host = await connectWorkshop({
  moduleId: "studio.lumina.example",
  moduleVersion: "1.0.0",
  features: ["backend.tasks"],
});

const task = await host.backend.submit({ operation: "invert-alpha", params: {}, inputs });
const finished = await host.backend.waitFor(task.taskId);
```

后端以当前用户权限在本机进程中运行；声明的能力用于授权提示与目录审阅，并非操作系统级沙箱。协议细节见 [`docs/backend-protocol.md`](docs/backend-protocol.md) 与 [`python/README.md`](python/README.md)。

## 参与贡献与本地检查

需要 Node.js 22+、`pnpm@10.33.2` 与 Python 3.12+：

```bash
pnpm install --frozen-lockfile
pnpm test
python3 -m unittest discover -s python/tests -v
python3 python/build_wheel.py --output dist-package
```

参见 [docs/module-development.md](docs/module-development.md)、[Lumina Workshop Registry](https://github.com/lumina-layer-studio/Lumina-Workshop-Registry)、[CONTRIBUTING.md](CONTRIBUTING.md) 与 [SECURITY.md](SECURITY.md)。

## 许可证

采用 **GPL-3.0-or-later** 许可协议，见 [LICENSE](LICENSE)。
