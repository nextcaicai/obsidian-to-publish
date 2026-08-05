export interface OfficialRequestOptions {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string | ArrayBuffer;
	contentType?: string;
	throw?: boolean;
}

export interface OfficialRequestResponse {
	status: number;
	json?: unknown;
	text?: string;
}

export type OfficialRequest = (options: OfficialRequestOptions) => Promise<OfficialRequestResponse>;

export function responseJsonRecord(response: OfficialRequestResponse): Record<string, unknown> {
	const value = readResponseJson(response);
	return isRecord(value) ? value : {};
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function normalizeOptionalString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function normalizeOptionalBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

export function createHttpError(label: string, url: string, response: OfficialRequestResponse): Error {
	const status = response.status || 0;
	const details = formatResponseDetails(response);
	return new Error(`${label} 请求失败，HTTP ${status}${details ? `：${details}` : ""} (${formatEndpoint(url)})`);
}

export function createApiError(label: string, code: unknown, message: unknown): Error {
	const normalizedCode = code === undefined || code === null || code === "" ? "N/A" : String(code);
	const normalizedMessage = typeof message === "string" && message ? message : "未知错误";
	return new Error(`${label} 失败 (${normalizedCode}): ${normalizedMessage}`);
}

export function redactSensitiveText(value: string): string {
	return String(value || "")
		.replace(/([?&](?:access_token|secret|app_secret)=)[^&\s)]+/gi, "$1***")
		.replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1***");
}

export function formatEndpoint(url: string): string {
	try {
		const parsed = new URL(url);
		return `${parsed.hostname}${parsed.pathname}`;
	} catch {
		return url;
	}
}

function formatResponseDetails(response: OfficialRequestResponse): string {
	const json = readResponseJson(response);
	if (isRecord(json)) {
		const code = json.code ?? json.errcode ?? json.Code;
		const message = json.msg ?? json.errmsg ?? json.message ?? json.error;
		const requestId = json.request_id ?? json.requestId ?? json.log_id;
		return [
			code !== undefined && code !== null && code !== "" ? `code ${String(code)}` : "",
			typeof message === "string" && message ? message : "",
			typeof requestId === "string" && requestId ? `request_id ${requestId}` : ""
		].filter(Boolean).join(", ");
	}

	const text = String(response.text || "").trim();
	return text.length > 300 ? `${text.slice(0, 300)}...` : text;
}

function readResponseJson(response: OfficialRequestResponse): unknown {
	try {
		return response.json;
	} catch {
		return undefined;
	}
}
