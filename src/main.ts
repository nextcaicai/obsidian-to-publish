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

import {
	extractMarkdownImageLinks,
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
	text: string;
	unresolvedImages: number;
}

interface CopyResult {
	profile: PlatformProfile;
	unresolvedImages: number;
}

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
			id: "copy-current-note-and-open-editor",
			name: "Copy current note and open target platform editor",
			callback: () => {
				void this.copyCurrentNoteAndOpenEditor();
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

		const refreshButton = toolbarEl.createEl("button", { text: "Refresh" });
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
		this.copyButton.setText(`Copy for ${profile.copyLabel}`);
		this.openEditorButton.disabled = !canOpenEditor;
		this.openEditorButton.setText(
			canOpenEditor ? `Copy & open ${profile.copyLabel}` : `No editor URL for ${profile.copyLabel}`
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
				new Notice("Open a Markdown note before copying.");
			}
			return null;
		}

		await this.renderActiveFile();
		if (!this.currentFile) {
			if (shouldNotifyFailure) {
				new Notice("Open a Markdown note before copying.");
			}
			return null;
		}

		try {
			const clipboard = await this.buildClipboardPayload();
			const profile = this.plugin.getCurrentPlatformProfile();
			await writePlatformClipboard(profile, clipboard, this.currentMarkdown);

			if (shouldNotifySuccess) {
				new Notice(getCopyNotice(profile, clipboard.unresolvedImages));
			}
			return {
				profile,
				unresolvedImages: clipboard.unresolvedImages
			};
		} catch (error) {
			console.error(error);
			if (shouldNotifyFailure) {
				new Notice("Copy failed. See console for details.");
			}
			return null;
		}
	}

	async copyAndOpenCurrentPlatform() {
		const result = await this.copyForCurrentPlatform({ notifySuccess: false });
		if (!result) {
			return;
		}

		const opened = openPlatformEditor(result.profile.editorUrl);
		if (opened) {
			new Notice(getCopyAndOpenNotice(result.profile, result.unresolvedImages));
		} else {
			new Notice(`${getCopyNotice(result.profile, result.unresolvedImages)} Open ${result.profile.editorUrl} manually.`);
		}
	}

	private async buildClipboardPayload(): Promise<ClipboardPayload> {
		const fragment = this.previewEl.innerHTML;
		return {
			fragment,
			html: wrapHtmlDocument(fragment),
			text: this.previewEl.innerText || this.currentMarkdown,
			unresolvedImages: this.currentUnresolvedImages
		};
	}

	private async buildPlatformFragment(): Promise<{
		fragment: string;
		unresolvedImages: number;
	}> {
		const clone = this.sourceEl.cloneNode(true) as HTMLElement;
		clone.classList.remove("obsidian-to-publish-source", "markdown-rendered");

		if (this.plugin.settings.inlineStyles) {
			inlineComputedStyles(this.sourceEl, clone);
		}

		applyPlatformProfile(clone, this.plugin.settings.targetPlatform);

		const unresolvedImages = this.plugin.settings.embedLocalImages
			? await this.embedLocalImages(clone)
			: 0;

		removeObsidianRuntimeControls(clone);
		replaceTaskCheckboxes(clone);
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
		const imageWarning = profile.capabilities.requiresManualImageUpload
			? " · images may need manual upload"
			: unresolvedImages === 0
				? ""
				: ` · ${unresolvedImages} image(s) not embedded`;
		this.statusEl.setText(`${file.path} · Previewing ${getClipboardFormatLabel(profile)} for ${profile.copyLabel}${imageWarning}`);
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
			.setName("Embed local images")
			.setDesc("Convert vault images to data URLs before copying.")
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.embedLocalImages)
				.onChange(async (value) => {
					this.plugin.settings.embedLocalImages = value;
					await this.plugin.saveSettings();
					await this.plugin.refreshPreviewViews();
				}));

		new Setting(containerEl)
			.setName("Inline source styles")
			.setDesc("Copy key computed styles before applying the target platform profile.")
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

async function writePlatformClipboard(profile: PlatformProfile, clipboard: ClipboardPayload, markdown: string) {
	if (profile.preferredFormat === "rich-html") {
		await writeRichClipboard(clipboard.html, clipboard.fragment, clipboard.text);
		return;
	}

	await writeTextClipboard(getTextClipboardContent(profile, markdown, clipboard.text));
}

function getTextClipboardContent(profile: PlatformProfile, markdown: string, text: string): string {
	if (profile.preferredFormat === "markdown") {
		return markdown.trim() ? markdown : text;
	}

	return text.trim() ? text : markdown;
}

function getCopyNotice(profile: PlatformProfile, unresolvedImages: number): string {
	return `Copied ${getClipboardFormatLabel(profile)} for ${profile.copyLabel}${getImageNoticeSuffix(profile, unresolvedImages)}.`;
}

function getCopyAndOpenNotice(profile: PlatformProfile, unresolvedImages: number): string {
	return `Copied ${getClipboardFormatLabel(profile)} for ${profile.copyLabel} and opened editor${getImageNoticeSuffix(profile, unresolvedImages)}.`;
}

function getClipboardFormatLabel(profile: PlatformProfile): string {
	if (profile.preferredFormat === "markdown") {
		return "Markdown";
	}

	if (profile.preferredFormat === "plain-text") {
		return "plain text";
	}

	return "rich HTML";
}

function getImageNoticeSuffix(profile: PlatformProfile, unresolvedImages: number): string {
	if (profile.capabilities.requiresManualImageUpload) {
		return " (images may need manual upload)";
	}

	return unresolvedImages === 0
		? ""
		: ` (${unresolvedImages} image(s) could not be embedded)`;
}

function isSafeEditorUrl(url: string): boolean {
	try {
		return new URL(url).protocol === "https:";
	} catch {
		return false;
	}
}

function openPlatformEditor(url: string): boolean {
	if (!isSafeEditorUrl(url)) {
		return false;
	}

	try {
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.rel = "noopener noreferrer";
		anchor.target = "_blank";
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
		return true;
	} catch (error) {
		console.error(`Unable to open platform editor: ${url}`, error);
		return false;
	}
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

	await writeTextClipboard(text);
}

async function writeTextClipboard(text: string) {
	if (navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(text);
		return;
	}

	if (copyTextWithSelection(text)) {
		return;
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
