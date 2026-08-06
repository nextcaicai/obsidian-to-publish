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

export interface FeishuDocsSettings {
	enabled: boolean;
	appId: string;
	appSecret: string;
	folderToken: string;
	ownerUserId: string;
}

export interface FeishuDocSyncResult {
	token: string;
	url: string;
	replacedAssetImages: number;
	uploadedImages: number;
	warnings: string[];
}

export interface FeishuImageMarker {
	assetId: string;
	marker: string;
	alt: string;
}

interface FeishuImportTaskResult {
	jobStatus: number;
	jobErrorMessage: string;
	token: string;
	url: string;
}

interface FeishuDocumentBlock {
	blockId: string;
	parentId: string;
	children: string[];
	blockType: number;
	text: string;
}

interface FeishuImageUploadResult {
	uploadedImages: number;
	failedImages: number;
	warnings: string[];
}

export const DEFAULT_FEISHU_DOCS_SETTINGS: FeishuDocsSettings = {
	enabled: false,
	appId: "",
	appSecret: "",
	folderToken: "",
	ownerUserId: ""
};

const FEISHU_API_BASE_URL = "https://open.feishu.cn/open-apis";
const FEISHU_MARKDOWN_LIMIT_BYTES = 20 * 1024 * 1024;
const FEISHU_MEDIA_LIMIT_BYTES = 20 * 1024 * 1024;
const FEISHU_IMAGE_MARKER_PREFIX = "OTP_IMG:";
const FEISHU_DOCUMENT_MUTATION_GAP_MS = 350;
const FEISHU_IMAGE_BLOCK_TYPE = 27;

export function normalizeFeishuDocsSettings(value: unknown): FeishuDocsSettings {
	const raw = isRecord(value) ? value : {};
	return {
		enabled: normalizeOptionalBoolean(raw.enabled, DEFAULT_FEISHU_DOCS_SETTINGS.enabled),
		appId: normalizeOptionalString(raw.appId),
		appSecret: normalizeOptionalString(raw.appSecret),
		folderToken: parseFeishuFolderToken(raw.folderToken),
		ownerUserId: normalizeOptionalString(raw.ownerUserId)
	};
}

export async function syncPackageToFeishuDoc(
	publishPackage: PublishPackageV1,
	settings: FeishuDocsSettings,
	request: OfficialRequest,
	wait: (delayMs: number) => Promise<void> = defaultWait
): Promise<FeishuDocSyncResult> {
	const normalizedSettings = normalizeFeishuDocsSettings(settings);
	assertFeishuSettingsReady(normalizedSettings);

	const preparedMarkdown = prepareFeishuMarkdown(publishPackage);
	if (preparedMarkdown.bytes.byteLength > FEISHU_MARKDOWN_LIMIT_BYTES) {
		throw new Error("飞书 Markdown 导入文件超过 20MB，请先拆分文章或压缩内容。");
	}

	const client = new FeishuDocsClient(normalizedSettings, request, wait);
	const fileToken = await client.uploadMarkdownForImport(`${safeFileName(publishPackage.article.title)}.md`, preparedMarkdown.bytes);
	const ticket = await client.createImportTask(publishPackage.article.title || publishPackage.note.basename, fileToken);
	const result = await client.waitForImportTask(ticket);

	const imageUpload = preparedMarkdown.imageMarkers.length > 0
		? await client.uploadImagesToDocument(result.token, preparedMarkdown.imageMarkers, publishPackage.assets)
		: { uploadedImages: 0, failedImages: 0, warnings: [] as string[] };

	if (normalizedSettings.ownerUserId) {
		await client.transferDocumentOwnership(result.token, normalizedSettings.ownerUserId);
	}

	return {
		token: result.token,
		url: result.url,
		replacedAssetImages: preparedMarkdown.replacedAssetImages,
		uploadedImages: imageUpload.uploadedImages,
		warnings: [...preparedMarkdown.warnings, ...imageUpload.warnings]
	};
}

export function prepareFeishuMarkdown(publishPackage: PublishPackageV1): {
	markdown: string;
	bytes: Uint8Array;
	replacedAssetImages: number;
	imageMarkers: FeishuImageMarker[];
	warnings: string[];
} {
	const replaced = replaceAssetImageMarkdownWithMarkers(
		publishPackage.article.markdown,
		publishPackage.assets
	);
	const markdown = stripFrontmatter(replaced.markdown).trim();
	return {
		markdown,
		bytes: new TextEncoder().encode(markdown || publishPackage.article.title || publishPackage.note.basename),
		replacedAssetImages: replaced.replacedAssetImages,
		imageMarkers: replaced.imageMarkers,
		warnings: replaced.warnings
	};
}

export function replaceAssetImageMarkdownWithMarkers(markdown: string, assets: PublishAsset[]): {
	markdown: string;
	replacedAssetImages: number;
	imageMarkers: FeishuImageMarker[];
	warnings: string[];
} {
	const imageMarkers: FeishuImageMarker[] = [];
	const assetById = new Map(assets.map((asset) => [asset.id, asset]));
	const warnings: string[] = [];
	const output = String(markdown || "").replace(/!\[([^\]]*)]\(asset:\/\/([A-Za-z0-9_-]+)\)/g, (_match, alt: string, assetId: string) => {
		const asset = assetById.get(assetId);
		const label = (alt || asset?.fileName || assetId).trim();
		const marker = createFeishuImageMarker(assetId);
		imageMarkers.push({
			assetId,
			marker,
			alt: label
		});
		if (!asset) {
			warnings.push(`飞书同步缺少本地图片资源：${label || assetId}`);
		}
		// Keep markers on their own lines so markdown import creates locatable text blocks.
		return `\n\n${marker}\n\n`;
	});

	return {
		markdown: output,
		replacedAssetImages: imageMarkers.length,
		imageMarkers,
		warnings
	};
}

/** @deprecated Prefer replaceAssetImageMarkdownWithMarkers; kept for existing call sites. */
export function replaceAssetImageMarkdownWithPlaceholders(markdown: string, assets: PublishAsset[]): {
	markdown: string;
	replacedAssetImages: number;
	warnings: string[];
} {
	const result = replaceAssetImageMarkdownWithMarkers(markdown, assets);
	return {
		markdown: result.markdown,
		replacedAssetImages: result.replacedAssetImages,
		warnings: result.warnings
	};
}

export function createFeishuImageMarker(assetId: string): string {
	return `${FEISHU_IMAGE_MARKER_PREFIX}${String(assetId || "").trim()}`;
}

export function parseFeishuImageMarker(text: string): string | null {
	const normalized = String(text || "").trim();
	if (!normalized.startsWith(FEISHU_IMAGE_MARKER_PREFIX)) {
		return null;
	}
	const assetId = normalized.slice(FEISHU_IMAGE_MARKER_PREFIX.length).trim();
	return assetId || null;
}

export function parseFeishuFolderToken(value: unknown): string {
	const text = normalizeOptionalString(value);
	if (!text) {
		return "";
	}

	try {
		const url = new URL(text);
		const queryToken = url.searchParams.get("folder_token");
		if (queryToken) {
			return queryToken.trim();
		}

		const folderMatch = url.pathname.match(/\/(?:drive\/)?folder\/([^/?#]+)/i);
		if (folderMatch) {
			return decodeURIComponent(folderMatch[1]).trim();
		}
	} catch {
		// Raw tokens are accepted below.
	}

	return text;
}

export class FeishuDocsClient {
	private accessToken = "";
	private tokenExpiry = 0;

	constructor(
		private settings: FeishuDocsSettings,
		private request: OfficialRequest,
		private wait: (delayMs: number) => Promise<void> = defaultWait
	) {}

	async getAccessToken(): Promise<string> {
		const now = Date.now();
		if (this.accessToken && this.tokenExpiry > now + 60_000) {
			return this.accessToken;
		}

		const url = `${FEISHU_API_BASE_URL}/auth/v3/tenant_access_token/internal`;
		const response = await this.sendRequest("获取飞书 tenant_access_token", {
			url,
			method: "POST",
			headers: {
				"Content-Type": "application/json; charset=utf-8"
			},
			body: JSON.stringify({
				app_id: this.settings.appId,
				app_secret: this.settings.appSecret
			})
		});
		const data = responseJsonRecord(response);
		if (data.code !== 0) {
			throw createApiError("获取飞书 tenant_access_token", data.code, data.msg);
		}

		const token = typeof data.tenant_access_token === "string" ? data.tenant_access_token : "";
		if (!token) {
			throw new Error("飞书接口返回数据中缺少 tenant_access_token。");
		}

		const expiresIn = typeof data.expire === "number" && Number.isFinite(data.expire)
			? data.expire
			: 7200;
		this.accessToken = token;
		this.tokenExpiry = now + expiresIn * 1000;
		return token;
	}

	async uploadMarkdownForImport(fileName: string, bytes: Uint8Array): Promise<string> {
		const token = await this.getAccessToken();
		const url = `${FEISHU_API_BASE_URL}/drive/v1/medias/upload_all`;
		const boundary = `obsidian-to-publish-feishu-${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
		const body = buildMultipartBody({
			boundary,
			fields: {
				file_name: fileName,
				parent_type: "ccm_import_open",
				size: String(bytes.byteLength),
				extra: JSON.stringify({
					obj_type: "docx",
					file_extension: "md"
				})
			},
			file: {
				fileName,
				mimeType: "text/markdown; charset=utf-8",
				bytes
			}
		});
		const response = await this.sendRequest("上传飞书 Markdown 导入素材", {
			url,
			method: "POST",
			headers: {
				"Authorization": `Bearer ${token}`,
				"Content-Type": `multipart/form-data; boundary=${boundary}`
			},
			body
		});
		const data = responseJsonRecord(response);
		if (data.code !== 0) {
			throw createApiError("上传飞书 Markdown 导入素材", data.code, data.msg);
		}

		return getNestedString(data, ["data", "file_token"], "飞书上传素材接口未返回 file_token。");
	}

	async createImportTask(title: string, fileToken: string): Promise<string> {
		const token = await this.getAccessToken();
		const url = `${FEISHU_API_BASE_URL}/drive/v1/import_tasks`;
		const response = await this.sendRequest("创建飞书导入任务", {
			url,
			method: "POST",
			headers: {
				"Authorization": `Bearer ${token}`,
				"Content-Type": "application/json; charset=utf-8"
			},
			body: JSON.stringify({
				file_extension: "md",
				file_name: title || "Obsidian 文档",
				type: "docx",
				file_token: fileToken,
				point: {
					mount_type: 1,
					mount_key: this.settings.folderToken
				}
			})
		});
		const data = responseJsonRecord(response);
		if (data.code !== 0) {
			throw createApiError("创建飞书导入任务", data.code, data.msg);
		}

		return getNestedString(data, ["data", "ticket"], "飞书导入任务接口未返回 ticket。");
	}

	async queryImportTask(ticket: string): Promise<FeishuImportTaskResult> {
		const token = await this.getAccessToken();
		const url = `${FEISHU_API_BASE_URL}/drive/v1/import_tasks/${encodeURIComponent(ticket)}`;
		const response = await this.sendRequest("查询飞书导入任务", {
			url,
			method: "GET",
			headers: {
				"Authorization": `Bearer ${token}`,
				"Content-Type": "application/json; charset=utf-8"
			}
		});
		const data = responseJsonRecord(response);
		if (data.code !== 0) {
			throw createApiError("查询飞书导入任务", data.code, data.msg);
		}

		const result = getNestedRecord(data, ["data", "result"]) ?? getNestedRecord(data, ["data"]);
		if (!result) {
			throw new Error("飞书查询导入任务未返回有效结果。");
		}

		return {
			jobStatus: typeof result.job_status === "number" ? result.job_status : -1,
			jobErrorMessage: typeof result.job_error_msg === "string" ? result.job_error_msg.trim() : "",
			token: typeof result.token === "string" ? result.token : "",
			url: typeof result.url === "string" ? result.url : ""
		};
	}

	async waitForImportTask(ticket: string): Promise<{
		token: string;
		url: string;
	}> {
		for (let attempt = 0; attempt < 8; attempt += 1) {
			const result = await this.queryImportTask(ticket);
			if (result.jobStatus === 0) {
				if (!result.token || !result.url) {
					throw new Error("飞书导入完成，但未返回文档 token 或 URL。");
				}

				return {
					token: result.token,
					url: result.url
				};
			}

			if (result.jobStatus !== 1 && result.jobStatus !== 2) {
				throw createFeishuImportJobError(result);
			}

			await this.wait(attempt < 3 ? 3000 : 5000);
		}

		throw new Error("飞书文档导入处理超时，请稍后到目标云空间查看。");
	}

	async transferDocumentOwnership(docToken: string, ownerUserId: string): Promise<void> {
		const token = await this.getAccessToken();
		const url = `${FEISHU_API_BASE_URL}/drive/v1/permissions/${encodeURIComponent(docToken)}/members/transfer_owner?need_notification=false&old_owner_perm=full_access&remove_old_owner=false&stay_put=true&type=docx`;
		const response = await this.sendRequest("转移飞书文档所有权", {
			url,
			method: "POST",
			headers: {
				"Authorization": `Bearer ${token}`,
				"Content-Type": "application/json; charset=utf-8"
			},
			body: JSON.stringify({
				member_id: ownerUserId,
				member_type: "userid"
			})
		});
		const data = responseJsonRecord(response);
		if (data.code !== 0) {
			throw createApiError("转移飞书文档所有权", data.code, data.msg);
		}
	}

	async uploadImagesToDocument(
		documentId: string,
		imageMarkers: FeishuImageMarker[],
		assets: PublishAsset[]
	): Promise<FeishuImageUploadResult> {
		if (imageMarkers.length === 0) {
			return { uploadedImages: 0, failedImages: 0, warnings: [] };
		}

		const assetById = new Map(assets.map((asset) => [asset.id, asset]));
		const pendingByMarker = new Map(imageMarkers.map((item) => [item.marker, item]));
		const warnings: string[] = [];
		let uploadedImages = 0;
		let failedImages = 0;

		// Process one image at a time and re-list blocks so sibling indexes stay accurate.
		while (pendingByMarker.size > 0) {
			const blocks = await this.listDocumentBlocks(documentId);
			const blockById = new Map(blocks.map((block) => [block.blockId, block]));
			const markerBlocks = blocks
				.map((block) => {
					const assetId = parseFeishuImageMarker(block.text);
					if (!assetId) {
						return null;
					}
					const marker = createFeishuImageMarker(assetId);
					const imageMarker = pendingByMarker.get(marker);
					if (!imageMarker) {
						return null;
					}
					const parent = blockById.get(block.parentId);
					const index = parent ? parent.children.indexOf(block.blockId) : -1;
					if (index < 0) {
						return null;
					}
					return {
						imageMarker,
						block,
						parentId: block.parentId,
						index
					};
				})
				.filter((item): item is {
					imageMarker: FeishuImageMarker;
					block: FeishuDocumentBlock;
					parentId: string;
					index: number;
				} => Boolean(item))
				// High index first so earlier sibling indexes stay valid within the same parent.
				.sort((left, right) => {
					if (left.parentId === right.parentId) {
						return right.index - left.index;
					}
					return left.parentId.localeCompare(right.parentId);
				});

			if (markerBlocks.length === 0) {
				for (const leftover of pendingByMarker.values()) {
					failedImages += 1;
					warnings.push(`飞书文档中未找到图片标记：${leftover.alt || leftover.assetId}`);
				}
				break;
			}

			const next = markerBlocks[0];
			pendingByMarker.delete(next.imageMarker.marker);

			const asset = assetById.get(next.imageMarker.assetId);
			if (!asset) {
				failedImages += 1;
				warnings.push(`飞书图片上传缺少资源：${next.imageMarker.alt || next.imageMarker.assetId}`);
				continue;
			}

			try {
				assertFeishuImageAsset(asset);
				await this.paceDocumentMutation();
				const imageBlockId = await this.createImageBlock(documentId, next.parentId, next.index);
				const fileToken = await this.uploadImageMedia(documentId, imageBlockId, asset);
				await this.paceDocumentMutation();
				await this.replaceImageBlockToken(documentId, imageBlockId, fileToken);
				await this.paceDocumentMutation();
				// Creating the image at the marker index pushes the marker one position forward.
				await this.deleteChildAtIndex(documentId, next.parentId, next.index + 1);
				uploadedImages += 1;
			} catch (error) {
				failedImages += 1;
				const message = error instanceof Error ? error.message : String(error || "未知错误");
				warnings.push(`飞书图片上传失败（${next.imageMarker.alt || next.imageMarker.assetId}）：${redactSensitiveText(message)}`);
			}
		}

		if (failedImages > 0) {
			warnings.unshift(`飞书图片上传完成：成功 ${uploadedImages} 张，失败 ${failedImages} 张。`);
		}

		return {
			uploadedImages,
			failedImages,
			warnings
		};
	}

	async listDocumentBlocks(documentId: string): Promise<FeishuDocumentBlock[]> {
		const token = await this.getAccessToken();
		const blocks: FeishuDocumentBlock[] = [];
		let pageToken = "";

		do {
			const query = new URLSearchParams({
				page_size: "500",
				document_revision_id: "-1"
			});
			if (pageToken) {
				query.set("page_token", pageToken);
			}
			const url = `${FEISHU_API_BASE_URL}/docx/v1/documents/${encodeURIComponent(documentId)}/blocks?${query.toString()}`;
			const response = await this.sendRequest("获取飞书文档块", {
				url,
				method: "GET",
				headers: {
					"Authorization": `Bearer ${token}`,
					"Content-Type": "application/json; charset=utf-8"
				}
			});
			const data = responseJsonRecord(response);
			if (data.code !== 0) {
				throw createApiError("获取飞书文档块", data.code, data.msg);
			}

			const payload = getNestedRecord(data, ["data"]) ?? {};
			const items = Array.isArray(payload.items) ? payload.items : [];
			for (const item of items) {
				if (!isRecord(item)) {
					continue;
				}
				const blockId = typeof item.block_id === "string" ? item.block_id : "";
				if (!blockId) {
					continue;
				}
				blocks.push({
					blockId,
					parentId: typeof item.parent_id === "string" ? item.parent_id : "",
					children: Array.isArray(item.children)
						? item.children.filter((child): child is string => typeof child === "string")
						: [],
					blockType: typeof item.block_type === "number" ? item.block_type : 0,
					text: extractFeishuBlockText(item)
				});
			}

			pageToken = typeof payload.page_token === "string" && payload.has_more
				? payload.page_token
				: "";
		} while (pageToken);

		return blocks;
	}

	async createImageBlock(documentId: string, parentBlockId: string, index: number): Promise<string> {
		const token = await this.getAccessToken();
		const url = `${FEISHU_API_BASE_URL}/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(parentBlockId)}/children?document_revision_id=-1`;
		const response = await this.sendRequest("创建飞书图片块", {
			url,
			method: "POST",
			headers: {
				"Authorization": `Bearer ${token}`,
				"Content-Type": "application/json; charset=utf-8"
			},
			body: JSON.stringify({
				index,
				children: [
					{
						block_type: FEISHU_IMAGE_BLOCK_TYPE,
						image: {}
					}
				]
			})
		});
		const data = responseJsonRecord(response);
		if (data.code !== 0) {
			throw createApiError("创建飞书图片块", data.code, data.msg);
		}

		const children = getNestedRecord(data, ["data"])?.children;
		if (!Array.isArray(children) || children.length === 0 || !isRecord(children[0])) {
			throw new Error("飞书创建图片块未返回 block_id。");
		}
		const blockId = typeof children[0].block_id === "string" ? children[0].block_id.trim() : "";
		if (!blockId) {
			throw new Error("飞书创建图片块未返回 block_id。");
		}
		return blockId;
	}

	async uploadImageMedia(documentId: string, imageBlockId: string, asset: PublishAsset): Promise<string> {
		const token = await this.getAccessToken();
		const bytes = base64ToBytes(asset.base64);
		if (bytes.byteLength > FEISHU_MEDIA_LIMIT_BYTES) {
			throw new Error(`图片超过飞书 20MB 限制：${asset.fileName || asset.id}`);
		}
		if (bytes.byteLength === 0) {
			throw new Error(`图片内容为空：${asset.fileName || asset.id}`);
		}

		const fileName = safeImageFileName(asset);
		const boundary = `obsidian-to-publish-feishu-img-${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
		const body = buildMultipartBody({
			boundary,
			fields: {
				file_name: fileName,
				parent_type: "docx_image",
				parent_node: imageBlockId,
				size: String(bytes.byteLength),
				extra: JSON.stringify({
					drive_route_token: documentId
				})
			},
			file: {
				fileName,
				mimeType: normalizeImageMime(asset.mime),
				bytes
			}
		});
		const response = await this.sendRequest("上传飞书图片素材", {
			url: `${FEISHU_API_BASE_URL}/drive/v1/medias/upload_all`,
			method: "POST",
			headers: {
				"Authorization": `Bearer ${token}`,
				"Content-Type": `multipart/form-data; boundary=${boundary}`
			},
			body
		});
		const data = responseJsonRecord(response);
		if (data.code !== 0) {
			throw createApiError("上传飞书图片素材", data.code, data.msg);
		}

		return getNestedString(data, ["data", "file_token"], "飞书上传图片素材未返回 file_token。");
	}

	async replaceImageBlockToken(documentId: string, imageBlockId: string, fileToken: string): Promise<void> {
		const token = await this.getAccessToken();
		const url = `${FEISHU_API_BASE_URL}/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(imageBlockId)}?document_revision_id=-1`;
		const response = await this.sendRequest("设置飞书图片块素材", {
			url,
			method: "PATCH",
			headers: {
				"Authorization": `Bearer ${token}`,
				"Content-Type": "application/json; charset=utf-8"
			},
			body: JSON.stringify({
				replace_image: {
					token: fileToken
				}
			})
		});
		const data = responseJsonRecord(response);
		if (data.code !== 0) {
			throw createApiError("设置飞书图片块素材", data.code, data.msg);
		}
	}

	async deleteChildAtIndex(documentId: string, parentBlockId: string, index: number): Promise<void> {
		if (index < 0) {
			return;
		}
		const token = await this.getAccessToken();
		const url = `${FEISHU_API_BASE_URL}/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(parentBlockId)}/children/batch_delete?document_revision_id=-1`;
		const response = await this.sendRequest("删除飞书图片标记块", {
			url,
			method: "DELETE",
			headers: {
				"Authorization": `Bearer ${token}`,
				"Content-Type": "application/json; charset=utf-8"
			},
			body: JSON.stringify({
				start_index: index,
				end_index: index + 1
			})
		});
		const data = responseJsonRecord(response);
		if (data.code !== 0) {
			throw createApiError("删除飞书图片标记块", data.code, data.msg);
		}
	}

	private async paceDocumentMutation(): Promise<void> {
		await this.wait(FEISHU_DOCUMENT_MUTATION_GAP_MS);
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

function assertFeishuSettingsReady(settings: FeishuDocsSettings) {
	if (!settings.enabled) {
		throw new Error("请先在插件设置中启用飞书云文档。");
	}

	if (!settings.appId || !settings.appSecret) {
		throw new Error("请先在插件设置中填写飞书 AppID 和 AppSecret。");
	}

	if (!settings.folderToken) {
		throw new Error("请先在插件设置中填写飞书目标文件夹 token 或文件夹 URL。");
	}
}

function createFeishuImportJobError(result: FeishuImportTaskResult): Error {
	const status = result.jobStatus;
	const detail = result.jobErrorMessage && result.jobErrorMessage.toLowerCase() !== "success"
		? ` 飞书返回：${redactSensitiveText(result.jobErrorMessage).slice(0, 200)}。`
		: "";

	if (Math.abs(status) === 116) {
		return new Error(
			`飞书导入失败：应用无权写入目标文件夹（job_status=${status}）。请确认文件夹 Token，并将目标文件夹共享给包含该应用机器人的群组，授予编辑权限。${detail}`
		);
	}

	return new Error(`飞书导入任务失败，job_status=${status}。${detail}`);
}

function stripFrontmatter(markdown: string): string {
	return String(markdown || "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function safeFileName(value: string): string {
	const normalized = String(value || "Obsidian 文档")
		.trim()
		.replace(/[\\/:*?"<>|\r\n]+/g, " ")
		.replace(/\s+/g, " ")
		.slice(0, 120)
		.trim();
	return normalized || "Obsidian 文档";
}

function safeImageFileName(asset: PublishAsset): string {
	const extension = getImageExtension(asset);
	const baseName = String(asset.fileName || asset.id || "image")
		.trim()
		.replace(/[\\/:*?"<>|\r\n]+/g, "_")
		.replace(/\s+/g, " ")
		.replace(/\.[a-z0-9]+$/i, "")
		.slice(0, 80)
		.trim();
	return `${baseName || "image"}.${extension}`;
}

function getImageExtension(asset: PublishAsset): string {
	const mime = normalizeImageMime(asset.mime);
	if (mime === "image/png") return "png";
	if (mime === "image/gif") return "gif";
	if (mime === "image/webp") return "webp";
	if (mime === "image/bmp") return "bmp";
	if (mime === "image/svg+xml") return "svg";
	const fromName = String(asset.fileName || "").match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
	if (fromName && /^[a-z0-9]+$/.test(fromName)) {
		return fromName;
	}
	return "jpg";
}

function normalizeImageMime(mime: string): string {
	const normalized = String(mime || "").trim().toLowerCase();
	if (normalized === "image/jpg") {
		return "image/jpeg";
	}
	return normalized || "image/png";
}

function assertFeishuImageAsset(asset: PublishAsset): void {
	if (!asset || asset.kind !== "image") {
		throw new Error("飞书图片上传需要 image 类型资源。");
	}
	if (!asset.base64) {
		throw new Error(`飞书图片资源缺少 base64 数据：${asset.fileName || asset.id}`);
	}
}

function extractFeishuBlockText(block: Record<string, unknown>): string {
	const chunks: string[] = [];
	const visit = (value: unknown): void => {
		if (!isRecord(value)) {
			return;
		}
		if (Array.isArray(value.elements)) {
			for (const element of value.elements) {
				if (!isRecord(element)) {
					continue;
				}
				const textRun = isRecord(element.text_run) ? element.text_run : null;
				if (textRun && typeof textRun.content === "string") {
					chunks.push(textRun.content);
				}
			}
		}
		for (const nested of Object.values(value)) {
			if (isRecord(nested) && Array.isArray(nested.elements)) {
				visit(nested);
			}
		}
	};

	// Common text-bearing keys from Feishu block payloads.
	for (const key of [
		"text",
		"quote",
		"heading1",
		"heading2",
		"heading3",
		"heading4",
		"heading5",
		"heading6",
		"heading7",
		"heading8",
		"heading9",
		"bullet",
		"ordered",
		"todo",
		"page"
	]) {
		if (key in block) {
			visit(block[key]);
		}
	}

	return chunks.join("").trim();
}

function base64ToBytes(base64: string): Uint8Array {
	const binary = atob(String(base64 || ""));
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

function getNestedString(data: Record<string, unknown>, path: string[], errorMessage: string): string {
	let current: unknown = data;
	for (const segment of path) {
		if (!isRecord(current)) {
			throw new Error(errorMessage);
		}
		current = current[segment];
	}

	if (typeof current === "string" && current.trim()) {
		return current.trim();
	}

	throw new Error(errorMessage);
}

function getNestedRecord(data: Record<string, unknown>, path: string[]): Record<string, unknown> | null {
	let current: unknown = data;
	for (const segment of path) {
		if (!isRecord(current)) {
			return null;
		}
		current = current[segment];
	}

	return isRecord(current) ? current : null;
}

function defaultWait(delayMs: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}
