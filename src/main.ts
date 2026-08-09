import {
	App,
	ButtonComponent,
	Component,
	ItemView,
	MarkdownRenderer,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Platform,
	requestUrl,
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
	PLATFORM_PICKER_LIST,
	PLATFORM_PROFILE_LIST,
	PLATFORM_PROFILES,
	wrapPlatformFragment
} from "./platforms/profiles";
import {
	ensurePrimaryInSelectedPlatforms,
	formatSelectedPlatformsLabel,
	normalizeSelectedPlatforms,
	resolvePrimaryPlatform,
	togglePlatformSelection
} from "./platforms/selection";
import {
	createChromeCompanionBridgeService,
	DEFAULT_CHROME_COMPANION_BRIDGE_SETTINGS,
	generateChromeCompanionToken
} from "./publishing/chrome-bridge";
import { sendToChromeCompanionAndActivate } from "./publishing/chrome-delivery";
import {
	createWechatDraftFromPackage,
	DEFAULT_WECHAT_OFFICIAL_SETTINGS,
	detectWechatOutboundIp as detectWechatOutboundIpWithOfficialApi,
	normalizeWechatOfficialSettings,
	upsertWechatCoverMediaRecord,
	upsertWechatDraftRecord,
	WechatIpWhitelistError
} from "./publishing/wechat-official";
import {
	DEFAULT_FEISHU_DOCS_SETTINGS,
	normalizeFeishuDocsSettings,
	syncPackageToFeishuDoc
} from "./publishing/feishu-docs";
import { buildPublishPackageV1 } from "./publishing/package";
import type {
	CopyPlatform,
	PlatformProfile
} from "./platforms/types";
import type {
	ChromeCompanionBridgeService,
	ChromeCompanionBridgeSettings
} from "./publishing/chrome-bridge";
import type { FeishuDocsSettings } from "./publishing/feishu-docs";
import type {
	OfficialRequestOptions,
	OfficialRequestResponse
} from "./publishing/official-http";
import type { WechatOfficialSettings } from "./publishing/wechat-official";
import type {
	PublishPackageV1,
	ResolvedPublishImage
} from "./publishing/types";

const VIEW_TYPE_WECHAT_PREVIEW = "obsidian-to-publish-view";
const WECHAT_DEVELOPER_PLATFORM_URL = "https://developers.weixin.qq.com/platform/";

interface WeChatPreviewCopySettings {
	autoOpen: boolean;
	chromeCompanionBridge: ChromeCompanionBridgeSettings;
	embedLocalImages: boolean;
	feishuDocs: FeishuDocsSettings;
	inlineStyles: boolean;
	selectedPlatforms: CopyPlatform[];
	targetPlatform: CopyPlatform;
	wechatOfficial: WechatOfficialSettings;
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
	chromeCompanionBridge: DEFAULT_CHROME_COMPANION_BRIDGE_SETTINGS,
	embedLocalImages: true,
	feishuDocs: DEFAULT_FEISHU_DOCS_SETTINGS,
	inlineStyles: true,
	selectedPlatforms: ["wechat"],
	targetPlatform: "wechat",
	wechatOfficial: DEFAULT_WECHAT_OFFICIAL_SETTINGS
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
	private chromeCompanionBridge: ChromeCompanionBridgeService | null = null;
	private lastMarkdownFile: TFile | null = null;
	private refreshTimer: number | null = null;

	async onload() {
		const loadedSettings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		const chromeCompanionBridge = normalizeChromeCompanionBridgeSettings(loadedSettings.chromeCompanionBridge);
		const wechatOfficial = normalizeWechatOfficialSettings(loadedSettings.wechatOfficial);
		const feishuDocs = normalizeFeishuDocsSettings(loadedSettings.feishuDocs);
		const targetPlatform = isCopyPlatform(loadedSettings.targetPlatform)
			? loadedSettings.targetPlatform
			: DEFAULT_SETTINGS.targetPlatform;
		const selectedPlatforms = ensurePrimaryInSelectedPlatforms(
			normalizeSelectedPlatforms(loadedSettings.selectedPlatforms, targetPlatform),
			targetPlatform
		);
		let shouldSaveNormalizedSettings = false;
		if (!chromeCompanionBridge.token) {
			chromeCompanionBridge.token = generateChromeCompanionToken();
			shouldSaveNormalizedSettings = true;
		}
		this.settings = {
			...loadedSettings,
			chromeCompanionBridge,
			feishuDocs,
			selectedPlatforms,
			targetPlatform: resolvePrimaryPlatform(selectedPlatforms, targetPlatform),
			wechatOfficial
		};
		if (shouldSaveNormalizedSettings) {
			await this.saveSettings();
		}
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
			id: "copy-current-note-publish-package-json",
			name: "复制当前笔记发布包 JSON",
			callback: () => {
				void this.copyCurrentNotePublishPackageJson();
			}
		});

		this.addCommand({
			id: "send-current-note-to-chrome-companion",
			name: "发送当前笔记到 Chrome 插件",
			callback: () => {
				void this.sendCurrentNoteToChromeCompanion();
			}
		});

		this.addCommand({
			id: "send-current-note-to-wechat-official-draft",
			name: "发送当前笔记到微信公众号草稿箱",
			callback: () => {
				void this.sendCurrentNoteToWechatOfficialDraft();
			}
		});

		this.addCommand({
			id: "sync-current-note-to-feishu-doc",
			name: "同步当前笔记到飞书云文档",
			callback: () => {
				void this.syncCurrentNoteToFeishuDoc();
			}
		});

		this.addCommand({
			id: "start-chrome-companion-bridge",
			name: "启动 Chrome 插件连接",
			callback: () => {
				void this.startChromeCompanionBridge();
			}
		});

		this.addCommand({
			id: "stop-chrome-companion-bridge",
			name: "停止 Chrome 插件连接",
			callback: () => {
				void this.stopChromeCompanionBridge();
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
			if (this.settings.chromeCompanionBridge.enabled) {
				void this.startChromeCompanionBridge(false);
			}

			if (this.settings.autoOpen) {
				void this.activateView(false);
			}
		});
	}

	onunload() {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
		}
		void this.stopChromeCompanionBridge(false);
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

	async copyCurrentNotePublishPackageJson() {
		const leaf = await this.getOrCreatePreviewLeaf();
		this.app.workspace.revealLeaf(leaf);

		if (leaf.view instanceof WeChatPreviewCopyView) {
			await leaf.view.renderActiveFile();
			await leaf.view.copyPublishPackageJson();
		}
	}

	async sendCurrentNoteToChromeCompanion() {
		if (!await this.startChromeCompanionBridge(false)) {
			return;
		}

		const leaf = await this.getOrCreatePreviewLeaf();
		this.app.workspace.revealLeaf(leaf);

		if (!(leaf.view instanceof WeChatPreviewCopyView)) {
			new Notice("发布预览未就绪。");
			return;
		}

		await leaf.view.renderActiveFile();

		try {
			const publishPackage = await leaf.view.buildPublishPackage();
			await this.sendPublishPackageToChromeCompanion(publishPackage);
		} catch (error) {
			console.error(error);
			new Notice("发送到 Chrome 插件失败，请查看控制台。");
		}
	}

	async sendCurrentNoteToWechatOfficialDraft() {
		const leaf = await this.getOrCreatePreviewLeaf();
		this.app.workspace.revealLeaf(leaf);

		if (!(leaf.view instanceof WeChatPreviewCopyView)) {
			new Notice("发布预览未就绪。");
			return;
		}

		await leaf.view.renderActiveFile();
		new Notice("正在发送到微信公众号草稿箱...");

		try {
			const publishPackage = await leaf.view.buildPublishPackage("wechat");
			const result = await createWechatDraftFromPackage(
				publishPackage,
				this.settings.wechatOfficial,
				(options) => this.requestOfficialApi(options)
			);
			if (result.warnings.length > 0) {
				console.warn("微信公众号草稿创建提示:", result.warnings);
			}
			this.settings.wechatOfficial.draftRecords = upsertWechatDraftRecord(
				this.settings.wechatOfficial.draftRecords,
				result.draftRecord
			);
			this.settings.wechatOfficial.coverMediaRecords = upsertWechatCoverMediaRecord(
				this.settings.wechatOfficial.coverMediaRecords,
				result.coverMediaRecord
			);
			let persistenceWarning = "";
			try {
				await this.saveSettings();
			} catch (error) {
				console.error("微信草稿已同步，但本地草稿关联保存失败:", error);
				persistenceWarning = "，但本地草稿关联保存失败";
			}
			const warningSuffix = result.warnings.length > 0 ? `，${result.warnings.length} 条提示见控制台` : "";
			const actionLabel = result.action === "updated" ? "更新" : "创建";
			new Notice(`已${actionLabel}微信公众号草稿：${result.mediaId}（${result.uploadedImages} 张正文图片）${warningSuffix}${persistenceWarning}。`);
		} catch (error) {
			console.error(error);
			if (error instanceof WechatIpWhitelistError) {
				new WechatIpWhitelistModal(this.app, error).open();
				return;
			}
			new Notice(getErrorMessage(error, "发送到微信公众号草稿箱失败，请查看控制台。"));
		}
	}

	async detectWechatOutboundIp() {
		return detectWechatOutboundIpWithOfficialApi(
			this.settings.wechatOfficial,
			(options) => this.requestOfficialApi(options)
		);
	}

	async syncCurrentNoteToFeishuDoc() {
		const leaf = await this.getOrCreatePreviewLeaf();
		this.app.workspace.revealLeaf(leaf);

		if (!(leaf.view instanceof WeChatPreviewCopyView)) {
			new Notice("发布预览未就绪。");
			return;
		}

		await leaf.view.renderActiveFile();
		new Notice("正在同步到飞书云文档...");

		try {
			const publishPackage = await leaf.view.buildPublishPackage("feishu");
			const result = await syncPackageToFeishuDoc(
				publishPackage,
				this.settings.feishuDocs,
				(options) => this.requestOfficialApi(options)
			);
			if (result.warnings.length > 0) {
				console.warn("飞书云文档同步提示:", result.warnings);
			}
			const imageSuffix = result.uploadedImages > 0
				? `（${result.uploadedImages} 张图片）`
				: result.replacedAssetImages > 0
					? "（本地图片未全部上传，详见控制台）"
					: "";
			const warningSuffix = result.warnings.length > 0 ? `，${result.warnings.length} 条提示见控制台` : "";
			new Notice(`已同步到飞书云文档：${result.url}${imageSuffix}${warningSuffix}。`);
		} catch (error) {
			console.error(error);
			new Notice(getErrorMessage(error, "同步到飞书云文档失败，请查看控制台。"));
		}
	}

	async copyCurrentNoteForPlatform(platform: CopyPlatform) {
		await this.setTargetPlatform(platform);
		await this.copyCurrentNoteForTargetPlatform();
	}

	getCurrentPlatformProfile(): PlatformProfile {
		return PLATFORM_PROFILES[this.settings.targetPlatform];
	}

	getSelectedPlatforms(): CopyPlatform[] {
		return ensurePrimaryInSelectedPlatforms(
			this.settings.selectedPlatforms,
			this.settings.targetPlatform
		);
	}

	shouldUseWechatOfficialDraftAction(platform: CopyPlatform = this.settings.targetPlatform): boolean {
		return platform === "wechat" && this.settings.wechatOfficial.enabled;
	}

	shouldUseFeishuDocsAction(platform: CopyPlatform = this.settings.targetPlatform): boolean {
		return platform === "feishu";
	}

	shouldUseChromeCompanionForPlatform(platform: CopyPlatform = this.settings.targetPlatform): boolean {
		return this.settings.chromeCompanionBridge.enabled
			&& platform !== "wechat"
			&& platform !== "feishu";
	}

	shouldUseChromeCompanionForCurrentPlatform(): boolean {
		return this.shouldUseChromeCompanionForPlatform(this.settings.targetPlatform);
	}

	syncPreviewControls() {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_WECHAT_PREVIEW)) {
			if (leaf.view instanceof WeChatPreviewCopyView) {
				leaf.view.syncPlatformControls();
			}
		}
	}

	async setTargetPlatform(platform: CopyPlatform) {
		await this.setSelectedPlatforms(
			ensurePrimaryInSelectedPlatforms(this.settings.selectedPlatforms, platform),
			platform
		);
	}

	async setSelectedPlatforms(platforms: CopyPlatform[], primaryPlatform?: CopyPlatform) {
		const preferredPrimary = primaryPlatform ?? this.settings.targetPlatform;
		const selectedPlatforms = ensurePrimaryInSelectedPlatforms(platforms, preferredPrimary);
		const nextPrimary = resolvePrimaryPlatform(selectedPlatforms, preferredPrimary);
		const primaryChanged = nextPrimary !== this.settings.targetPlatform;
		this.settings.selectedPlatforms = selectedPlatforms;
		this.settings.targetPlatform = nextPrimary;
		await this.saveSettings();

		const renders: Promise<void>[] = [];
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_WECHAT_PREVIEW)) {
			if (leaf.view instanceof WeChatPreviewCopyView) {
				leaf.view.syncPlatformControls();
				if (primaryChanged) {
					renders.push(leaf.view.renderActiveFile());
				}
			}
		}
		await Promise.all(renders);
	}

	async toggleSelectedPlatform(platform: CopyPlatform, checked: boolean) {
		const next = togglePlatformSelection(
			this.settings.selectedPlatforms,
			platform,
			checked,
			this.settings.targetPlatform
		);
		await this.setSelectedPlatforms(next.selectedPlatforms, next.primaryPlatform);
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

	async fileToResolvedPublishImage(file: TFile): Promise<ResolvedPublishImage> {
		const mime = IMAGE_MIME_BY_EXTENSION[file.extension.toLowerCase()];
		if (!mime) {
			throw new Error(`Unsupported image type: ${file.extension}`);
		}

		return {
			path: file.path,
			fileName: file.name,
			mime,
			data: await this.app.vault.readBinary(file),
			mtime: file.stat.mtime
		};
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async requestOfficialApi(options: OfficialRequestOptions): Promise<OfficialRequestResponse> {
		return requestUrl(options as Parameters<typeof requestUrl>[0]) as Promise<OfficialRequestResponse>;
	}

	async startChromeCompanionBridge(notify = true): Promise<boolean> {
		if (!Platform.isDesktopApp) {
			if (notify) {
				new Notice("Chrome 插件连接仅支持 Obsidian 桌面端。");
			}
			return false;
		}

		const requireFn = getRuntimeRequire();
		if (!requireFn) {
			if (notify) {
				new Notice("当前环境无法启动本地连接。");
			}
			return false;
		}

		try {
			await this.getChromeCompanionBridgeService(requireFn).start();
			if (notify) {
				const status = this.getChromeCompanionBridgeStatus();
				new Notice(`Chrome 插件连接已启动：127.0.0.1:${status.port}。`);
			}
			return true;
		} catch (error) {
			console.error(error);
			if (notify) {
				new Notice("Chrome 插件连接启动失败，请检查端口是否被占用。");
			}
			return false;
		}
	}

	async stopChromeCompanionBridge(notify = true): Promise<void> {
		if (!this.chromeCompanionBridge) {
			return;
		}

		try {
			await this.chromeCompanionBridge.stop();
			this.chromeCompanionBridge = null;
			if (notify) {
				new Notice("Chrome 插件连接已停止。");
			}
		} catch (error) {
			console.error(error);
			if (notify) {
				new Notice("停止 Chrome 插件连接失败，请查看控制台。");
			}
		}
	}

	async restartChromeCompanionBridgeIfEnabled(): Promise<void> {
		if (!this.settings.chromeCompanionBridge.enabled) {
			return;
		}

		await this.stopChromeCompanionBridge(false);
		await this.startChromeCompanionBridge(false);
	}

	async sendPublishPackageToChromeCompanion(
		publishPackage: PublishPackageV1,
		options: { notify?: boolean } = {}
	): Promise<boolean> {
		const shouldNotify = options.notify !== false;
		if (!await this.startChromeCompanionBridge(false)) {
			return false;
		}

		try {
			const target = publishPackage.targets[0];
			const profile = isCopyPlatform(target)
				? PLATFORM_PROFILES[target]
				: this.getCurrentPlatformProfile();
			const result = await this.getChromeCompanionBridgeService().request("article.importDraft", {
				package: publishPackage
			}, { timeoutMs: 15000 });
			const accepted = isRecord(result) && result.accepted === true;
			if (accepted) {
				if (shouldNotify) {
					new Notice(`已发送到 Chrome 插件：${profile.copyLabel}。`);
				}
				return true;
			}

			if (shouldNotify) {
				new Notice("Chrome 插件已响应，但未确认导入，请查看 Chrome 扩展日志。");
			}
			return false;
		} catch (error) {
			console.error(error);
			if (shouldNotify) {
				const status = this.getChromeCompanionBridgeStatus();
				const hint = status.hasClient ? "请查看控制台。" : "请确认 Chrome companion 已加载并填入令牌。";
				new Notice(`发送到 Chrome 插件失败，${hint}`);
			}
			return false;
		}
	}

	getChromeCompanionBridgeStatus() {
		return this.chromeCompanionBridge?.getStatus() ?? {
			running: false,
			port: this.settings.chromeCompanionBridge.port,
			hasClient: false,
			clientLabel: "",
			clientVersion: "",
			lastSeenAt: null
		};
	}

	private getChromeCompanionBridgeService(requireFn: RuntimeRequire | null = getRuntimeRequire()): ChromeCompanionBridgeService {
		if (!requireFn) {
			throw new Error("Runtime require is not available.");
		}

		if (!this.chromeCompanionBridge) {
			this.chromeCompanionBridge = createChromeCompanionBridgeService({
				...this.settings.chromeCompanionBridge,
				requireFn,
				pluginVersion: this.manifest.version,
				supportedPlatforms: getSupportedChromeCompanionPlatforms()
			});
		}

		return this.chromeCompanionBridge;
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
	private platformMenuEl: HTMLElement | null = null;
	private platformPickerEl!: HTMLElement;
	private platformTriggerEl!: HTMLButtonElement;
	private platformTriggerLabelEl!: HTMLElement;
	private platformMenuOpen = false;
	private previewEl!: HTMLElement;
	private renderComponent: Component | null = null;
	private renderSerial = 0;
	private sourceEl!: HTMLElement;
	private documentClickHandler: ((event: MouseEvent) => void) | null = null;
	private windowRepositionHandler: (() => void) | null = null;

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
		this.createPlatformPicker(toolbarEl);

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

		this.previewEl = this.contentEl.createDiv({ cls: "obsidian-to-publish-content" });
		this.sourceEl = this.contentEl.createDiv({
			cls: "obsidian-to-publish-source markdown-rendered"
		});
		this.syncPlatformControls();

		await this.renderActiveFile();
	}

	private createPlatformPicker(toolbarEl: HTMLElement) {
		this.platformPickerEl = toolbarEl.createDiv({ cls: "obsidian-to-publish-platform-picker" });
		this.platformTriggerEl = this.platformPickerEl.createEl("button", {
			cls: "obsidian-to-publish-platform-trigger",
			attr: {
				type: "button",
				"aria-haspopup": "listbox",
				"aria-expanded": "false"
			}
		});
		this.platformTriggerLabelEl = this.platformTriggerEl.createSpan({
			cls: "obsidian-to-publish-platform-trigger-label"
		});
		this.platformTriggerEl.createSpan({
			cls: "obsidian-to-publish-platform-trigger-caret",
			text: "▾"
		});
		this.platformTriggerEl.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.togglePlatformMenu();
		});

		this.documentClickHandler = (event: MouseEvent) => {
			if (!this.platformMenuOpen) {
				return;
			}
			const target = event.target;
			if (!(target instanceof Node)) {
				return;
			}
			if (this.platformPickerEl.contains(target) || this.platformMenuEl?.contains(target)) {
				return;
			}
			this.closePlatformMenu();
		};
		this.registerDomEvent(document, "click", this.documentClickHandler);

		this.windowRepositionHandler = () => {
			if (this.platformMenuOpen) {
				this.positionPlatformMenu();
			}
		};
		this.registerDomEvent(window, "resize", this.windowRepositionHandler);
		this.registerDomEvent(window, "scroll", this.windowRepositionHandler, { capture: true });
	}

	private togglePlatformMenu() {
		if (this.platformMenuOpen) {
			this.closePlatformMenu();
			return;
		}
		this.openPlatformMenu();
	}

	private openPlatformMenu() {
		this.closePlatformMenu();
		const menu = document.body.createDiv({
			cls: "obsidian-to-publish-platform-menu"
		});
		menu.setAttribute("role", "listbox");
		menu.setAttribute("aria-multiselectable", "true");

		const selected = new Set(this.plugin.getSelectedPlatforms());
		for (const profile of PLATFORM_PICKER_LIST) {
			const option = menu.createEl("label", {
				cls: "obsidian-to-publish-platform-option"
			});
			const checkbox = option.createEl("input", {
				attr: {
					type: "checkbox",
					value: profile.id
				}
			});
			checkbox.checked = selected.has(profile.id);
			option.createSpan({ text: profile.label });
			if (profile.id === this.plugin.settings.targetPlatform) {
				option.addClass("is-primary");
			}
			checkbox.addEventListener("change", () => {
				void this.plugin.toggleSelectedPlatform(profile.id, checkbox.checked);
			});
			option.addEventListener("click", (event) => {
				// Keep the menu open while multi-selecting.
				event.stopPropagation();
			});
		}

		this.platformMenuEl = menu;
		this.platformMenuOpen = true;
		this.platformTriggerEl.setAttribute("aria-expanded", "true");
		this.platformPickerEl.addClass("is-open");
		this.positionPlatformMenu();
	}

	private closePlatformMenu() {
		this.platformMenuEl?.remove();
		this.platformMenuEl = null;
		this.platformMenuOpen = false;
		this.platformTriggerEl?.setAttribute("aria-expanded", "false");
		this.platformPickerEl?.removeClass("is-open");
	}

	private positionPlatformMenu() {
		if (!this.platformMenuEl || !this.platformTriggerEl) {
			return;
		}

		const rect = this.platformTriggerEl.getBoundingClientRect();
		const spaceBelow = Math.max(120, window.innerHeight - rect.bottom - 8);
		const maxHeight = Math.min(320, spaceBelow);

		this.platformMenuEl.style.position = "fixed";
		this.platformMenuEl.style.top = `${Math.round(rect.bottom + 4)}px`;
		this.platformMenuEl.style.left = `${Math.round(rect.left)}px`;
		this.platformMenuEl.style.minWidth = `${Math.round(rect.width)}px`;
		this.platformMenuEl.style.maxHeight = `${Math.round(maxHeight)}px`;
	}

	syncPlatformControls() {
		if (!this.copyButton || !this.openEditorButton || !this.platformTriggerLabelEl) {
			return;
		}

		const selectedPlatforms = this.plugin.getSelectedPlatforms();
		const primaryPlatform = this.plugin.settings.targetPlatform;
		this.platformTriggerLabelEl.setText(
			formatSelectedPlatformsLabel(selectedPlatforms, primaryPlatform)
		);
		this.copyButton.setText("复制");
		this.openEditorButton.disabled = !this.canSyncAnySelectedPlatform(selectedPlatforms);
		this.openEditorButton.setText(this.getSyncButtonLabel(selectedPlatforms));

		if (this.platformMenuOpen) {
			this.openPlatformMenu();
		}
	}

	private getSyncButtonLabel(selectedPlatforms: CopyPlatform[]): string {
		if (selectedPlatforms.length === 1 && selectedPlatforms[0] === "feishu") {
			return "同步飞书";
		}

		if (this.canSyncAnySelectedPlatform(selectedPlatforms)) {
			return "同步草稿箱";
		}

		return "无可用编辑器入口";
	}

	private canSyncAnySelectedPlatform(selectedPlatforms: CopyPlatform[]): boolean {
		return selectedPlatforms.some((platform) => {
			if (this.plugin.shouldUseFeishuDocsAction(platform)) {
				return true;
			}
			if (this.plugin.shouldUseWechatOfficialDraftAction(platform)) {
				return true;
			}
			if (this.plugin.shouldUseChromeCompanionForPlatform(platform)) {
				return true;
			}
			return isSafeEditorUrl(PLATFORM_PROFILES[platform].editorUrl);
		});
	}

	async onClose() {
		this.closePlatformMenu();
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
			this.previewEl.createDiv({
				cls: "obsidian-to-publish-empty",
				text: "打开一篇 Markdown 笔记后在这里预览。"
			});
			return;
		}

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
		platform?: CopyPlatform;
	} = {}): Promise<CopyResult | null> {
		const shouldNotifyFailure = options.notifyFailure !== false;
		const shouldNotifySuccess = options.notifySuccess !== false;
		const platform = options.platform ?? this.plugin.settings.targetPlatform;
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
			const clipboard = await this.buildClipboardPayload(platform);
			const profile = PLATFORM_PROFILES[platform];
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
		const selectedPlatforms = this.plugin.getSelectedPlatforms();
		if (selectedPlatforms.length === 0) {
			new Notice("请先选择至少一个目标平台。");
			return;
		}

		if (!this.currentFile) {
			new Notice("请先打开一篇 Markdown 笔记。");
			return;
		}

		await this.renderActiveFile();
		if (!this.currentFile) {
			new Notice("请先打开一篇 Markdown 笔记。");
			return;
		}

		if (selectedPlatforms.length === 1) {
			await this.syncPlatformDraft(selectedPlatforms[0], {
				notify: true,
				activateChrome: true
			});
			return;
		}

		new Notice(`正在同步 ${selectedPlatforms.length} 个平台草稿箱...`);
		const successes: string[] = [];
		const failures: string[] = [];
		let shouldActivateChrome = false;

		for (const platform of selectedPlatforms) {
			const profile = PLATFORM_PROFILES[platform];
			const result = await this.syncPlatformDraft(platform, {
				notify: false,
				activateChrome: false
			});
			if (result.success) {
				successes.push(profile.copyLabel);
				shouldActivateChrome = shouldActivateChrome || result.usedChromeCompanion;
			} else {
				failures.push(profile.copyLabel);
			}
		}

		if (shouldActivateChrome) {
			await activateChromeAfterCompanionDelivery();
		}

		if (failures.length === 0) {
			new Notice(`已同步 ${successes.length} 个平台草稿箱：${successes.join("、")}。`);
			return;
		}

		if (successes.length === 0) {
			new Notice(`同步失败：${failures.join("、")}。请查看控制台或检查 Chrome companion。`);
			return;
		}

		new Notice(`部分同步成功：成功 ${successes.join("、")}；失败 ${failures.join("、")}。`);
	}

	private async syncPlatformDraft(
		platform: CopyPlatform,
		options: {
			notify?: boolean;
			activateChrome?: boolean;
		} = {}
	): Promise<{ success: boolean; usedChromeCompanion: boolean }> {
		const shouldNotify = options.notify !== false;
		const shouldActivateChrome = options.activateChrome !== false;

		if (this.plugin.shouldUseFeishuDocsAction(platform)) {
			return {
				success: await this.syncFeishuDraft(shouldNotify),
				usedChromeCompanion: false
			};
		}

		if (this.plugin.shouldUseWechatOfficialDraftAction(platform)) {
			return {
				success: await this.syncWechatOfficialDraft(shouldNotify),
				usedChromeCompanion: false
			};
		}

		if (this.plugin.shouldUseChromeCompanionForPlatform(platform)) {
			try {
				const publishPackage = await this.buildPublishPackage(platform);
				const send = () => this.plugin.sendPublishPackageToChromeCompanion(publishPackage, {
					notify: shouldNotify
				});
				const sent = shouldActivateChrome
					? await sendToChromeCompanionAndActivate(send, activateChromeAfterCompanionDelivery)
					: await send();
				if (sent) {
					return {
						success: true,
						usedChromeCompanion: true
					};
				}
				if (shouldNotify) {
					new Notice("发送到 Chrome 插件失败，已改用复制并打开兜底。");
				}
			} catch (error) {
				console.error(error);
				if (shouldNotify) {
					new Notice("发送到 Chrome 插件失败，已改用复制并打开兜底。");
				}
			}
		}

		return {
			success: await this.copyAndOpenPlatform(platform, { notify: shouldNotify }),
			usedChromeCompanion: false
		};
	}

	private async syncWechatOfficialDraft(notify: boolean): Promise<boolean> {
		if (notify) {
			new Notice("正在发送到微信公众号草稿箱...");
		}

		try {
			const publishPackage = await this.buildPublishPackage("wechat");
			const result = await createWechatDraftFromPackage(
				publishPackage,
				this.plugin.settings.wechatOfficial,
				(options) => this.plugin.requestOfficialApi(options)
			);
			if (result.warnings.length > 0) {
				console.warn("微信公众号草稿创建提示:", result.warnings);
			}
			this.plugin.settings.wechatOfficial.draftRecords = upsertWechatDraftRecord(
				this.plugin.settings.wechatOfficial.draftRecords,
				result.draftRecord
			);
			this.plugin.settings.wechatOfficial.coverMediaRecords = upsertWechatCoverMediaRecord(
				this.plugin.settings.wechatOfficial.coverMediaRecords,
				result.coverMediaRecord
			);
			let persistenceWarning = "";
			try {
				await this.plugin.saveSettings();
			} catch (error) {
				console.error("微信草稿已同步，但本地草稿关联保存失败:", error);
				persistenceWarning = "，但本地草稿关联保存失败";
			}
			if (notify) {
				const warningSuffix = result.warnings.length > 0 ? `，${result.warnings.length} 条提示见控制台` : "";
				const actionLabel = result.action === "updated" ? "更新" : "创建";
				new Notice(`已${actionLabel}微信公众号草稿：${result.mediaId}（${result.uploadedImages} 张正文图片）${warningSuffix}${persistenceWarning}。`);
			}
			return true;
		} catch (error) {
			console.error(error);
			if (error instanceof WechatIpWhitelistError) {
				if (notify) {
					new WechatIpWhitelistModal(this.app, error).open();
				}
				return false;
			}
			if (notify) {
				new Notice(getErrorMessage(error, "发送到微信公众号草稿箱失败，请查看控制台。"));
			}
			return false;
		}
	}

	private async syncFeishuDraft(notify: boolean): Promise<boolean> {
		if (notify) {
			new Notice("正在同步到飞书云文档...");
		}

		try {
			const publishPackage = await this.buildPublishPackage("feishu");
			const result = await syncPackageToFeishuDoc(
				publishPackage,
				this.plugin.settings.feishuDocs,
				(options) => this.plugin.requestOfficialApi(options)
			);
			if (result.warnings.length > 0) {
				console.warn("飞书云文档同步提示:", result.warnings);
			}
			if (notify) {
				const imageSuffix = result.uploadedImages > 0
					? `（${result.uploadedImages} 张图片）`
					: result.replacedAssetImages > 0
						? "（本地图片未全部上传，详见控制台）"
						: "";
				const warningSuffix = result.warnings.length > 0 ? `，${result.warnings.length} 条提示见控制台` : "";
				new Notice(`已同步到飞书云文档：${result.url}${imageSuffix}${warningSuffix}。`);
			}
			return true;
		} catch (error) {
			console.error(error);
			if (notify) {
				new Notice(getErrorMessage(error, "同步到飞书云文档失败，请查看控制台。"));
			}
			return false;
		}
	}

	private async copyAndOpenPlatform(
		platform: CopyPlatform,
		options: { notify?: boolean } = {}
	): Promise<boolean> {
		const shouldNotify = options.notify !== false;
		const profile = PLATFORM_PROFILES[platform];
		const result = await this.copyForCurrentPlatform({
			platform,
			notifyFailure: shouldNotify,
			notifySuccess: false
		});
		if (!result) {
			return false;
		}

		const opened = await openPlatformEditor(profile.editorUrl);
		if (shouldNotify) {
			if (opened) {
				new Notice(getCopyAndOpenNotice(result));
			} else {
				new Notice(`${getCopyNotice(result.profile, result)} 无法自动打开编辑器，请手动打开：${profile.editorUrl}`);
			}
		}
		// Count clipboard success as success even if the editor tab failed to open.
		return true;
	}

	async copyPublishPackageJson() {
		if (!this.currentFile) {
			new Notice("请先打开一篇 Markdown 笔记。");
			return;
		}

		try {
			const publishPackage = await this.buildPublishPackage();
			await writeTextClipboard(JSON.stringify(publishPackage, null, "\t"));
			new Notice(`已复制发布包 JSON（${publishPackage.assets.length} 个资源，${publishPackage.warnings.length} 条提示）。`);
		} catch (error) {
			console.error(error);
			new Notice("复制发布包 JSON 失败，请查看控制台。");
		}
	}

	async buildPublishPackage(targetPlatform: CopyPlatform = this.plugin.settings.targetPlatform): Promise<PublishPackageV1> {
		if (!this.currentFile) {
			throw new Error("No active Markdown file.");
		}

		const clipboard = await this.buildClipboardPayload(targetPlatform);
		return buildPublishPackageV1({
			targets: [targetPlatform],
			note: {
				path: this.currentFile.path,
				basename: this.currentFile.basename,
				mtime: this.currentFile.stat.mtime
			},
			markdown: this.currentMarkdown,
			html: clipboard.html,
			text: clipboard.text,
			resolveImage: async (src) => {
				const file = this.resolveLinkToImageFile(src);
				return file ? this.plugin.fileToResolvedPublishImage(file) : null;
			}
		});
	}

	private async buildClipboardPayload(targetPlatform: CopyPlatform = this.plugin.settings.targetPlatform): Promise<ClipboardPayload> {
		const profile = PLATFORM_PROFILES[targetPlatform];
		const platformFragment = await this.buildPlatformFragment(targetPlatform);
		const fragment = platformFragment.fragment;
		const imageResult = await this.buildClipboardImagePayload(profile);
		return {
			fragment,
			html: wrapHtmlDocument(fragment),
			image: imageResult.image,
			imageCount: imageResult.imageCount,
			text: htmlFragmentToText(fragment) || this.currentMarkdown,
			unresolvedImages: platformFragment.unresolvedImages
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

	private async buildPlatformFragment(targetPlatform: CopyPlatform = this.plugin.settings.targetPlatform): Promise<{
		fragment: string;
		unresolvedImages: number;
	}> {
		const profile = PLATFORM_PROFILES[targetPlatform];
		const embeddedImageFiles = this.resolveEmbeddedImageFiles();
		const clone = this.sourceEl.cloneNode(true) as HTMLElement;
		clone.classList.remove("obsidian-to-publish-source", "markdown-rendered");

		if (this.plugin.settings.inlineStyles) {
			inlineComputedStyles(this.sourceEl, clone);
		}

		this.removeRenderedAttachmentOpenLinks(clone, embeddedImageFiles);
		removeObsidianRuntimeControls(clone);
		// Flatten task items before platform styles so checkbox + text stay one line for WeChat.
		normalizeTaskListItems(clone);
		applyPlatformProfile(clone, targetPlatform);
		this.removeRenderedAttachmentOpenLinks(clone, embeddedImageFiles);

		const unresolvedImages = profile.capabilities.requiresRemoteImageUrl
			? embeddedImageFiles.length
			: this.plugin.settings.embedLocalImages
			? await this.embedLocalImages(clone)
			: 0;

		removeObsidianRuntimeControls(clone);
		this.removeRenderedAttachmentOpenLinks(clone, embeddedImageFiles);
		removeObsidianRuntimeAttributes(clone);

		return {
			fragment: wrapPlatformFragment(clone.innerHTML, targetPlatform),
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

	private updateStatus(_file: TFile, unresolvedImages: number) {
		// Path/status text was removed from the toolbar to reduce noise.
		// Keep image-related warnings available via notices during copy/sync.
		void unresolvedImages;
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

		const brand = containerEl.createDiv({ cls: "obsidian-to-publish-settings-brand" });
		const brandText = brand.createDiv({ cls: "obsidian-to-publish-settings-brand-text" });
		brandText.createEl("div", {
			cls: "obsidian-to-publish-settings-title",
			text: "Obsidian to Publish"
		});
		brandText.createEl("div", {
			cls: "obsidian-to-publish-settings-subtitle",
			text: "预览、复制，并同步到多平台草稿箱"
		});

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
			.setName("默认预览平台")
			.setDesc("预览与「复制」默认使用的平台。多平台同步请在预览工具栏勾选。")
			.addDropdown((dropdown) => {
				for (const profile of PLATFORM_PICKER_LIST) {
					dropdown.addOption(profile.id, profile.label);
				}

				const defaultPlatform = PLATFORM_PICKER_LIST.some(
					(profile) => profile.id === this.plugin.settings.targetPlatform
				)
					? this.plugin.settings.targetPlatform
					: PLATFORM_PICKER_LIST[0]?.id ?? "wechat";

				dropdown
					.setValue(defaultPlatform)
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

		containerEl.createEl("h3", { text: "微信公众号草稿箱" });

		new Setting(containerEl)
			.setName("启用微信官方 API")
			.setDesc("使用微信公众号官方接口上传图片并创建草稿箱草稿。")
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.wechatOfficial.enabled)
				.onChange(async (value) => {
					this.plugin.settings.wechatOfficial.enabled = value;
					await this.plugin.saveSettings();
					this.plugin.syncPreviewControls();
				}));

		new Setting(containerEl)
			.setName("微信 AppID")
			.setDesc("微信公众号后台的开发者 AppID。")
			.addText((text) => text
				.setPlaceholder("wx...")
				.setValue(this.plugin.settings.wechatOfficial.appId)
				.onChange(async (value) => {
					this.plugin.settings.wechatOfficial.appId = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("微信 AppSecret")
			.setDesc("仅保存在本地 Obsidian 插件设置中，不会写入发布包。")
			.addText((text) => {
				text
					.setValue(this.plugin.settings.wechatOfficial.appSecret)
					.onChange(async (value) => {
						this.plugin.settings.wechatOfficial.appSecret = value.trim();
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
			});

		let detectedWechatIp = "";
		let copyWechatIpButton: ButtonComponent;
		const wechatIpSetting = new Setting(containerEl)
			.setName("微信出口 IP")
			.setDesc("优先使用微信接口返回的准确 IP；白名单已生效时使用公网 IPv4 检测服务兜底。")
			.addButton((button) => button
				.setButtonText("检测")
				.onClick(async () => {
					detectedWechatIp = "";
					copyWechatIpButton.setDisabled(true);
					button.setDisabled(true).setButtonText("检测中...");
					try {
						const result = await this.plugin.detectWechatOutboundIp();
						detectedWechatIp = result.ip;
						copyWechatIpButton.setDisabled(false);
						const sourceLabel = result.source === "wechat"
							? "微信接口"
							: `公网检测服务 ${result.source}`;
						const routingHint = result.source === "wechat"
							? ""
							: " 如果使用分流代理，以微信 40164 错误返回的 IP 为准。";
						wechatIpSetting.setDesc(`当前 IPv4：${result.ip}（来源：${sourceLabel}）。${routingHint}`);
						new Notice(`已检测微信出口 IP：${result.ip}`);
					} catch (error) {
						console.error(error);
						wechatIpSetting.setDesc(getErrorMessage(error, "微信出口 IP 检测失败。"));
						new Notice(getErrorMessage(error, "微信出口 IP 检测失败。"));
					} finally {
						button.setDisabled(false).setButtonText("检测");
					}
				}))
			.addButton((button) => {
				copyWechatIpButton = button;
				button
					.setButtonText("复制 IP")
					.setDisabled(true)
					.onClick(async () => {
						if (!detectedWechatIp) {
							return;
						}
						await writeTextClipboard(detectedWechatIp);
						new Notice(`已复制 IP：${detectedWechatIp}`);
					});
			});

		new Setting(containerEl)
			.setName("作者")
			.setDesc("写入微信草稿的 author 字段，可留空。")
			.addText((text) => text
				.setValue(this.plugin.settings.wechatOfficial.author)
				.onChange(async (value) => {
					this.plugin.settings.wechatOfficial.author = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("默认摘要")
			.setDesc("留空时优先使用 frontmatter excerpt，否则使用默认同步说明。")
			.addText((text) => text
				.setValue(this.plugin.settings.wechatOfficial.digest)
				.onChange(async (value) => {
					this.plugin.settings.wechatOfficial.digest = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("原文链接")
			.setDesc("写入微信草稿的 content_source_url，可留空。")
			.addText((text) => text
				.setPlaceholder("https://...")
				.setValue(this.plugin.settings.wechatOfficial.contentSourceUrl)
				.onChange(async (value) => {
					this.plugin.settings.wechatOfficial.contentSourceUrl = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("开启留言")
			.setDesc("同步为微信草稿字段 need_open_comment。")
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.wechatOfficial.openComment)
				.onChange(async (value) => {
					this.plugin.settings.wechatOfficial.openComment = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("仅粉丝可留言")
			.setDesc("同步为微信草稿字段 only_fans_can_comment。")
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.wechatOfficial.onlyFansCanComment)
				.onChange(async (value) => {
					this.plugin.settings.wechatOfficial.onlyFansCanComment = value;
					await this.plugin.saveSettings();
				}));

		containerEl.createEl("h3", { text: "飞书云文档" });

		new Setting(containerEl)
			.setName("启用飞书开放平台 API")
			.setDesc("使用飞书自建应用把当前 Markdown 导入为新版云文档。")
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.feishuDocs.enabled)
				.onChange(async (value) => {
					this.plugin.settings.feishuDocs.enabled = value;
					await this.plugin.saveSettings();
					this.plugin.syncPreviewControls();
				}));

		new Setting(containerEl)
			.setName("飞书 AppID")
			.setDesc("飞书开放平台自建应用的 AppID。")
			.addText((text) => text
				.setValue(this.plugin.settings.feishuDocs.appId)
				.onChange(async (value) => {
					this.plugin.settings.feishuDocs.appId = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("飞书 AppSecret")
			.setDesc("仅保存在本地 Obsidian 插件设置中，不会写入发布包。")
			.addText((text) => {
				text
					.setValue(this.plugin.settings.feishuDocs.appSecret)
					.onChange(async (value) => {
						this.plugin.settings.feishuDocs.appSecret = value.trim();
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
			});

		new Setting(containerEl)
			.setName("目标文件夹 Token 或 URL")
			.setDesc("导入后的文档会创建在此文件夹；需启用应用机器人，并把文件夹共享给包含该机器人的群组，授予编辑权限。")
			.addText((text) => text
				.setPlaceholder("fld...")
				.setValue(this.plugin.settings.feishuDocs.folderToken)
				.onChange(async (value) => {
					this.plugin.settings.feishuDocs.folderToken = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("转移所有者 User ID")
			.setDesc("可选。填写后导入完成会尝试把文档所有者转给该 userid。")
			.addText((text) => text
				.setValue(this.plugin.settings.feishuDocs.ownerUserId)
				.onChange(async (value) => {
					this.plugin.settings.feishuDocs.ownerUserId = value.trim();
					await this.plugin.saveSettings();
				}));

		containerEl.createEl("h3", { text: "Chrome 插件连接" });
		const bridgeStatus = this.plugin.getChromeCompanionBridgeStatus();

		new Setting(containerEl)
			.setName("启用本地连接")
			.setDesc("在 Obsidian 桌面端监听 127.0.0.1，供 Chrome companion 接收发布包。")
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.chromeCompanionBridge.enabled)
				.onChange(async (value) => {
					this.plugin.settings.chromeCompanionBridge.enabled = value;
					await this.plugin.saveSettings();
					if (value) {
						const started = await this.plugin.startChromeCompanionBridge();
						if (!started) {
							this.plugin.settings.chromeCompanionBridge.enabled = false;
							await this.plugin.saveSettings();
						}
					} else {
						await this.plugin.stopChromeCompanionBridge();
					}
					this.display();
				}));

		new Setting(containerEl)
			.setName("本地端口")
			.setDesc("Chrome 插件将连接 ws://127.0.0.1:<port>/bridge。修改端口后会重启连接。")
			.addText((text) => text
				.setPlaceholder(String(DEFAULT_CHROME_COMPANION_BRIDGE_SETTINGS.port))
				.setValue(String(this.plugin.settings.chromeCompanionBridge.port))
				.onChange(async (value) => {
					const port = Number(value);
					if (!Number.isInteger(port) || port < 1024 || port > 65535) {
						return;
					}
					this.plugin.settings.chromeCompanionBridge.port = port;
					await this.plugin.saveSettings();
					await this.plugin.restartChromeCompanionBridgeIfEnabled();
				}));

		new Setting(containerEl)
			.setName("连接令牌")
			.setDesc("复制到 Chrome companion 设置页。不要公开分享这个令牌。")
			.addText((text) => {
				text
					.setValue(this.plugin.settings.chromeCompanionBridge.token)
					.setDisabled(true);
				text.inputEl.type = "password";
			})
			.addButton((button) => button
				.setButtonText("复制令牌")
				.onClick(async () => {
					await writeTextClipboard(this.plugin.settings.chromeCompanionBridge.token);
					new Notice("已复制 Chrome companion 连接令牌。");
				}))
			.addButton((button) => button
				.setButtonText("重置")
				.onClick(async () => {
					this.plugin.settings.chromeCompanionBridge.token = generateChromeCompanionToken();
					await this.plugin.saveSettings();
					await this.plugin.restartChromeCompanionBridgeIfEnabled();
					new Notice("已重置 Chrome companion 连接令牌。");
					this.display();
				}));

		new Setting(containerEl)
			.setName("连接状态")
			.setDesc(createChromeCompanionStatusFragment(bridgeStatus))
			.addButton((button) => button
				.setButtonText("刷新")
				.onClick(() => {
					this.display();
				}));
	}
}

class WechatIpWhitelistModal extends Modal {
	constructor(
		app: App,
		private error: WechatIpWhitelistError
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		const hasDetectedIp = Boolean(this.error.ip);
		contentEl.addClass("obsidian-to-publish-wechat-ip-modal");
		contentEl.createEl("h2", { text: "微信公众号 IP 白名单未配置" });
		contentEl.createEl("p", {
			text: hasDetectedIp
				? "微信接口拒绝了当前出口 IP。请复制下方 IP，然后前往微信开发者平台将其加入 API IP 白名单。"
				: "微信接口拒绝了当前出口 IP，但错误信息中没有可识别的 IPv4。请先使用设置页的“检测微信出口 IP”。"
		});
		if (hasDetectedIp) {
			contentEl.createEl("code", {
				cls: "obsidian-to-publish-wechat-ip-value",
				text: this.error.ip
			});
		}
		contentEl.createEl("p", {
			cls: "obsidian-to-publish-wechat-ip-route",
			text: "路径：选择对应公众号 → 基础信息 → 开发密钥 → API IP 白名单"
		});

		const actions = contentEl.createDiv({ cls: "obsidian-to-publish-wechat-ip-actions" });
		if (hasDetectedIp) {
			const copyButton = actions.createEl("button", {
				cls: "mod-cta",
				text: "复制 IP"
			});
			copyButton.addEventListener("click", async () => {
				await writeTextClipboard(this.error.ip);
				new Notice(`已复制 IP：${this.error.ip}`);
			});
		}

		const openButton = actions.createEl("button", { text: "打开微信开发者平台" });
		openButton.addEventListener("click", async () => {
			if (!await openExternalUrl(WECHAT_DEVELOPER_PLATFORM_URL)) {
				new Notice("无法自动打开微信开发者平台，请在浏览器中手动访问 developers.weixin.qq.com/platform。");
			}
		});

		const closeButton = actions.createEl("button", { text: "关闭" });
		closeButton.addEventListener("click", () => this.close());
	}

	onClose() {
		this.contentEl.empty();
	}
}

function normalizeChromeCompanionBridgeSettings(value: unknown): ChromeCompanionBridgeSettings {
	const raw = isRecord(value) ? value : {};
	const port = typeof raw.port === "number" && Number.isInteger(raw.port) && raw.port >= 1024 && raw.port <= 65535
		? raw.port
		: DEFAULT_CHROME_COMPANION_BRIDGE_SETTINGS.port;
	const token = typeof raw.token === "string"
		? raw.token.trim()
		: DEFAULT_CHROME_COMPANION_BRIDGE_SETTINGS.token;

	return {
		enabled: typeof raw.enabled === "boolean"
			? raw.enabled
			: DEFAULT_CHROME_COMPANION_BRIDGE_SETTINGS.enabled,
		port,
		token
	};
}

function getSupportedChromeCompanionPlatforms() {
	return PLATFORM_PROFILE_LIST.map((profile) => ({
		id: profile.id,
		label: profile.label,
		editorUrl: profile.editorUrl
	}));
}

function getChromeCompanionStatusLabel(status: ReturnType<WeChatPreviewCopyPlugin["getChromeCompanionBridgeStatus"]>): string {
	if (!status.running) {
		return `未启动，端口 ${status.port}。`;
	}

	if (!status.hasClient) {
		return `已启动 127.0.0.1:${status.port}，等待 Chrome companion 连接。`;
	}

	const client = status.clientLabel || "Chrome companion";
	const version = status.clientVersion ? ` ${status.clientVersion}` : "";
	return `已连接 ${client}${version}，端口 ${status.port}。`;
}

function createChromeCompanionStatusFragment(status: ReturnType<WeChatPreviewCopyPlugin["getChromeCompanionBridgeStatus"]>): DocumentFragment {
	const fragment = document.createDocumentFragment();
	const statusView = getChromeCompanionStatusView(status);
	const badge = document.createElement("span");
	badge.className = `obsidian-to-publish-bridge-status obsidian-to-publish-bridge-status-${statusView.tone}`;
	badge.textContent = statusView.label;
	fragment.appendChild(badge);
	fragment.appendChild(document.createTextNode(statusView.detail));
	return fragment;
}

function getChromeCompanionStatusView(status: ReturnType<WeChatPreviewCopyPlugin["getChromeCompanionBridgeStatus"]>): {
	detail: string;
	label: string;
	tone: "connected" | "waiting" | "offline";
} {
	if (!status.running) {
		return {
			label: "未启动",
			tone: "offline",
			detail: ` 本地 bridge 未启动，端口 ${status.port}。`
		};
	}

	if (!status.hasClient) {
		return {
			label: "等待连接",
			tone: "waiting",
			detail: ` 已监听 127.0.0.1:${status.port}，等待 Chrome companion 连接。`
		};
	}

	const client = status.clientLabel || "Chrome companion";
	const version = status.clientVersion ? ` ${status.clientVersion}` : "";
	return {
		label: "已连接",
		tone: "connected",
		detail: ` ${client}${version}，端口 ${status.port}。`
	};
}

function getErrorMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
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

/**
 * Obsidian task items often render as:
 *   <li class="task-list-item"><div|input checkbox></div>text</li>
 * or with a block checkbox that forces a line break. WeChat then shows
 * "• □" on one line and the text on the next (looks like empty bullets).
 * Flatten each task item to a single-line "☐ text" / "☑ text".
 */
function normalizeTaskListItems(root: HTMLElement) {
	const taskItems = Array.from(root.querySelectorAll<HTMLElement>("li")).filter(isTaskListItem);
	if (taskItems.length === 0) {
		// Still convert any leftover bare checkboxes for non-standard renders.
		for (const input of Array.from(root.querySelectorAll<HTMLInputElement>("input[type='checkbox']"))) {
			const marker = document.createElement("span");
			marker.textContent = input.checked ? "☑" : "☐";
			marker.setAttribute("style", "display:inline;white-space:nowrap;");
			input.replaceWith(marker);
		}
		return;
	}

	for (const listItem of taskItems) {
		const checked = isTaskListItemChecked(listItem);
		const text = getTaskListItemPlainText(listItem);
		const marker = checked ? "☑" : "☐";
		const line = text ? `${marker} ${text}` : marker;
		listItem.replaceChildren(document.createTextNode(line));
		appendInlineStyle(listItem, "list-style-type:none;");
		listItem.classList.add("task-list-item");
		if (checked) {
			listItem.classList.add("is-checked");
		} else {
			listItem.classList.remove("is-checked");
		}
	}

	for (const list of Array.from(root.querySelectorAll<HTMLElement>("ul"))) {
		const items = Array.from(list.children).filter((child) => child.tagName === "LI");
		if (items.length > 0 && items.every((item) => item.classList.contains("task-list-item"))) {
			appendInlineStyle(list, "list-style-type:none;padding-left:0.2em;");
			list.classList.add("contains-task-list");
		}
	}
}

function isTaskListItem(listItem: HTMLElement): boolean {
	if (
		listItem.classList.contains("task-list-item")
		|| listItem.hasAttribute("data-task")
		|| listItem.querySelector("input[type='checkbox'],.task-list-item-checkbox")
	) {
		return true;
	}
	return false;
}

function isTaskListItemChecked(listItem: HTMLElement): boolean {
	if (listItem.classList.contains("is-checked")) {
		return true;
	}
	const dataTask = (listItem.getAttribute("data-task") || "").trim();
	if (dataTask && dataTask !== " " && dataTask.toLowerCase() !== "n") {
		// Obsidian uses data-task="x" / "X" / various done marks when checked.
		return true;
	}
	const input = listItem.querySelector<HTMLInputElement>("input[type='checkbox']");
	if (input?.checked) {
		return true;
	}
	const custom = listItem.querySelector<HTMLElement>(".task-list-item-checkbox");
	if (custom && (custom.classList.contains("is-checked") || custom.getAttribute("data-task"))) {
		const customTask = (custom.getAttribute("data-task") || "").trim();
		if (customTask && customTask !== " ") {
			return true;
		}
	}
	return false;
}

function getTaskListItemPlainText(listItem: HTMLElement): string {
	const clone = listItem.cloneNode(true) as HTMLElement;
	for (const node of Array.from(clone.querySelectorAll(
		"input[type='checkbox'],.task-list-item-checkbox,.list-bullet,.list-collapse-indicator,.collapse-indicator"
	))) {
		node.remove();
	}
	return (clone.textContent || "").replace(/\s+/g, " ").trim();
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

function htmlFragmentToText(fragment: string): string {
	const container = document.createElement("div");
	container.innerHTML = fragment;
	return container.innerText || container.textContent || "";
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

async function openExternalUrl(url: string): Promise<boolean> {
	if (!isSafeEditorUrl(url)) {
		return false;
	}
	if (Platform.isDesktopApp && await openUrlWithElectronShell(url)) {
		return true;
	}
	try {
		return window.open(url, "_blank", "noopener,noreferrer") !== null;
	} catch (error) {
		console.error(`Unable to open external URL: ${url}`, error);
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
	return openChromeOnMac(url);
}

async function activateChromeAfterCompanionDelivery(): Promise<boolean> {
	if (!Platform.isDesktopApp || !Platform.isMacOS) {
		return false;
	}

	return openChromeOnMac();
}

async function openChromeOnMac(url?: string): Promise<boolean> {
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
			const args = ["-a", "Google Chrome"];
			if (url) {
				args.push(url);
			}
			childProcess.execFile?.("open", args, (error) => {
				resolve(!error);
			});
		});
	} catch (error) {
		console.error(
			url
				? `Unable to open Chrome for platform editor: ${url}`
				: "Unable to activate Chrome after companion delivery.",
			error
		);
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
