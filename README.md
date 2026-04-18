# Galgame Web UI 运行指南

本仓库在 `web/galgame/` 下提供浏览器端 Galgame 风格对话界面，由 `scripts/galgame-server.ts` 启动：本地静态页面 + 基于 `@codeany/open-agent-sdk` 的聊天 API（不单独拉起完整 CLI）。

## 环境要求

- [Bun](https://bun.sh/) **≥ 1.2.0**（与 `package.json` 的 `engines` 一致；建议安装最新稳定版）
- 可访问的大模型 HTTP API（通过下文环境变量配置）

## 1. 安装依赖

在**仓库根目录**执行：

```bash
bun install
```

## 2. 配置 API（必做）

Galgame 通过 **CODEANY_*** 环境变量把请求发到你的模型服务。常见做法是在根目录创建 `.env`（勿提交到 Git；本仓库 `.gitignore` 已忽略 `.env`）。

### 示例 A：OpenAI 兼容接口（`completions` 风格）

适用于多数「OpenAI 兼容」网关或代理：

```env
CODEANY_API_TYPE=openai-completions
CODEANY_API_KEY=sk-你的密钥
CODEANY_BASE_URL=https://api.example.com/v1
```

### 示例 B：Anthropic Messages 风格

```env
CODEANY_API_TYPE=anthropic-messages
CODEANY_API_KEY=sk-ant-...
CODEANY_BASE_URL=https://api.anthropic.com
```

### 可选：默认模型名

未在界面里指定模型时，服务端默认使用环境变量 `CODEANY_MODEL`；若未设置，脚本内默认值为 `MiniMax-M2.7-highspeed`（请按你实际供应商提供的模型 ID 修改）。

```env
CODEANY_MODEL=你的模型名
```

Bun 会加载当前工作目录下的 `.env`；若你用手动 `export` / 系统环境变量，效果相同。

使用下文「包装脚本」启动时，进程会先切换到**仓库根目录**，因此根目录下的 `.env` 仍会被正常加载。

## 3. 启动 Galgame

在仓库根目录：

```bash
bun run galgame
```

启动成功后，终端会打印类似：

```text
Galgame server (open-agent-sdk) listening on http://127.0.0.1:<端口>/
```

在浏览器中打开该地址即可使用 `web/galgame/` 页面。

### 从任意目录启动（包装脚本，推荐）

脚本根据**自身所在位置**定位仓库根目录（`scripts/` 的上一级），不要求你事先 `cd` 到仓库。

1. 把本仓库的 `scripts` 目录加入系统 **PATH**（用户环境变量即可）。
2. **Windows**：在终端输入 `galgame`（会解析到 `galgame.cmd`）。
3. **macOS / Linux**：先执行一次 `chmod +x scripts/galgame`，再在 PATH 里用 `galgame`。

之后在任何当前目录下执行 `galgame`，都会先切到仓库根再运行 `bun run galgame`。

### Windows 其它方式

- **`scripts/galgame.cmd`**：与上面 PATH 方式相同，也可直接双击或用完整路径运行。
- **`scripts/start-galgame.bat`**：带更多提示；出错时会 `pause` 方便查看（适合双击调试）。

以上脚本都会先切换到仓库根目录再启动服务。

## 4. 端口与监听地址

| 变量 | 作用 |
|------|------|
| `GALGAME_HOST` | 监听地址，默认 `127.0.0.1` |
| `GALGAME_PORT` | **强制**使用该端口；若端口被占用则**直接失败**（只尝试一次） |
| `OPENAI_ANTHROPIC_PROXY_PORT` | 兼容旧名：作为**起始端口**（默认 `4100`）。未设置 `GALGAME_PORT` 时，会从该端口起**最多尝试 50 个连续端口**，直到找到可用端口 |

因此：若未设置 `GALGAME_PORT`，实际端口可能为 `4100`、`4101`……请以终端打印为准。

## 5. 健康检查

服务启动后可用浏览器或 curl 访问：

```http
GET /health
```

返回 JSON：`{"ok":true}` 表示进程正常。

## 6. 服务端提供的 API（供页面与调试）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/` 及静态资源 | 托管 `web/galgame/` |
| `POST` | `/api/cc/chat` | 非流式，JSON 一次返回 |
| `POST` | `/api/cc/chat/stream` | SSE 流式事件 |
| `POST` | `/api/cc/chat/cancel` | 按 `sessionId` 中断当前查询 |

会话默认仅在内存中（`persistSession: false`），重启服务会丢失会话状态。

## 7. 常见问题

- **提示找不到 `bun`**：将 Bun 安装目录加入 `PATH`，重新打开终端后再试。
- **端口已被占用**：不设 `GALGAME_PORT` 时会自动递增端口；若你固定了 `GALGAME_PORT` 又冲突，请换端口或结束占用进程。
- **401 / 连接 API 失败**：检查 `CODEANY_API_KEY`、`CODEANY_BASE_URL` 是否与供应商文档一致，以及网络能否访问该地址。
- **模型名无效**：设置正确的 `CODEANY_MODEL`，或在页面里选择/填写支持的模型 ID（若界面提供）。

## 8. 与本仓库 CLI 的关系

终端版 Claude Code 风格 CLI 的开发入口为：

```bash
bun run dev
```

Galgame 与 `bun run dev` **相互独立**；日常只用浏览器 UI 时，只需按上文完成 `bun install`、配置 `.env` 并 `bun run galgame` 即可。

---

仓库说明：本项目主体为逆向/复现的 Claude Code CLI（`src/` 等），Galgame 为内置的轻量 Web 前端与本地 API。许可证见 `LICENSE`。
