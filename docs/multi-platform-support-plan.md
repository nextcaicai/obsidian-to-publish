# Multi-Platform Support Plan

更新日期：2026-07-24

## 目标

把当前插件从“面向少数平台的富文本复制工具”升级为“Obsidian 到多个内容平台的发布准备工作台”。

短期目标不是承诺所有平台一键自动发布，而是先让用户可以稳定完成：

- 选择目标平台。
- 预览该平台的复制效果。
- 一键复制适配后的内容。
- 一键打开目标平台编辑器。
- 明确看到图片、封面、链接、代码块等内容是否需要手动处理。

中长期只在平台有稳定官方能力时，再做 API 草稿箱或自动投递。这样做的原因是：知乎、CSDN、掘金、小红书、Bilibili、X/Twitter、Substack 的登录态、编辑器和图片上传机制差异很大，如果一开始就承诺全自动草稿箱，会把不稳定性转嫁给用户。

## 当前基线

当前项目已经具备以下基础：

- 插件入口集中在 `src/main.ts`。
- 预览使用 Obsidian `MarkdownRenderer`。
- 平台差异通过 `PlatformProfile`、`PLATFORM_PROFILES`、`applyPlatformProfile()` 管理。
- 已支持 `wechat` 和 `zhishixingqiu` 两个平台。
- 本地图片可以在复制时转成 data URI。
- 已有 Vitest 基线，`src/rendering/image-links.ts` 负责纯图片链接解析。

当前主要限制：

- `CopyPlatform` 是固定 union，继续加平台会让 `src/main.ts` 继续膨胀。
- 平台 profile 只描述样式，不描述平台能力，例如是否支持封面、标签、Markdown、HTML、长文、图片上传。
- 图片处理直接服务于剪贴板复制，没有形成可复用的 `assets[]` 内容包。
- 预览输出、剪贴板输出、未来发布 payload 没有明确分层。

## 产品原则

1. 先复制增强，再做自动草稿箱。
2. 对用户明确区分“已复制”“已打开编辑器”“已创建草稿”“已发布”。
3. 不在 Obsidian 插件中托管第三方平台 Cookie。
4. 没有稳定官方 API 的平台，默认提供“复制 + 打开编辑器”。
5. 所有平台适配先能手动验证粘贴结果，再考虑自动化。
6. 新增平台不应该修改用户源 Markdown。
7. 平台不支持的能力要可见，例如图片需手动上传、封面不支持、标签需手动填写。

## 目标平台分层

| 平台 | 第一阶段能力 | 推荐输出 | 编辑器入口 | 草稿箱策略 | 主要风险 |
| --- | --- | --- | --- | --- | --- |
| 知乎 | 复制 + 打开编辑器 | rich HTML | `https://www.zhihu.com` | 暂不承诺自动草稿 | 图片和标题/正文拆分需验证 |
| CSDN | 复制 + 打开 Markdown 编辑器 | Markdown 优先，HTML 备选 | `https://editor.csdn.net/md/` | 暂不承诺自动草稿 | Markdown 方言和图片处理 |
| 掘金 | 复制 + 打开编辑器 | Markdown 优先 | `https://juejin.cn` | 暂不承诺自动草稿 | 分类、标签、封面需手动 |
| Substack | 复制 + 打开写作入口 | rich HTML | `https://substack.com/home` | 评估官方 API 后再定 | 账号工作区差异 |
| X/Twitter | 复制短文本/线程草稿 | plain text / thread text | `https://x.com/compose/post` | 暂不承诺自动草稿 | 长文、图片、链接预览限制 |
| 小红书图文 | 复制标题/正文 + 打开发布页 | plain text + image checklist | `https://creator.xiaohongshu.com/publish/publish?from=menu&target=article` | 暂不承诺自动草稿 | 图文平台更依赖图片上传 |
| Bilibili 图文 | 复制标题/正文 + 打开专栏入口 | rich HTML / Markdown 待验证 | `https://member.bilibili.com/platform/upload/text` | 暂不承诺自动草稿 | 编辑器粘贴清洗和图片上传 |

## 阶段 1：多平台复制增强

目标：让用户可以在当前插件里选择更多平台，并得到可预期的复制结果。

### 任务 1.1：抽出平台模型

建议新增：

- `src/platforms/types.ts`
- `src/platforms/profiles.ts`

建议类型：

```ts
export type PlatformOutputFormat = "rich-html" | "markdown" | "plain-text";

export interface PlatformCapability {
	supportsRichHtml: boolean;
	supportsMarkdown: boolean;
	supportsImages: boolean;
	supportsCover: boolean;
	supportsTags: boolean;
	supportsDraftApi: boolean;
	requiresManualImageUpload: boolean;
}

export interface PlatformProfile {
	id: string;
	label: string;
	copyLabel: string;
	editorUrl: string;
	preferredFormat: PlatformOutputFormat;
	capabilities: PlatformCapability;
	wrapperStyle?: string;
	rules?: PlatformStyleRule[];
	transform?: (root: HTMLElement) => void;
}
```

验收标准：

- `wechat` 和 `zhishixingqiu` 行为不变。
- 新平台可以只新增 profile，不需要改复制主流程。
- `npm run build` 通过。
- `npm test` 通过。

### 任务 1.2：新增首批平台 profile

优先顺序：

1. `zhihu`
2. `csdn`
3. `juejin`
4. `substack`
5. `x`
6. `xiaohongshu`
7. `bilibili`

为什么先做知乎、CSDN、掘金：

- 它们更接近长文编辑器。
- 可以复用当前 Markdown/HTML 复制管线。
- 能最快暴露标题、代码块、表格、图片、链接等通用问题。

验收标准：

- 设置页可以选择这些平台。
- 命令面板至少有一个“复制当前目标平台”通用命令。
- 不为每个平台新增一堆重复命令，避免命令面板膨胀。
- 每个平台 profile 明确 `preferredFormat` 和 `editorUrl`。

### 任务 1.3：新增“复制并打开编辑器”

建议新增命令：

- `copy-current-note-and-open-editor`

行为：

1. 按当前目标平台生成内容。
2. 写入剪贴板。
3. 打开目标平台 `editorUrl`。
4. Notice 告诉用户复制结果和下一步。

用户影响：

- 用户不需要自己找平台入口。
- 但仍由用户确认粘贴和最终发布，避免误发。

验收标准：

- URL 只允许 `https://`。
- 没有 `editorUrl` 的平台隐藏或禁用该动作。
- 打开失败时不影响复制成功结果。

## 阶段 2：内容包与资源管线

目标：让 Markdown、HTML、图片、封面和警告形成统一中间产物，避免每个平台重复解析。

### 任务 2.1：抽出文章资源解析

建议新增：

- `src/rendering/article-assets.ts`
- `tests/article-assets.test.ts`

建议输出：

```ts
export interface ArticleAsset {
	id: string;
	filename: string;
	mimeType: string;
	size: number;
	dataUri?: string;
	source: {
		originalSrc: string;
		vaultRelativePath?: string;
		resourceSrc?: string;
	};
}

export interface ArticleAssetResult {
	markdown: string;
	assets: ArticleAsset[];
	warnings: ArticleAssetWarning[];
	firstImageSrc: string;
}
```

必须覆盖：

- `![](path.png)`
- `![[path.png]]`
- `![[path.png|alt]]`
- `![[path.png|640]]`
- 相对路径图片。
- Obsidian `app://` 渲染图片。
- 代码块和 inline code 中的假图片不应被解析。
- 找不到图片时返回 warning，不静默失败。

验收标准：

- 当前复制本地图片能力不退化。
- 图片解析逻辑有单元测试。
- 不绕过 vault 边界读取任意磁盘文件。

### 任务 2.2：拆分输出格式

建议新增：

- `src/rendering/export-payload.ts`

建议输出：

```ts
export interface ExportPayload {
	format: "rich-html" | "markdown" | "plain-text";
	html?: string;
	markdown?: string;
	text: string;
	assets: ArticleAsset[];
	warnings: ExportWarning[];
}
```

平台映射：

- `rich-html`：微信公众号、知乎、Substack、Bilibili 待验证。
- `markdown`：CSDN、掘金。
- `plain-text`：X/Twitter、小红书正文辅助。

验收标准：

- 复制流程根据 `preferredFormat` 选择 payload。
- 微信和知识星球原有 rich HTML 复制不退化。
- Markdown 输出不包含 Obsidian 私有 DOM。

### 任务 2.3：增加平台限制提示

在预览或复制 Notice 中提示：

- 图片未嵌入。
- 当前平台需要手动上传图片。
- 当前平台不支持封面自动设置。
- 当前平台可能清洗表格或代码块样式。

验收标准：

- 警告信息面向用户，不暴露内部函数名。
- 同一篇文章的 warning 可以汇总，不刷屏。

## 阶段 3：官方 API 草稿箱评估

目标：只对稳定、可维护、用户可理解的平台做草稿箱。

### 任务 3.1：建立 API 可行性表

建议新增文档：

- `docs/platform-api-research.md`

每个平台记录：

- 是否有官方创建草稿 API。
- 是否支持图片上传。
- 是否需要企业/开发者认证。
- 是否支持更新已有草稿。
- 是否有频率限制。
- 凭据如何保存。
- 失败后用户如何恢复。

验收标准：

- 没有调研结论的平台不得在 UI 中承诺“一键草稿箱”。
- 对所有 API 平台明确数据安全边界。

### 任务 3.2：优先评估微信官方 API

原因：

- 微信草稿箱有相对明确的官方 API。
- 与当前 `wechat` profile 关系最强。
- 用户收益明确：减少复制、上传封面和正文图片的重复操作。

需要设计：

- 多账号设置。
- AppID/AppSecret 保存。
- access token 生命周期。
- 图片上传和素材缓存。
- 创建草稿和更新草稿分离。
- 创建草稿不自动重试，避免重复草稿。
- 失败时保留可手动复制 fallback。

验收标准：

- 没有账号配置时不影响复制能力。
- 创建草稿成功后记录当前笔记和草稿 ID 的关联。
- 再次同步默认更新已有草稿。
- 非幂等创建操作不做自动网络重试。

### 任务 3.3：其他平台默认不做 API 草稿箱

默认策略：

- 知乎：复制 + 打开编辑器。
- CSDN：复制 Markdown + 打开编辑器。
- 掘金：复制 Markdown + 打开编辑器。
- 小红书：复制标题/正文 + 图片 checklist。
- Bilibili：复制正文 + 打开专栏入口。
- Substack：先复制 + 打开入口，后续再评估官方能力。
- X/Twitter：复制 plain text 或 thread text，不做自动发帖。

## 阶段 4：浏览器助手的决策点

只有当以下条件都满足时，再考虑浏览器插件或本地 bridge：

- 用户明确需要把多个平台保存到草稿箱。
- 单纯“复制 + 打开编辑器”已经被验证不够用。
- 至少 3 个目标平台没有稳定官方 API，但有稳定浏览器编辑器流程。
- 可以接受额外安装浏览器扩展。
- 能维护连接、配对、token、任务状态、失败恢复和版本兼容。

当前不建议立刻做。

原因：

- 它会把插件从轻量 Obsidian 插件变成 Obsidian 插件 + 浏览器扩展 + 本地通信协议。
- 用户安装和排障成本明显上升。
- 每个平台 DOM 改版都会影响自动填充稳定性。

## 推荐实现顺序

### Milestone A：平台模型和首批 profile

- [x] 新增 `src/platforms/types.ts`。
- [x] 新增 `src/platforms/profiles.ts`。
- [x] 把现有 `wechat`、`zhishixingqiu` profile 移出 `src/main.ts`。
- [x] 新增 `zhihu`、`csdn`、`juejin` profile。
- [x] 设置页支持更多平台选择。
- [x] 保持原有复制命令可用。
- [x] 跑 `npm test`。
- [x] 跑 `npm run build`。

### Milestone B：复制并打开编辑器

- [x] 新增通用命令 `copy-current-note-and-open-editor`。
- [x] 为每个平台配置 `editorUrl`。
- [x] 新增安全 URL 打开 helper。
- [x] 打开失败时显示可理解 Notice。
- [ ] 手动验证知乎、CSDN、掘金粘贴效果。

### Milestone C：文章资源包

- [ ] 新增 `src/rendering/article-assets.ts`。
- [ ] 支持 Markdown 图片、WikiLink 图片、尺寸 hint。
- [ ] 返回 `assets[]` 和 `warnings[]`。
- [ ] 当前 data URI 复制改为消费 `assets[]`。
- [ ] 补 `tests/article-assets.test.ts`。
- [ ] 跑 `npm test`。
- [ ] 跑 `npm run build`。

### Milestone D：输出格式分层

- [ ] 新增 `src/rendering/export-payload.ts`。
- [x] 支持 `rich-html`、`markdown`、`plain-text`。
- [x] CSDN/掘金默认复制 Markdown。
- [x] X/Twitter 默认复制 plain text。
- [ ] 小红书默认复制标题/正文，并提示图片需要手动上传。
- [ ] 手动验证各平台粘贴效果。

当前说明：

- `rich-html`、`markdown`、`plain-text` 已先接入现有剪贴板流程，尚未独立成 `src/rendering/export-payload.ts`。
- 小红书当前复制纯文本正文，并通过通用图片提示提醒手动上传；标题/正文拆分留到资源包和导出 payload 阶段处理。
- 知乎、掘金这类平台可以识别线上图片 URL，但无法稳定识别 Obsidian 本地图片、`data:` 图片或剪贴板图片 Blob；本地图片需要先上传成线上 URL 后再复制。
- 真实平台粘贴验证仍需在开发 vault 中手动完成，尤其是知乎、CSDN、掘金的标题、代码块、表格和图片表现。

### Milestone E：API 草稿箱调研

- [ ] 新增 `docs/platform-api-research.md`。
- [ ] 先调研微信、Substack、X/Twitter。
- [ ] 对知乎、CSDN、掘金、小红书、Bilibili 明确是否有稳定公开写入能力。
- [ ] 没有调研完成前，不在 UI 文案里写“一键发布”或“一键草稿箱”。

## 手动验证清单

每个平台至少用同一篇测试笔记验证：

- 一级、二级、三级标题。
- 段落和空行。
- 有序列表和无序列表。
- 任务列表。
- 引用块。
- 表格。
- 行内代码和代码块。
- 内部链接。
- 外部链接。
- 本地图片。
- 远程图片。
- Callout。

记录结果：

| 平台 | 标题 | 列表 | 表格 | 代码块 | 图片 | 链接 | Callout | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 知乎 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 |
| CSDN | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 |
| 掘金 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 |
| Substack | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 |
| X/Twitter | 待测 | 待测 | 不适用 | 不适用 | 待测 | 待测 | 不适用 | 待测 |
| 小红书图文 | 待测 | 待测 | 不适用 | 不适用 | 待测 | 待测 | 不适用 | 待测 |
| Bilibili 图文 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 |

## 不做事项

- 不在第一阶段做浏览器插件。
- 不在第一阶段接管任何平台 Cookie。
- 不承诺自动最终发布。
- 不为了新增平台改插件 ID。
- 不把用户笔记内容上传到第三方服务做转换。
- 不为了样式统一重写整个 `src/main.ts`，只在新增能力触发复杂度时逐步拆模块。

## 完成定义

第一阶段完成的定义：

- 用户可以选择至少 5 个目标平台。
- 每个平台有明确输出格式和编辑器入口。
- 微信和知识星球原有复制体验不退化。
- 知乎、CSDN、掘金至少完成一轮真实粘贴验证。
- 图片无法自动处理时，用户能看到明确提示。
- `npm test` 和 `npm run build` 通过。

第二阶段完成的定义：

- 图片、封面和 Markdown 引用解析从 `src/main.ts` 中抽离。
- 资源处理有单元测试。
- 后续新增平台不需要重新写图片解析逻辑。

第三阶段完成的定义：

- 每个平台的 API 能力有文档证据。
- 只对有稳定官方 API 的平台进入实现。
- 所有草稿箱能力都有复制 fallback。
