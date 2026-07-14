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
- 发布版本时保持 `package.json`、`manifest.json`、`versions.json` 版本一致。GitHub Release 的 tag 应与 `manifest.json` 的版本号完全一致，不加 `v` 前缀。

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
