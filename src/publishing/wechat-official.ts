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
	OfficialRequestOptions
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
}

export interface WechatDraftHtmlInspection {
	blockingIssues: string[];
	warnings: string[];
}

export const DEFAULT_WECHAT_OFFICIAL_SETTINGS: WechatOfficialSettings = {
	enabled: false,
	appId: "",
	appSecret: "",
	author: "",
	digest: "",
	contentSourceUrl: "",
	openComment: false,
	onlyFansCanComment: false
};

const WECHAT_API_BASE_URL = "https://api.weixin.qq.com/cgi-bin";
const WECHAT_ARTICLE_TITLE_LIMIT = 64;
const WECHAT_ARTICLE_DIGEST_LIMIT = 120;
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
		onlyFansCanComment: normalizeOptionalBoolean(raw.onlyFansCanComment, DEFAULT_WECHAT_OFFICIAL_SETTINGS.onlyFansCanComment)
	};
}

export async function createWechatDraftFromPackage(
	publishPackage: PublishPackageV1,
	settings: WechatOfficialSettings,
	request: OfficialRequest
): Promise<WechatDraftResult> {
	const normalizedSettings = normalizeWechatOfficialSettings(settings);
	assertWechatSettingsReady(normalizedSettings);

	const coverAsset = resolveWechatCoverAsset(publishPackage);
	if (!coverAsset) {
		throw new Error("微信公众号草稿需要封面图。请在 frontmatter 设置 cover，或在正文放入至少一张本地图片。");
	}

	const client = new WechatOfficialClient(normalizedSettings, request);
	const coverResponse = await client.uploadCover(coverAsset);
	const thumbMediaId = getRequiredString(coverResponse, "media_id", "微信封面上传接口未返回 media_id");

	const uploadedUrls = new Map<string, string>();
	for (const asset of publishPackage.assets) {
		const response = await client.uploadArticleImage(asset);
		uploadedUrls.set(asset.id, getRequiredString(response, "url", `微信正文图片上传接口未返回 URL：${asset.fileName}`));
	}

	const replaced = replaceHtmlImageSourcesWithWechatUrls(
		extractHtmlBodyContent(publishPackage.article.html),
		publishPackage.assets,
		uploadedUrls
	);
	const normalizedHtml = normalizeWechatDraftHtml(replaced.html);
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
	const draftResponse = await client.createDraft(article);
	const mediaId = getRequiredString(draftResponse, "media_id", "微信草稿接口未返回 media_id");

	return {
		article,
		mediaId,
		uploadedImages: uploadedUrls.size,
		warnings: replaced.unresolvedSources.concat(inspection.warnings)
	};
}

export function resolveWechatCoverAsset(publishPackage: PublishPackageV1): PublishAsset | null {
	const cover = publishPackage.article.cover || "";
	const coverAssetId = parseAssetId(cover);
	if (coverAssetId) {
		return publishPackage.assets.find((asset) => asset.id === coverAssetId) ?? null;
	}

	return publishPackage.assets[0] ?? null;
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

export function normalizeWechatDraftHtml(html: string): string {
	return String(html || "")
		.replace(/<!doctype[^>]*>/gi, "")
		.replace(/<\/?html\b[^>]*>/gi, "")
		.replace(/<head\b[\s\S]*?<\/head>/gi, "")
		.replace(/<\/?body\b[^>]*>/gi, "")
		.replace(/<script\b[\s\S]*?<\/script>/gi, "")
		.replace(/<style\b[\s\S]*?<\/style>/gi, "")
		.trim();
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

	async uploadArticleImage(asset: PublishAsset): Promise<Record<string, unknown>> {
		assertWechatImageAsset(asset);
		const token = await this.getAccessToken();
		return this.uploadMultipart(
			"上传微信正文图片",
			`${WECHAT_API_BASE_URL}/media/uploadimg?access_token=${encodeURIComponent(token)}`,
			asset
		);
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

function getRequiredString(data: Record<string, unknown>, key: string, message: string): string {
	const value = data[key];
	if (typeof value === "string" && value.trim()) {
		return value.trim();
	}

	throw new Error(message);
}

function createWechatApiError(label: string, data: Record<string, unknown>): Error {
	const code = data.errcode;
	const message = typeof data.errmsg === "string" ? data.errmsg : "";
	if (Number(code) === 40164) {
		const ip = message.match(/\binvalid ip\s+((?:\d{1,3}\.){3}\d{1,3})\b/i)?.[1] || "当前出口 IP";
		return new Error(
			`${label} 失败 (40164)：${ip} 未加入微信公众号 API IP 白名单。请在公众号后台将该 IP 加入白名单后重试。`
		);
	}

	return createApiError(label, code, message || JSON.stringify(data));
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
