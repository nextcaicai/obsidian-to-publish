# Obsidian to Publish

An Obsidian plugin that opens a right-sidebar preview for the active Markdown note and copies rich HTML for publishing platforms.

## Features

- Preview the currently active Markdown note in a right sidebar view.
- Keep the preview synchronized with the active file and editor changes.
- Copy rendered HTML to the clipboard with inline styles.
- Apply a target-platform copy profile for long-form publishing platforms.
- Embed local vault images as `data:` URLs so the clipboard does not depend on Obsidian local resource paths.
- Also writes a Markdown/plain-text fallback to the clipboard.

## Copy profiles

The copy pipeline renders Markdown with Obsidian first, then applies a target-platform profile before writing HTML to the clipboard. A profile owns the platform-specific inline styles and DOM cleanup rules for headings, paragraphs, lists, tables, code blocks, images, callouts, and links.

Current profiles:

- `wechat`: WeChat Official Account article layout.
- `zhishixingqiu`: 知识星球 layout with real spacer paragraphs between blocks, so pasted content is less likely to lose blank lines in the editor.
- `zhihu`: Zhihu rich-text article layout.
- `csdn`: CSDN Markdown editor layout.
- `juejin`: Juejin Markdown editor layout.
- `substack`: Substack rich-text post layout.
- `x`: X Articles Markdown export target.
- `xiaohongshu`: Xiaohongshu plain-text note layout.
- `bilibili`: Bilibili rich-text article layout.

Future platforms can be added by extending `PLATFORM_PROFILES` in `src/platforms/profiles.ts`.

## Development

```bash
npm install
npm run dev
```

For manual installation, copy `manifest.json`, `main.js`, and `styles.css` into:

```text
<Vault>/.obsidian/plugins/obsidian-to-publish/
```

Reload Obsidian and enable the plugin from Community plugins.

## Notes

Paste behavior is controlled by each target editor. This plugin prepares self-contained HTML with embedded local images and inline styles, which is the most portable clipboard format Obsidian can provide without uploading assets to a remote image host.
