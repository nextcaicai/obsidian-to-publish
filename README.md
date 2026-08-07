# Obsidian to Publish

插件 ID：`obsidian-to-publish`  
仓库：https://github.com/nextcaicai/obsidian-to-publish

把 Obsidian 笔记变成可发布内容：右侧预览、按平台适配复制，以及可选的官方 API 草稿 / Chrome companion 导入。

默认本地处理。只有你显式启用并填写凭证的能力才会发起网络请求；插件不会把 vault 内容上传到作者服务器，也没有遥测。

## 功能范围

### 核心（桌面与移动端）

- 右侧栏预览当前 Markdown 笔记，并随编辑同步。
- 用 Obsidian 渲染结果生成平台适配后的剪贴板内容。
- 本地图片可嵌入为 `data:` URL（复制场景），不依赖 Obsidian 内部资源路径。
- 同时写入 HTML / Markdown / 纯文本等回退格式（视目标平台而定）。

### 平台复制 profile

复制流程：Obsidian 渲染 → 平台 profile 清洗/内联样式 → 写入剪贴板。

| 平台 | 说明 |
| --- | --- |
| 微信公众号 | 富文本布局 |
| 知识星球 | 富文本，尽量保留空行 |
| 知乎 | 富文本 |
| CSDN / 掘金 | 偏 Markdown 编辑器 |
| Substack / Bilibili | 富文本 |
| X | Markdown 导出取向 |
| 小红书 | 纯文本取向 |

### 可选：官方 API（需自行配置凭证）

| 能力 | 网络目标 | 需要什么 |
| --- | --- | --- |
| 微信公众号草稿 | `api.weixin.qq.com` | AppID + AppSecret（及开发者后台 IP 白名单等） |
| 飞书文档同步 | `open.feishu.cn` | 应用 App ID + App Secret、目标文件夹等 |

凭证只保存在**你的本机 vault** 里，见下方「密钥存哪」。

### 可选：Chrome companion（仅桌面）

目录：`chrome-companion/`。未打包的 Chrome 扩展，通过本机 WebSocket 接收发布包，打开目标平台编辑器并尝试填入草稿、上传本地图片（视平台适配进度而定）。

**不经过**微信 / 飞书官方 API 路径；那两条继续走插件内官方接口。

安装与配对见 [chrome-companion/README.md](chrome-companion/README.md)。

## 支持范围与 `isDesktopOnly`

`manifest.json` 中 `isDesktopOnly` 为 **`false`**：插件可在移动端安装。

| 能力 | 桌面 | 移动端 |
| --- | --- | --- |
| 预览 + 平台复制 | ✅ | ✅（受系统剪贴板能力限制） |
| 微信草稿 / 飞书同步 | ✅ | 理论上可用（依赖网络与平台接口） |
| Chrome companion 本机 bridge | ✅ | ❌ |
| 一键用本机 Chrome 打开编辑器 | ✅（macOS 等有额外优化） | ❌ |

若你主要依赖 companion 一键导入，请在 **Obsidian 桌面端**使用。

## 网络行为

| 场景 | 是否联网 | 说明 |
| --- | --- | --- |
| 预览、复制、本地图片嵌入 | 否 | 纯本地 |
| 微信创建/更新草稿、上传素材 | 是 | 仅在你启用并填写微信配置后，请求微信官方 API |
| 飞书导入文档、上传图片 | 是 | 仅在你启用并填写飞书配置后，请求飞书开放平台 |
| Chrome companion | 本机 | `ws://127.0.0.1:<port>/bridge`；扩展在你已登录的平台站点上操作页面 |
| 打开平台编辑器 URL | 是（浏览器） | 仅打开你选择的平台站点，不上传笔记正文到第三方中转服务 |

插件**不会**：

- 把笔记、图片、密钥发送到作者或第三方中转服务
- 默认开启任何图床上传
- 做使用量统计 / 遥测

## 密钥与敏感数据存哪

全部由 Obsidian 的 `loadData()` / `saveData()` 写入：

```text
<Vault>/.obsidian/plugins/obsidian-to-publish/data.json
```

可能包含：

- 微信 `appId` / `appSecret`
- 飞书 `appId` / `appSecret`、文件夹 token 等
- Chrome companion 连接令牌与端口
- 插件内缓存的草稿/媒体关联记录（若已使用相关功能）

**注意：**

- 不要把 `data.json` 提交到 Git，也不要放进公开分享的 vault 备份。
- 同步 vault（iCloud / Git / 网盘）等于同步这些密钥；公开仓库或共享盘会泄露 AppSecret。
- 连接令牌等同本机配对密码：不要发到群聊或截图公开。

仓库 `.gitignore` 已包含 `data.json` 与 `.env*`，降低误提交风险。

## 本机 bridge（Obsidian ↔ Chrome companion）

1. 仅在 **Obsidian 桌面端**、且你打开「启用本地连接」时监听。
2. 绑定 **`127.0.0.1`**，不对外网开放。
3. 默认端口 **`27127`**（可在设置中改）。
4. 使用随机 **连接令牌**；扩展连接 URL 形如：  
   `ws://127.0.0.1:<port>/bridge?token=<令牌>`
5. 配对成功后，Obsidian 会把当前笔记的发布包（正文与资源）发给扩展。

威胁模型是「本机其它进程在持有令牌时读取草稿」，不是公网扫端口。设置中可随时重置令牌。

## Chrome companion 权限说明

扩展会申请（见 `chrome-companion/manifest.json`）：

- `storage`：保存端口与令牌
- `clipboardWrite`：回退复制
- `tabs` / `windows`：打开或定位编辑器标签
- 各内容平台的 `host_permissions` 与 content scripts：在**你已打开并登录**的页面上填入内容、上传图片

扩展**不会**把发布包发到扩展作者的服务器；与 Obsidian 的通信只走本机 WebSocket。

各平台自动填入与图片上传成熟度不同，失败时应使用面板里的手动复制/粘贴回退。

## 安装

### 从源码手动安装（开发 / 试用）

```bash
npm install
npm run build
```

将下列文件复制到 vault：

```text
<Vault>/.obsidian/plugins/obsidian-to-publish/
  manifest.json
  main.js
  styles.css
```

在 Obsidian 中启用插件。修改 `manifest.json` 后建议重载插件或重启 Obsidian。

**不要在主力 vault 里开发测试**，避免误改真实笔记；使用单独开发 vault。

### Chrome companion（可选）

1. 插件设置中启用「Chrome 插件连接」，复制令牌  
2. Chrome → `chrome://extensions` → 开发者模式 →「加载已解压的扩展程序」→ 选择 `chrome-companion/`  
3. 扩展选项页粘贴令牌与端口并保存  
4. 在 Obsidian 中使用「发送当前笔记到 Chrome 插件」类命令  

细节见 [chrome-companion/README.md](chrome-companion/README.md)。

## 开发

```bash
npm install
npm run dev      # 监听构建
npm run build    # 类型检查 + 生产构建
npm test         # Vitest
```

多平台粘贴回归可用 [docs/test-publishing.md](docs/test-publishing.md) 作为基准笔记。

发布版本时保持 `package.json`、`manifest.json`、`versions.json` 版本一致；GitHub Release tag 与 `manifest.json` 版本号相同，不加 `v` 前缀。

## 命名

| 项 | 值 |
| --- | --- |
| 插件 ID（勿随意改） | `obsidian-to-publish` |
| npm / 包名 | `obsidian-to-publish` |
| GitHub 仓库 | `nextcaicai/obsidian-to-publish` |
| 安装目录 | `.obsidian/plugins/obsidian-to-publish/` |

## 许可

[Apache License 2.0](LICENSE)

Copyright 2026 Next蔡蔡 (nextcaicai)
