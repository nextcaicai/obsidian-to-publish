# AGENTS.md

## 项目定位

- 这是一个 Obsidian Community Plugin，不是独立 Web 应用。
- 插件入口是 `src/main.ts`，通过 `esbuild.config.mjs` 打包成根目录的 `main.js`。
- Obsidian 实际加载根目录的 `manifest.json`、`main.js`，以及可选的 `styles.css`。
- 当前插件 ID 是 `obsidian-to-publish`；本地测试安装目录应与 `manifest.json` 的 `id` 保持一致。

## 沟通与改动范围

- 默认用中文沟通；涉及技术取舍时说明“为什么”和“对用户的影响”。
- 只改与当前任务直接相关的文件。发现旁支问题先说明，不顺手大改。
- 不要自动 commit、push、创建 PR，除非用户明确要求。

## 开发命令

- 安装依赖：`npm install`
- 开发监听：`npm run dev`
- 生产构建与类型检查：`npm run build`
- 自动化测试：`npm test`
- 测试监听：`npm run test:watch`
- 打包 GitHub Release 四件套：`npm run package:release`（输出到 `dist/release/`）
- 当前项目没有 lint 脚本时，不要假装已执行 lint；如需新增 lint，先说明原因。

## Obsidian 插件开发规则

- 不要在主力 vault 里开发或测试插件；使用单独的开发 vault，避免插件 bug 误改真实笔记。
- 手动安装测试时，将 `manifest.json`、`main.js`、`styles.css` 复制到：

```text
<Vault>/.obsidian/plugins/obsidian-to-publish/
```

- 修改 TypeScript 源码后，需要重新加载插件或 Reload app 才能看到变化。
- 修改 `manifest.json` 后，需要重启 Obsidian 或重新加载插件环境，避免 UI 中仍显示旧名称、版本或能力声明。
- `manifest.json` 的 `id` 一旦发布就视为稳定标识，不要随意改名；改 ID 会影响用户已有安装与设置数据。
- 使用新 Obsidian API 时同步检查 `minAppVersion`；如果最低版本提高，要说明对旧版用户的影响。
- 发布版本时遵守下方「GitHub Release 规范」；不要只改一个版本号文件。

## GitHub Release 规范

每次正式发布必须遵循本规范。其它 Agent 执行「发布 release / 打版本」任务时，以本节为准，不要临时发明附件结构或 tag 格式。

### 版本与 tag

- 版本号采用 semver，例如 `0.2.2`。
- **必须一致**的版本字段：
  - `package.json` → `version`
  - `manifest.json` → `version`（Obsidian 插件）
  - `versions.json` → 新增 `"<version>": "<minAppVersion>"` 条目
  - `chrome-companion/manifest.json` → `version`（与插件同号）
- GitHub Release **tag = 版本号本身**，例如 `0.2.2`，**不加** `v` 前缀（不要用 `v0.2.2`）。
- Release 标题使用同一版本号，例如 `0.2.2`。
- 仓库远程默认是 `nextcaicai/obsidian-to-publish`。

### 固定附件（每次恰好 4 个）

每个 Release **固定上传且仅上传**以下 4 个文件（不要合并成一个总包，也不要附源码 tarball 当安装包）：

| # | 文件 | 用途 |
| --- | --- | --- |
| 1 | `main.js` | Obsidian 插件打包产物 |
| 2 | `manifest.json` | Obsidian 插件清单 |
| 3 | `styles.css` | Obsidian 插件样式 |
| 4 | `obsidian-to-publish-companion-<version>.zip` | 配套 Chrome 扩展安装包 |

Chrome zip 约定：

- 文件名：`obsidian-to-publish-companion-0.2.2.zip`（版本与插件相同）。
- zip 内必须有**一层**顶层目录 `obsidian-to-publish-companion/`，其下直接是扩展根文件（`manifest.json`、`options.html`、`icons/`、`src/`）。
- 用户解压后，在 `chrome://extensions` 选择该顶层目录做「加载已解压的扩展程序」。
- **不要**发 `.crx`；Chrome 旁路安装 `.crx` 对普通用户不可用。
- zip 内不要混入 Obsidian 的 `main.js` / 插件 `manifest.json`。
- 只用公众号/飞书的用户可以忽略 Companion zip；Release 说明里写清楚。

### 打包命令

在仓库根目录：

```bash
npm test
npm run package:release
```

`npm run package:release` 会：

1. 校验插件 / package / companion / `versions.json` 版本一致
2. 执行 `npm run build`
3. 把 4 个资产输出到 `dist/release/`

`dist/` 已 gitignore，不要提交构建产物目录。

### 发布检查清单（按顺序）

1. 工作区干净或仅包含本版本应发布的改动；`main` 与要发布内容一致。
2. 将四个版本相关文件升到目标版本（见上）。
3. 更新 Release notes 要点（用户可见变更，中文即可）。
4. `npm test` 全部通过。
5. `npm run package:release`，确认 `dist/release/` 中恰有 4 个文件。
6. 提交版本 bump（及文档/脚本等必要文件），message 示例：`Release 0.2.2: <short summary>`。
7. `git push origin main`（仅在用户明确要求发布时执行 push / 创建 Release）。
8. 创建 GitHub Release（tag 无 `v` 前缀），挂上 `dist/release/` 里全部 4 个文件：

```bash
VERSION=0.2.2
gh release create "$VERSION" \
  "dist/release/main.js" \
  "dist/release/manifest.json" \
  "dist/release/styles.css" \
  "dist/release/obsidian-to-publish-companion-${VERSION}.zip" \
  --title "$VERSION" \
  --notes-file path/to/notes.md
```

若 notes 用 heredoc 内联也可以，但附件列表不可缺项。

9. 用 `gh release view "$VERSION"` 核对 tag、标题、4 个 asset 名称。

### Release notes 最低要求

- 写清本版本用户可见变更。
- 说明 Obsidian 三件套安装路径：`<Vault>/.obsidian/plugins/obsidian-to-publish/`。
- 说明 Companion：从 Release 下载 zip → 解压 → Chrome「加载已解压」选 `obsidian-to-publish-companion` 目录；仅一键导入浏览器编辑器时需要。
- 附上 Full Changelog 链接：`https://github.com/nextcaicai/obsidian-to-publish/compare/<prev>...<version>`。

### 明确不要做的事

- 不要用 `v0.x.x` 作为 tag。
- 不要只发 Obsidian 三件套而漏掉 Companion zip。
- 不要把 Companion 与 Obsidian 文件打成同一个 zip 当唯一附件。
- 不要在未运行 `npm test` + `package:release` 的情况下凭手感上传旧 `main.js`。
- 不要自动 `git push` / `gh release create`，除非用户明确要求发布。
- 不要把 `data.json`、token、密钥、本机绝对路径写进附件或 notes。

## 代码结构约定

- `src/main.ts` 应尽量聚焦插件生命周期、视图注册、命令注册和设置入口。
- 当前功能已经集中在 `src/main.ts`；新增较大逻辑时优先拆出模块，例如：
  - `src/settings.ts`：设置类型、默认值、加载与保存。
  - `src/views/`：右侧预览视图和 UI 交互。
  - `src/platforms/`：微信公众号、知识星球等平台复制 profile。
  - `src/rendering/`：Markdown 渲染、DOM 清理、内联样式、图片嵌入。
  - `src/clipboard/`：HTML / Markdown / plain text 剪贴板写入。
- 不为了“重构好看”大拆文件；只有在新增功能会继续扩大单文件复杂度时再拆。
- 用户可见命令使用 `this.addCommand(...)`，命令 ID 发布后避免改名。
- 有设置项时提供默认值、向后兼容读取和必要校验，使用 `this.loadData()` / `this.saveData()` 持久化。

## 生命周期与资源清理

- 所有需要卸载清理的事件、DOM 监听、interval、Obsidian workspace 监听，都使用 `this.registerEvent(...)`、`this.registerDomEvent(...)`、`this.registerInterval(...)` 或对应的 Obsidian 注册 API。
- 视图使用 `this.registerView(...)` 注册，关闭和重新打开时要保证幂等，不要重复创建不可清理的状态。
- `onload()` 保持轻量；重型渲染、vault 扫描、图片读取、剪贴板处理应延迟到用户打开视图或点击复制时执行。

## Vault、安全与隐私

- 默认本地、离线处理。除非功能明确需要并得到用户知情，否则不要新增网络请求。
- 不上传、不记录、不遥测用户 vault 内容、文件名、图片或剪贴板内容。
- 访问文件优先使用 Obsidian 的 `app.vault`、`metadataCache`、`TFile` 等 API，不直接绕过 vault 边界读取用户磁盘。
- 当前插件核心是“预览并复制”，不要在未明确要求的情况下修改用户笔记内容。
- 密钥、token、账号信息不得写入代码、日志或示例配置。

## 移动端兼容

- 当前 `manifest.json` 中 `isDesktopOnly` 为 `false`，因此默认按桌面和移动端都可能运行来设计。
- 不要随意引入 Electron、Node 文件系统、系统剪贴板等桌面专用 API。
- 如果功能必须依赖桌面能力，要同步调整 `isDesktopOnly`，并说明移动端用户将无法使用该插件。

## 复制与平台 profile 规则

- 复制流程应先使用 Obsidian 的 Markdown 渲染能力生成 DOM，再做目标平台适配；不要自行写一套不完整 Markdown parser。
- 平台差异放在独立 profile 中维护，包括 `label`、`copyLabel`、`wrapperStyle`、样式规则、DOM 清理和必要 transform。
- 新增平台时至少手动验证目标编辑器的粘贴效果，重点看标题、列表、表格、代码块、callout、图片和空行。
- 本地图片嵌入应尊重设置项；默认不要把远程上传服务作为隐式依赖。
- CSS 尽量作用于插件自己的视图 class，避免污染整个 Obsidian 界面。

## 验证要求

- 代码改动后优先运行 `npm run build`。
- 只改文档时可以不跑构建，但最终说明未跑构建的原因。
- 涉及 Obsidian 实际行为的改动，除构建外还应说明需要在开发 vault 中手动重载插件验证。

## 参考资料

- Obsidian sample plugin: https://github.com/obsidianmd/obsidian-sample-plugin
- Build a plugin: https://docs.obsidian.md/Plugins/Getting%20started/Build%20a%20plugin
