# Obsidian to Publish 配套 Chrome 插件

这个目录是 `Obsidian to Publish` 的配套 Chrome 插件源码。它不是单独使用的浏览器插件，而是配合 Obsidian 插件，把当前笔记发送到本机 Chrome，并尝试写入目标平台编辑器。

如果你只同步微信公众号草稿箱或飞书云文档，不需要安装这个 Chrome 插件。公众号和飞书走 Obsidian 插件里的官方 API。

## 它能做什么

- 通过 `ws://127.0.0.1:<port>/bridge` 连接本机 Obsidian 桌面端插件。
- 接收 Obsidian 发来的 `PublishPackageV1` 发布包。
- 打开或定位目标平台编辑器标签页。
- 页面加载完成后，自动重试把草稿写入编辑器。
- 在目标页面显示一个小面板，提供手动回退操作：
  - `尝试填入`：把草稿写入当前聚焦的编辑器，或页面中最大的可编辑区域。
  - `复制 Markdown`：复制 Markdown，方便手动粘贴。
  - `关闭`：清除当前收到的任务。

## 安装与配对

1. 先在 Obsidian 中安装并启用 `Obsidian to Publish`。
2. 打开「设置 → Obsidian to Publish → Chrome 插件连接」。
3. 打开「启用本地连接」。
4. 复制 Obsidian 生成的连接令牌，并确认本地端口。
5. 在 Chrome 打开 `chrome://extensions`。
6. 打开右上角「开发者模式」。
7. 点击「加载已解压的扩展程序」。
8. 选择本项目里的 `chrome-companion/` 目录。
9. 打开扩展选项页，粘贴连接令牌，确认端口，然后保存。
10. 回到 Obsidian，打开要同步的笔记，运行「发送当前笔记到 Chrome 插件」。

> [!NOTE]
> 截图待补：这里建议放 3 张图：Obsidian 的 Chrome 插件连接设置、Chrome 扩展加载页、扩展选项页。

## 使用边界

- 微信公众号和飞书云文档继续使用 Obsidian 插件里的官方 API，不走这个 Chrome 插件。
- 这个 Chrome 插件主要用于知乎、知识星球、X Articles、Substack、Bilibili 图文、小红书图文、掘金等浏览器编辑器。
- 当前写入策略偏保守：只操作页面里可见、可编辑的输入区域，并会为延迟加载的编辑器重试。
- 各平台编辑器经常改版，自动填入或图片上传可能失败；失败时使用页面小面板里的复制功能手动粘贴。
- 同步完成后，请务必在平台编辑器里人工检查标题、正文、图片、表格和代码块，再发布。

## 文件结构

- `src/assets/publish-assets.js`：图片上传队列、去重、重试、缓存和 Markdown 图片链接改写。
- `src/content-shared.js`：共享 DOM、粘贴、页面上传桥接、资源和重试工具。
- `src/platforms/*.js`：各平台的选择器和写入策略。
- `src/content.js`：页面入口、小面板 UI 和重试循环。

平台相关修复优先放在对应的 `src/platforms/<platform>.js` 文件里。只有当问题确实属于通用能力时，再修改共享 helper。

## 当前图片策略

- Substack：保留富文本图片粘贴路径。
- 掘金和 CSDN：先上传本地图片，再插入最终 Markdown。
- CSDN：如果页面 SDK 不可用，会回退到编辑器粘贴上传。
- X 和知乎：当前会先省略本地图片，等待后续专门的图片适配器。
