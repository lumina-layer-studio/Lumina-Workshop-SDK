# 模块后端契约 / Module backend contract (Workshop API 1.1.0)

本文件是公开 SDK 1.1.0 的后端契约。宿主实现位于 Lumina Studio；模块只依赖本 SDK。
This document is the public SDK 1.1.0 backend contract. Modules depend only on
this SDK, never on Lumina Studio source.

## 运行模式 / Execution model

- 本机进程模式：后端以用户自己的权限在本机运行。独立进程与环境用于保持宿主环境
  干净、资源可归属和可回收，不是操作系统级权限沙箱。
  Local-process mode: backends run with the user's own permissions. Separate
  processes and environments keep the host clean and resources attributable;
  they are not an OS permission sandbox.
- 声明的能力（`network`、`subprocess`、`external-files`）只用于向用户说明用途，
  宿主不声称强制限制它们。
- 安装、启用、运行是三个独立状态。宿主在提交任务时按需启动后端，同时只执行一个
  任务，空闲后停止进程。
- 任务归宿主所有：关闭或切换模块页面不会取消任务；重新进入后用
  `client.backend.list()` / `get()` 恢复进度或结果。取消、停用、卸载和退出程序会
  结束该模块的进程树。

## Manifest v2

只有带后端的模块使用 `manifestVersion: 2`；纯前端模块继续使用 v1。后端模块必须声明
`workshopApi.min >= 1.1.0`，因此旧宿主会在目录中过滤它们，本地安装也会明确失败。

```json
{
  "manifestVersion": 2,
  "workshopApi": { "min": "1.1.0", "maxExclusive": "2.0.0" },
  "backend": {
    "entry": "backend/main.py",
    "python": "3.12",
    "lock": "backend/pylock.toml",
    "platforms": ["windows-x86_64", "linux-x86_64", "macos-arm64"],
    "capabilities": [{ "name": "network", "reason": "Downloads public sample data." }],
    "models": [{
      "id": "matte", "fileName": "matte.onnx",
      "url": "https://example.com/matte.onnx",
      "sha256": "<64 lowercase hex>", "bytes": 123456, "license": "Apache-2.0"
    }],
    "variants": [{
      "id": "cuda", "lock": "backend/pylock.cuda.toml",
      "name": { "zh-CN": "GPU 加速", "en-US": "GPU acceleration" },
      "description": { "zh-CN": "使用 NVIDIA GPU", "en-US": "Uses an NVIDIA GPU" },
      "platforms": ["windows-x86_64", "linux-x86_64"]
    }],
    "idleTimeoutSeconds": 300
  }
}
```

包内 `backend/` 只能包含有大小上限的 UTF-8 文本源文件（`.py`、`.toml`、`.json`、
`.txt`、`.md`、`.cfg`、`.ini`、`.csv`），不得包含 `__pycache__`、隐藏文件或原生
二进制。原生代码只能来自锁中的 wheel；模型不打进包里，由宿主按声明下载并校验。

## 依赖锁 / Locks

- 使用 PEP 751 `pylock.toml`（文件名 `pylock.toml` 或 `pylock.<name>.toml`），
  例如 `uv pip compile requirements.in --universal --format pylock.toml`。
- 首版只接受预编译 wheel：每个包需要 HTTPS `url` 与 `hashes.sha256`；`size`
  可选但建议提供，宿主用它在授权前估算下载量。不接受 sdist、VCS、目录或本地路径。
- 宿主按“平台 + 解释器小版本 + 规范化锁内容”区分环境：相同锁共用一个环境，不同锁
  各自独立，冲突版本自然共存；相同文件在环境之间按内容共享。无论从哪个镜像下载，
  内容都按锁中的哈希校验。
- 变体锁是完整锁（不是叠加层），用于 CPU/GPU 等不同运行库；只有用户开启加速时才
  准备，初始化失败时回退到 CPU。

## SDK 版本与分发 / SDK delivery

Python SDK `lumina-workshop-backend` 与 JS SDK 一样只通过本仓库的不可变 GitHub
Release 发布（无 PyPI）。模块可以把校验过的 wheel 内容放进 `backend/`
（`backend/lumina_workshop_backend/`），也可以在锁中引用该 Release wheel 的
HTTPS 地址与 SHA-256。

## 启动契约 / Launch contract

宿主用模块环境中的解释器启动：

```text
python -I -X utf8 -X pycache_prefix=<module cache> <host bootstrap> <version dir>/backend <entry>
```

- `-I`：忽略 `PYTHON*` 变量和用户 site，脚本目录不进入 `sys.path`；宿主引导脚本
  把 `<version dir>/backend` 加入 `sys.path` 后以 `__main__` 运行 `entry`。
- 控制通道是两条继承的专用管道，引导脚本把它们转换成不可继承的文件描述符并写入
  `LUMINA_WORKSHOP_CONTROL_FDS=<read>,<write>`。stdout/stderr 只作诊断日志，原生库
  输出不会污染协议。
- 环境变量为白名单；`TMP`/`TEMP`/`TMPDIR` 与常见缓存（`XDG_CACHE_HOME`、`HF_HOME`、
  `TORCH_HOME`、`NUMBA_CACHE_DIR`、`MPLCONFIGDIR`、`CUPY_CACHE_DIR`）重定向到模块私有
  目录。宿主还提供 `LUMINA_WORKSHOP_MODULE_ID`、`LUMINA_WORKSHOP_MODULE_VERSION`、
  `LUMINA_WORKSHOP_BACKEND_VARIANT`（`cpu` 或变体 ID）和 `LUMINA_WORKSHOP_MODELS_DIR`。
- 不要在运行时向自身环境安装或修改文件：多个模块的环境共享物理文件。

## 消息 / Messages (protocol v1)

每行一个 JSON 对象，最大 1 MiB。图片等数据通过任务目录中的文件传递。

后端 → 宿主：

| type | 字段 |
| --- | --- |
| `ready` | `protocol: 1`, `sdk: {name, version}`, `operations: string[]` |
| `progress` | `taskId`, `completed`, `total`, `phase` |
| `result` | `taskId`, `outputs: [{name, fileName, mimeType}]`（文件位于 `outputDir`） |
| `error` | `taskId`, `code`（稳定 kebab-case）, `message`（不含堆栈、路径或令牌） |
| `cancelled` | `taskId` |

宿主 → 后端：

| type | 字段 |
| --- | --- |
| `run` | `taskId`, `operation`, `params`, `inputs: [{name, path, fileName, mimeType}]`, `outputDir`, `workDir`, `models: {id: path}`, `variant` |
| `cancel` | `taskId`（协作取消；超过宽限期宿主终止整棵进程树） |
| `shutdown` | 立即退出 |

宿主关闭控制通道时（包括宿主异常退出），SDK 立即退出。取消请求之后到达的结果不会
覆盖“已取消”。宿主异常退出或重启时，未完成任务记为“已中断”。

## 前端 RPC / Frontend RPC

```ts
const client = await connectWorkshop({ moduleId, moduleVersion, features: ["backend.tasks"] });
const task = await client.backend.submit({
  operation: "invert-alpha",
  params: {},
  inputs: [{ name: "image", fileName: "source.png", mimeType: "image/png", bytes }],
  idempotencyKey: crypto.randomUUID(),
});
const finished = await client.backend.waitFor(task.taskId, { onProgress: render });
const output = await client.backend.readOutput(finished.taskId, "image");
await client.handoff.image({ /* PNG from output.bytes */ });
```

只有请求 `backend.tasks` 时，就绪消息才上报 API `1.1.0`；否则仍为 `1.0.0`，使纯前端
模块在旧宿主上可用。宿主只对声明了后端、且用户已授权的版本开放这些方法。输入与产物
沿用 64 MiB 二进制上限；参数为不超过 64 KiB 的 JSON。产物在后端停止或页面切换后仍可
读取，按宿主保留期（默认 14 天）保存，用户可在存储概览中删除。
