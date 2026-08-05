export interface MultipartFilePart {
	fieldName?: string;
	fileName: string;
	mimeType?: string;
	bytes: ArrayBuffer | Uint8Array;
}

export interface MultipartBodyOptions {
	boundary: string;
	fields?: Record<string, string>;
	file: MultipartFilePart;
}

export function buildMultipartBody(options: MultipartBodyOptions): ArrayBuffer {
	const { boundary, fields = {}, file } = options;
	const encoder = new TextEncoder();
	const parts: Uint8Array[] = [];

	for (const [name, value] of Object.entries(fields)) {
		parts.push(encoder.encode(`--${boundary}\r\n`));
		parts.push(encoder.encode(`Content-Disposition: form-data; name="${escapeMultipartName(name)}"\r\n\r\n`));
		parts.push(encoder.encode(`${value}\r\n`));
	}

	const fileBytes = toUint8Array(file.bytes);
	parts.push(encoder.encode(`--${boundary}\r\n`));
	parts.push(encoder.encode(`Content-Disposition: form-data; name="${escapeMultipartName(file.fieldName || "file")}"; filename="${escapeMultipartFilename(file.fileName)}"\r\n`));
	parts.push(encoder.encode(`Content-Type: ${file.mimeType || "application/octet-stream"}\r\n\r\n`));
	parts.push(fileBytes);
	parts.push(encoder.encode("\r\n"));
	parts.push(encoder.encode(`--${boundary}--\r\n`));

	return mergeParts(parts);
}

export function toUint8Array(binary: ArrayBuffer | Uint8Array): Uint8Array {
	if (binary instanceof Uint8Array) {
		return binary;
	}

	return new Uint8Array(binary);
}

function mergeParts(parts: Uint8Array[]): ArrayBuffer {
	const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
	const body = new Uint8Array(totalLength);
	let offset = 0;

	for (const part of parts) {
		body.set(part, offset);
		offset += part.length;
	}

	return body.buffer;
}

function escapeMultipartName(value: string): string {
	return value.replace(/["\r\n]/g, "_");
}

function escapeMultipartFilename(value: string): string {
	return value.replace(/["\r\n\\/]/g, "_");
}
