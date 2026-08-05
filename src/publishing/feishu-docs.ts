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
	warnings: string[];
}

interface FeishuImportTaskResult {
	jobStatus: number;
	jobErrorMessage: string;
	token: string;
	url: string;
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

	if (normalizedSettings.ownerUserId) {
		await client.transferDocumentOwnership(result.token, normalizedSettings.ownerUserId);
	}

	return {
		token: result.token,
		url: result.url,
		replacedAssetImages: preparedMarkdown.replacedAssetImages,
		warnings: preparedMarkdown.warnings
	};
}

export function prepareFeishuMarkdown(publishPackage: PublishPackageV1): {
	markdown: string;
	bytes: Uint8Array;
	replacedAssetImages: number;
	warnings: string[];
} {
	const replaced = replaceAssetImageMarkdownWithPlaceholders(
		publishPackage.article.markdown,
		publishPackage.assets
	);
	const markdown = stripFrontmatter(replaced.markdown).trim();
	return {
		markdown,
		bytes: new TextEncoder().encode(markdown || publishPackage.article.title || publishPackage.note.basename),
		replacedAssetImages: replaced.replacedAssetImages,
		warnings: replaced.warnings
	};
}

export function replaceAssetImageMarkdownWithPlaceholders(markdown: string, assets: PublishAsset[]): {
	markdown: string;
	replacedAssetImages: number;
	warnings: string[];
} {
	let replacedAssetImages = 0;
	const assetById = new Map(assets.map((asset) => [asset.id, asset]));
	const output = String(markdown || "").replace(/!\[([^\]]*)]\(asset:\/\/([A-Za-z0-9_-]+)\)/g, (_match, alt: string, assetId: string) => {
		const asset = assetById.get(assetId);
		replacedAssetImages += 1;
		const label = (alt || asset?.fileName || assetId).trim();
		return `> 图片待补：${label}`;
	});

	return {
		markdown: output,
		replacedAssetImages,
		warnings: replacedAssetImages > 0
			? [`飞书第一版导入已保留 ${replacedAssetImages} 个本地图片位置，但尚未自动上传图片块。`]
			: []
	};
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
