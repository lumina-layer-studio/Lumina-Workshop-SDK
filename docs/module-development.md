# 创意工坊模块开发与发布指南

Creative Workshop module development and release guide

## 先理解边界

创意工坊模块是独立发布、由用户安装的自包含网页应用。模块不能导入 Lumina Studio
源码、React 组件、Zustand store、Electron preload 或私有接口；它只能通过公开
`@lumina/workshop-sdk` 与宿主通信。

正式模块运行在 `sandbox="allow-scripts"` 的 iframe 中。桌面版还会按已提交的模块
frame 拦截网络、WebSocket、跳转、弹窗、权限和下载。普通浏览器无法提供同等级的
请求防火墙。支持官方目录浏览器运行的宿主只允许运行签名 Registry 中标记为 `official`
的模块、预装官方 seed 和测试 fixture；社区、GitHub 和普通本地模块需要桌面版，本地
模块只有在显式不安全开发模式中才能用合成数据调试。较旧宿主可能只允许预装包。

这套边界对官方模块和第三方模块相同。不要尝试通过 `fetch`、CDN、动态 `import()`、
`eval`、本地文件路径或父页面 DOM 绕过它。

## 获取不可变 SDK

公开 SDK 的稳定身份是：

- npm 包名：`@lumina/workshop-sdk`
- 版本：`1.0.2`
- GitHub Release tag：`v1.0.2`
- 资产：`lumina-workshop-sdk-1.0.2.tgz`
- 校验文件：`lumina-workshop-sdk-1.0.2.tgz.sha256`

SDK 只通过公开 `Lumina-Workshop-SDK` 仓库的不可变 GitHub Release 分发，不发布
可变 `latest` 资产，也不发布到 npm registry。模块应直接锁定精确 Release URL：

```json
{
  "dependencies": {
    "@lumina/workshop-sdk": "https://github.com/lumina-layer-studio/Lumina-Workshop-SDK/releases/download/v1.0.2/lumina-workshop-sdk-1.0.2.tgz"
  }
}
```

Release 同时提供小写 SHA-256 校验文件；macOS 可用 `shasum -a 256 -c` 验证。
模块仓库必须提交 `pnpm-lock.yaml`，CI 使用 `pnpm install --frozen-lockfile`。
不要依赖 Lumina 工作区中的 `workspace:*` 路径或未发布的 SDK 源码。

### 版本兼容与预装包 / Compatibility and bundled modules

| 项目 / Item | 版本 / Version | 含义 / Meaning |
| --- | --- | --- |
| 当前宿主的 SDK 依赖 / Host SDK dependency | `1.0.1` | 宿主的固定依赖，不是模块 SDK 的版本要求 / Host pin, not a module SDK requirement |
| 推荐的模块 SDK / Recommended module SDK | `1.0.2` | 新模块使用精确 Release / Pin the exact release for new modules |
| Workshop API / Manifest | `1.0.0` / `1` | 两个 SDK 版本共用 / Shared by both SDK releases |
| 官方离线预装拼豆包 / Offline bead seed | `1.0.1` | 首次安装与离线恢复 / First installation and offline recovery |
| 已审核的在线拼豆更新 / Reviewed bead update | `1.0.8` | 用户从签名目录安装 / User-installed catalog update |

SDK 包、协议和模块版本分别管理。当前宿主已支持 SDK 1.0.2 的可选 SVG、厚度和界面
事件扩展，虽然宿主自身仍锁定 SDK 1.0.1。面向不支持扩展的旧宿主时，应省略
`svgBytes` 和 `recommendedTotalThicknessMm`，只发送基础 PNG 交接字段；同时提供
PNG 不会让旧宿主接受未知字段。只面向支持扩展的宿主时，应声明并测试对应宿主范围。
没有界面事件时使用 `ui.getState()`。在 manifest 中声明实际测试过的 `workshopApi`
与 `luminaVersion` 范围。

SDK, API, and module versions are independent. The current host supports the
optional SDK 1.0.2 extensions while retaining its own SDK 1.0.1 dependency pin.
For older hosts without extension support, omit `svgBytes` and
`recommendedTotalThicknessMm` and send only base PNG handoff fields; PNG alongside
unknown fields is not a fallback. Alternatively, require a tested host range that
supports the extensions. Use `ui.getState()` when UI events are unavailable.
Declare and test actual host/API compatibility in the manifest; do not infer it
from the host SDK pin.

预装包保持锁定，不会在启动时因在线新版本强制升级。在线更新先安装为候选版本，成功
启动后才启用；离线恢复仍使用锁定的预装包。已发布 SDK、模块包与历史签名记录不可替换。

The seed is pinned and does not force updates on startup. Catalog updates
activate after the candidate starts successfully. Offline recovery uses the
locked seed, and historical release assets/signatures remain immutable.

## 最小仓库结构

```text
my-workshop-module/
├── .github/workflows/ci.yml
├── .github/workflows/release.yml
├── LICENSE
├── README.md
├── manifest.json
├── package.json
├── pnpm-lock.yaml
├── public/assets/icon.png
├── scripts/package.mjs
├── src/main.ts
└── test/
```

构建产物必须收敛为一个自包含 `ui/index.html`。JavaScript、CSS、worker 和运行所需
图像都应内联为脚本、样式、`data:` 或 `blob:`；运行时不能引用包内其他文件或外部
URL。

## Manifest v1

`manifest.json` 使用关闭式结构，未知字段、未知权限、重复权限和不完整 SemVer 都会
使安装失败：

```json
{
  "manifestVersion": 1,
  "id": "example.pattern-editor",
  "version": "1.0.0",
  "name": {
    "zh-CN": "图案编辑器",
    "en-US": "Pattern Editor"
  },
  "description": {
    "zh-CN": "读取图纸、校正网格并向 Lumina 交接图像。",
    "en-US": "Read a pattern, correct its grid, and hand an image to Lumina."
  },
  "publisher": "Example Studio",
  "workshopApi": {
    "min": "1.0.0",
    "maxExclusive": "2.0.0"
  },
  "luminaVersion": {
    "min": "2.0.0"
  },
  "entrypoints": {
    "ui": "ui/index.html"
  },
  "permissions": [
    {
      "name": "image.pick",
      "reason": "由用户选择一张图纸并读取其像素"
    },
    {
      "name": "project.storage",
      "reason": "保存和恢复本模块的编辑工程"
    },
    {
      "name": "handoff.image",
      "reason": "把用户确认的 PNG 交给 Lumina 转换器"
    }
  ]
}
```

模块 ID 是永久的全局身份，应使用小写分段名。版本、Release tag、包名和 manifest
版本必须精确一致。同一模块 ID 不能换仓库或改作另一种产品。

GitHub 仓库更名或转移后，宿主会通过登记地址读取 GitHub API 的当前仓库信息，再核对
精确 Release 资产地址。登记的模块身份、发布者与历史签名记录保持不变；变更审核身份
仍需单独审核，不能用任意新仓库替换登记记录。

GitHub-confirmed routing redirects preserve reviewed module identity.
Publisher/trust changes still require separate review; a changed asset URL
alone is not proof of a repository transfer.

### v1 权限

| 权限 | SDK 调用 | 宿主边界 |
| --- | --- | --- |
| `image.pick` | `client.image.pick()` | 用户主动选择；类型、解码尺寸和 64 MiB 上限由宿主校验 |
| `project.storage` | `client.projects.*` | 只能访问本模块命名空间；单记录 64 MiB、模块总量 256 MiB |
| `color-library.read` | `client.colorLibrary.read()` | 只返回规范化色库，不暴露 LUT、耗材档案路径或私有状态 |
| `handoff.image` | `client.handoff.image()` | 重新校验 PNG、像素、物理尺寸、色库身份和 1 MiB 配方信封 |

权限理由会显示给用户。更新新增权限时，宿主必须再次确认，拒绝后旧版本继续可用。
v1 没有一般网络权限。

## 连接宿主

模块入口只使用 SDK：

```ts
import {
  applyWorkshopUiState,
  connectWorkshop,
} from "@lumina/workshop-sdk";

const moduleId = "example.pattern-editor";
const moduleVersion = "1.0.0";

const client = await connectWorkshop({
  moduleId,
  moduleVersion,
});

const unsubscribeUiState = client.ui.subscribeState(applyWorkshopUiState);
applyWorkshopUiState(await client.ui.getState());
await client.lifecycle.ready();
```

`ui.getState()` 保证旧宿主仍可提供初始状态；SDK 1.0.2 还会在握手中声明
`ui.stateChanged` 事件能力。支持该能力的宿主会在语言、主题或公开 token 变化时主动推送，
无需轮询或重载 iframe。SDK 会从连接建立起缓存最后一个合法事件，订阅时同步重放；若
`getState()` 请求期间收到更新，返回值会采用缓存的新事件而不是迟到的旧快照。因此上面的
“先订阅，再读取初始状态”写法不会漏更新或让界面状态倒退。模块关闭长期视图时应调用
`unsubscribeUiState()`；重复调用安全，单个监听器抛错也不会影响其他监听器或 RPC 连接。
连接内一旦收到合法事件，最后一个事件就是权威状态，后续 `getState()` 直接返回该缓存；
旧宿主不发送事件时，`getState()` 仍会像 1.0.1 一样逐次发起 RPC 请求。

握手必须在 iframe load 后 10 秒内完成。普通请求默认 30 秒，原生图片选择最长
5 分钟，图片交接 120 秒；控制消息不超过 1 MiB，单次二进制不超过 64 MiB。
错误应使用稳定的 kebab-case 代码，用户消息不能包含堆栈、路径、令牌或原始项目内容。

## 项目、迁移与配方信封

项目记录必须带独立的 `schemaVersion`。读取后先完整验证，再按已知版本逐步迁移；遇到
未知新版本或迁移失败时保留原记录，不做部分写回。更新候选版本启动前，宿主会创建项目
快照；启动或迁移失败时可回滚代码和项目指针。

分享卡只保存重新编辑所需的 JSON：

```ts
const recipeSource = {
  manifestSchemaVersion: 1 as const,
  moduleId,
  moduleVersion,
  projectSchemaVersion: "example-project/v1",
  renderSchemaVersion: "example-render/v1",
  payload: {
    rows: 24,
    columns: 24,
    edits: [],
  },
};
```

信封总量不得超过 1 MiB。不要保存 `Blob`、图片字节、对象 URL、本机路径、GitHub
token、Registry 签名或桌面令牌。Lumina 导入分享卡时只校验通用信封；安装好的模块
负责验证和迁移自身 payload。模块缺失时，转换器图像和参数仍会恢复，并提示用户安装
精确模块版本。

## 图像交接

模块只能通过 `client.handoff.image()` 进入 Lumina 转换器。交接对象至少包含：

- 与当前 manifest 一致的模块 ID 和版本；
- 标准 PNG 的 `ArrayBuffer`、像素宽高与非空内容；
- 可选的原生 SVG `svgBytes`；宿主会重新验证，PNG 始终作为兼容回退；
- 推荐物理宽高；
- 可选的成品总厚度 `recommendedTotalThicknessMm`；
- 可选但自洽的方形网格行列和节距；
- 当前宿主色库 ID；
- 1 MiB 以内的配方信封。

如果转换器已有工作，第一次交接返回 `needs-confirmation`，模块应显示清楚的替换确认，
再由用户触发第二次交接。成功后仍走 Lumina 原有的 LUT/耗材档案、叠色预览和 3MF
生成路径。不要把辅助网格、编号、水印、选中框或诊断覆盖层写入最终 PNG。

## 单文件包

标准资产名是：

```text
<module-id>-<version>.lumina-workshop
```

它是一个 ZIP，但根目录只能包含：

```text
manifest.json
ui/index.html
assets/icon.png
assets/gallery/*     # 可选静态 PNG/JPEG/WebP，最多 20 张
README.md
LICENSE
```

不允许额外 JavaScript 文件、source map、符号链接、重复/大小写冲突路径、路径穿越、
加密成员、动画图片或压缩炸弹。`ui/index.html` 必须在第一个 `<script>` 前出现
`<head>`，不得使用 `eval`、动态 `import()` 或非内联资源。

本地构建应可复现。正式 Registry 审核会使用 Lumina 宿主检查器重新下载两次并静态
验证最终 Release 资产；模块仓库不应复制或依赖私有宿主实现。

## GitHub Release

每个版本发布一个非 draft、非 prerelease 的不可变 Release：

```text
tag:        v1.0.0
asset:      example.pattern-editor-1.0.0.lumina-workshop
checksum:   example.pattern-editor-1.0.0.lumina-workshop.sha256
```

Release workflow 应使用 Node 22、pnpm 10.33.2、冻结 lockfile，完整测试后只打包一次，
从最终资产计算小写 SHA-256。不要重用 tag、替换既有资产或提供可变 `latest` 下载。
Registry 收录时还会绑定 GitHub 仓库、Release tag、字节数、包摘要、manifest 摘要、
权限、兼容范围和审核状态。

## 本地测试 fixture

模块仓库测试不应启动真实 Lumina，也不应复制私有宿主代码。用实现
`WorkshopParentWindowLike` 的小型 harness：

1. 接收 `lumina.workshop.ready`；
2. 核对模块 ID、版本和 API 版本；
3. 通过 `MessageChannel` 发送 `lumina.workshop.connect`；
4. 对每个 RPC 返回固定、合成、无隐私的数据；
5. 覆盖握手超时、权限拒绝、超限 payload、保存/恢复、交接确认和稳定错误码。

SDK 测试提供最小协议契约；模块自己的识别、编辑、渲染和迁移测试仍留在独立仓库。

## 发布前检查

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm run package
```

同时确认：

- 包只含允许文件，且入口完全自包含；
- manifest、tag、资产名和实际版本完全一致；
- 权限理由准确，没有申请未使用权限；
- 浅色/深色、中文/英文均可用；
- 浏览器限制提示、桌面沙箱和离线已安装流程可复现；
- 项目迁移、权限扩张拒绝、启动失败和回滚不丢数据；
- 分享卡往返不保存图片字节、路径或凭据；
- README、LICENSE、图标和图库不含外部活动内容。
