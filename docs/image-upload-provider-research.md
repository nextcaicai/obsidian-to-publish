# Obsidian 本地图片上传图床后复制的平台适配调研

更新日期：2026-07-25

## 结论

这个方案可行，但不应该做成默认行为。

推荐路线是：先抽象 `uploader provider`，默认保持本地离线；当目标平台需要线上图片 URL 且文章包含本地图片时，再让用户显式选择“上传本地图片后复制”。第一批 provider 可以支持：

- `imgbb`：插件直接调用 ImgBB API，用户自带 API key。
- `picgo-server`：调用用户本机已安装并配置好的 PicGo HTTP server。
- `none`：默认，不上传，只提示哪些图片需要先变成线上 URL。

不建议把 PicGo Core 直接打包成插件内置依赖。PicGo 更适合作为外部工具集成，而不是这个 Obsidian Community Plugin 的默认运行时依赖。

对用户的影响：这样可以解决知乎、掘金等平台不识别本地图片的问题，同时避免插件在用户不知情时把 vault 图片上传到第三方服务。

## 背景

当前已确认：知乎、掘金等平台可以识别有独立 URL 的线上图片，但不识别 Obsidian 本地图片或 `data:` 图片。这类平台的稳定路径不是继续增强剪贴板图片 Blob，而是在复制前把本地图片变成远程 URL，再输出 rich HTML 或 Markdown。

这个能力涉及用户笔记资产离开本地 vault，和项目约束存在直接关系：

- 本项目是 Obsidian Community Plugin，不是独立 Web 应用。
- 当前项目原则是默认本地、离线处理，不应默认新增网络上传。
- Obsidian 官方隐私说明强调本地数据保存在设备上，不发送到 Obsidian 服务器；Community Plugin 若使用网络，需要清晰披露。
- Obsidian Developer policies 要求 README 明确披露网络使用、账号要求、付费要求、访问 vault 外文件等事项。

来源：

- [Obsidian Privacy Policy](https://obsidian.md/privacy)
- [Obsidian Developer policies](https://obsidian-developer-docs.pages.dev/Developer-policies)
- [Obsidian Manifest reference](https://docs.obsidian.md/Reference/Manifest)
- [Obsidian plugin self-critique checklist](https://docs.obsidian.md/oo/plugin)

## ImgBB 可行性

### 官方 API 能力

ImgBB 官方 API v1 文档说明它允许上传图片。

上传方式：

- API 调用可以用 `POST` 或 `GET`，但官方建议本地文件使用 `POST`，因为 `GET` 会受 URL 长度和编码影响。
- 上传接口示例是 `https://api.imgbb.com/1/upload?expiration=600&key=YOUR_CLIENT_API_KEY`。
- `key` 是必填参数，即 API key。
- `image` 是必填参数，可以是二进制文件、base64 数据或图片 URL，单图最大 32 MB。
- `name` 可选。
- `expiration` 可选，范围是 60 到 15552000 秒。
- 响应是 JSON，包含 `success`、`status`、`data.url`、`display_url`、`url_viewer`、`delete_url` 等字段。

来源：

- [ImgBB API v1](https://api.imgbb.com/)
- [ImgBB API v1 mirror page](https://imgbb.com/api/1)

### 是否有免费 API

只能下谨慎结论：ImgBB 有公开 API 文档，并且 ImgBB 官网称自己是免费图片托管服务；但官网 Pro 方案也把 `API Access` 列为 Pro 权益之一。

因此，产品上不应承诺“ImgBB 免费 API 可无限使用”。更稳妥的表述是：

- 支持用户自带 ImgBB API key。
- 是否免费、配额、可用性以用户账号当前状态和 ImgBB 官方规则为准。
- 不内置项目共享 API key。
- 不把 ImgBB 作为默认上传目标。

来源：

- [ImgBB Upload Image page](https://imgbb.com/?lang=en_gb)
- [ImgBB API v1](https://api.imgbb.com/)

### 主要限制与风险

1. API key 风险

插件需要保存用户的 ImgBB API key。Obsidian 插件设置不是系统级加密存储，所以设置页必须提示这一点。不要把 key 写进源码、测试 fixture、日志或共享文档。

2. 免费/付费边界不清晰

官方 API 文档未在页面中给出免费 API 配额、rate limit 或 SLA。官网又把 API Access 放进 Pro 权益。实现时只能做“用户自带 key 的可选 provider”，不能写成默认免费基础设施。

3. 图片内容离开本地

上传后图片会进入 ImgBB 服务。ImgBB Privacy Notice 说明它会收集账号注册信息，以及 IP、设备、浏览器、日志和使用数据等自动收集信息。用户需要知道图片和相关请求元数据会被第三方处理。

4. 内容合规和用途限制

ImgBB Terms of Service 要求用户对上传内容有必要权利，禁止违法、未授权或不符合服务目的的使用。插件不能替用户判断版权和隐私风险，只能在上传前提示。

5. 删除和长期可用性

API 响应里有 `delete_url`，但这类 URL 本质上是删除凭据。是否存储它需要单独设计：存了可以帮助用户后续删除，不存则更少敏感信息。无论如何都不能承诺图片永久可用。

来源：

- [ImgBB Privacy Notice](https://imgbb.com/privacy)
- [ImgBB Terms of Service](https://imgbb.com/tos)
- [ImgBB API v1](https://api.imgbb.com/)

## PicGo 可行性

### PicGo 是什么

PicGo 官方定位是图片上传工具和工作流。PicGo 支持拖拽、剪贴板、快捷键、CLI、HTTP API 和 Node.js SDK。PicGo Core 是底层上传引擎，具备 CLI、编程 API 和插件系统。

PicGo 支持多种内置图床，也能通过插件扩展更多图床。官方文档列出的内置/常见图床包括 GitHub、SM.MS、Imgur、七牛、腾讯云 COS、又拍云、阿里云 OSS 等；更多选项通过插件扩展。

来源：

- [PicGo official site](https://picgo.app/)
- [PicGo GUI guide](https://docs.picgo.app/gui/guide/)
- [PicGo Core overview](https://docs.picgo.app/core/guide/)

### 外部集成方式

PicGo 很适合作为外部集成。

官方支持的调用方式：

- CLI：例如 macOS 可用 `/Applications/PicGo.app/Contents/MacOS/PicGo upload /img/test.jpg` 上传指定文件。
- HTTP server：默认监听 `127.0.0.1:36677`，可以 `POST /upload`，请求体用 `{ "list": ["/path/to/img.jpg"] }`，响应里返回 URL 列表。
- Node.js API：`new PicGo()` 后调用 `picgo.upload(['/xxx/xxx.jpg'])`。
- PicGo Core 2.0+ 的 local server 支持可选 server secret，认证可用 `Authorization: Bearer <token>` 或 `X-PicGo-Secret`。

对本插件来说，优先级建议是：

1. `picgo-server` provider：用户本机已安装并配置 PicGo，插件只向 `127.0.0.1` 发请求。
2. `picgo-cli` provider：作为桌面端兜底，用户填写 PicGo 可执行文件路径。
3. 暂不内置 PicGo Core。

来源：

- [PicGo official site: Integrate PicGo into your workflow](https://picgo.app/)
- [PicGo advanced usage: CLI and PicGo server](https://picgo.github.io/PicGo-Doc/guide/advance.html)
- [PicGo Core: Using PicGo in Node.js](https://docs.picgo.app/core/guide/use-in-node)

### 为什么不建议把 PicGo Core 作为内置依赖

不建议当前阶段直接把 PicGo Core 打进插件包，原因如下。

1. 环境不匹配

PicGo Core 官方说明：为了支持本地插件系统，PicGo 只在 Node.js 环境可用，包括 Electron main process，不支持 browser environment。Obsidian 插件虽然在桌面端有 Electron 能力，但这个 repo 当前 `manifest.json` 的 `isDesktopOnly` 为 `false`，直接内置 PicGo Core 会把能力推向桌面专用。

2. 移动端约束

Obsidian manifest 文档说明 `isDesktopOnly` 用于声明插件是否使用 NodeJS 或 Electron API。官方移动端 checklist 也提示：当 `isDesktopOnly` 为 `false` 时，不要在顶层使用 `fs`、`path`、`electron` 等 Node/Electron 模块，必要时要用 `Platform.isDesktopApp` 和动态 `require()` 做门禁。

3. 打包复杂度

PicGo 文档明确提到，集成到 Electron 这类打包项目时，可能会因为动态 `require()` 和插件加载遇到打包问题。这个项目使用 esbuild 打包 Obsidian 插件，虽然不是 webpack，但问题类型相同：动态插件系统不适合直接塞进单文件插件 bundle。

4. 插件安装机制不适合内嵌到 Obsidian 插件里

PicGo 的 `pluginHandler` 会通过 npm 安装、更新、卸载 PicGo 插件；`pluginLoader` 支持运行时动态注册插件。这对 PicGo 自己是合理设计，但放进 Obsidian Community Plugin 会扩大供应链和动态代码执行风险。Obsidian 官方也要求关注依赖安全，且插件如有网络、账号、付费或外部访问需要披露。

来源：

- [PicGo Core: Using PicGo in Node.js](https://docs.picgo.app/core/guide/use-in-node)
- [PicGo Core plugin loading and bundling notes](https://docs.picgo.app/core/guide/use-in-node)
- [PicGo Plugin Development](https://docs.picgo.app/core/dev-guide/cli)
- [Obsidian Manifest reference](https://docs.obsidian.md/Reference/Manifest)
- [Obsidian plugin self-critique checklist](https://docs.obsidian.md/oo/plugin)

## 是否应抽象为 uploader provider

应该抽象，而且应该先抽象再实现具体图床。

原因：

- 平台需求不是“所有图片都要上传”，而是“部分平台只接受线上图片 URL”。
- 图床能力差异很大：有的需要 API key，有的依赖本地 PicGo，有的支持批量，有的返回删除 URL，有的需要自定义域名。
- 用户隐私偏好不同：有些人愿意用 ImgBB，有些人只愿意用自己的 OSS/R2/GitHub，有些人只愿意手动上传。
- 未来如果接平台官方素材 API，例如公众号素材库，也可以作为一个 provider，而不是把上传逻辑写死在剪贴板流程里。

建议的模型：

```ts
type ImageUploadProviderId = "none" | "imgbb" | "picgo-server" | "picgo-cli";

interface ImageUploadProvider {
	id: ImageUploadProviderId;
	label: string;
	requiresNetwork: boolean;
	requiresCredential: boolean;
	supportsBatch: boolean;
	upload(asset: ArticleAsset): Promise<UploadedImage>;
}

interface UploadedImage {
	originalSrc: string;
	url: string;
	deleteUrl?: string;
	provider: ImageUploadProviderId;
}
```

平台 profile 可以只表达平台要求，例如：

```ts
interface PlatformCapability {
	requiresRemoteImageUrl: boolean;
	requiresManualImageUpload: boolean;
}
```

复制流程则根据平台和用户设置决定：

1. 平台不需要远程 URL：维持现有富文本/data URI/剪贴板逻辑。
2. 平台需要远程 URL，且文章只有远程图片：原样复制。
3. 平台需要远程 URL，且文章有本地图片，但 provider 是 `none`：提示用户需要先上传。
4. 平台需要远程 URL，且 provider 可用：上传本地图片，替换为远程 URL，再复制。

## 推荐产品路线

### 阶段 1：设计上传能力但默认关闭

新增设置项：

- 本地图片上传：关闭 / 每次询问 / 复制前自动上传。
- 上传 provider：无 / ImgBB / PicGo server / PicGo CLI。
- ImgBB API key：仅当选择 ImgBB 时显示。
- PicGo server 地址：默认 `http://127.0.0.1:36677/upload`。
- PicGo server secret：可选。

用户体验：

- 第一次启用上传时显示明确说明：图片会上传到第三方图床，并生成公网可访问 URL。
- 每次复制前汇总要上传的图片数量和目标 provider。
- 上传失败时不改原文，复制流程降级为警告。

### 阶段 2：先做 ImgBB direct provider

理由：

- API 简单，直接返回 URL。
- 不要求用户安装外部应用。
- 可作为最小可用验证：本地图片能否在知乎/掘金里通过远程 URL 被正确识别。

边界：

- 必须用户自带 API key。
- 设置页明确写“ImgBB 规则、免费/付费、配额以官方账号状态为准”。
- 不承诺免费、永久、稳定。
- 不上传任何图片，除非用户显式开启。

### 阶段 3：再做 PicGo 外部 provider

理由：

- 更适合已经有图床工作流的用户。
- 插件不需要理解每一种对象存储和图床的认证细节。
- 用户可以继续使用 PicGo 的 GitHub、SM.MS、Imgur、OSS、R2、MinIO 等生态。

边界：

- 只在桌面端启用。
- 默认调用本机 `127.0.0.1`。
- 如果用户开启 PicGo server secret，插件需要支持 Bearer token 或 `X-PicGo-Secret`。
- 如果 PicGo 未运行或未配置，给出中文提示，不阻塞其他平台复制。

### 阶段 4：图片映射缓存与删除管理

建议延后。

可以考虑保存 `local asset hash -> remote URL` 映射，避免同一张图重复上传。但这会引入更多隐私和数据管理问题：

- hash 是否会泄露用户图片特征。
- remote URL 是否要持久保存。
- `delete_url` 是否保存，如果保存就相当于保存删除凭据。
- 用户是否需要“清理已上传图片”的界面。

第一版可以先不做持久缓存，只在一次复制任务内复用上传结果。

## 不推荐路线

1. 不要默认自动上传所有本地图片。

这会违背本项目“默认本地、离线处理”的约束，也容易让用户误把私有图片传到公网。

2. 不要内置项目共享 ImgBB API key。

共享 key 会带来配额、滥用、封禁、审计和责任归属问题。

3. 不要把 PicGo Core 直接作为主流程依赖。

它会引入 Node/Electron、动态插件、npm 安装和打包复杂度，和当前 Community Plugin 的移动端兼容目标冲突。

4. 不要把上传后的 URL 写回用户 Markdown，除非用户明确选择“替换源文件图片链接”。

当前插件定位是预览并复制，不应默认修改用户笔记内容。

## 后续实现验收建议

如果进入实现，建议验收标准如下：

- 默认设置下不产生任何网络上传。
- 启用上传前必须有清晰中文说明。
- `requiresRemoteImageUrl` 平台遇到本地图片时，能提示、上传或降级。
- ImgBB provider 使用 `POST`，不使用 `GET` 上传本地文件。
- ImgBB provider 不记录 API key，不在 Notice 或 console 输出 key。
- PicGo provider 只访问 `127.0.0.1` 或用户显式配置的本地地址。
- 上传失败不会修改源 Markdown。
- 测试覆盖：本地图片、远程图片、上传成功、上传失败、未配置 key、平台不需要远程图片 URL。

## 来源列表

- [ImgBB API v1](https://api.imgbb.com/)
- [ImgBB API v1 mirror page](https://imgbb.com/api/1)
- [ImgBB Upload Image page](https://imgbb.com/?lang=en_gb)
- [ImgBB Privacy Notice](https://imgbb.com/privacy)
- [ImgBB Terms of Service](https://imgbb.com/tos)
- [PicGo official site](https://picgo.app/)
- [PicGo GUI guide](https://docs.picgo.app/gui/guide/)
- [PicGo Core overview](https://docs.picgo.app/core/guide/)
- [PicGo Core: Using PicGo in Node.js](https://docs.picgo.app/core/guide/use-in-node)
- [PicGo advanced usage: CLI and PicGo server](https://picgo.github.io/PicGo-Doc/guide/advance.html)
- [PicGo Plugin Development](https://docs.picgo.app/core/dev-guide/cli)
- [Obsidian Privacy Policy](https://obsidian.md/privacy)
- [Obsidian Developer policies](https://obsidian-developer-docs.pages.dev/Developer-policies)
- [Obsidian Manifest reference](https://docs.obsidian.md/Reference/Manifest)
- [Obsidian plugin self-critique checklist](https://docs.obsidian.md/oo/plugin)
