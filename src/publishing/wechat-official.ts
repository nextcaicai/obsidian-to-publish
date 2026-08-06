import { buildMultipartBody } from "./multipart";
import {
	createApiError,
	createHttpError,
	isRecord,
	normalizeOptionalBoolean,
	normalizeOptionalString,
	redactSensitiveText,
	responseJsonRecord
} from "./official-http";
import type {
	OfficialRequest,
	OfficialRequestOptions,
	OfficialRequestResponse
} from "./official-http";
import type {
	PublishAsset,
	PublishPackageV1
} from "./types";

export interface WechatOfficialSettings {
	enabled: boolean;
	appId: string;
	appSecret: string;
	author: string;
	digest: string;
	contentSourceUrl: string;
	openComment: boolean;
	onlyFansCanComment: boolean;
	draftRecords: WechatDraftRecord[];
	coverMediaRecords: WechatCoverMediaRecord[];
}

export interface WechatDraftRecord {
	appId: string;
	notePath: string;
	mediaId: string;
	title: string;
	updatedAt: string;
}

export interface WechatCoverMediaRecord {
	appId: string;
	assetHash: string;
	mediaId: string;
	updatedAt: string;
}

export interface WechatDraftArticle {
	title: string;
	content: string;
	thumb_media_id: string;
	author: string;
	digest: string;
	content_source_url?: string;
	need_open_comment?: number;
	only_fans_can_comment?: number;
}

export interface WechatDraftResult {
	article: WechatDraftArticle;
	mediaId: string;
	uploadedImages: number;
	warnings: string[];
	action: "created" | "updated";
	draftRecord: WechatDraftRecord;
	coverMediaRecord: WechatCoverMediaRecord;
}

export interface WechatDraftHtmlInspection {
	blockingIssues: string[];
	warnings: string[];
}

export interface WechatOutboundIpResult {
	ip: string;
	source: "wechat" | "ipify" | "ipw.cn" | "icanhazip";
}

export interface WechatDraftSyncOptions {
	fingerprintAsset?: (asset: PublishAsset) => Promise<string>;
}

export class WechatApiError extends Error {
	constructor(
		message: string,
		readonly code: number | string | null
	) {
		super(message);
		this.name = "WechatApiError";
	}
}

export class WechatIpWhitelistError extends WechatApiError {
	constructor(
		message: string,
		readonly ip: string
	) {
		super(message, 40164);
		this.name = "WechatIpWhitelistError";
	}
}

export const DEFAULT_WECHAT_OFFICIAL_SETTINGS: WechatOfficialSettings = {
	enabled: false,
	appId: "",
	appSecret: "",
	author: "",
	digest: "",
	contentSourceUrl: "",
	openComment: false,
	onlyFansCanComment: false,
	draftRecords: [],
	coverMediaRecords: []
};

const WECHAT_API_BASE_URL = "https://api.weixin.qq.com/cgi-bin";
const WECHAT_ARTICLE_TITLE_LIMIT = 64;
const WECHAT_ARTICLE_DIGEST_LIMIT = 120;
const WECHAT_CACHE_RECORD_LIMIT = 200;
const WECHAT_REMOTE_IMAGE_LIMIT_BYTES = 10 * 1024 * 1024;
const SUPPORTED_WECHAT_IMAGE_MIME = new Set([
	"image/jpeg",
	"image/jpg",
	"image/png",
	"image/gif"
]);

export function normalizeWechatOfficialSettings(value: unknown): WechatOfficialSettings {
	const raw = isRecord(value) ? value : {};
	return {
		enabled: normalizeOptionalBoolean(raw.enabled, DEFAULT_WECHAT_OFFICIAL_SETTINGS.enabled),
		appId: normalizeOptionalString(raw.appId),
		appSecret: normalizeOptionalString(raw.appSecret),
		author: normalizeOptionalString(raw.author),
		digest: normalizeOptionalString(raw.digest),
		contentSourceUrl: normalizeOptionalString(raw.contentSourceUrl),
		openComment: normalizeOptionalBoolean(raw.openComment, DEFAULT_WECHAT_OFFICIAL_SETTINGS.openComment),
		onlyFansCanComment: normalizeOptionalBoolean(raw.onlyFansCanComment, DEFAULT_WECHAT_OFFICIAL_SETTINGS.onlyFansCanComment),
		draftRecords: normalizeWechatDraftRecords(raw.draftRecords),
		coverMediaRecords: normalizeWechatCoverMediaRecords(raw.coverMediaRecords)
	};
}

export function upsertWechatDraftRecord(
	records: WechatDraftRecord[],
	record: WechatDraftRecord
): WechatDraftRecord[] {
	return [
		record,
		...records.filter((item) =>
			item.appId !== record.appId || item.notePath !== record.notePath
		)
	]
		.sort(compareWechatRecordUpdatedAt)
		.slice(0, WECHAT_CACHE_RECORD_LIMIT);
}

export function upsertWechatCoverMediaRecord(
	records: WechatCoverMediaRecord[],
	record: WechatCoverMediaRecord
): WechatCoverMediaRecord[] {
	return [
		record,
		...records.filter((item) =>
			item.appId !== record.appId || item.assetHash !== record.assetHash
		)
	]
		.sort(compareWechatRecordUpdatedAt)
		.slice(0, WECHAT_CACHE_RECORD_LIMIT);
}

export async function detectWechatOutboundIp(
	settings: WechatOfficialSettings,
	request: OfficialRequest
): Promise<WechatOutboundIpResult> {
	const normalizedSettings = normalizeWechatOfficialSettings(settings);
	if (!normalizedSettings.appId || !normalizedSettings.appSecret) {
		throw new Error("请先填写微信公众号 AppID 和 AppSecret。");
	}

	const client = new WechatOfficialClient(normalizedSettings, request);
	try {
		await client.getAccessToken();
	} catch (error) {
		if (error instanceof WechatIpWhitelistError) {
			if (error.ip) {
				return {
					ip: error.ip,
					source: "wechat"
				};
			}
		} else {
			throw error;
		}
	}

	const providers: Array<{
		url: string;
		source: WechatOutboundIpResult["source"];
		read: (response: OfficialRequestResponse) => string;
	}> = [
		{
			url: "https://api.ipify.org?format=json",
			source: "ipify",
			read: (response) => normalizeOptionalString(responseJsonRecord(response).ip)
		},
		{
			url: "https://4.ipw.cn",
			source: "ipw.cn",
			read: (response) => normalizeOptionalString(response.text)
		},
		{
			url: "https://ipv4.icanhazip.com",
			source: "icanhazip",
			read: (response) => normalizeOptionalString(response.text)
		}
	];
	const failures: string[] = [];
	for (const provider of providers) {
		try {
			const response = await request({
				url: provider.url,
				method: "GET",
				throw: false
			});
			if (response.status >= 400) {
				failures.push(`${provider.source}: HTTP ${response.status}`);
				continue;
			}
			const ip = extractIpv4(provider.read(response));
			if (ip) {
				return {
					ip,
					source: provider.source
				};
			}
			failures.push(`${provider.source}: 未返回 IPv4`);
		} catch (error) {
			failures.push(`${provider.source}: ${error instanceof Error ? error.message : "网络错误"}`);
		}
	}

	throw new Error(`微信 API 已连通，但未能检测当前公网 IPv4。${failures.join("；")}`);
}

export async function createWechatDraftFromPackage(
	publishPackage: PublishPackageV1,
	settings: WechatOfficialSettings,
	request: OfficialRequest,
	options: WechatDraftSyncOptions = {}
): Promise<WechatDraftResult> {
	const normalizedSettings = normalizeWechatOfficialSettings(settings);
	assertWechatSettingsReady(normalizedSettings);

	const client = new WechatOfficialClient(normalizedSettings, request);
	const coverAsset = resolveWechatCoverAsset(publishPackage)
		?? await resolveRemoteWechatCoverAsset(publishPackage, client);
	if (!coverAsset) {
		throw new Error("微信公众号草稿需要封面图。请在 frontmatter 设置 cover，或在正文放入至少一张图片。");
	}

	const fingerprintAsset = options.fingerprintAsset ?? createWechatAssetFingerprint;
	const coverHash = await fingerprintAsset(coverAsset);
	const cachedCover = normalizedSettings.coverMediaRecords.find((record) =>
		record.appId === normalizedSettings.appId && record.assetHash === coverHash
	);
	let thumbMediaId = "";
	if (cachedCover && await client.isCoverMediaValid(cachedCover.mediaId)) {
		thumbMediaId = cachedCover.mediaId;
	}
	if (!thumbMediaId) {
		const coverResponse = await client.uploadCover(coverAsset);
		thumbMediaId = getRequiredString(coverResponse, "media_id", "微信封面上传接口未返回 media_id");
	}
	const coverMediaRecord: WechatCoverMediaRecord = {
		appId: normalizedSettings.appId,
		assetHash: coverHash,
		mediaId: thumbMediaId,
		updatedAt: new Date().toISOString()
	};

	const uploadedUrls = new Map<string, string>();
	for (const asset of publishPackage.assets) {
		const response = await client.uploadArticleImage(asset);
		uploadedUrls.set(asset.id, getRequiredString(response, "url", `微信正文图片上传接口未返回 URL：${asset.fileName}`));
	}

	const replacedLocal = replaceHtmlImageSourcesWithWechatUrls(
		extractHtmlBodyContent(publishPackage.article.html),
		publishPackage.assets,
		uploadedUrls
	);
	const replacedRemote = await replaceRemoteHtmlImagesWithWechatUrls(replacedLocal.html, client);
	const normalizedHtml = normalizeWechatDraftHtml(replacedRemote.html);
	const inspection = inspectWechatDraftHtml(normalizedHtml);
	if (inspection.blockingIssues.length > 0) {
		throw new Error(`微信草稿内容检查未通过：${inspection.blockingIssues.slice(0, 3).join("；")}`);
	}

	const article = buildWechatDraftArticle(
		publishPackage,
		normalizedSettings,
		normalizedHtml,
		thumbMediaId
	);
	const existingDraft = normalizedSettings.draftRecords.find((record) =>
		record.appId === normalizedSettings.appId && record.notePath === publishPackage.note.path
	);
	let action: "created" | "updated" = "created";
	let mediaId = "";
	if (existingDraft) {
		try {
			await client.updateDraft(existingDraft.mediaId, article);
			mediaId = existingDraft.mediaId;
			action = "updated";
		} catch (error) {
			if (!isInvalidWechatMediaIdError(error)) {
				throw error;
			}
		}
	}
	if (!mediaId) {
		const draftResponse = await client.createDraft(article);
		mediaId = getRequiredString(draftResponse, "media_id", "微信草稿接口未返回 media_id");
	}
	const draftRecord: WechatDraftRecord = {
		appId: normalizedSettings.appId,
		notePath: publishPackage.note.path,
		mediaId,
		title: article.title,
		updatedAt: new Date().toISOString()
	};

	return {
		article,
		mediaId,
		uploadedImages: uploadedUrls.size + replacedRemote.uploadedImages,
		warnings: replacedLocal.unresolvedSources
			.filter((source) => !isRemoteHttpUrl(source))
			.concat(replacedRemote.warnings, inspection.warnings),
		action,
		draftRecord,
		coverMediaRecord
	};
}

export function resolveWechatCoverAsset(publishPackage: PublishPackageV1): PublishAsset | null {
	const cover = publishPackage.article.cover || "";
	const coverAssetId = parseAssetId(cover);
	if (coverAssetId) {
		return publishPackage.assets.find((asset) => asset.id === coverAssetId) ?? null;
	}
	if (isRemoteHttpUrl(cover)) {
		return null;
	}
	const normalizedCover = decodeHtmlAttribute(cover).trim();
	if (normalizedCover) {
		const matchingAsset = publishPackage.assets.find((asset) => asset.originalSrc === normalizedCover);
		if (matchingAsset) {
			return matchingAsset;
		}
	}

	return publishPackage.assets[0] ?? null;
}

async function resolveRemoteWechatCoverAsset(
	publishPackage: PublishPackageV1,
	client: WechatOfficialClient
): Promise<PublishAsset | null> {
	const explicitCover = decodeHtmlAttribute(publishPackage.article.cover || "").trim();
	if (isRemoteHttpUrl(explicitCover)) {
		return client.downloadRemoteImage(explicitCover);
	}

	const firstRemoteImage = collectRemoteHtmlImageSources(publishPackage.article.html)[0];
	return firstRemoteImage ? client.downloadRemoteImage(firstRemoteImage) : null;
}

export function replaceHtmlImageSourcesWithWechatUrls(
	html: string,
	assets: PublishAsset[],
	uploadedUrls: Map<string, string>
): {
	html: string;
	unresolvedSources: string[];
} {
	let sequentialAssetIndex = 0;
	const unresolvedSources: string[] = [];
	const replacedHtml = html.replace(/<img\b[^>]*>/gi, (tag) => {
		const src = getHtmlAttribute(tag, "src");
		if (src && isWechatImageUrl(src)) {
			return tag;
		}

		const sequentialAsset = assets[sequentialAssetIndex] ?? null;
		const asset = resolveImageTagAsset(src, assets, sequentialAssetIndex);
		if (!parseAssetId(src) && asset && sequentialAsset && asset.id === sequentialAsset.id) {
			sequentialAssetIndex += 1;
		}

		if (!asset) {
			unresolvedSources.push(src || "<img>");
			return tag;
		}

		const uploadedUrl = uploadedUrls.get(asset.id);
		if (!uploadedUrl) {
			unresolvedSources.push(src || asset.originalSrc);
			return tag;
		}

		return removeHtmlAttribute(
			setHtmlAttribute(tag, "src", uploadedUrl),
			"data-src"
		);
	});

	return {
		html: replacedHtml,
		unresolvedSources
	};
}

async function replaceRemoteHtmlImagesWithWechatUrls(
	html: string,
	client: WechatOfficialClient
): Promise<{
	html: string;
	uploadedImages: number;
	warnings: string[];
}> {
	const uploadedUrls = new Map<string, string>();
	for (const remoteUrl of collectRemoteHtmlImageSources(html)) {
		try {
			const asset = await client.downloadRemoteImage(remoteUrl);
			const response = await client.uploadArticleImage(asset);
			uploadedUrls.set(
				remoteUrl,
				getRequiredString(response, "url", `微信远程图片上传接口未返回 URL：${shorten(remoteUrl)}`)
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error || "未知错误");
			throw new Error(`远程图片转存微信 CDN 失败：${shorten(remoteUrl)}。${message}`);
		}
	}

	const replacedHtml = html.replace(/<img\b[^>]*>/gi, (tag) => {
		const src = getHtmlAttribute(tag, "src");
		const uploadedUrl = uploadedUrls.get(src);
		return uploadedUrl
			? removeHtmlAttribute(setHtmlAttribute(tag, "src", uploadedUrl), "data-src")
			: tag;
	});

	return {
		html: replacedHtml,
		uploadedImages: uploadedUrls.size,
		warnings: []
	};
}

function collectRemoteHtmlImageSources(html: string): string[] {
	const sources: string[] = [];
	const seen = new Set<string>();
	let match: RegExpExecArray | null;
	const pattern = /<img\b[^>]*>/gi;
	while ((match = pattern.exec(String(html || ""))) !== null) {
		const src = getHtmlAttribute(match[0], "src");
		if (!isRemoteHttpUrl(src) || isWechatImageUrl(src) || seen.has(src)) {
			continue;
		}
		seen.add(src);
		sources.push(src);
	}
	return sources;
}

/**
 * Normalize HTML before uploading to WeChat draft API.
 *
 * WeChat's editor re-parses content and treats whitespace/newlines between
 * block tags (especially inside ul/ol) as extra empty list items. That shows
 * up as alternating empty bullets/numbers between real list content.
 */
export function normalizeWechatDraftHtml(html: string): string {
	let result = String(html || "")
		.replace(/<!doctype[^>]*>/gi, "")
		.replace(/<\/?html\b[^>]*>/gi, "")
		.replace(/<head\b[\s\S]*?<\/head>/gi, "")
		.replace(/<\/?body\b[^>]*>/gi, "")
		.replace(/<script\b[\s\S]*?<\/script>/gi, "")
		.replace(/<style\b[\s\S]*?<\/style>/gi, "")
		.trim();

	result = unwrapWechatListItemParagraphs(result);
	result = removeWechatEmptyListItems(result);
	result = removeWechatEmptyParagraphs(result);
	result = compactWechatBlockWhitespace(result);
	return result;
}

const WECHAT_BLOCK_TAGS =
	"li|ul|ol|p|h[1-6]|section|article|blockquote|figure|figcaption|table|tbody|thead|tfoot|tr|th|td|pre|hr|br|img|div";

/**
 * Collapse whitespace/newlines between block-level tags.
 * WeChat treats those gaps as blank lines / empty list items.
 */
export function compactWechatBlockWhitespace(html: string): string {
	const betweenCloseOpen = new RegExp(
		`(</(?:${WECHAT_BLOCK_TAGS})>)\\s+(<(?:${WECHAT_BLOCK_TAGS})\\b[^>]*/?>)`,
		"gi"
	);
	const betweenOpenOpen = new RegExp(
		`(<(?:${WECHAT_BLOCK_TAGS})\\b[^>]*>)\\s+(<(?:${WECHAT_BLOCK_TAGS})\\b[^>]*/?>)`,
		"gi"
	);
	const betweenCloseClose = new RegExp(
		`(</(?:${WECHAT_BLOCK_TAGS})>)\\s+(</(?:${WECHAT_BLOCK_TAGS})>)`,
		"gi"
	);
	// Trim leading/trailing whitespace inside list items.
	const trimListItemOpen = /(<li\b[^>]*>)\s+/gi;
	const trimListItemClose = /\s+(<\/li>)/gi;

	let result = String(html || "");
	let previous = "";
	while (result !== previous) {
		previous = result;
		result = result
			.replace(betweenCloseOpen, "$1$2")
			.replace(betweenOpenOpen, "$1$2")
			.replace(betweenCloseClose, "$1$2")
			.replace(trimListItemOpen, "$1")
			.replace(trimListItemClose, "$1");
	}
	return result;
}

/** Remove empty list items that only contain whitespace or a lone <br>. */
export function removeWechatEmptyListItems(html: string): string {
	let result = String(html || "");
	let previous = "";
	while (result !== previous) {
		previous = result;
		result = result.replace(/<li\b[^>]*>\s*(?:<br\s*\/?>\s*)*<\/li>/gi, "");
	}
	return result;
}

/** Remove empty paragraphs WeChat would turn into blank lines. */
export function removeWechatEmptyParagraphs(html: string): string {
	return String(html || "").replace(/<p\b[^>]*>\s*(?:<br\s*\/?>\s*)*<\/p>/gi, "");
}

/**
 * Unwrap a sole <p> wrapper inside <li>.
 * Loose-list HTML like <li><p>item</p></li> is frequently rewritten by WeChat
 * into an empty bullet plus a content bullet.
 */
export function unwrapWechatListItemParagraphs(html: string): string {
	return String(html || "").replace(
		/<li(\b[^>]*)>\s*<p\b[^>]*>([\s\S]*?)<\/p>\s*<\/li>/gi,
		(_match, attrs: string, content: string) => `<li${attrs}>${content.trim()}</li>`
	);
}

export function inspectWechatDraftHtml(html: string): WechatDraftHtmlInspection {
	const source = String(html || "");
	const blockingIssues: string[] = [];
	const warnings: string[] = [];
	let match: RegExpExecArray | null;
	const imagePattern = /<img\b[^>]*>/gi;

	while ((match = imagePattern.exec(source)) !== null) {
		const src = getHtmlAttribute(match[0], "src");
		if (!src || !isWechatImageUrl(src)) {
			blockingIssues.push(src ? `正文仍有未上传到微信的图片：${shorten(src)}` : "正文仍有缺少 src 的图片");
		}
	}

	if (/\b(?:src|href)=["'](?:data:|file:|app:|obsidian:|capacitor:)/i.test(source)) {
		blockingIssues.push("正文仍包含微信草稿不支持的本地或 data: 资源链接");
	}

	if (/<svg\b|<mjx-container\b/i.test(source)) {
		blockingIssues.push("正文仍包含未转换的 SVG 或数学公式节点");
	}

	if (source.length > 900_000) {
		warnings.push("正文 HTML 接近微信草稿接口大小上限，若接口拒收需压缩正文或图片。");
	}

	return {
		blockingIssues,
		warnings
	};
}

export class WechatOfficialClient {
	private accessToken = "";
	private tokenExpiry = 0;
	private remoteImageCache = new Map<string, PublishAsset>();

	constructor(
		private settings: WechatOfficialSettings,
		private request: OfficialRequest
	) {}

	async getAccessToken(): Promise<string> {
		const now = Date.now();
		if (this.accessToken && this.tokenExpiry > now + 300_000) {
			return this.accessToken;
		}

		const url = `${WECHAT_API_BASE_URL}/token?grant_type=client_credential&appid=${encodeURIComponent(this.settings.appId)}&secret=${encodeURIComponent(this.settings.appSecret)}`;
		const response = await this.sendRequest("获取微信 access_token", { url, method: "GET" });
		const data = responseJsonRecord(response);
		const token = typeof data.access_token === "string" ? data.access_token : "";
		if (!token) {
			throw createWechatApiError("获取微信 access_token", data);
		}

		const expiresIn = typeof data.expires_in === "number" && Number.isFinite(data.expires_in)
			? data.expires_in
			: 7200;
		this.accessToken = token;
		this.tokenExpiry = now + expiresIn * 1000;
		return token;
	}

	async uploadCover(asset: PublishAsset): Promise<Record<string, unknown>> {
		assertWechatImageAsset(asset);
		const token = await this.getAccessToken();
		return this.uploadMultipart(
			"上传微信封面图",
			`${WECHAT_API_BASE_URL}/material/add_material?access_token=${encodeURIComponent(token)}&type=image`,
			asset
		);
	}

	async isCoverMediaValid(mediaId: string): Promise<boolean> {
		const token = await this.getAccessToken();
		const response = await this.sendRequest("校验微信封面素材", {
			url: `${WECHAT_API_BASE_URL}/material/get_material?access_token=${encodeURIComponent(token)}`,
			method: "POST",
			headers: {
				"Content-Type": "application/json; charset=utf-8"
			},
			body: JSON.stringify({ media_id: mediaId }),
			throw: false
		});
		const data = responseJsonRecord(response);
		if (Number(data.errcode) === 40007) {
			return false;
		}
		if (data.errcode !== undefined && Number(data.errcode) !== 0) {
			throw createWechatApiError("校验微信封面素材", data);
		}
		return true;
	}

	async uploadArticleImage(asset: PublishAsset): Promise<Record<string, unknown>> {
		assertWechatImageAsset(asset);
		const token = await this.getAccessToken();
		return this.uploadMultipart(
			"上传微信正文图片",
			`${WECHAT_API_BASE_URL}/media/uploadimg?access_token=${encodeURIComponent(token)}`,
			asset
		);
	}

	async downloadRemoteImage(url: string): Promise<PublishAsset> {
		const normalizedUrl = normalizeWechatRemoteImageUrl(url);
		const cached = this.remoteImageCache.get(normalizedUrl);
		if (cached) {
			return cached;
		}

		const response = await this.sendRequest("下载远程图片", {
			url: normalizedUrl,
			method: "GET",
			headers: {
				Accept: "image/*"
			},
			throw: false
		});
		const arrayBuffer = response.arrayBuffer;
		if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength === 0) {
			throw new Error(`远程图片未返回可用数据：${shorten(normalizedUrl)}`);
		}
		if (arrayBuffer.byteLength > WECHAT_REMOTE_IMAGE_LIMIT_BYTES) {
			throw new Error(`远程图片超过 10MB 安全限制：${shorten(normalizedUrl)}`);
		}
		const bytes = new Uint8Array(arrayBuffer);
		const mime = resolveRemoteWechatImageMime(response.headers, normalizedUrl, bytes);
		const hash = await createSha256Fingerprint(bytes);
		const asset: PublishAsset = {
			id: `remote_${hash.replace(/[^a-z0-9]/gi, "").slice(0, 16)}`,
			kind: "image",
			originalSrc: normalizedUrl,
			fileName: createRemoteImageFileName(normalizedUrl, mime),
			mime,
			bytes: bytes.byteLength,
			base64: bytesToBase64(bytes),
			sha256: hash
		};
		this.remoteImageCache.set(normalizedUrl, asset);
		return asset;
	}

	async createDraft(article: WechatDraftArticle): Promise<Record<string, unknown>> {
		const token = await this.getAccessToken();
		const url = `${WECHAT_API_BASE_URL}/draft/add?access_token=${encodeURIComponent(token)}`;
		const response = await this.sendRequest("创建微信公众号草稿", {
			url,
			method: "POST",
			headers: {
				"Content-Type": "application/json; charset=utf-8"
			},
			body: JSON.stringify({ articles: [article] }),
			throw: false
		});
		const data = responseJsonRecord(response);
		if (typeof data.media_id === "string" && data.media_id) {
			return data;
		}

		throw createWechatApiError("创建微信公众号草稿", data);
	}

	async updateDraft(mediaId: string, article: WechatDraftArticle): Promise<void> {
		const token = await this.getAccessToken();
		const response = await this.sendRequest("更新微信公众号草稿", {
			url: `${WECHAT_API_BASE_URL}/draft/update?access_token=${encodeURIComponent(token)}`,
			method: "POST",
			headers: {
				"Content-Type": "application/json; charset=utf-8"
			},
			body: JSON.stringify({
				media_id: mediaId,
				index: 0,
				articles: article
			}),
			throw: false
		});
		const data = responseJsonRecord(response);
		if (Number(data.errcode) === 0 || data.errmsg === "ok") {
			return;
		}
		throw createWechatApiError("更新微信公众号草稿", data);
	}

	private async uploadMultipart(label: string, url: string, asset: PublishAsset): Promise<Record<string, unknown>> {
		const boundary = `obsidian-to-publish-wechat-${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
		const body = buildMultipartBody({
			boundary,
			file: {
				fieldName: "media",
				fileName: `image.${getImageExtension(asset)}`,
				mimeType: normalizeWechatImageMime(asset.mime),
				bytes: base64ToBytes(asset.base64)
			}
		});
		const response = await this.sendRequest(label, {
			url,
			method: "POST",
			headers: {
				"Content-Type": `multipart/form-data; boundary=${boundary}`
			},
			body,
			throw: false
		});
		const data = responseJsonRecord(response);
		if (typeof data.media_id === "string" || typeof data.url === "string") {
			return data;
		}

		throw createWechatApiError(label, data);
	}

	private async sendRequest(label: string, options: OfficialRequestOptions) {
		let response;
		try {
			response = await this.request({
				...options,
				throw: false
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error || "未知网络错误");
			throw new Error(`${label} 请求失败：${redactSensitiveText(message)}`);
		}

		if (response.status >= 400) {
			throw createHttpError(label, options.url, response);
		}

		return response;
	}
}

function assertWechatSettingsReady(settings: WechatOfficialSettings) {
	if (!settings.enabled) {
		throw new Error("请先在插件设置中启用微信公众号草稿箱。");
	}

	if (!settings.appId || !settings.appSecret) {
		throw new Error("请先在插件设置中填写微信公众号 AppID 和 AppSecret。");
	}
}

function buildWechatDraftArticle(
	publishPackage: PublishPackageV1,
	settings: WechatOfficialSettings,
	content: string,
	thumbMediaId: string
): WechatDraftArticle {
	const digest = settings.digest || publishPackage.article.excerpt || "一键同步自 Obsidian";
	const article: WechatDraftArticle = {
		title: truncateText(publishPackage.article.title || publishPackage.note.basename || "无标题文章", WECHAT_ARTICLE_TITLE_LIMIT),
		content,
		thumb_media_id: thumbMediaId,
		author: settings.author,
		digest: truncateText(digest, WECHAT_ARTICLE_DIGEST_LIMIT),
		need_open_comment: settings.openComment ? 1 : 0,
		only_fans_can_comment: settings.onlyFansCanComment ? 1 : 0
	};

	if (settings.contentSourceUrl) {
		article.content_source_url = settings.contentSourceUrl;
	}

	return article;
}

function resolveImageTagAsset(src: string, assets: PublishAsset[], sequentialAssetIndex: number): PublishAsset | null {
	const assetId = parseAssetId(src);
	if (assetId) {
		return assets.find((asset) => asset.id === assetId) ?? null;
	}

	if (src) {
		const normalizedSrc = decodeHtmlAttribute(src).trim();
		const byOriginalSrc = assets.find((asset) => asset.originalSrc === normalizedSrc);
		if (byOriginalSrc) {
			return byOriginalSrc;
		}
		if (isRemoteHttpUrl(normalizedSrc)) {
			return null;
		}
	}

	return assets[sequentialAssetIndex] ?? null;
}

function extractHtmlBodyContent(html: string): string {
	const source = String(html || "");
	const bodyMatch = source.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
	return bodyMatch ? bodyMatch[1] : source;
}

function getHtmlAttribute(tag: string, name: string): string {
	const pattern = new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
	const match = tag.match(pattern);
	return decodeHtmlAttribute(match?.[2] ?? match?.[3] ?? match?.[4] ?? "");
}

function setHtmlAttribute(tag: string, name: string, value: string): string {
	const escapedValue = escapeHtmlAttribute(value);
	const pattern = new RegExp(`(\\s${escapeRegExp(name)}\\s*=\\s*)("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
	if (pattern.test(tag)) {
		return tag.replace(pattern, (_match, prefix: string) => `${prefix}"${escapedValue}"`);
	}

	return tag.replace(/\s*\/?>$/, (suffix) => ` ${name}="${escapedValue}"${suffix}`);
}

function removeHtmlAttribute(tag: string, name: string): string {
	const pattern = new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "gi");
	return tag.replace(pattern, "");
}

function parseAssetId(value: string): string {
	const match = String(value || "").match(/^asset:\/\/([A-Za-z0-9_-]+)$/);
	return match ? match[1] : "";
}

function isWechatImageUrl(value: string): boolean {
	return /^https?:\/\/mmbiz\.qpic\.cn\//i.test(value)
		|| /^https?:\/\/mmbiz\.qlogo\.cn\//i.test(value);
}

function assertWechatImageAsset(asset: PublishAsset) {
	const mime = normalizeWechatImageMime(asset.mime);
	if (!SUPPORTED_WECHAT_IMAGE_MIME.has(mime)) {
		throw new Error(`微信官方 API 暂不支持该图片格式：${asset.fileName} (${asset.mime})`);
	}

	if (!asset.base64) {
		throw new Error(`图片数据为空：${asset.fileName}`);
	}
}

function getImageExtension(asset: PublishAsset): string {
	const fromName = asset.fileName.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
	if (fromName === "jpeg") {
		return "jpg";
	}
	if (fromName && ["jpg", "png", "gif"].includes(fromName)) {
		return fromName;
	}

	if (/gif/i.test(asset.mime)) return "gif";
	if (/png/i.test(asset.mime)) return "png";
	return "jpg";
}

function normalizeWechatImageMime(mime: string): string {
	const normalized = mime.trim().toLowerCase();
	return normalized === "image/jpg" ? "image/jpeg" : normalized;
}

function base64ToBytes(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	const chunkSize = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
	}
	return btoa(binary);
}

function getRequiredString(data: Record<string, unknown>, key: string, message: string): string {
	const value = data[key];
	if (typeof value === "string" && value.trim()) {
		return value.trim();
	}

	throw new Error(message);
}

function createWechatApiError(label: string, data: Record<string, unknown>): WechatApiError {
	const code = data.errcode;
	const message = typeof data.errmsg === "string" ? data.errmsg : "";
	if (Number(code) === 40164) {
		const ip = extractIpv4(message);
		const ipLabel = ip || "当前出口 IP";
		return new WechatIpWhitelistError(
			`${label} 失败 (40164)：${ipLabel} 未加入微信公众号 API IP 白名单。请在公众号后台将该 IP 加入白名单后重试。`,
			ip
		);
	}

	return new WechatApiError(
		createApiError(label, code, message || JSON.stringify(data)).message,
		code === undefined || code === null ? null : typeof code === "number" || typeof code === "string" ? code : String(code)
	);
}

function isInvalidWechatMediaIdError(error: unknown): boolean {
	return error instanceof WechatApiError
		? Number(error.code) === 40007
		: error instanceof Error && /(?:40007|invalid media_id)/i.test(error.message);
}

function normalizeWechatDraftRecords(value: unknown): WechatDraftRecord[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.map((item): WechatDraftRecord | null => {
			if (!isRecord(item)) {
				return null;
			}
			const record = {
				appId: normalizeOptionalString(item.appId),
				notePath: normalizeOptionalString(item.notePath),
				mediaId: normalizeOptionalString(item.mediaId),
				title: normalizeOptionalString(item.title),
				updatedAt: normalizeWechatRecordDate(item.updatedAt)
			};
			return record.appId && record.notePath && record.mediaId ? record : null;
		})
		.filter((record): record is WechatDraftRecord => record !== null)
		.sort(compareWechatRecordUpdatedAt)
		.slice(0, WECHAT_CACHE_RECORD_LIMIT);
}

function normalizeWechatCoverMediaRecords(value: unknown): WechatCoverMediaRecord[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.map((item): WechatCoverMediaRecord | null => {
			if (!isRecord(item)) {
				return null;
			}
			const record = {
				appId: normalizeOptionalString(item.appId),
				assetHash: normalizeOptionalString(item.assetHash),
				mediaId: normalizeOptionalString(item.mediaId),
				updatedAt: normalizeWechatRecordDate(item.updatedAt)
			};
			return record.appId && record.assetHash && record.mediaId ? record : null;
		})
		.filter((record): record is WechatCoverMediaRecord => record !== null)
		.sort(compareWechatRecordUpdatedAt)
		.slice(0, WECHAT_CACHE_RECORD_LIMIT);
}

function normalizeWechatRecordDate(value: unknown): string {
	const text = normalizeOptionalString(value);
	return text && Number.isFinite(Date.parse(text)) ? text : new Date(0).toISOString();
}

function compareWechatRecordUpdatedAt(
	left: { updatedAt: string },
	right: { updatedAt: string }
): number {
	return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}

async function createWechatAssetFingerprint(asset: PublishAsset): Promise<string> {
	const knownHash = normalizeOptionalString(asset.sha256);
	if (knownHash) {
		return knownHash.startsWith("sha256:") ? knownHash : `sha256:${knownHash}`;
	}
	return createSha256Fingerprint(base64ToBytes(asset.base64));
}

async function createSha256Fingerprint(bytes: Uint8Array): Promise<string> {
	if (globalThis.crypto?.subtle) {
		const digestInput = new Uint8Array(bytes.byteLength);
		digestInput.set(bytes);
		const digest = await globalThis.crypto.subtle.digest("SHA-256", digestInput.buffer);
		return `sha256:${Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("")}`;
	}

	let hash = 2166136261;
	for (const value of bytes) {
		hash ^= value;
		hash = Math.imul(hash, 16777619);
	}
	return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}:${bytes.byteLength}`;
}

function normalizeWechatRemoteImageUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(decodeHtmlAttribute(value).trim());
	} catch {
		throw new Error(`远程图片 URL 无效：${shorten(value)}`);
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new Error(`远程图片只支持 HTTP/HTTPS：${shorten(value)}`);
	}
	if (url.username || url.password) {
		throw new Error("远程图片 URL 不得包含账号或密码。");
	}
	return url.toString();
}

function isRemoteHttpUrl(value: string): boolean {
	try {
		const protocol = new URL(decodeHtmlAttribute(value).trim()).protocol;
		return protocol === "https:" || protocol === "http:";
	} catch {
		return false;
	}
}

function resolveRemoteWechatImageMime(
	headers: Record<string, string> | undefined,
	url: string,
	bytes: Uint8Array
): string {
	const sniffed = sniffImageMime(bytes);
	const declared = normalizeWechatImageMime(getResponseHeader(headers, "content-type").split(";", 1)[0]);
	const fromPath = normalizeWechatImageMime(inferImageMimeFromUrl(url));
	const mime = sniffed || declared || fromPath;
	if (!SUPPORTED_WECHAT_IMAGE_MIME.has(mime)) {
		throw new Error(`微信暂不支持该远程图片格式：${mime || "未知格式"}`);
	}
	return mime;
}

function sniffImageMime(bytes: Uint8Array): string {
	if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) {
		return "image/png";
	}
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return "image/jpeg";
	}
	if (bytes.length >= 6) {
		const signature = String.fromCharCode(...bytes.subarray(0, 6));
		if (signature === "GIF87a" || signature === "GIF89a") {
			return "image/gif";
		}
	}
	return "";
}

function inferImageMimeFromUrl(value: string): string {
	try {
		const extension = new URL(value).pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
		if (extension === "png") return "image/png";
		if (extension === "gif") return "image/gif";
		if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
	} catch {
		return "";
	}
	return "";
}

function getResponseHeader(headers: Record<string, string> | undefined, name: string): string {
	if (!headers) {
		return "";
	}
	const target = name.toLowerCase();
	const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === target);
	return entry?.[1]?.trim() || "";
}

function createRemoteImageFileName(url: string, mime: string): string {
	let baseName = "remote-image";
	try {
		const fromPath = decodeURIComponent(new URL(url).pathname.split("/").pop() || "").trim();
		baseName = fromPath.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || baseName;
	} catch {
		// Keep the stable fallback name.
	}
	const extension = mime === "image/png" ? "png" : mime === "image/gif" ? "gif" : "jpg";
	return /\.(?:png|gif|jpe?g)$/i.test(baseName) ? baseName : `${baseName}.${extension}`;
}

function extractIpv4(value: string): string {
	for (const match of String(value || "").matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
		const candidate = match[0];
		if (candidate.split(".").every((part) => Number(part) >= 0 && Number(part) <= 255)) {
			return candidate;
		}
	}
	return "";
}

function truncateText(value: string, maxLength: number): string {
	const chars = Array.from(String(value || "").trim());
	return chars.length > maxLength ? chars.slice(0, maxLength).join("") : chars.join("");
}

function shorten(value: string): string {
	const text = value.trim();
	return text.length > 120 ? `${text.slice(0, 120)}...` : text;
}

function decodeHtmlAttribute(value: string): string {
	return value
		.replace(/&quot;/g, "\"")
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">");
}

function escapeHtmlAttribute(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
