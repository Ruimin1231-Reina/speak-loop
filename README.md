# Speak Loop · 口语工作台（开发说明）

静态 PWA，用来配合 ChatGPT Live/文字对话：ChatGPT 在**同一个对话**生成 Daily Pack JSON → 用户粘贴或选择 `.json` 文件导入 → 人工筛选 → 主动回忆复习 → 生成下次聊天开场白。它不是内嵌 ChatGPT 或 Live 语音的应用。

原生 JavaScript、无构建步骤、无第三方依赖、无后端。用户流程和可复制命令见上级目录的 `03-每天怎么练与生成Pack.md`；唯一 Pack 模板见 `01-ChatGPT项目指令.md` 和 `prompts.js`。

## 运行

```bash
cd "英语学习/speak-loop"
python3 -m http.server 8765 --bind 127.0.0.1
# 浏览器打开 http://127.0.0.1:8765
```

直接打开 `index.html` 也可试用；Service Worker 和安装到主屏幕需要 http(s)。

## 验证

```bash
node --test tests/*.test.js
node --check app.js
node --check core.js
node --check prompts.js
node --check sample-pack.js
node --check sw.js
```

- `tests/core.test.js`：Pack 解析（含尾逗号和引号内逗号）、空/稀疏 Pack、导入、调度、队列、统计、提示、语音文字比对、合并。
- `tests/content.test.js`：示例 Pack、项目模板和带当天本地日期的独立 Pack 请求。
- `tests/sync.test.js`：假的 GitHub Contents API 的同步流程；不会联网。
- `tests/e2e.browser.js`：可选浏览器端到端脚本，不随 `node --test` 运行。

还应手工以 390×844 检查：所有命令复制按钮、粘贴和 JSON 文件导入、解析失败后的修复请求、零条目 Pack 提示、筛选/重复/复习及语音文字比对说明。

## 文件

| 文件 | 作用 |
|---|---|
| `core.js` | 无 DOM 的 Pack 解析、导入、复习调度、统计和同步合并 |
| `prompts.js` | 项目指令、规范模板和 configured/standalone/repair 请求构建器 |
| `sample-pack.js` | 通用的空指标示例 Pack |
| `storage.js` | IndexedDB；失败时使用 localStorage |
| `speech.js` | `speechSynthesis` 和可选的 `SpeechRecognition` 文字比对 |
| `sync.js` | 可选 GitHub 私有仓库同步 |
| `ui.js` | 安全的 `h()`/`textContent` 渲染、图标、提示、表单 |
| `app.js` | 路由与页面；包括粘贴/文件导入和人工筛选 |
| `sw.js` | 离线缓存；改静态资源时只将 `CACHE` 版本加 1 |

## Pack 约定和数据

Pack schema 固定为 `speak-loop/pack@1`。`minutes` 和所有 `scores` 默认 `null`，因为聊天文字不能可靠测量真实开口时长、发音或官方水平。素材可为空或很少；没有 vocabulary、expression 或 feedback 时，导入器明确拒绝创建无复习内容的日报，而不会编造卡片。

本机 IndexedDB 有 `state`（可同步的 items/packs/activity/settings）与 `device`（设备 ID、声音、同步配置和 Token）。持久化 schema、`storage.js` 与 `sync.js` 不应在此类 UI/Prompt 改动中修改。修改条目、日报或设置必须更新时间戳 `updatedAt`。

用户输入与 ChatGPT 文本只能经 `ui.js` 的 `h()` 写入 `textContent`；不要用 `innerHTML`。代码或示例中不能添加个人信息、学习记录或 Token。
