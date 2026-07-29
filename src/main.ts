import {
	App,
	Component,
	ItemView,
	MarkdownRenderer,
	MarkdownView,
	Notice,
	Plugin,
	PluginSettingTab,
	Platform,
	Setting,
	TFile,
	WorkspaceLeaf
} from "obsidian";

import {
	extractMarkdownImageLinks,
	extractRenderedImageAttachmentTarget,
	extractStandaloneMarkdownImageAttachmentLinkTarget,
	extractStandaloneMarkdownImageEmbedTarget,
	normalizeImageLink
} from "./rendering/image-links";
import {
	applyPlatformProfile,
	isCopyPlatform,
	PLATFORM_PROFILE_LIST,
	PLATFORM_PROFILES,
	wrapPlatformFragment
} from "./platforms/profiles";
import type {
	CopyPlatform,
	PlatformProfile
} from "./platforms/types";

const VIEW_TYPE_WECHAT_PREVIEW = "obsidian-to-publish-view";

interface WeChatPreviewCopySettings {
	autoOpen: boolean;
	embedLocalImages: boolean;
	inlineStyles: boolean;
	targetPlatform: CopyPlatform;
}

interface ClipboardPayload {
	fragment: string;
	html: string;
	image: ClipboardImagePayload | null;
	imageCount: number;
	text: string;
	unresolvedImages: number;
}

interface ClipboardImagePayload {
	blob: Blob;
	file: TFile;
	mime: string;
}

interface CopyResult {
	imageCount: number;
	hasClipboardImage: boolean;
	profile: PlatformProfile;
	unresolvedImages: number;
}

type RuntimeRequire = (moduleName: string) => unknown;

const DEFAULT_SETTINGS: WeChatPreviewCopySettings = {
	autoOpen: true,
	embedLocalImages: true,
	inlineStyles: true,
	targetPlatform: "wechat"
};

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

export default class WeChatPreviewCopyPlugin extends Plugin {
	settings: WeChatPreviewCopySettings = DEFAULT_SETTINGS;
	private lastMarkdownFile: TFile | null = null;
	private refreshTimer: number | null = null;

	async onload() {
		const loadedSettings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		this.settings = {
			...loadedSettings,
			targetPlatform: isCopyPlatform(loadedSettings.targetPlatform)
				? loadedSettings.targetPlatform
				: DEFAULT_SETTINGS.targetPlatform
		};
		this.rememberActiveMarkdownFile();

		this.registerView(
			VIEW_TYPE_WECHAT_PREVIEW,
			(leaf) => new WeChatPreviewCopyView(leaf, this)
		);

		this.addRibbonIcon("copy", "打开发布预览", () => {
			void this.activateView();
		});

		this.addCommand({
			id: "open-copy-preview",
			name: "打开发布预览",
			callback: () => {
				void this.activateView();
			}
		});

		this.addCommand({
			id: "copy-current-note-for-target-platform",
			name: "复制当前笔记到目标平台",
			callback: () => {
				void this.copyCurrentNoteForTargetPlatform();
			}
		});

		this.addCommand({
			id: "copy-current-note-and-open-editor",
			name: "复制当前笔记并打开平台编辑器",
			callback: () => {
				void this.copyCurrentNoteAndOpenEditor();
			}
		});

		this.addCommand({
			id: "copy-current-note-for-wechat",
			name: "复制当前笔记到微信公众号",
			callback: () => {
				void this.copyCurrentNoteForPlatform("wechat");
			}
		});

		this.addCommand({
			id: "copy-current-note-for-zhishixingqiu",
			name: "复制当前笔记到知识星球",
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

	async copyCurrentNoteAndOpenEditor() {
		const leaf = await this.getOrCreatePreviewLeaf();
		this.app.workspace.revealLeaf(leaf);

		if (leaf.view instanceof WeChatPreviewCopyView) {
			await leaf.view.renderActiveFile();
			await leaf.view.copyAndOpenCurrentPlatform();
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
		const renders: Promise<void>[] = [];
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_WECHAT_PREVIEW)) {
			if (leaf.view instanceof WeChatPreviewCopyView) {
				leaf.view.syncPlatformControls();
				renders.push(leaf.view.renderActiveFile());
			}
		}
		await Promise.all(renders);
	}

	async refreshPreviewViews() {
		const renders: Promise<void>[] = [];
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_WECHAT_PREVIEW)) {
			if (leaf.view instanceof WeChatPreviewCopyView) {
				renders.push(leaf.view.renderActiveFile());
			}
		}
		await Promise.all(renders);
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

	async fileToClipboardImage(file: TFile): Promise<ClipboardImagePayload> {
		const mime = IMAGE_MIME_BY_EXTENSION[file.extension.toLowerCase()];
		if (!mime) {
			throw new Error(`Unsupported image type: ${file.extension}`);
		}

		const buffer = await this.app.vault.readBinary(file);
		return {
			blob: new Blob([buffer], { type: mime }),
			file,
			mime
		};
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
	private currentUnresolvedImages = 0;
	private copyButton!: HTMLButtonElement;
	private openEditorButton!: HTMLButtonElement;
	private platformSelect!: HTMLSelectElement;
	private previewEl!: HTMLElement;
	private renderComponent: Component | null = null;
	private renderSerial = 0;
	private sourceEl!: HTMLElement;
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
		return "发布预览";
	}

	getIcon() {
		return "copy";
	}

	async onOpen() {
		this.contentEl.empty();
		this.contentEl.addClass("obsidian-to-publish-view");

		const toolbarEl = this.contentEl.createDiv({ cls: "obsidian-to-publish-toolbar" });

		this.platformSelect = toolbarEl.createEl("select");
		for (const profile of PLATFORM_PROFILE_LIST) {
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

		this.openEditorButton = toolbarEl.createEl("button", { text: "" });
		this.openEditorButton.addEventListener("click", () => {
			void this.copyAndOpenCurrentPlatform();
		});

		const refreshButton = toolbarEl.createEl("button", { text: "刷新" });
		refreshButton.addEventListener("click", () => {
			void this.renderActiveFile();
		});

		this.statusEl = toolbarEl.createDiv({ cls: "obsidian-to-publish-status" });
		this.previewEl = this.contentEl.createDiv({ cls: "obsidian-to-publish-content" });
		this.sourceEl = this.contentEl.createDiv({
			cls: "obsidian-to-publish-source markdown-rendered"
		});
		this.syncPlatformControls();

		await this.renderActiveFile();
	}

	syncPlatformControls() {
		if (!this.copyButton || !this.openEditorButton || !this.platformSelect) {
			return;
		}

		const profile = this.plugin.getCurrentPlatformProfile();
		const canOpenEditor = isSafeEditorUrl(profile.editorUrl);
		this.platformSelect.value = profile.id;
		this.copyButton.setText("复制");
		this.openEditorButton.disabled = !canOpenEditor;
		this.openEditorButton.setText(
			canOpenEditor ? "复制并打开" : "无可用编辑器入口"
		);
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
		this.currentUnresolvedImages = 0;

		this.renderComponent?.unload();
		this.renderComponent = null;
		this.previewEl.empty();
		this.sourceEl.empty();

		if (!file) {
			this.statusEl.setText("未打开 Markdown 笔记");
			this.previewEl.createDiv({
				cls: "obsidian-to-publish-empty",
				text: "打开一篇 Markdown 笔记后在这里预览。"
			});
			return;
		}

		this.statusEl.setText(file.path);

		const markdown = await this.plugin.getMarkdownForFile(file);
		if (serial !== this.renderSerial) {
			return;
		}

		this.currentMarkdown = this.removeRedundantImageAttachmentLinkLines(markdown);
		this.renderComponent = new Component();
		this.renderComponent.load();

		await MarkdownRenderer.render(
			this.app,
			this.currentMarkdown,
			this.sourceEl,
			file.path,
			this.renderComponent
		);
		this.removeRenderedRuntimeControls(this.sourceEl, serial);

		const preview = await this.buildPlatformFragment();
		if (serial !== this.renderSerial) {
			return;
		}

		this.currentUnresolvedImages = preview.unresolvedImages;
		this.previewEl.innerHTML = preview.fragment;
		this.updateStatus(file, preview.unresolvedImages);
	}

	async copyForCurrentPlatform(options: {
		notifyFailure?: boolean;
		notifySuccess?: boolean;
	} = {}): Promise<CopyResult | null> {
		const shouldNotifyFailure = options.notifyFailure !== false;
		const shouldNotifySuccess = options.notifySuccess !== false;
		if (!this.currentFile) {
			if (shouldNotifyFailure) {
				new Notice("请先打开一篇 Markdown 笔记。");
			}
			return null;
		}

		await this.renderActiveFile();
		if (!this.currentFile) {
			if (shouldNotifyFailure) {
				new Notice("请先打开一篇 Markdown 笔记。");
			}
			return null;
		}

		try {
			const clipboard = await this.buildClipboardPayload();
			const profile = this.plugin.getCurrentPlatformProfile();
			const hasClipboardImage = await writePlatformClipboard(profile, clipboard, this.currentMarkdown);
			const result: CopyResult = {
				hasClipboardImage,
				imageCount: clipboard.imageCount,
				profile,
				unresolvedImages: clipboard.unresolvedImages
			};

			if (shouldNotifySuccess) {
				new Notice(getCopyNotice(profile, result));
			}
			return result;
		} catch (error) {
			console.error(error);
			if (shouldNotifyFailure) {
				new Notice("复制失败，请查看控制台。");
			}
			return null;
		}
	}

	async copyAndOpenCurrentPlatform() {
		const result = await this.copyForCurrentPlatform({ notifySuccess: false });
		if (!result) {
			return;
		}

		const opened = await openPlatformEditor(result.profile.editorUrl);
		if (opened) {
			new Notice(getCopyAndOpenNotice(result));
		} else {
			new Notice(`${getCopyNotice(result.profile, result)} 无法自动打开编辑器，请手动打开：${result.profile.editorUrl}`);
		}
	}

	private async buildClipboardPayload(): Promise<ClipboardPayload> {
		const profile = this.plugin.getCurrentPlatformProfile();
		const fragment = this.previewEl.innerHTML;
		const imageResult = await this.buildClipboardImagePayload(profile);
		return {
			fragment,
			html: wrapHtmlDocument(fragment),
			image: imageResult.image,
			imageCount: imageResult.imageCount,
			text: this.previewEl.innerText || this.currentMarkdown,
			unresolvedImages: this.currentUnresolvedImages
		};
	}

	private async buildClipboardImagePayload(profile: PlatformProfile): Promise<{
		image: ClipboardImagePayload | null;
		imageCount: number;
	}> {
		const imageFiles = this.resolveEmbeddedImageFiles();
		if (imageFiles.length === 0) {
			return {
				image: null,
				imageCount: 0
			};
		}

		if (profile.capabilities.requiresRemoteImageUrl) {
			return {
				image: null,
				imageCount: imageFiles.length
			};
		}

		try {
			return {
				image: await this.plugin.fileToClipboardImage(imageFiles[0]),
				imageCount: imageFiles.length
			};
		} catch (error) {
			console.error(`Unable to prepare clipboard image: ${imageFiles[0].path}`, error);
			return {
				image: null,
				imageCount: imageFiles.length
			};
		}
	}

	private async buildPlatformFragment(): Promise<{
		fragment: string;
		unresolvedImages: number;
	}> {
		const profile = this.plugin.getCurrentPlatformProfile();
		const embeddedImageFiles = this.resolveEmbeddedImageFiles();
		const clone = this.sourceEl.cloneNode(true) as HTMLElement;
		clone.classList.remove("obsidian-to-publish-source", "markdown-rendered");

		if (this.plugin.settings.inlineStyles) {
			inlineComputedStyles(this.sourceEl, clone);
		}

		this.removeRenderedAttachmentOpenLinks(clone, embeddedImageFiles);
		applyPlatformProfile(clone, this.plugin.settings.targetPlatform);
		this.removeRenderedAttachmentOpenLinks(clone, embeddedImageFiles);

		const unresolvedImages = profile.capabilities.requiresRemoteImageUrl
			? embeddedImageFiles.length
			: this.plugin.settings.embedLocalImages
			? await this.embedLocalImages(clone)
			: 0;

		removeObsidianRuntimeControls(clone);
		replaceTaskCheckboxes(clone);
		this.removeRenderedAttachmentOpenLinks(clone, embeddedImageFiles);
		removeObsidianRuntimeAttributes(clone);

		return {
			fragment: wrapPlatformFragment(clone.innerHTML, this.plugin.settings.targetPlatform),
			unresolvedImages
		};
	}

	private async embedLocalImages(clone: HTMLElement): Promise<number> {
		const cloneImages = Array.from(clone.querySelectorAll("img"));
		const sourceImages = Array.from(this.sourceEl.querySelectorAll("img"));
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

	private removeRenderedRuntimeControls(root: HTMLElement, serial: number) {
		removeObsidianRuntimeControls(root);

		window.requestAnimationFrame(() => {
			if (serial === this.renderSerial) {
				removeObsidianRuntimeControls(root);
			}
		});

		window.setTimeout(() => {
			if (serial === this.renderSerial) {
				removeObsidianRuntimeControls(root);
			}
		}, 100);
	}

	private updateStatus(file: TFile, unresolvedImages: number) {
		const profile = this.plugin.getCurrentPlatformProfile();
		const imageWarning = profile.capabilities.requiresRemoteImageUrl && unresolvedImages > 0
			? ` · ${unresolvedImages} 张本地图片需先上传为线上 URL`
			: profile.capabilities.requiresManualImageUpload
			? " · 图片可能需要手动上传"
			: unresolvedImages === 0
				? ""
				: ` · ${unresolvedImages} 张图片未嵌入`;
		this.statusEl.setText(`${file.path} · 正在预览${profile.copyLabel}的${getClipboardFormatLabel(profile)}${imageWarning}`);
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

	private removeRedundantImageAttachmentLinkLines(markdown: string): string {
		const lines = markdown.split(/\r?\n/);
		const shouldRemove = new Set<number>();

		for (let index = 0; index < lines.length; index += 1) {
			const linkTarget = extractStandaloneMarkdownImageAttachmentLinkTarget(lines[index]);
			if (!linkTarget) {
				continue;
			}

			const linkFile = this.resolveLinkToImageFile(linkTarget);
			if (!linkFile) {
				continue;
			}

			const previousImageFile = this.resolveNeighboringMarkdownImageFile(lines, index, -1);
			const nextImageFile = this.resolveNeighboringMarkdownImageFile(lines, index, 1);
			if (
				previousImageFile?.path === linkFile.path
				|| nextImageFile?.path === linkFile.path
			) {
				shouldRemove.add(index);
			}
		}

		if (shouldRemove.size === 0) {
			return markdown;
		}

		return lines.filter((_, index) => !shouldRemove.has(index)).join("\n");
	}

	private resolveNeighboringMarkdownImageFile(lines: string[], index: number, direction: -1 | 1): TFile | null {
		for (let offset = index + direction; offset >= 0 && offset < lines.length; offset += direction) {
			if (!lines[offset].trim()) {
				continue;
			}

			const imageTarget = extractStandaloneMarkdownImageEmbedTarget(lines[offset]);
			return imageTarget ? this.resolveLinkToImageFile(imageTarget) : null;
		}

		return null;
	}

	private removeRenderedAttachmentOpenLinks(root: HTMLElement, embeddedImageFiles: TFile[]) {
		const imageTargets = buildImageAttachmentTargetSet(embeddedImageFiles);

		for (const link of Array.from(root.querySelectorAll<HTMLAnchorElement>("a"))) {
			if (!isRenderedImageAttachmentText(link.textContent ?? "", imageTargets)) {
				continue;
			}

			if (isInsideRenderedImageEmbed(link)) {
				link.remove();
				continue;
			}

			if (!isStandaloneRenderedAttachmentLink(link)) {
				continue;
			}

			removeLinkOrSingleLinkContainer(link);
		}

		removeRenderedImageAttachmentTextNodes(root, imageTargets);
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
			.setName("自动打开预览")
			.setDesc("插件加载时自动打开右侧发布预览。")
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
			.setName("目标平台")
			.setDesc("选择复制和预览时使用的平台格式。")
			.addDropdown((dropdown) => {
				for (const profile of PLATFORM_PROFILE_LIST) {
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
			.setName("嵌入本地图片")
			.setDesc("复制前将 vault 内图片转换为可粘贴的数据。")
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.embedLocalImages)
				.onChange(async (value) => {
					this.plugin.settings.embedLocalImages = value;
					await this.plugin.saveSettings();
					await this.plugin.refreshPreviewViews();
				}));

		new Setting(containerEl)
			.setName("内联源样式")
			.setDesc("应用目标平台样式前，先保留当前预览中的关键计算样式。")
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.inlineStyles)
				.onChange(async (value) => {
					this.plugin.settings.inlineStyles = value;
					await this.plugin.saveSettings();
					await this.plugin.refreshPreviewViews();
				}));
	}
}

function isImageFile(file: TFile): boolean {
	return Boolean(IMAGE_MIME_BY_EXTENSION[file.extension.toLowerCase()]);
}

function isPortableImageSource(src: string): boolean {
	return src.startsWith("data:") || src.startsWith("http://") || src.startsWith("https://");
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

function buildImageAttachmentTargetSet(files: TFile[]): Set<string> {
	const targets = new Set<string>();

	for (const file of files) {
		addImageAttachmentTarget(targets, file.path);
		addImageAttachmentTarget(targets, file.name);
		addImageAttachmentTarget(targets, getPathBasename(file.path));
	}

	return targets;
}

function addImageAttachmentTarget(targets: Set<string>, value: string) {
	const normalized = normalizeImageAttachmentTarget(value);
	if (normalized) {
		targets.add(normalized);
		targets.add(normalizeImageAttachmentTarget(getPathBasename(normalized)));
	}
}

function normalizeImageAttachmentTarget(value: string): string {
	return normalizeImageLink(value).replace(/\\/g, "/").trim().toLowerCase();
}

function getPathBasename(path: string): string {
	const normalizedPath = path.replace(/\\/g, "/");
	return normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1);
}

function isRenderedImageAttachmentText(text: string, imageTargets: Set<string>): boolean {
	const target = extractRenderedImageAttachmentTarget(text);
	if (!target) {
		return false;
	}

	const normalizedTarget = normalizeImageAttachmentTarget(target);
	return (
		imageTargets.has(normalizedTarget)
		|| imageTargets.has(normalizeImageAttachmentTarget(getPathBasename(normalizedTarget)))
	);
}

function removeRenderedImageAttachmentTextNodes(root: HTMLElement, imageTargets: Set<string>) {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const removableTextNodes: Text[] = [];

	while (walker.nextNode()) {
		const node = walker.currentNode;
		if (node instanceof Text && isRenderedImageAttachmentText(node.textContent ?? "", imageTargets)) {
			removableTextNodes.push(node);
		}
	}

	for (const textNode of removableTextNodes) {
		const parent = textNode.parentElement;
		if (!parent || parent.closest("a")) {
			continue;
		}

		if (isInsideRenderedImageEmbed(parent)) {
			textNode.remove();
			continue;
		}

		const container = findStandaloneTextContainer(parent);
		if (container) {
			container.remove();
		}
	}
}

function findStandaloneTextContainer(element: HTMLElement): HTMLElement | null {
	let current: HTMLElement | null = element;

	while (current && current.parentElement) {
		if (current.matches("p,div,span")) {
			const text = current.textContent?.trim() ?? "";
			if (text && !current.querySelector("img") && current.children.length <= 1) {
				return current;
			}
		}

		if (current.matches("section,article,body")) {
			return null;
		}

		current = current.parentElement;
	}

	return null;
}

function removeLinkOrSingleLinkContainer(link: HTMLAnchorElement) {
	const parent = link.parentElement;
	if (
		parent
		&& parent.matches("p,div")
		&& parent.textContent?.trim() === link.textContent?.trim()
		&& !parent.querySelector("img")
	) {
		parent.remove();
		return;
	}

	link.remove();
}

function isInsideRenderedImageEmbed(element: Element): boolean {
	const embed = element.closest(".image-embed,.media-embed,.internal-embed");
	return Boolean(embed?.querySelector("img"));
}

function isStandaloneRenderedAttachmentLink(link: HTMLAnchorElement): boolean {
	const parent = link.parentElement;
	if (!parent) {
		return false;
	}

	return (
		parent.matches("p,div")
		&& parent.textContent?.trim() === link.textContent?.trim()
		&& !parent.querySelector("img")
	);
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

async function writePlatformClipboard(
	profile: PlatformProfile,
	clipboard: ClipboardPayload,
	markdown: string
): Promise<boolean> {
	const text = getTextClipboardContent(profile, markdown, clipboard.text);

	if (profile.preferredFormat === "rich-html") {
		return writeRichClipboard(clipboard.html, clipboard.fragment, text, clipboard.image);
	}

	if (profile.preferredFormat === "markdown" && profile.capabilities.supportsRichHtml && clipboard.image) {
		return writeRichClipboard(clipboard.html, clipboard.fragment, text, clipboard.image);
	}

	return writeTextClipboard(text, clipboard.image);
}

function getTextClipboardContent(profile: PlatformProfile, markdown: string, text: string): string {
	if (profile.preferredFormat === "markdown") {
		return markdown.trim() ? markdown : text;
	}

	return text.trim() ? text : markdown;
}

function getCopyNotice(profile: PlatformProfile, result: ClipboardPayload | CopyResult): string {
	return `已复制${getClipboardFormatLabel(profile)}到${profile.copyLabel}${getImageNoticeSuffix(profile, result)}。`;
}

function getCopyAndOpenNotice(result: CopyResult): string {
	return `已复制${getClipboardFormatLabel(result.profile)}到${result.profile.copyLabel}，并已打开编辑器${getImageNoticeSuffix(result.profile, result)}。`;
}

function getClipboardFormatLabel(profile: PlatformProfile): string {
	if (profile.preferredFormat === "markdown") {
		return "Markdown";
	}

	if (profile.preferredFormat === "plain-text") {
		return "纯文本";
	}

	return "富文本";
}

function getImageNoticeSuffix(profile: PlatformProfile, result: ClipboardPayload | CopyResult): string {
	const hasClipboardImage = "hasClipboardImage" in result
		? result.hasClipboardImage
		: result.image !== null;
	const imageCount = result.imageCount;
	const unresolvedImages = result.unresolvedImages;

	if (profile.capabilities.requiresRemoteImageUrl) {
		if (imageCount === 0) {
			return "";
		}

		return `（${imageCount} 张本地图片不会被该平台识别，请先上传为线上 URL 后再复制）`;
	}

	if (profile.capabilities.requiresManualImageUpload) {
		if (imageCount > 1) {
			return hasClipboardImage
				? `（已尽量携带首张图片，其余 ${imageCount - 1} 张图片可能需要手动上传）`
				: `（${imageCount} 张图片可能需要手动上传）`;
		}

		if (imageCount === 1) {
			return hasClipboardImage
				? "（已尽量携带首张图片，平台不支持时仍需手动上传）"
				: "（图片可能需要手动上传）";
		}

		return "";
	}

	return unresolvedImages === 0
		? ""
		: `（${unresolvedImages} 张图片未嵌入）`;
}

function isSafeEditorUrl(url: string): boolean {
	try {
		return new URL(url).protocol === "https:";
	} catch {
		return false;
	}
}

async function openPlatformEditor(url: string): Promise<boolean> {
	if (!isSafeEditorUrl(url)) {
		return false;
	}

	if (!Platform.isDesktopApp) {
		return false;
	}

	if (Platform.isMacOS && await openUrlInChromeOnMac(url)) {
		return true;
	}

	return openUrlWithElectronShell(url);
}

async function openUrlInChromeOnMac(url: string): Promise<boolean> {
	const requireFn = getRuntimeRequire();
	if (!requireFn) {
		return false;
	}

	try {
		const childProcess = requireFn("child_process") as {
			execFile?: (
				file: string,
				args: string[],
				callback: (error: Error | null) => void
			) => void;
		};
		if (typeof childProcess.execFile !== "function") {
			return false;
		}

		return await new Promise<boolean>((resolve) => {
			childProcess.execFile?.("open", ["-a", "Google Chrome", url], (error) => {
				resolve(!error);
			});
		});
	} catch (error) {
		console.error(`Unable to open Chrome for platform editor: ${url}`, error);
		return false;
	}
}

async function openUrlWithElectronShell(url: string): Promise<boolean> {
	const requireFn = getRuntimeRequire();
	if (!requireFn) {
		return false;
	}

	try {
		const electron = requireFn("electron") as {
			shell?: {
				openExternal?: (target: string) => Promise<void>;
			};
		};
		if (typeof electron.shell?.openExternal !== "function") {
			return false;
		}

		await electron.shell.openExternal(url);
		return true;
	} catch (error) {
		console.error(`Unable to open platform editor: ${url}`, error);
		return false;
	}
}

function getRuntimeRequire(): RuntimeRequire | null {
	const windowWithRequire = window as Window & {
		require?: RuntimeRequire;
	};
	if (typeof windowWithRequire.require === "function") {
		return windowWithRequire.require;
	}

	const globalWithRequire = globalThis as typeof globalThis & {
		require?: RuntimeRequire;
	};
	return typeof globalWithRequire.require === "function" ? globalWithRequire.require : null;
}

async function writeRichClipboard(
	html: string,
	fragment: string,
	text: string,
	image: ClipboardImagePayload | null
): Promise<boolean> {
	if (navigator.clipboard?.write && "ClipboardItem" in window) {
		const basePayload: Record<string, Blob> = {
			"text/html": new Blob([html], { type: "text/html" }),
			"text/plain": new Blob([text], { type: "text/plain" })
		};

		if (image) {
			const itemPayload = {
				...basePayload
			};
			itemPayload[image.mime] = image.blob;
			try {
				await navigator.clipboard.write([new ClipboardItem(itemPayload)]);
				return true;
			} catch (error) {
				console.warn(`Unable to include clipboard image: ${image.file.path}`, error);
			}
		}

		const item = new ClipboardItem(basePayload);
		await navigator.clipboard.write([item]);
		return false;
	}

	if (copyHtmlWithSelection(fragment)) {
		return false;
	}

	return writeTextClipboard(text, image);
}

async function writeTextClipboard(text: string, image: ClipboardImagePayload | null = null): Promise<boolean> {
	if (image && navigator.clipboard?.write && "ClipboardItem" in window) {
		try {
			const item = new ClipboardItem({
				"text/plain": new Blob([text], { type: "text/plain" }),
				[image.mime]: image.blob
			});
			await navigator.clipboard.write([item]);
			return true;
		} catch (error) {
			console.warn(`Unable to include clipboard image: ${image.file.path}`, error);
		}
	}

	if (navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(text);
		return false;
	}

	if (copyTextWithSelection(text)) {
		return false;
	}

	throw new Error("Clipboard text API is not available.");
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

function copyTextWithSelection(text: string): boolean {
	const textarea = document.createElement("textarea");
	textarea.value = text;
	textarea.style.left = "-99999px";
	textarea.style.position = "fixed";
	textarea.style.top = "0";
	document.body.appendChild(textarea);
	textarea.focus();
	textarea.select();

	let copied = false;
	try {
		copied = document.execCommand("copy");
	} finally {
		textarea.remove();
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
