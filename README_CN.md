# Lumina Workshop SDK

[English](README.md) · [简体中文](README_CN.md) · [安装](#安装v110) · [快速上手](#快速上手) · [能力与清单约定](#能力与清单约定) · [模块开发指南](docs/module-development.md)

`@lumina/workshop-sdk` 是为 [Lumina Studio](https://github.com/lumina-layer-studio/Lumina-Layers) 开发可安装创意工坊模块的公开 SDK。

创意工坊模块运行在受限的 `ui/index.html` iframe 中，通过 `MessagePort` 与 Lumina Studio 通信。借助 SDK，模块可以同步宿主的语言与明暗主题、读取用户选择的图片、预览当前激活的 LUT 或耗材档案色库、保存本地工程、按需运行 Python 后端任务，并将处理好的 SVG 或 PNG 交回 Lumina 的三维打印转换流程。

## 可以用它做什么

| 模块能力 | SDK 接口与清单声明 |
| --- | --- |
| 同步宿主主题与界面语言 | `client.ui.getState()`、`client.ui.subscribeState()`（`ui.stateChanged`）与 `applyWorkshopUiState()` |
| 选择并读入图片 | `image.pick` 权限 |
| 读取当前色库与耗材预览 | `color-library.read` 权限 |
| 将图案交回转换器（PNG 或矢量 SVG） | `handoff.image` 权限，支持可选的原生矢量 `svgBytes` 与推荐总厚度 `recommendedTotalThicknessMm` |
| 本地工程存储与 `.lum` 实时快照 | `project.storage` 权限，配合可选的 `client.projectSnapshots`（`projectSnapshots.register` 与 `projectSnapshots.changed`） |
| 本地 Python 任务后端 | `"manifestVersion": 2`、`backend.tasks` 能力与配套的 `lumina_workshop_backend` Python wheel |

编写纯前端模块时，可以直接复制 [`templates/image-handoff`](templates/image-handoff) 起步模板，运行 `pnpm install --frozen-lockfile`、`pnpm build`，再用 `pnpm check` 校验生成的 `.lumina-workshop` 安装包。完整的开发与打包步骤见 [`docs/module-development.md`](docs/module-development.md)。

## 安装（`v1.1.0`）

SDK 通过带版本号的 GitHub Release 资产发布，每个包均附带对应的 `.sha256` 校验文件：

- **TypeScript / JavaScript 前端 SDK：** `lumina-workshop-sdk-1.1.0.tgz`
- **Python 后端 SDK：** `lumina_workshop_backend-1.1.0-py3-none-any.whl`

接入模块前，可先下载并核对 `v1.1.0` 发行包的 SHA-256 校验值：

```bash
gh release download v1.1.0 \
  --repo lumina-layer-studio/Lumina-Workshop-SDK \
  --pattern "lumina-workshop-sdk-1.1.0.tgz*" \
  --dir .workshop-sdk-release
cd .workshop-sdk-release
shasum -a 256 -c lumina-workshop-sdk-1.1.0.tgz.sha256
```

随后在模块的 `package.json` 中锁定该 Release 包地址，并一并提交锁文件：

```json
{
  "dependencies": {
    "@lumina/workshop-sdk": "https://github.com/lumina-layer-studio/Lumina-Workshop-SDK/releases/download/v1.1.0/lumina-workshop-sdk-1.1.0.tgz"
  }
}
```

联调开发阶段也可锁定已审阅的 Git 提交 SHA（源码安装由 `prepare` 编译 TypeScript）；正式 Release 压缩包内直接提供编译好的 `dist/` 产物。

## 快速上手

在 `ui/index.html` 中连接 Lumina Studio，同步初始界面状态并完成就绪握手：

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

// 卸载长生命周期视图前调用 unsubscribe()。
```

先订阅 `subscribeState` 再调用 `getState()`，既能实时接收 `ui.stateChanged` 推送，也能兼容仅支持快照查询的宿主版本。`host.lifecycle.ready()` 完成后，Lumina Studio 会激活模块界面并开放已声明的权限。

## 能力与清单约定

- **Workshop API 版本：** 纯前端模块上报 `1.0.0`；请求 `backend.tasks` 的后端模块上报 `1.1.0`。
- **Manifest 版本：** 纯前端模块使用 `1`；包含 Python 后端的模块使用 `2`。
- **界面入口：** `ui/index.html`，与 `manifest.json`、`assets/icon.png`、`README.md` 和 `LICENSE` 一起打包。
- **权限说明：** 在 `manifest.json` 中逐项声明所需权限及用途说明。若需兼容不支持矢量交接扩展的旧版宿主，交接时仅发送基础 PNG 字段，省略 `svgBytes` 和 `recommendedTotalThicknessMm`。

### 工程实时快照（`client.projectSnapshots`）

已申请 `project.storage` 的模块可在 `manifest.json` 中声明 `"projectSnapshots": { "protocol": 1, "schemas": ["my-editor/v1"] }`，并在调用 `host.lifecycle.ready()` 之前注册快照处理器，从而随宿主 `.lum` 工程一起保存与恢复当前编辑状态：

```ts
const unregister = host.projectSnapshots.register({
  capture: () => ({ schemaVersion: "my-editor/v1", state: editor.current() }),
  prepare: (snapshot) => editor.validateAndPrepare(snapshot),
  commit: (prepared) => editor.applyAndWaitForRender(prepared),
});

// 用户每次编辑后通知宿主（包含尚未落盘的草稿修改）。
host.projectSnapshots.changed();

// 组件卸载时调用 unregister()。
```

`capture` 返回当前可编辑状态，`prepare` 在不改动当前状态的前提下完成校验，`commit` 应用恢复后的工作区。宿主仅将结构化数据与原始字节写入 `.lum` 工程文件；不支持该可选握手的宿主会自动忽略它。

### Python 模块后端（`backend.tasks`）

使用 manifest v2 时，模块可以声明由宿主托管的本地 Python 后端，包含 Python 入口与仅使用预编译 wheel、带哈希锁定的 PEP 751 `pylock.toml`：

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

经用户确认后，Lumina Studio 会准备对应的 Python 运行环境，仅在提交任务时按需拉起后端进程，并统一管理任务输入输出与依赖回收。后端以当前用户权限在本机进程中运行；声明的能力用于用户授权提示与目录审阅，并非操作系统级沙箱。后端协议细节见 [`docs/backend-protocol.md`](docs/backend-protocol.md) 与 [`python/README.md`](python/README.md)。

## 相关文档与生态

- [模块开发与打包指南](docs/module-development.md)（中英双语）
- [Python 后端协议说明](docs/backend-protocol.md) 与 [Python SDK 说明](python/README.md)
- [Lumina Workshop Registry](https://github.com/lumina-layer-studio/Lumina-Workshop-Registry) —— 创意工坊公开签名目录
- [参与贡献](CONTRIBUTING.md) 与 [安全策略](SECURITY.md)

## 参与贡献与本地检查

需要 Node.js 22+、`pnpm@10.33.2` 与 Python 3.12+：

```bash
pnpm install --frozen-lockfile
pnpm test
python3 -m unittest discover -s python/tests -v
python3 python/build_wheel.py --output dist-package
```

兼容性与提交流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

采用 **GPL-3.0-or-later** 许可协议，详见 [LICENSE](LICENSE)。
