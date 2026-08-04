import type { CopyPlatform } from "../platforms/types";

type RuntimeRequire = (moduleName: string) => unknown;

export interface ChromeCompanionBridgeSettings {
	enabled: boolean;
	port: number;
	token: string;
}

export interface ChromeCompanionBridgeStatus {
	running: boolean;
	port: number;
	hasClient: boolean;
	clientLabel: string;
	clientVersion: string;
	lastSeenAt: number | null;
}

export interface ChromeCompanionBridgeService {
	start(): Promise<void>;
	stop(): Promise<void>;
	request(method: string, params: unknown, options?: { timeoutMs?: number }): Promise<unknown>;
	getStatus(): ChromeCompanionBridgeStatus;
}

interface BridgeOptions extends ChromeCompanionBridgeSettings {
	requireFn: RuntimeRequire;
	pluginVersion: string;
	supportedPlatforms: Array<{
		id: CopyPlatform;
		label: string;
		editorUrl: string;
	}>;
}

interface HttpModuleLike {
	createServer(handler: (request: HttpRequestLike, response: HttpResponseLike) => void): HttpServerLike;
}

interface CryptoModuleLike {
	createHash(algorithm: string): {
		update(value: string): { digest(encoding: "base64"): string };
	};
}

interface HttpRequestLike {
	headers: Record<string, string | string[] | undefined>;
	method?: string;
	url?: string;
}

interface HttpResponseLike {
	writeHead(status: number, headers?: Record<string, string>): void;
	end(body?: string): void;
}

interface HttpServerLike {
	on(event: "upgrade", handler: (request: HttpRequestLike, socket: BridgeSocketLike) => void): void;
	listen(port: number, host: string, callback: () => void): void;
	close(callback?: (error?: Error) => void): void;
}

interface BridgeSocketLike {
	write(data: string | Buffer): void;
	end(): void;
	destroy(): void;
	on(event: "data", handler: (chunk: Buffer) => void): void;
	on(event: "close" | "error", handler: () => void): void;
}

interface PendingRequest {
	resolve(value: unknown): void;
	reject(error: Error): void;
	timeout: number;
}

interface BridgeClient {
	socket: BridgeSocketLike;
	label: string;
	version: string;
	lastSeenAt: number;
	buffer: Buffer;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
const LOCAL_HOST = "127.0.0.1";
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export const DEFAULT_CHROME_COMPANION_BRIDGE_SETTINGS: ChromeCompanionBridgeSettings = {
	enabled: false,
	port: 27127,
	token: ""
};

export function createChromeCompanionBridgeService(options: BridgeOptions): ChromeCompanionBridgeService {
	const http = options.requireFn("http") as HttpModuleLike;
	const crypto = options.requireFn("crypto") as CryptoModuleLike;
	let server: HttpServerLike | null = null;
	let client: BridgeClient | null = null;
	let starting: Promise<void> | null = null;
	const pendingRequests = new Map<string, PendingRequest>();

	function start(): Promise<void> {
		if (server) {
			return Promise.resolve();
		}

		if (starting) {
			return starting;
		}

		starting = new Promise<void>((resolve, reject) => {
			try {
				server = http.createServer((request, response) => {
					handleHttpStatus(request, response);
				});
				server.on("upgrade", (request, socket) => {
					handleUpgrade(request, socket);
				});
				server.listen(options.port, LOCAL_HOST, () => {
					starting = null;
					resolve();
				});
			} catch (error) {
				starting = null;
				server = null;
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});

		return starting;
	}

	function stop(): Promise<void> {
		for (const pending of pendingRequests.values()) {
			window.clearTimeout(pending.timeout);
			pending.reject(new Error("Chrome companion bridge stopped."));
		}
		pendingRequests.clear();

		if (client) {
			closeClient();
		}

		return new Promise((resolve) => {
			if (!server) {
				resolve();
				return;
			}

			const closingServer = server;
			server = null;
			closingServer.close(() => resolve());
		});
	}

	function request(method: string, params: unknown, requestOptions: { timeoutMs?: number } = {}): Promise<unknown> {
		if (!client) {
			return Promise.reject(new Error("Chrome companion is not connected."));
		}

		const id = createRequestId();
		const timeoutMs = typeof requestOptions.timeoutMs === "number"
			&& Number.isFinite(requestOptions.timeoutMs)
			&& requestOptions.timeoutMs > 0
			? requestOptions.timeoutMs
			: DEFAULT_REQUEST_TIMEOUT_MS;

		return new Promise((resolve, reject) => {
			const timeout = window.setTimeout(() => {
				pendingRequests.delete(id);
				reject(new Error(`Chrome companion request timed out: ${method}`));
			}, timeoutMs);

			pendingRequests.set(id, {
				resolve,
				reject,
				timeout
			});

			sendJson(client, {
				id,
				method,
				params,
				token: options.token
			});
		});
	}

	function getStatus(): ChromeCompanionBridgeStatus {
		return {
			running: Boolean(server),
			port: options.port,
			hasClient: Boolean(client),
			clientLabel: client?.label ?? "",
			clientVersion: client?.version ?? "",
			lastSeenAt: client?.lastSeenAt ?? null
		};
	}

	function handleHttpStatus(request: HttpRequestLike, response: HttpResponseLike) {
		if (request.method !== "GET" || request.url !== "/status") {
			response.writeHead(404, { "Content-Type": "application/json" });
			response.end(JSON.stringify({ ok: false, error: "not_found" }));
			return;
		}

		response.writeHead(200, {
			"Content-Type": "application/json",
			"Access-Control-Allow-Origin": "*",
			"Cache-Control": "no-store"
		});
		response.end(JSON.stringify({
			ok: true,
			source: "obsidian-to-publish",
			pluginVersion: options.pluginVersion,
			status: getStatus()
		}));
	}

	function handleUpgrade(request: HttpRequestLike, socket: BridgeSocketLike) {
		const key = firstHeaderValue(request.headers["sec-websocket-key"]);
		const url = new URL(request.url || "/", `http://${LOCAL_HOST}:${options.port}`);
		const token = url.searchParams.get("token") || "";
		if (!key || token !== options.token) {
			socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
			socket.destroy();
			return;
		}

		if (client) {
			closeClient();
		}

		const accept = crypto.createHash("sha1").update(`${key}${WS_GUID}`).digest("base64");
		socket.write([
			"HTTP/1.1 101 Switching Protocols",
			"Upgrade: websocket",
			"Connection: Upgrade",
			`Sec-WebSocket-Accept: ${accept}`,
			"",
			""
		].join("\r\n"));

		client = {
			socket,
			label: "",
			version: "",
			lastSeenAt: Date.now(),
			buffer: Buffer.alloc(0)
		};

		socket.on("data", (chunk) => handleSocketData(socket, chunk));
		socket.on("close", () => {
			if (client?.socket === socket) {
				client = null;
			}
		});
		socket.on("error", () => {
			if (client?.socket === socket) {
				client = null;
			}
		});
	}

	function handleSocketData(socket: BridgeSocketLike, chunk: Buffer) {
		if (!client || client.socket !== socket) {
			return;
		}

		client.buffer = Buffer.concat([client.buffer, chunk]);
		const parsed = parseWebSocketFrames(client.buffer);
		client.buffer = parsed.remaining;
		client.lastSeenAt = Date.now();

		for (const message of parsed.messages) {
			handleClientMessage(message);
		}
	}

	function handleClientMessage(text: string) {
		let message: unknown;
		try {
			message = JSON.parse(text);
		} catch {
			return;
		}

		if (!isRecord(message)) {
			return;
		}

		if (message.type === "extension.hello") {
			if (client) {
				client.label = typeof message.label === "string" ? message.label : "Chrome companion";
				client.version = typeof message.version === "string" ? message.version : "";
				sendJson(client, {
					type: "extension.hello_ack",
					ok: true,
					pluginVersion: options.pluginVersion,
					supportedPlatforms: options.supportedPlatforms
				});
			}
			return;
		}

		if (typeof message.id === "string" && pendingRequests.has(message.id)) {
			const pending = pendingRequests.get(message.id);
			if (!pending) {
				return;
			}

			window.clearTimeout(pending.timeout);
			pendingRequests.delete(message.id);
			if (message.error) {
				pending.reject(new Error(String(message.error)));
			} else {
				pending.resolve(message.result);
			}
		}
	}

	function closeClient() {
		if (!client) {
			return;
		}

		try {
			client.socket.end();
		} catch {
			// Closing a dead socket can throw; the bridge status will be reset below.
		}
		client = null;
	}

	return {
		start,
		stop,
		request,
		getStatus
	};
}

export function generateChromeCompanionToken(): string {
	const values = new Uint32Array(4);
	crypto.getRandomValues(values);
	return Array.from(values, (value) => value.toString(36).padStart(7, "0")).join("");
}

function sendJson(client: BridgeClient | null, payload: unknown) {
	if (!client) {
		return;
	}

	client.socket.write(encodeWebSocketTextFrame(JSON.stringify(payload)));
}

function encodeWebSocketTextFrame(text: string): Buffer {
	const payload = Buffer.from(text, "utf8");
	if (payload.length < 126) {
		return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
	}

	if (payload.length < 65536) {
		const header = Buffer.alloc(4);
		header[0] = 0x81;
		header[1] = 126;
		header.writeUInt16BE(payload.length, 2);
		return Buffer.concat([header, payload]);
	}

	const header = Buffer.alloc(10);
	header[0] = 0x81;
	header[1] = 127;
	header.writeBigUInt64BE(BigInt(payload.length), 2);
	return Buffer.concat([header, payload]);
}

function parseWebSocketFrames(buffer: Buffer): {
	messages: string[];
	remaining: Buffer;
} {
	const messages: string[] = [];
	let offset = 0;

	while (offset + 2 <= buffer.length) {
		const firstByte = buffer[offset];
		const secondByte = buffer[offset + 1];
		const opcode = firstByte & 0x0f;
		const masked = (secondByte & 0x80) === 0x80;
		let length = secondByte & 0x7f;
		let headerLength = 2;

		if (length === 126) {
			if (offset + 4 > buffer.length) {
				break;
			}
			length = buffer.readUInt16BE(offset + 2);
			headerLength = 4;
		} else if (length === 127) {
			if (offset + 10 > buffer.length) {
				break;
			}
			const longLength = buffer.readBigUInt64BE(offset + 2);
			if (longLength > BigInt(Number.MAX_SAFE_INTEGER)) {
				return {
					messages,
					remaining: Buffer.alloc(0)
				};
			}
			length = Number(longLength);
			headerLength = 10;
		}

		const maskLength = masked ? 4 : 0;
		const frameLength = headerLength + maskLength + length;
		if (offset + frameLength > buffer.length) {
			break;
		}

		if (opcode === 0x8) {
			return {
				messages,
				remaining: Buffer.alloc(0)
			};
		}

		if (opcode === 0x1) {
			const payloadStart = offset + headerLength + maskLength;
			const payload = Buffer.from(buffer.subarray(payloadStart, payloadStart + length));
			if (masked) {
				const mask = buffer.subarray(offset + headerLength, offset + headerLength + 4);
				for (let index = 0; index < payload.length; index += 1) {
					payload[index] ^= mask[index % 4];
				}
			}
			messages.push(payload.toString("utf8"));
		}

		offset += frameLength;
	}

	return {
		messages,
		remaining: buffer.subarray(offset)
	};
}

function firstHeaderValue(value: string | string[] | undefined): string {
	return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function createRequestId(): string {
	return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
