# Multi-Platform Support Plan

更新日期：2026-07-30

## 目标

把当前插件从“面向少数平台的富文本复制工具”升级为“Obsidian 到多个内容平台的发布准备工作台”。

短期目标不是承诺所有平台一键自动发布，而是先让用户可以稳定完成：

- 选择目标平台。
- 预览该平台的复制效果。
- 一键复制适配后的内容。
- 一键打开目标平台编辑器。
- 明确看到图片、封面、链接、代码块等内容是否需要手动处理。

中长期路线采用分层发布架构：微信走官方草稿箱 API，飞书走开放平台 API，其他内容平台走浏览器插件。这样做的原因是：微信公众号和飞书有相对明确的官方接口，适合在 Obsidian 插件内实现；知乎、CSDN、掘金、小红书、Bilibili、X/Twitter、Substack 等平台的登录态、编辑器和图片上传机制差异很大，浏览器插件更适合复用用户已有登录态并承接页面自动化。

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
4. 微信草稿箱走官方 API，不依赖浏览器登录态。
5. 飞书云文档走开放平台 API，不伪装成内容平台草稿箱。
6. 其他平台草稿箱写入走浏览器插件，Obsidian 插件只负责内容准备、平台选择和任务投递。
7. 浏览器插件只保存草稿，不自动最终发布。
8. 所有平台适配先能手动验证粘贴结果，再考虑自动化。
9. 新增平台不应该修改用户源 Markdown。
10. 平台不支持的能力要可见，例如图片需手动上传、封面不支持、标签需手动填写。

## 后续发布路线

| 链路 | 覆盖平台 | 实现载体 | 目标能力 | 阶段 |
| --- | --- | --- | --- | --- |
| 微信官方 API | 微信公众号 | Obsidian 插件内置 API 客户端 | 创建草稿、更新草稿、上传封面、上传正文图片、保存草稿关联 | 阶段 3 |
| 飞书开放平台 API | 飞书云文档 | Obsidian 插件内置 API 客户端 | 创建 docx 云文档、覆盖更新、上传图片、保存文档绑定 | 阶段 4 |
| 浏览器插件 | 知乎、CSDN、掘金、小红书、Bilibili、X/Twitter、Substack 等 | Obsidian 插件 + 本地 bridge + 浏览器扩展 | 使用浏览器登录态保存平台草稿，回传草稿链接、失败原因和重试入口 | 阶段 5-6 |

阶段之间的依赖关系：

1. 阶段 1-2 先把复制 profile、输出格式和资源包打稳，给 API 和浏览器插件复用同一份内容产物。
2. 阶段 3 先做微信，因为它和当前 rich HTML 预览、封面、正文图片关系最强，用户收益最大。
3. 阶段 4 做飞书，因为它是独立的开放平台文档同步链路，不应该被混进“草稿箱”语义。
4. 阶段 5 先做浏览器插件协议和一个平台 MVP，证明 Obsidian 到浏览器的任务投递、登录态检测、草稿结果回传可用。
5. 阶段 6 再扩展多平台适配器，避免一开始同时维护多个不稳定页面流程。

## 目标平台分层

| 平台 | 第一阶段能力 | 推荐输出 | 编辑器入口 | 草稿箱策略 | 主要风险 |
| --- | --- | --- | --- | --- | --- |
| 微信公众号 | 复制 + 打开后台，后续创建/更新草稿 | rich HTML | `https://mp.weixin.qq.com/` | 官方 API 草稿箱，阶段 3 实现 | AppID/AppSecret、IP 白名单、素材上传、重复草稿 |
| 飞书云文档 | 后续同步到目标文件夹 | Markdown/docx block payload | 飞书文档 URL | 开放平台 API，阶段 4 实现 | 权限申请、图片上传、覆盖更新一致性 |
| 知乎 | 复制 + 打开编辑器，后续浏览器插件保存草稿 | rich HTML | `https://www.zhihu.com` | 浏览器插件，阶段 5-6 实现 | 图片和标题/正文拆分需验证 |
| CSDN | 复制 + 打开 Markdown 编辑器，后续浏览器插件保存草稿 | Markdown 优先，HTML 备选 | `https://editor.csdn.net/md/` | 浏览器插件，阶段 5-6 实现 | Markdown 方言和图片处理 |
| 掘金 | 复制 + 打开编辑器，后续浏览器插件保存草稿 | Markdown 优先 | `https://juejin.cn` | 浏览器插件，阶段 5-6 实现 | 分类、标签、封面需自动化 |
| Substack | 复制 + 打开写作入口，后续评估浏览器插件或官方 API | rich HTML | `https://substack.com/home` | 阶段 6 再定 | 账号工作区差异 |
| X/Twitter | 复制短文本/线程草稿，后续浏览器插件保存草稿 | plain text / thread text | `https://x.com/compose/post` | 浏览器插件，阶段 6 再定 | 长文、图片、链接预览限制 |
| 小红书图文 | 复制标题/正文 + 打开发布页，后续浏览器插件保存草稿 | plain text + image checklist | `https://creator.xiaohongshu.com/publish/publish?from=menu&target=article` | 浏览器插件，阶段 5-6 实现 | 图文平台更依赖图片上传 |
| Bilibili 图文 | 复制标题/正文 + 打开专栏入口，后续浏览器插件保存草稿 | rich HTML / Markdown 待验证 | `https://member.bilibili.com/platform/upload/text` | 浏览器插件，阶段 6 实现 | 编辑器粘贴清洗和图片上传 |

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

## 阶段 3：微信官方 API 草稿箱

目标：先把微信公众号从“复制 + 打开后台”升级为“创建/更新微信草稿箱”，并保留复制 fallback。

### 任务 3.1：建立微信账号与安全边界

需要设计：

- 多账号设置。
- AppID/AppSecret 保存。
- access token 生命周期。
- API 代理配置，解决 IP 白名单和跨域限制。
- 凭据不进入日志、示例和导出 payload。
- 没有账号配置时不影响复制能力。

验收标准：

- 设置页能添加、编辑、删除微信公众号账号。
- 账号配置缺失时，微信草稿按钮显示可理解的配置入口。
- 所有 API 错误面向用户转成可执行提示。

### 任务 3.2：实现微信素材与正文图片上传

需要设计：

- 封面图上传为永久素材，获得 `thumb_media_id`。
- 正文图片上传到微信图文图片接口，并替换正文 HTML 的 `img src`。
- 封面素材缓存，避免同一封面重复上传。
- 图片上传失败时用占位提示保留草稿创建能力。
- Mermaid、SVG、数学公式等需要先转成微信可接收图片或安全 HTML。

验收标准：

- 本地图片不会以 Obsidian 本地路径或 `data:` 直接进入微信草稿。
- 正文中残留不支持资源时阻止创建草稿，并提示具体原因。
- 图片失败不导致整篇文章不可恢复，用户能在微信后台手动补传。

### 任务 3.3：实现微信创建/更新草稿

需要设计：

- 创建草稿调用微信新增草稿接口。
- 更新草稿调用微信更新草稿接口。
- 创建草稿和更新草稿分离。
- 创建草稿不自动重试，避免请求成功但响应丢失时产生重复草稿。
- 创建成功后记录当前笔记、公众号账号和草稿 ID 的关联。
- 再次同步同一笔记时默认更新已有草稿。
- 提供“取消关联并新建草稿”的恢复入口。

验收标准：

- 创建草稿成功后，微信公众号后台能看到草稿。
- 再次同步默认更新同一个草稿，不堆出重复草稿。
- 微信后台草稿被删除或 media_id 失效时，用户可以取消关联后新建。
- 失败时保留可手动复制 fallback。

## 阶段 4：飞书开放平台 API 同步

目标：把当前文章同步为飞书 docx 云文档，并支持后续覆盖更新。飞书链路命名为“同步到飞书云文档”，不叫“飞书草稿箱”。

### 任务 4.1：建立飞书应用配置

需要设计：

- 飞书自建应用 App ID / App Secret。
- 目标文件夹 token。
- 可选 user ID 或所有者策略。
- API 调用次数统计。
- 权限不足时的用户提示。

验收标准：

- 没有飞书配置时不影响复制、微信草稿和其他平台能力。
- 设置页能验证基本配置是否齐全。
- 权限错误能明确提示需要补哪些开放平台权限。

### 任务 4.2：实现首次创建飞书文档

需要设计：

- Markdown/frontmatter 标题解析。
- 本地图片上传或转换为飞书可用资源。
- Mermaid、数学公式、Callout、任务列表的飞书处理策略。
- 创建到目标文件夹，并保存当前笔记和飞书 doc token 的绑定关系。

验收标准：

- 首次同步后在目标文件夹生成 docx 云文档。
- 返回飞书文档链接。
- 图片、列表、代码块和基础排版可用。

### 任务 4.3：实现覆盖更新与重绑

需要设计：

- 同一篇笔记再次同步时优先更新已绑定文档。
- 旧文档 token 失效时，可以在目标文件夹按标题检索恢复绑定。
- 用户可以手动粘贴飞书 docx 链接重新绑定。
- 更新时先写入新内容，再清理旧内容，降低失败时清空文档的风险。

验收标准：

- 再次同步尽量保持原飞书链接不变。
- 更新失败时旧文档内容不被静默清空。
- 用户能理解当前是“创建新文档”“更新已有文档”还是“需要重绑”。

## 阶段 5：浏览器插件与本地 Bridge MVP

目标：建立 Obsidian 插件和浏览器插件之间的最小可用通信协议，先跑通一个其他平台草稿箱保存闭环。

### 任务 5.1：定义 Bridge 协议

建议方法：

- `health`
- `listSupportedPlatforms`
- `checkAuth`
- `enqueueSyncArticle`
- `getSyncTask`
- `getSyncTaskLink`
- `openSyncTask`

验收标准：

- 本地 bridge 只监听本机，默认不允许远程访问。
- Obsidian 和浏览器插件通过用户可见 token 配对。
- token mismatch、扩展未连接、平台未登录都有明确状态。
- 协议 payload 不夹带平台 Cookie。

### 任务 5.2：定义文章任务 payload

建议 payload：

- `platforms[]`
- `title`
- `markdown`
- `content`，用于 HTML 或平台适配后的正文。
- `cover`
- `assets[]`，携带本地图片文件名、MIME、大小和 base64。
- `source: "obsidian"`

验收标准：

- Obsidian 侧不把本地图片直接塞成内联超大 base64 HTML。
- 浏览器插件可以根据 `assets[]` 做上传、重试和历史记录脱敏。
- 任务可以异步完成，Obsidian 不长时间阻塞等待所有平台。

### 任务 5.3：实现一个平台 MVP

候选顺序：

1. CSDN：Markdown 编辑器相对直接。
2. 掘金：Markdown 长文适配价值高。
3. 知乎：用户价值高，但标题/正文/图片拆分更复杂。

验收标准：

- 浏览器插件能检测目标平台登录态。
- 能创建或保存草稿。
- 能回传草稿链接或可打开的任务页。
- 失败后能看到失败原因，并可以单平台重试。

## 阶段 6：浏览器插件多平台适配扩展

目标：在 MVP 验证后，再逐步扩展其他平台适配器，不一次性承诺所有平台稳定可用。

### 任务 6.1：扩展首批长文平台

优先顺序：

1. CSDN
2. 掘金
3. 知乎
4. Bilibili 图文

验收标准：

- 每个平台都记录标题、正文、图片、封面、标签、分类的支持状态。
- 每个平台都保留“复制 + 打开编辑器”fallback。
- 页面 DOM 改版导致失败时，不影响其他平台任务。

### 任务 6.2：扩展图文和短内容平台

候选平台：

- 小红书图文。
- X/Twitter 长文或线程。
- Substack。

验收标准：

- 小红书明确图片上传和正文格式限制。
- X/Twitter 明确字数、线程拆分和媒体限制。
- Substack 明确 workspace、newsletter 和编辑器入口差异。

### 任务 6.3：任务中心和版本兼容

需要设计：

- 浏览器插件任务历史。
- 草稿链接、失败原因和重试入口。
- Obsidian 插件与浏览器插件版本兼容检查。
- 免费/Pro 或额度策略如果存在，必须在 UI 中明确展示。

验收标准：

- Obsidian 侧能看到任务已投递，不假装全部平台已完成。
- 浏览器插件侧能查看每个平台的最终状态。
- 旧版扩展不支持新协议时，给出升级提示。

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

### Milestone E：微信官方 API 草稿箱

- [ ] 新增微信账号设置。
- [ ] 实现 access token 获取与缓存。
- [ ] 实现封面上传和正文图片上传。
- [ ] 实现微信 HTML 草稿前清洗与阻断检查。
- [ ] 实现创建草稿。
- [ ] 实现草稿关联缓存。
- [ ] 实现更新已有草稿。
- [ ] 失败时保留复制 fallback。
- [ ] 补微信 API、图片处理、草稿关联测试。
- [ ] 跑 `npm test`。
- [ ] 跑 `npm run build`。

### Milestone F：飞书开放平台 API 同步

- [ ] 新增飞书设置。
- [ ] 实现飞书 tenant access token 获取与缓存。
- [ ] 实现目标文件夹创建 docx 云文档。
- [ ] 实现本地图片上传或替换策略。
- [ ] 保存当前笔记和飞书 doc token 的绑定。
- [ ] 实现覆盖更新已有飞书文档。
- [ ] 实现文档重绑恢复入口。
- [ ] 补飞书 API payload、绑定、覆盖更新测试。
- [ ] 跑 `npm test`。
- [ ] 跑 `npm run build`。

### Milestone G：浏览器插件与 Bridge MVP

- [ ] 新建浏览器插件项目或工作区目录。
- [ ] 定义 Obsidian bridge token、端口和配对流程。
- [ ] 实现 `health`、`listSupportedPlatforms`、`checkAuth`。
- [ ] 实现 `enqueueSyncArticle`。
- [ ] Obsidian 侧发送 `title`、`markdown`、`content`、`cover`、`assets[]`。
- [ ] 浏览器插件侧实现一个平台 MVP。
- [ ] 回传任务 ID、草稿链接、失败原因。
- [ ] 支持单平台重试。
- [ ] 明确浏览器插件不接收、不上传平台 Cookie。

### Milestone H：浏览器插件多平台扩展

- [ ] 扩展 CSDN、掘金、知乎长文适配。
- [ ] 扩展小红书图文、Bilibili 图文。
- [ ] 评估 Substack、X/Twitter 的适配方式。
- [ ] 为每个平台记录登录态检测、草稿创建、图片上传、封面、标签、分类支持状态。
- [ ] 增加任务中心。
- [ ] 增加 Obsidian 插件和浏览器插件版本兼容提示。
- [ ] 每个平台都保留“复制 + 打开编辑器”fallback。

## 手动验证清单

固定测试笔记：

- `docs/test-publishing.md`
- `docs/assets/local-paste-test.svg`

建议把这两个文件复制到单独的开发 vault 中验证，不要在主力 vault 里测试插件。每个平台至少用同一篇测试笔记验证：

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

记录规则：

- 第一轮做完整基线，覆盖表格中所有适用项。
- 后续只在复制、资源包、图片上传、平台 profile 或浏览器插件适配变更时做相关回归。
- 图片列需要分别记录本地图片、Obsidian WikiLink 图片和远程 URL 图片的表现。
- 对不适用的平台写“不适用”，不要为了填表强行测试。

| 平台 | 标题 | 列表 | 表格 | 代码块 | 图片 | 链接 | Callout | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 微信公众号 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 |
| 飞书云文档 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 |
| 知乎 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 |
| CSDN | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 |
| 掘金 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 |
| Substack | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 |
| X/Twitter | 待测 | 待测 | 不适用 | 不适用 | 待测 | 待测 | 不适用 | 待测 |
| 小红书图文 | 待测 | 待测 | 不适用 | 不适用 | 待测 | 待测 | 不适用 | 待测 |
| Bilibili 图文 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 |

## 不做事项

- 不在第一阶段做浏览器插件。
- 不在 Obsidian 插件中接管任何平台 Cookie。
- 不承诺自动最终发布。
- 不为了新增平台改插件 ID。
- 不把用户笔记内容上传到未明确配置的第三方服务做转换。
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

- 微信公众号可以创建新草稿。
- 同一篇笔记再次同步时可以更新已关联草稿。
- 封面和正文图片走微信可接收的上传链路。
- 微信失败时保留复制 fallback。

第四阶段完成的定义：

- 飞书云文档可以首次创建。
- 同一篇笔记再次同步时可以覆盖更新已有飞书文档。
- 飞书文档绑定丢失时有恢复或重绑入口。
- 飞书失败不影响微信、复制和其他平台入口。

第五阶段完成的定义：

- Obsidian 插件和浏览器插件可以完成本机配对。
- Obsidian 可以把文章任务投递给浏览器插件。
- 至少一个其他平台能通过浏览器插件保存草稿。
- 浏览器插件能回传任务状态、草稿链接或失败原因。

第六阶段完成的定义：

- CSDN、掘金、知乎至少完成浏览器插件草稿保存适配。
- 小红书和 Bilibili 图文完成可用性验证或明确延后原因。
- 每个平台都有独立失败状态和 fallback。
- Obsidian 侧不把“已投递到浏览器插件”误写成“所有平台已创建草稿”。
