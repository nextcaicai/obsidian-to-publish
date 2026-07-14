import {
	App,
	Component,
	ItemView,
	MarkdownRenderer,
	MarkdownView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	WorkspaceLeaf
} from "obsidian";

const VIEW_TYPE_WECHAT_PREVIEW = "obsidian-to-publish-view";

type CopyPlatform = "wechat" | "zhishixingqiu";

interface WeChatPreviewCopySettings {
	autoOpen: boolean;
	embedLocalImages: boolean;
	inlineStyles: boolean;
	targetPlatform: CopyPlatform;
}

const DEFAULT_SETTINGS: WeChatPreviewCopySettings = {
	autoOpen: true,
	embedLocalImages: true,
	inlineStyles: true,
	targetPlatform: "wechat"
};

interface PlatformProfile {
	id: CopyPlatform;
	label: string;
	copyLabel: string;
	wrapperStyle: string;
	rules: PlatformStyleRule[];
	transform?: (root: HTMLElement) => void;
}

interface PlatformStyleRule {
	selector: string;
	style?: string;
	remove?: boolean;
}

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
	avif: "image/avif",
	bmp: "image/bmp",
	gif: "image/gif",
	jpeg: "image/jpeg",
	jpg: "image/jpeg",
	png: "image/png",
	svg: "image/svg+xml",
	webp: "image/webp"
};

const INLINE_STYLE_PROPERTIES = [
	"background-color",
	"border-bottom-color",
	"border-bottom-style",
	"border-bottom-width",
	"border-collapse",
	"border-left-color",
	"border-left-style",
	"border-left-width",
	"border-radius",
	"border-right-color",
	"border-right-style",
	"border-right-width",
	"border-spacing",
	"border-top-color",
	"border-top-style",
	"border-top-width",
	"box-sizing",
	"color",
	"display",
	"font-family",
	"font-size",
	"font-style",
	"font-weight",
	"line-height",
	"list-style-position",
	"list-style-type",
	"margin-bottom",
	"margin-left",
	"margin-right",
	"margin-top",
	"max-width",
	"overflow-wrap",
	"padding-bottom",
	"padding-left",
	"padding-right",
	"padding-top",
	"text-align",
	"text-decoration",
	"vertical-align",
	"white-space",
	"word-break"
];

const OBSIDIAN_CODE_COPY_CONTROL_SELECTORS = [
	".copy-code-button",
	"button.copy-code-button",
	".code-block-copy-button",
	"button.code-block-copy-button",
	".clipboard-button",
	"button.clipboard-button",
	".copy-button",
	"button.copy-button",
	".code-copy-button",
	"button.code-copy-button",
	"button[aria-label='Copy code']",
	"button[aria-label='Copy Code']",
	"button[aria-label='复制代码']",
	"button[title='Copy code']",
	"button[title='Copy Code']",
	"button[title='复制代码']",
	"pre > button",
	"pre + button",
	"pre ~ button"
];

const PLATFORM_PROFILES: Record<CopyPlatform, PlatformProfile> = {
	wechat: {
		id: "wechat",
		label: "WeChat Official Account",
		copyLabel: "WeChat",
		wrapperStyle: [
			"box-sizing:border-box",
			"color:#3f3f3f",
			"font-family:-apple-system,BlinkMacSystemFont,\"Helvetica Neue\",Helvetica,\"PingFang SC\",\"Microsoft YaHei\",Arial,sans-serif",
			"font-size:16px",
			"letter-spacing:0",
			"line-height:1.75",
			"margin:0 auto",
			"max-width:677px",
			"overflow-wrap:break-word",
			"word-break:break-word"
		].join(";"),
		rules: [
			{
				selector: "h1",
				style: "border-bottom:1px solid #e5e6eb;color:#1d2129;font-size:24px;font-weight:700;line-height:1.35;margin:1.4em 0 0.8em;padding:0 0 0.35em;"
			},
			{
				selector: "h2",
				style: "border-left:4px solid #1e80ff;color:#1d2129;font-size:20px;font-weight:700;line-height:1.45;margin:1.8em 0 0.8em;padding:0 0 0 12px;"
			},
			{
				selector: "h3",
				style: "color:#1d2129;font-size:18px;font-weight:700;line-height:1.5;margin:1.5em 0 0.7em;"
			},
			{
				selector: "h4,h5,h6",
				style: "color:#1d2129;font-size:16px;font-weight:700;line-height:1.5;margin:1.2em 0 0.6em;"
			},
			{
				selector: "p",
				style: "color:#3f3f3f;font-size:16px;line-height:1.8;margin:1em 0;"
			},
			{
				selector: "strong",
				style: "color:#1d2129;font-weight:700;"
			},
			{
				selector: "em",
				style: "color:#4e5969;font-style:italic;"
			},
			{
				selector: "a",
				style: "color:#576b95;text-decoration:none;"
			},
			{
				selector: "ul,ol",
				style: "margin:1em 0;padding-left:1.4em;"
			},
			{
				selector: "li",
				style: "color:#3f3f3f;line-height:1.8;margin:0.35em 0;"
			},
			{
				selector: "blockquote",
				style: "background:#f7f8fa;border-left:4px solid #d0d7de;color:#57606a;margin:1.2em 0;padding:12px 16px;"
			},
			{
				selector: "blockquote p",
				style: "color:#57606a;margin:0.6em 0;"
			},
			{
				selector: "code",
				style: "background:#f6f8fa;border-radius:4px;color:#d6336c;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,\"Liberation Mono\",monospace;font-size:0.9em;padding:2px 4px;"
			},
			{
				selector: "pre",
				style: "background:#f6f8fa;border-radius:6px;box-sizing:border-box;color:#24292f;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,\"Liberation Mono\",monospace;font-size:14px;line-height:1.65;margin:1.2em 0;overflow-x:auto;padding:12px 14px;white-space:pre-wrap;word-break:break-word;"
			},
			{
				selector: "pre code",
				style: "background:transparent;color:#24292f;font-size:14px;line-height:1.65;padding:0;"
			},
			{
				selector: "table",
				style: "border-collapse:collapse;border-spacing:0;margin:1.2em 0;width:100%;"
			},
			{
				selector: "th,td",
				style: "border:1px solid #d8dee4;color:#3f3f3f;font-size:15px;line-height:1.6;padding:8px 10px;text-align:left;vertical-align:top;"
			},
			{
				selector: "th",
				style: "background:#f6f8fa;color:#1d2129;font-weight:700;"
			},
			{
				selector: "img",
				style: "border-radius:4px;display:block;height:auto;margin:16px auto;max-width:100%;"
			},
			{
				selector: "hr",
				style: "border:0;border-top:1px solid #e5e6eb;margin:2em 0;"
			},
			{
				selector: ".callout",
				style: "background:#f7fbff;border-left:4px solid #1e80ff;border-radius:6px;box-sizing:border-box;color:#3f3f3f;margin:1.2em 0;padding:12px 16px;"
			},
			{
				selector: ".callout-title",
				style: "color:#1d2129;font-size:16px;font-weight:700;line-height:1.6;margin:0 0 6px;"
			},
			{
				selector: ".callout-content",
				style: "color:#3f3f3f;font-size:16px;line-height:1.8;"
			},
			{
				selector: ".callout-icon,.heading-collapse-indicator,.collapse-indicator",
				remove: true
			}
		],
		transform: transformWechatArticle
	},
	zhishixingqiu: {
		id: "zhishixingqiu",
		label: "知识星球",
		copyLabel: "知识星球",
		wrapperStyle: [
			"box-sizing:border-box",
			"color:#2f3033",
			"font-family:-apple-system,BlinkMacSystemFont,\"Helvetica Neue\",Helvetica,\"PingFang SC\",\"Microsoft YaHei\",Arial,sans-serif",
			"font-size:16px",
			"letter-spacing:0",
			"line-height:1.75",
			"margin:0",
			"max-width:100%",
			"overflow-wrap:break-word",
			"word-break:break-word"
		].join(";"),
		rules: [
			{
				selector: "h1",
				style: "color:#1d2129;font-size:24px;font-weight:700;line-height:1.4;margin:1.2em 0 0.8em;"
			},
			{
				selector: "h2",
				style: "color:#1d2129;font-size:21px;font-weight:700;line-height:1.45;margin:1.4em 0 0.75em;"
			},
			{
				selector: "h3",
				style: "color:#1d2129;font-size:18px;font-weight:700;line-height:1.5;margin:1.2em 0 0.65em;"
			},
			{
				selector: "h4,h5,h6",
				style: "color:#1d2129;font-size:16px;font-weight:700;line-height:1.5;margin:1em 0 0.55em;"
			},
			{
				selector: "p",
				style: "color:#2f3033;font-size:16px;line-height:1.8;margin:0;"
			},
			{
				selector: "strong",
				style: "color:#1d2129;font-weight:700;"
			},
			{
				selector: "em",
				style: "color:#515866;font-style:italic;"
			},
			{
				selector: "a",
				style: "color:#246bfe;text-decoration:none;"
			},
			{
				selector: "ul,ol",
				style: "margin:0;padding-left:1.4em;"
			},
			{
				selector: "li",
				style: "color:#2f3033;line-height:1.8;margin:0.2em 0;"
			},
			{
				selector: "blockquote",
				style: "background:#f7f8fa;border-left:4px solid #d7dce5;color:#515866;margin:0;padding:12px 16px;"
			},
			{
				selector: "blockquote p",
				style: "color:#515866;margin:0;"
			},
			{
				selector: "code",
				style: "background:#f5f6f8;border-radius:4px;color:#d6336c;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,\"Liberation Mono\",monospace;font-size:0.9em;padding:2px 4px;"
			},
			{
				selector: "pre",
				style: "background:#f5f6f8;border-radius:6px;box-sizing:border-box;color:#24292f;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,\"Liberation Mono\",monospace;font-size:14px;line-height:1.65;margin:0;overflow-x:auto;padding:12px 14px;white-space:pre-wrap;word-break:break-word;"
			},
			{
				selector: "pre code",
				style: "background:transparent;color:#24292f;font-size:14px;line-height:1.65;padding:0;"
			},
			{
				selector: "table",
				style: "border-collapse:collapse;border-spacing:0;margin:0;width:100%;"
			},
			{
				selector: "th,td",
				style: "border:1px solid #d8dee4;color:#2f3033;font-size:15px;line-height:1.6;padding:8px 10px;text-align:left;vertical-align:top;"
			},
			{
				selector: "th",
				style: "background:#f5f6f8;color:#1d2129;font-weight:700;"
			},
			{
				selector: "img",
				style: "border-radius:4px;display:block;height:auto;margin:0 auto;max-width:100%;"
			},
			{
				selector: "hr",
				style: "border:0;border-top:1px solid #e5e6eb;margin:0;"
			},
			{
				selector: ".callout",
				style: "background:#f7fbff;border-left:4px solid #246bfe;border-radius:6px;box-sizing:border-box;color:#2f3033;margin:0;padding:12px 16px;"
			},
			{
				selector: ".callout-title",
				style: "color:#1d2129;font-size:16px;font-weight:700;line-height:1.6;margin:0 0 6px;"
			},
			{
				selector: ".callout-content",
				style: "color:#2f3033;font-size:16px;line-height:1.8;"
			},
			{
				selector: ".callout-icon,.heading-collapse-indicator,.collapse-indicator",
				remove: true
			}
		],
		transform: transformZhishixingqiuArticle
	}
};

export default class WeChatPreviewCopyPlugin extends Plugin {
	settings: WeChatPreviewCopySettings = DEFAULT_SETTINGS;
	private lastMarkdownFile: TFile | null = null;
	private refreshTimer: number | null = null;

	async onload() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		this.rememberActiveMarkdownFile();

		this.registerView(
			VIEW_TYPE_WECHAT_PREVIEW,
			(leaf) => new WeChatPreviewCopyView(leaf, this)
		);

		this.addRibbonIcon("copy", "Open copy preview", () => {
			void this.activateView();
		});

		this.addCommand({
			id: "open-copy-preview",
			name: "Open copy preview in right sidebar",
			callback: () => {
				void this.activateView();
			}
		});

		this.addCommand({
			id: "copy-current-note-for-target-platform",
			name: "Copy current note for target platform",
			callback: () => {
				void this.copyCurrentNoteForTargetPlatform();
			}
		});

		this.addCommand({
			id: "copy-current-note-for-wechat",
			name: "Copy current note for WeChat",
			callback: () => {
				void this.copyCurrentNoteForPlatform("wechat");
			}
		});

		this.addCommand({
			id: "copy-current-note-for-zhishixingqiu",
			name: "Copy current note for 知识星球",
			callback: () => {
				void this.copyCurrentNoteForPlatform("zhishixingqiu");
			}
		});

		this.addSettingTab(new WeChatPreviewCopySettingTab(this.app, this));

		this.registerEvent(this.app.workspace.on("file-open", () => {
			this.rememberActiveMarkdownFile();
			this.scheduleRefresh();
		}));
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
			this.rememberActiveMarkdownFile();
			this.scheduleRefresh();
		}));
		this.registerEvent(this.app.vault.on("modify", (file) => {
			if (file instanceof TFile && file.extension === "md") {
				this.scheduleRefresh();
			}
		}));
		this.registerEvent(this.app.metadataCache.on("changed", (file) => {
			if (file.extension === "md" || isImageFile(file)) {
				this.scheduleRefresh();
			}
		}));
		this.registerEditorChangeEvent();

		this.app.workspace.onLayoutReady(() => {
			if (this.settings.autoOpen) {
				void this.activateView(false);
			}
		});
	}

	onunload() {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
		}
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_WECHAT_PREVIEW);
	}

	async activateView(reveal = true) {
		const leaf = await this.getOrCreatePreviewLeaf();
		if (reveal) {
			this.app.workspace.revealLeaf(leaf);
		}

		if (leaf.view instanceof WeChatPreviewCopyView) {
			await leaf.view.renderActiveFile();
		}
	}

	async copyCurrentNoteForTargetPlatform() {
		const leaf = await this.getOrCreatePreviewLeaf();
		this.app.workspace.revealLeaf(leaf);

		if (leaf.view instanceof WeChatPreviewCopyView) {
			await leaf.view.renderActiveFile();
			await leaf.view.copyForCurrentPlatform();
		}
	}

	async copyCurrentNoteForPlatform(platform: CopyPlatform) {
		await this.setTargetPlatform(platform);
		await this.copyCurrentNoteForTargetPlatform();
	}

	getCurrentPlatformProfile(): PlatformProfile {
		return PLATFORM_PROFILES[this.settings.targetPlatform];
	}

	async setTargetPlatform(platform: CopyPlatform) {
		this.settings.targetPlatform = platform;
		await this.saveSettings();
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_WECHAT_PREVIEW)) {
			if (leaf.view instanceof WeChatPreviewCopyView) {
				leaf.view.syncPlatformControls();
			}
		}
	}

	getActiveMarkdownFile(): TFile | null {
		const focusedFile = this.getFocusedMarkdownFile();
		if (focusedFile) {
			this.lastMarkdownFile = focusedFile;
			return focusedFile;
		}

		if (this.lastMarkdownFile) {
			const knownFile = this.app.vault.getAbstractFileByPath(this.lastMarkdownFile.path);
			if (knownFile instanceof TFile && knownFile.extension === "md") {
				return knownFile;
			}
		}

		return null;
	}

	async getMarkdownForFile(file: TFile): Promise<string> {
		const markdownView = this.findMarkdownViewForFile(file);
		if (markdownView?.file === file) {
			return markdownView.editor.getValue();
		}

		return this.app.vault.cachedRead(file);
	}

	async fileToDataUri(file: TFile): Promise<string> {
		const mime = IMAGE_MIME_BY_EXTENSION[file.extension.toLowerCase()];
		if (!mime) {
			throw new Error(`Unsupported image type: ${file.extension}`);
		}

		const buffer = await this.app.vault.readBinary(file);
		return `data:${mime};base64,${arrayBufferToBase64(buffer)}`;
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private getFocusedMarkdownFile(): TFile | null {
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (markdownView?.file) {
			return markdownView.file;
		}

		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile?.extension === "md") {
			return activeFile;
		}

		return null;
	}

	private findMarkdownViewForFile(file: TFile): MarkdownView | null {
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (markdownView?.file === file) {
			return markdownView;
		}

		let matchingView: MarkdownView | null = null;

		this.app.workspace.iterateAllLeaves((leaf) => {
			if (matchingView || !(leaf.view instanceof MarkdownView)) {
				return;
			}

			if (leaf.view.file === file) {
				matchingView = leaf.view;
			}
		});

		return matchingView;
	}

	private rememberActiveMarkdownFile() {
		const focusedFile = this.getFocusedMarkdownFile();
		if (focusedFile) {
			this.lastMarkdownFile = focusedFile;
		}
	}

	private async getOrCreatePreviewLeaf(): Promise<WorkspaceLeaf> {
		const existingLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_WECHAT_PREVIEW)[0];
		if (existingLeaf) {
			return existingLeaf;
		}

		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) {
			throw new Error("Unable to create right sidebar preview.");
		}

		await leaf.setViewState({
			type: VIEW_TYPE_WECHAT_PREVIEW,
			active: true
		});

		return leaf;
	}

	private scheduleRefresh() {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
		}

		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_WECHAT_PREVIEW)) {
				if (leaf.view instanceof WeChatPreviewCopyView) {
					void leaf.view.renderActiveFile();
				}
			}
		}, 150);
	}

	private registerEditorChangeEvent() {
		const workspaceWithEditorChange = this.app.workspace as typeof this.app.workspace & {
			on(name: "editor-change", callback: () => void): ReturnType<App["workspace"]["on"]>;
		};

		this.registerEvent(workspaceWithEditorChange.on("editor-change", () => this.scheduleRefresh()));
	}
}

class WeChatPreviewCopyView extends ItemView {
	private currentFile: TFile | null = null;
	private currentMarkdown = "";
	private copyButton!: HTMLButtonElement;
	private platformSelect!: HTMLSelectElement;
	private previewEl!: HTMLElement;
	private renderComponent: Component | null = null;
	private renderSerial = 0;
	private statusEl!: HTMLElement;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: WeChatPreviewCopyPlugin
	) {
		super(leaf);
	}

	getViewType() {
		return VIEW_TYPE_WECHAT_PREVIEW;
	}

	getDisplayText() {
		return "Copy Preview";
	}

	getIcon() {
		return "copy";
	}

	async onOpen() {
		this.contentEl.empty();
		this.contentEl.addClass("obsidian-to-publish-view");

		const toolbarEl = this.contentEl.createDiv({ cls: "obsidian-to-publish-toolbar" });

		this.platformSelect = toolbarEl.createEl("select");
		for (const profile of Object.values(PLATFORM_PROFILES)) {
			this.platformSelect.createEl("option", {
				attr: { value: profile.id },
				text: profile.label
			});
		}
		this.platformSelect.addEventListener("change", () => {
			if (isCopyPlatform(this.platformSelect.value)) {
				void this.plugin.setTargetPlatform(this.platformSelect.value);
			}
		});

		this.copyButton = toolbarEl.createEl("button", {
			cls: "mod-cta",
			text: ""
		});
		this.copyButton.addEventListener("click", () => {
			void this.copyForCurrentPlatform();
		});

		const refreshButton = toolbarEl.createEl("button", { text: "Refresh" });
		refreshButton.addEventListener("click", () => {
			void this.renderActiveFile();
		});

		this.statusEl = toolbarEl.createDiv({ cls: "obsidian-to-publish-status" });
		this.previewEl = this.contentEl.createDiv({
			cls: "obsidian-to-publish-content markdown-rendered"
		});
		this.syncPlatformControls();

		await this.renderActiveFile();
	}

	syncPlatformControls() {
		if (!this.copyButton || !this.platformSelect) {
			return;
		}

		const profile = this.plugin.getCurrentPlatformProfile();
		this.platformSelect.value = profile.id;
		this.copyButton.setText(`Copy for ${profile.copyLabel}`);
	}

	async onClose() {
		this.renderComponent?.unload();
		this.renderComponent = null;
	}

	async renderActiveFile() {
		const serial = ++this.renderSerial;
		const file = this.plugin.getActiveMarkdownFile();
		this.currentFile = file;
		this.currentMarkdown = "";

		this.renderComponent?.unload();
		this.renderComponent = null;
		this.previewEl.empty();

		if (!file) {
			this.statusEl.setText("No active Markdown file");
			this.previewEl.createDiv({
				cls: "obsidian-to-publish-empty",
				text: "Open a Markdown note to preview it here."
			});
			return;
		}

		this.statusEl.setText(file.path);

		const markdown = await this.plugin.getMarkdownForFile(file);
		if (serial !== this.renderSerial) {
			return;
		}

		this.currentMarkdown = markdown;
		this.renderComponent = new Component();
		this.renderComponent.load();

		await MarkdownRenderer.render(
			this.app,
			markdown,
			this.previewEl,
			file.path,
			this.renderComponent
		);
		this.removePreviewRuntimeControls(serial);
	}

	async copyForCurrentPlatform() {
		if (!this.currentFile) {
			new Notice("Open a Markdown note before copying.");
			return;
		}

		await this.renderActiveFile();
		if (!this.currentFile) {
			new Notice("Open a Markdown note before copying.");
			return;
		}

		try {
			const clipboard = await this.buildClipboardPayload();
			await writeRichClipboard(clipboard.html, clipboard.fragment, clipboard.text);

			const profile = this.plugin.getCurrentPlatformProfile();
			const suffix = clipboard.unresolvedImages === 0
				? ""
				: ` (${clipboard.unresolvedImages} image(s) could not be embedded)`;
			new Notice(`Copied for ${profile.copyLabel}${suffix}.`);
		} catch (error) {
			console.error(error);
			new Notice("Copy failed. See console for details.");
		}
	}

	private async buildClipboardPayload(): Promise<{
		fragment: string;
		html: string;
		text: string;
		unresolvedImages: number;
	}> {
		const clone = this.previewEl.cloneNode(true) as HTMLElement;
		clone.classList.remove("obsidian-to-publish-content");

		if (this.plugin.settings.inlineStyles) {
			inlineComputedStyles(this.previewEl, clone);
		}

		applyPlatformProfile(clone, this.plugin.settings.targetPlatform);

		const unresolvedImages = this.plugin.settings.embedLocalImages
			? await this.embedLocalImages(clone)
			: 0;

		removeObsidianRuntimeControls(clone);
		replaceTaskCheckboxes(clone);
		removeObsidianRuntimeAttributes(clone);

		const fragment = wrapPlatformFragment(clone.innerHTML, this.plugin.settings.targetPlatform);
		return {
			fragment,
			html: wrapHtmlDocument(fragment),
			text: this.previewEl.innerText || this.currentMarkdown,
			unresolvedImages
		};
	}

	private async embedLocalImages(clone: HTMLElement): Promise<number> {
		const cloneImages = Array.from(clone.querySelectorAll("img"));
		const sourceImages = Array.from(this.previewEl.querySelectorAll("img"));
		const embeddedFiles = this.resolveEmbeddedImageFiles();
		let embeddedFileIndex = 0;
		let unresolved = 0;

		for (let index = 0; index < cloneImages.length; index += 1) {
			const image = cloneImages[index];
			const src = image.getAttribute("src") ?? "";

			if (isPortableImageSource(src)) {
				continue;
			}

			const imageFile = embeddedFiles[embeddedFileIndex] ?? this.resolveImageFromElement(sourceImages[index]);
			embeddedFileIndex += 1;

			if (!imageFile) {
				unresolved += 1;
				continue;
			}

			try {
				image.setAttribute("src", await this.plugin.fileToDataUri(imageFile));
				image.removeAttribute("data-src");
				appendInlineStyle(image, "max-width:100%;height:auto;");
			} catch (error) {
				console.error(`Unable to embed image: ${imageFile.path}`, error);
				unresolved += 1;
			}
		}

		return unresolved;
	}

	private removePreviewRuntimeControls(serial: number) {
		removeObsidianRuntimeControls(this.previewEl);

		window.requestAnimationFrame(() => {
			if (serial === this.renderSerial) {
				removeObsidianRuntimeControls(this.previewEl);
			}
		});

		window.setTimeout(() => {
			if (serial === this.renderSerial) {
				removeObsidianRuntimeControls(this.previewEl);
			}
		}, 100);
	}

	private resolveEmbeddedImageFiles(): TFile[] {
		if (!this.currentFile) {
			return [];
		}

		const cache = this.app.metadataCache.getFileCache(this.currentFile);
		const files: TFile[] = [];

		for (const embed of cache?.embeds ?? []) {
			const file = this.resolveLinkToImageFile(embed.link);
			if (file) {
				files.push(file);
			}
		}

		if (files.length > 0) {
			return files;
		}

		for (const link of extractMarkdownImageLinks(this.currentMarkdown)) {
			const file = this.resolveLinkToImageFile(link);
			if (file) {
				files.push(file);
			}
		}

		return files;
	}

	private resolveImageFromElement(image: HTMLImageElement | undefined): TFile | null {
		if (!image) {
			return null;
		}

		for (const value of [
			image.getAttribute("alt"),
			image.getAttribute("data-path"),
			image.getAttribute("src")
		]) {
			const file = this.resolveLinkToImageFile(value ?? "");
			if (file) {
				return file;
			}
		}

		return null;
	}

	private resolveLinkToImageFile(link: string): TFile | null {
		if (!this.currentFile || !link || isPortableImageSource(link)) {
			return null;
		}

		const normalizedLink = normalizeImageLink(link);
		if (!normalizedLink) {
			return null;
		}

		const file = this.app.metadataCache.getFirstLinkpathDest(
			normalizedLink,
			this.currentFile.path
		);

		return file && isImageFile(file) ? file : null;
	}
}

class WeChatPreviewCopySettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: WeChatPreviewCopyPlugin
	) {
		super(app, plugin);
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Open preview automatically")
			.setDesc("Open the right-sidebar preview when the plugin loads.")
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.autoOpen)
				.onChange(async (value) => {
					this.plugin.settings.autoOpen = value;
					await this.plugin.saveSettings();
					if (value) {
						await this.plugin.activateView();
					}
				}));

		new Setting(containerEl)
			.setName("Copy profile")
			.setDesc("Choose the target platform formatting profile.")
			.addDropdown((dropdown) => {
				for (const profile of Object.values(PLATFORM_PROFILES)) {
					dropdown.addOption(profile.id, profile.label);
				}

				dropdown
					.setValue(this.plugin.settings.targetPlatform)
					.onChange(async (value) => {
						if (isCopyPlatform(value)) {
							await this.plugin.setTargetPlatform(value);
						}
					});
			});

		new Setting(containerEl)
			.setName("Embed local images")
			.setDesc("Convert vault images to data URLs before copying.")
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.embedLocalImages)
				.onChange(async (value) => {
					this.plugin.settings.embedLocalImages = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Inline source styles")
			.setDesc("Copy key computed styles before applying the target platform profile.")
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.inlineStyles)
				.onChange(async (value) => {
					this.plugin.settings.inlineStyles = value;
					await this.plugin.saveSettings();
				}));
	}
}

function isImageFile(file: TFile): boolean {
	return Boolean(IMAGE_MIME_BY_EXTENSION[file.extension.toLowerCase()]);
}

function isPortableImageSource(src: string): boolean {
	return src.startsWith("data:") || src.startsWith("http://") || src.startsWith("https://");
}

function isCopyPlatform(value: string): value is CopyPlatform {
	return value in PLATFORM_PROFILES;
}

function applyPlatformProfile(root: HTMLElement, platform: CopyPlatform) {
	const profile = PLATFORM_PROFILES[platform];

	for (const rule of profile.rules) {
		for (const element of Array.from(root.querySelectorAll(rule.selector))) {
			if (!(element instanceof HTMLElement)) {
				continue;
			}

			if (rule.remove) {
				element.remove();
			} else if (rule.style) {
				appendInlineStyle(element, rule.style);
			}
		}
	}

	profile.transform?.(root);
}

function transformWechatArticle(root: HTMLElement) {
	for (const link of Array.from(root.querySelectorAll<HTMLAnchorElement>("a.internal-link"))) {
		link.removeAttribute("href");
		link.setAttribute("title", "Internal Obsidian link");
		appendInlineStyle(link, "color:#3f3f3f;text-decoration:none;");
	}

	for (const paragraph of Array.from(root.querySelectorAll<HTMLElement>("p:empty"))) {
		paragraph.remove();
	}
}

function transformZhishixingqiuArticle(root: HTMLElement) {
	for (const link of Array.from(root.querySelectorAll<HTMLAnchorElement>("a.internal-link"))) {
		link.removeAttribute("href");
		link.setAttribute("title", "Internal Obsidian link");
		appendInlineStyle(link, "color:#2f3033;text-decoration:none;");
	}

	for (const paragraph of Array.from(root.querySelectorAll<HTMLElement>("p:empty"))) {
		turnIntoZhishixingqiuSpacer(paragraph);
	}

	insertZhishixingqiuSpacers(root);
}

function insertZhishixingqiuSpacers(root: HTMLElement) {
	const children = Array.from(root.children);

	for (let index = 0; index < children.length - 1; index += 1) {
		const current = children[index];
		const next = children[index + 1];

		if (!isZhishixingqiuBlock(current) || !isZhishixingqiuBlock(next)) {
			continue;
		}

		const spacer = document.createElement("p");
		turnIntoZhishixingqiuSpacer(spacer);
		current.after(spacer);
	}
}

function turnIntoZhishixingqiuSpacer(element: HTMLElement) {
	element.innerHTML = "&nbsp;";
	element.classList.add("zhishixingqiu-spacer");
	element.setAttribute("style", [
		"color:transparent",
		"font-size:16px",
		"line-height:1.2",
		"margin:0",
		"min-height:1.2em"
	].join(";"));
}

function isZhishixingqiuBlock(element: Element): boolean {
	if (element.classList.contains("zhishixingqiu-spacer")) {
		return false;
	}

	const tagName = element.tagName.toLowerCase();
	return [
		"blockquote",
		"h1",
		"h2",
		"h3",
		"h4",
		"h5",
		"h6",
		"hr",
		"img",
		"ol",
		"p",
		"pre",
		"table",
		"ul"
	].includes(tagName) || element.classList.contains("callout");
}

function removeObsidianRuntimeControls(root: HTMLElement) {
	const controls = new Set<Element>();

	for (const selector of OBSIDIAN_CODE_COPY_CONTROL_SELECTORS) {
		for (const element of Array.from(root.querySelectorAll(selector))) {
			controls.add(element);
		}
	}

	for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>("button"))) {
		const label = [
			button.className,
			button.getAttribute("aria-label"),
			button.getAttribute("title"),
			button.textContent
		].join(" ");

		if (/copy|clipboard|复制/i.test(label) && isNearCodeBlock(button)) {
			controls.add(button);
		}
	}

	for (const svg of Array.from(root.querySelectorAll<SVGElement>("svg"))) {
		const label = [
			svg.getAttribute("class"),
			svg.getAttribute("aria-label"),
			svg.getAttribute("data-icon"),
			svg.getAttribute("icon-name"),
			svg.parentElement?.className,
			svg.parentElement?.getAttribute("aria-label"),
			svg.parentElement?.getAttribute("title")
		].join(" ");

		if (/copy|clipboard|复制/i.test(label) && isNearCodeBlock(svg)) {
			controls.add(svg.closest("button,.copy-code-button,.code-block-copy-button,.clipboard-button,.copy-button,.code-copy-button") ?? svg);
		}
	}

	for (const control of controls) {
		control.remove();
	}
}

function isNearCodeBlock(element: Element): boolean {
	const parent = element.parentElement;
	if (!parent) {
		return false;
	}

	return Boolean(
		element.closest("pre")
		|| parent.querySelector("pre")
		|| element.previousElementSibling?.tagName.toLowerCase() === "pre"
		|| element.nextElementSibling?.tagName.toLowerCase() === "pre"
	);
}

function wrapPlatformFragment(fragment: string, platform: CopyPlatform): string {
	const profile = PLATFORM_PROFILES[platform];
	const wrapper = document.createElement("section");
	wrapper.setAttribute("style", profile.wrapperStyle);
	wrapper.innerHTML = fragment;
	return wrapper.outerHTML;
}

function normalizeImageLink(link: string): string {
	let value = link.trim();
	if (!value) {
		return "";
	}

	const pipeIndex = value.indexOf("|");
	if (pipeIndex >= 0) {
		value = value.slice(0, pipeIndex);
	}

	const hashIndex = value.indexOf("#");
	if (hashIndex >= 0) {
		value = value.slice(0, hashIndex);
	}

	if (value.startsWith("<") && value.includes(">")) {
		value = value.slice(1, value.indexOf(">"));
	}

	const titleIndex = value.search(/\s+["']/);
	if (titleIndex > 0) {
		value = value.slice(0, titleIndex);
	}

	try {
		value = decodeURIComponent(value);
	} catch {
		// Keep the original value if it is not URI encoded.
	}

	return value.trim();
}

function extractMarkdownImageLinks(markdown: string): string[] {
	const links: string[] = [];
	const markdownImagePattern = /!\[[^\]]*]\(([^)]+)\)/g;
	let match: RegExpExecArray | null;

	while ((match = markdownImagePattern.exec(markdown)) !== null) {
		links.push(normalizeImageLink(match[1]));
	}

	return links;
}

function inlineComputedStyles(sourceRoot: HTMLElement, cloneRoot: HTMLElement) {
	const sourceElements = [sourceRoot, ...Array.from(sourceRoot.querySelectorAll("*"))];
	const cloneElements = [cloneRoot, ...Array.from(cloneRoot.querySelectorAll("*"))];

	for (let index = 0; index < sourceElements.length; index += 1) {
		const source = sourceElements[index];
		const clone = cloneElements[index];

		if (!(source instanceof HTMLElement) || !(clone instanceof HTMLElement)) {
			continue;
		}

		const computed = window.getComputedStyle(source);
		const declarations: string[] = [];

		for (const property of INLINE_STYLE_PROPERTIES) {
			const value = computed.getPropertyValue(property);
			if (shouldKeepInlineStyle(property, value)) {
				declarations.push(`${property}:${value}`);
			}
		}

		if (declarations.length > 0) {
			appendInlineStyle(clone, declarations.join(";"));
		}
	}
}

function shouldKeepInlineStyle(property: string, value: string): boolean {
	const normalized = value.trim();
	if (!normalized) {
		return false;
	}

	if (normalized === "none" && !property.startsWith("border")) {
		return false;
	}

	if (
		property.endsWith("color")
		&& (normalized === "rgba(0, 0, 0, 0)" || normalized === "transparent")
	) {
		return false;
	}

	return true;
}

function appendInlineStyle(element: HTMLElement, declaration: string) {
	const existing = element.getAttribute("style")?.trim();
	const normalizedDeclaration = declaration.trim().replace(/;+$/, "");
	element.setAttribute(
		"style",
		existing ? `${existing};${normalizedDeclaration}` : normalizedDeclaration
	);
}

function replaceTaskCheckboxes(root: HTMLElement) {
	for (const input of Array.from(root.querySelectorAll<HTMLInputElement>("input[type='checkbox']"))) {
		const marker = document.createElement("span");
		marker.innerHTML = input.checked ? "&#9745;" : "&#9744;";
		marker.setAttribute("style", "display:inline-block;width:1.3em;");
		input.replaceWith(marker);
	}
}

function removeObsidianRuntimeAttributes(root: HTMLElement) {
	for (const element of Array.from(root.querySelectorAll("*"))) {
		for (const attribute of Array.from(element.attributes)) {
			if (
				attribute.name.startsWith("aria-")
				|| attribute.name.startsWith("data-")
				|| attribute.name === "contenteditable"
				|| attribute.name === "draggable"
				|| attribute.name === "tabindex"
			) {
				element.removeAttribute(attribute.name);
			}
		}
	}
}

function wrapHtmlDocument(fragment: string): string {
	return [
		"<!DOCTYPE html>",
		"<html>",
		"<head><meta charset=\"utf-8\"></head>",
		"<body>",
		"<section data-source=\"obsidian-to-publish\">",
		fragment,
		"</section>",
		"</body>",
		"</html>"
	].join("");
}

async function writeRichClipboard(html: string, fragment: string, text: string) {
	if (navigator.clipboard?.write && "ClipboardItem" in window) {
		const item = new ClipboardItem({
			"text/html": new Blob([html], { type: "text/html" }),
			"text/plain": new Blob([text], { type: "text/plain" })
		});
		await navigator.clipboard.write([item]);
		return;
	}

	if (copyHtmlWithSelection(fragment)) {
		return;
	}

	await navigator.clipboard.writeText(text);
}

function copyHtmlWithSelection(fragment: string): boolean {
	const container = document.createElement("div");
	container.contentEditable = "true";
	container.style.left = "-99999px";
	container.style.position = "fixed";
	container.style.top = "0";
	container.innerHTML = fragment;
	document.body.appendChild(container);

	const selection = window.getSelection();
	if (!selection) {
		container.remove();
		return false;
	}

	const range = document.createRange();
	range.selectNodeContents(container);
	selection.removeAllRanges();
	selection.addRange(range);

	let copied = false;
	try {
		copied = document.execCommand("copy");
	} finally {
		selection.removeAllRanges();
		container.remove();
	}

	return copied;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	const chunkSize = 0x8000;
	let binary = "";

	for (let index = 0; index < bytes.length; index += chunkSize) {
		const chunk = bytes.subarray(index, index + chunkSize);
		binary += String.fromCharCode(...chunk);
	}

	return btoa(binary);
}
