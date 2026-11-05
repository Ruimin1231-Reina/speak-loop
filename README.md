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
- `tests/story.test.js`：故事 / 关键句 / 说法升级的解析与导入、同名故事替换、复述间隔、分句、表达高亮、故事合并。
- `tests/e2e.browser.js`：可选浏览器端到端脚本，不随 `node --test` 运行。它会注入一个假的 `speechSynthesis`，验证逐句播放、点句、盲听、复述、连续循环播放和散步模式。

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
| `player.js` | 逐句朗读播放器（连读 / 盲听 / 跟读、多篇循环），以及散步模式用的 Screen Wake Lock |
| `app.js` | 路由与页面；包括粘贴/文件导入、人工筛选、听力（`#/listen`）、故事（`#/story/<id>`）和复述（`#/retell/<id>`） |
| `sw.js` | 离线缓存；改静态资源时只将 `CACHE` 版本加 1 |

## Pack 约定和数据

Pack schema 固定为 `speak-loop/pack@1`。`minutes` 和所有 `scores` 默认 `null`，因为聊天文字不能可靠测量真实开口时长、发音或官方水平。素材可为空或很少；没有 vocabulary、expression、feedback，也没有故事时，导入器明确拒绝创建空日报，而不会编造卡片。

本机 IndexedDB 有 `state`（可同步的 items/packs/stories/activity/settings）与 `device`（设备 ID、声音、同步配置和 Token）。修改条目、日报、故事或设置必须更新时间戳 `updatedAt`，同步合并靠它。

故事（2026-10-28 新增，Pack 里的可选字段，schema 仍是 pack@1）：

- Pack 的 `story` = `{kind: diary|story, title, topics, full[], short[], outline[], key_sentences[{sentence, cue}]}`，顶层 `upgrades` = `[{basic, better, why_zh}]`。
- 导入后：`state.stories[id]` 保存正文、`packId` 和复述进度 `retell {step, due, reps, lapses, last}`；关键句变成 `kind: 'expr', form: 'sentence'` 的条目（`cue` 是题面），说法升级变成 `kind: 'fix', form: 'upgrade'` 的条目，都进入普通复习。
- 同一天、同标题的故事再次导入时替换旧的（旧的标成 removed），复述进度保留。
- `activity` 多了 `l`（听完的篇数），也算进连续天数。
- 浏览器朗读的限制：iPhone 锁屏或切到别的 App 时会暂停；player.js 在页面回到前台时从当前句继续。锁屏播放需要真正的音频文件，目前没有做。

用户输入与 ChatGPT 文本只能经 `ui.js` 的 `h()` 写入 `textContent`；不要用 `innerHTML`。代码或示例中不能添加个人信息、学习记录或 Token。
