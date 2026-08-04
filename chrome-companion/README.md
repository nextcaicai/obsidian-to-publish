# Chrome Companion MVP

This directory contains an unpacked Chrome extension for the Obsidian to Publish plugin.

## What Works

- Connects to the Obsidian desktop plugin through `ws://127.0.0.1:<port>/bridge`.
- Receives `PublishPackageV1` from Obsidian.
- Opens the target platform editor tab.
- Shows a small in-page panel with:
  - `尝试填入`: inserts Markdown into the currently focused or largest writable editor.
  - `复制 Markdown`: copies the draft Markdown as a fallback.
  - `关闭`: clears the latest received task.

## Local Setup

1. In Obsidian, open plugin settings and enable `Chrome 插件连接`.
2. Copy the generated connection token from Obsidian.
3. In Chrome, open `chrome://extensions`.
4. Enable `Developer mode`.
5. Click `Load unpacked` and select this `chrome-companion` directory.
6. Open the extension options page, paste the token, confirm the port, then save.
7. In Obsidian, run `发送当前笔记到 Chrome 插件`.

## MVP Boundaries

- This MVP does not yet implement a dedicated X Articles Draft.js adapter.
- The current write path is intentionally conservative: it only uses visible browser-editable fields.
- WeChat Official Account and Feishu should continue through official APIs, not this Chrome companion.
