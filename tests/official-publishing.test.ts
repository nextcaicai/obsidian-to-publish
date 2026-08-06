import { describe, expect, it } from "vitest";

import { buildMultipartBody } from "../src/publishing/multipart";
import {
	parseFeishuFolderToken,
	prepareFeishuMarkdown,
	syncPackageToFeishuDoc
} from "../src/publishing/feishu-docs";
import { createHttpError, redactSensitiveText } from "../src/publishing/official-http";
import type { OfficialRequest, OfficialRequestResponse } from "../src/publishing/official-http";
import type { PublishAsset, PublishPackageV1 } from "../src/publishing/types";
import {
	compactWechatBlockWhitespace,
	createWechatDraftFromPackage,
	detectWechatOutboundIp,
	normalizeWechatDraftHtml,
	removeWechatEmptyListItems,
	replaceHtmlImageSourcesWithWechatUrls,
	unwrapWechatListItemParagraphs,
	upsertWechatCoverMediaRecord,
	upsertWechatDraftRecord
} from "../src/publishing/wechat-official";

const imageAsset: PublishAsset = {
	id: "asset_1",
	kind: "image",
	originalSrc: "images/cover.png",
	fileName: "cover.png",
	mime: "image/png",
	bytes: 4,
	base64: Buffer.from("png!").toString("base64")
};

function createPackage(): PublishPackageV1 {
	return {
		version: 1,
		source: "obsidian-to-publish",
		requestId: "pub_test",
		createdAt: "2026-08-05T00:00:00.000Z",
		targets: ["wechat"],
		note: {
			path: "posts/demo.md",
			basename: "demo"
		},
		article: {
			title: "Demo title",
			markdown: "正文\n\n![Cover](asset://asset_1)",
			html: "<!doctype html><html><body><section><p>正文</p><img src=\"data:image/png;base64,abc\"></section></body></html>",
			text: "正文",
			excerpt: "摘要",
			cover: "asset://asset_1"
		},
		assets: [imageAsset],
		warnings: [],
		options: {
			openEditor: true,
			overwriteExistingDraft: "ask",
			uploadRemoteImages: "never"
		}
	};
}

function createWechatSettings() {
	return {
		enabled: true,
		appId: "wx-app",
		appSecret: "secret",
		author: "Author",
		digest: "",
		contentSourceUrl: "",
		openComment: false,
		onlyFansCanComment: false,
		draftRecords: [],
		coverMediaRecords: []
	};
}

describe("official publishing", () => {
	it("redacts API credentials from transport errors", () => {
		expect(redactSensitiveText("https://api.weixin.qq.com/cgi-bin/token?secret=abc&access_token=xyz Authorization: Bearer token"))
			.toBe("https://api.weixin.qq.com/cgi-bin/token?secret=***&access_token=*** Authorization: Bearer ***");
	});

	it("formats non-JSON HTTP responses without leaking a JSON parse error", () => {
		const response = {
			status: 404,
			text: "404 page not found"
		} as OfficialRequestResponse;
		Object.defineProperty(response, "json", {
			get() {
				throw new SyntaxError("Unexpected non-whitespace character after JSON at position 4");
			}
		});

		expect(createHttpError(
			"查询飞书导入任务",
			"https://open.feishu.cn/open-apis/drive/v1/import_tasks/ticket",
			response
		).message).toContain("HTTP 404：404 page not found");
	});

	it("builds multipart bodies with fields and one file", () => {
		const body = buildMultipartBody({
			boundary: "boundary",
			fields: {
				file_name: "demo.md",
				parent_type: "ccm_import_open"
			},
			file: {
				fieldName: "file",
				fileName: "demo.md",
				mimeType: "text/markdown",
				bytes: new TextEncoder().encode("# Demo")
			}
		});
		const text = Buffer.from(body).toString("utf8");

		expect(text).toContain('name="file_name"');
		expect(text).toContain("demo.md");
		expect(text).toContain('name="file"; filename="demo.md"');
		expect(text).toContain("Content-Type: text/markdown");
	});

	it("replaces rendered HTML image sources with WeChat CDN URLs", () => {
		const result = replaceHtmlImageSourcesWithWechatUrls(
			'<p>A</p><img alt="Cover" src="data:image/png;base64,abc" data-src="local.png">',
			[imageAsset],
			new Map([["asset_1", "https://mmbiz.qpic.cn/sz_mmbiz_png/demo/0"]])
		);

		expect(result.unresolvedSources).toEqual([]);
		expect(result.html).toContain('src="https://mmbiz.qpic.cn/sz_mmbiz_png/demo/0"');
		expect(result.html).not.toContain("data:image");
		expect(result.html).not.toContain("data-src");
	});

	it("compacts whitespace between list tags that WeChat turns into empty bullets", () => {
		const source = [
			"<ul>",
			"<li>无序列表第一项</li>",
			"",
			"<li>无序列表第二项</li>",
			"<li>无序列表第三项</li>",
			"</ul>",
			"<ol>",
			"<li>有序列表第一项</li>",
			"<li>有序列表第二项</li>",
			"<li>有序列表第三项</li>",
			"</ol>"
		].join("\n");

		const compacted = compactWechatBlockWhitespace(source);
		expect(compacted).toBe(
			"<ul><li>无序列表第一项</li><li>无序列表第二项</li><li>无序列表第三项</li></ul>"
			+ "<ol><li>有序列表第一项</li><li>有序列表第二项</li><li>有序列表第三项</li></ol>"
		);
		expect(compacted).not.toMatch(/<\/li>\s+<li/);
	});

	it("removes empty list items and unwraps sole paragraphs inside li", () => {
		expect(removeWechatEmptyListItems("<ul><li> </li><li>内容</li><li><br></li></ul>"))
			.toBe("<ul><li>内容</li></ul>");
		expect(unwrapWechatListItemParagraphs("<ul><li><p>段落项</p></li><li><p>第二项</p></li></ul>"))
			.toBe("<ul><li>段落项</li><li>第二项</li></ul>");
	});

	it("normalizes draft HTML so lists stay compact for WeChat editor", () => {
		const html = [
			"<!DOCTYPE html>",
			"<html><body>",
			"<section>",
			"<ul>",
			"<li><p>无序列表第一项</p></li>",
			"",
			"<li> </li>",
			"<li><p>无序列表第二项，包含 <code>inline code</code></p></li>",
			"</ul>",
			"<ol>",
			"<li><p>有序列表第一项</p></li>",
			"<li><p>有序列表第二项</p></li>",
			"<li><p>有序列表第三项</p></li>",
			"</ol>",
			"</section>",
			"</body></html>"
		].join("\n");

		const normalized = normalizeWechatDraftHtml(html);
		expect(normalized).toContain("<ul><li>无序列表第一项</li><li>无序列表第二项，包含 <code>inline code</code></li></ul>");
		expect(normalized).toContain("<ol><li>有序列表第一项</li><li>有序列表第二项</li><li>有序列表第三项</li></ol>");
		expect(normalized).not.toMatch(/<li[^>]*>\s*<\/li>/);
		expect(normalized).not.toMatch(/<li[^>]*>\s*<p\b/i);
		expect(normalized).not.toContain("<!DOCTYPE");
		expect(normalized).not.toContain("<body");
	});

	it("creates a WeChat draft from a publish package request sequence", async () => {
		const requests: Array<{ url: string; method: string; body?: string | ArrayBuffer }> = [];
		const request: OfficialRequest = async (options) => {
			requests.push({
				url: options.url,
				method: options.method || "GET",
				body: options.body
			});

			if (options.url.includes("/token?")) {
				return { status: 200, json: { access_token: "token", expires_in: 7200 } };
			}
			if (options.url.includes("/material/add_material")) {
				return { status: 200, json: { media_id: "cover_media_id" } };
			}
			if (options.url.includes("/media/uploadimg")) {
				return { status: 200, json: { url: "https://mmbiz.qpic.cn/sz_mmbiz_png/demo/0" } };
			}
			if (options.url.includes("/draft/add")) {
				return { status: 200, json: { media_id: "draft_media_id" } };
			}

			throw new Error(`Unexpected URL: ${options.url}`);
		};

		const result = await createWechatDraftFromPackage(createPackage(), createWechatSettings(), request);
		const draftRequest = requests.find((item) => item.url.includes("/draft/add"));
		const draftPayload = JSON.parse(String(draftRequest?.body || "{}"));

		expect(result.mediaId).toBe("draft_media_id");
		expect(result.uploadedImages).toBe(1);
		expect(draftPayload.articles[0].thumb_media_id).toBe("cover_media_id");
		expect(draftPayload.articles[0].content).toContain("https://mmbiz.qpic.cn/");
		expect(draftPayload.articles[0].content).not.toContain("data:image");
	});

	it("explains how to resolve a WeChat IP whitelist rejection", async () => {
		const request: OfficialRequest = async () => ({
			status: 200,
			json: {
				errcode: 40164,
				errmsg: "invalid ip 103.116.123.196 ipv6 ::ffff:103.116.123.196, not in whitelist"
			}
		});

		await expect(createWechatDraftFromPackage(createPackage(), createWechatSettings(), request)).rejects.toThrow(
			"103.116.123.196 未加入微信公众号 API IP 白名单"
		);
	});

	it("detects the exact outbound IP reported by WeChat", async () => {
		const result = await detectWechatOutboundIp(createWechatSettings(), async () => ({
			status: 200,
			json: {
				errcode: 40164,
				errmsg: "invalid ip 120.241.117.188 ipv6 ::ffff:120.241.117.188, not in whitelist"
			}
		}));

		expect(result).toEqual({
			ip: "120.241.117.188",
			source: "wechat"
		});
	});

	it("falls back to a public IPv4 detector when WeChat omits the rejected IP", async () => {
		const result = await detectWechatOutboundIp(createWechatSettings(), async (options) => {
			if (options.url.includes("/token?")) {
				return {
					status: 200,
					json: {
						errcode: 40164,
						errmsg: "request ip not in whitelist"
					}
				};
			}
			if (options.url.includes("api.ipify.org")) {
				return { status: 200, json: { ip: "203.0.113.9" } };
			}
			throw new Error(`Unexpected URL: ${options.url}`);
		});

		expect(result).toEqual({
			ip: "203.0.113.9",
			source: "ipify"
		});
	});

	it("reuses a valid cover and updates the draft associated with the note", async () => {
		const requests: Array<{ url: string; body?: string | ArrayBuffer }> = [];
		const settings = createWechatSettings();
		settings.coverMediaRecords = [{
			appId: "wx-app",
			assetHash: "sha256:706e6721",
			mediaId: "cached-cover",
			updatedAt: "2026-08-05T00:00:00.000Z"
		}];
		settings.draftRecords = [{
			appId: "wx-app",
			notePath: "posts/demo.md",
			mediaId: "existing-draft",
			title: "Demo title",
			updatedAt: "2026-08-05T00:00:00.000Z"
		}];
		const request: OfficialRequest = async (options) => {
			requests.push({ url: options.url, body: options.body });
			if (options.url.includes("/token?")) {
				return { status: 200, json: { access_token: "token", expires_in: 7200 } };
			}
			if (options.url.includes("/material/get_material")) {
				return { status: 200, arrayBuffer: Buffer.from("image").buffer };
			}
			if (options.url.includes("/media/uploadimg")) {
				return { status: 200, json: { url: "https://mmbiz.qpic.cn/local" } };
			}
			if (options.url.includes("/draft/update")) {
				return { status: 200, json: { errcode: 0, errmsg: "ok" } };
			}
			throw new Error(`Unexpected URL: ${options.url}`);
		};

		const result = await createWechatDraftFromPackage(createPackage(), settings, request, {
			fingerprintAsset: async () => "sha256:706e6721"
		});

		expect(result.action).toBe("updated");
		expect(result.mediaId).toBe("existing-draft");
		expect(result.coverMediaRecord.mediaId).toBe("cached-cover");
		expect(requests.some((item) => item.url.includes("/material/add_material"))).toBe(false);
		expect(requests.some((item) => item.url.includes("/draft/add"))).toBe(false);
	});

	it("reuploads an invalid cached cover and recreates a missing draft", async () => {
		const settings = createWechatSettings();
		settings.coverMediaRecords = [{
			appId: "wx-app",
			assetHash: "sha256:706e6721",
			mediaId: "deleted-cover",
			updatedAt: "2026-08-05T00:00:00.000Z"
		}];
		settings.draftRecords = [{
			appId: "wx-app",
			notePath: "posts/demo.md",
			mediaId: "deleted-draft",
			title: "Demo title",
			updatedAt: "2026-08-05T00:00:00.000Z"
		}];
		const request: OfficialRequest = async (options) => {
			if (options.url.includes("/token?")) {
				return { status: 200, json: { access_token: "token", expires_in: 7200 } };
			}
			if (options.url.includes("/material/get_material")) {
				return { status: 200, json: { errcode: 40007, errmsg: "invalid media_id" } };
			}
			if (options.url.includes("/material/add_material")) {
				return { status: 200, json: { media_id: "new-cover" } };
			}
			if (options.url.includes("/media/uploadimg")) {
				return { status: 200, json: { url: "https://mmbiz.qpic.cn/local" } };
			}
			if (options.url.includes("/draft/update")) {
				return { status: 200, json: { errcode: 40007, errmsg: "invalid media_id" } };
			}
			if (options.url.includes("/draft/add")) {
				return { status: 200, json: { media_id: "new-draft" } };
			}
			throw new Error(`Unexpected URL: ${options.url}`);
		};

		const result = await createWechatDraftFromPackage(createPackage(), settings, request, {
			fingerprintAsset: async () => "sha256:706e6721"
		});

		expect(result.action).toBe("created");
		expect(result.mediaId).toBe("new-draft");
		expect(result.coverMediaRecord.mediaId).toBe("new-cover");
	});

	it("downloads remote images and keeps them in their original HTML positions", async () => {
		const pkg = createPackage();
		pkg.article.html = '<html><body><section><p><img src="https://images.example.com/remote.png"></p><p><img src="data:image/png;base64,abc"></p></section></body></html>';
		const request: OfficialRequest = async (options) => {
			if (options.url.includes("/token?")) {
				return { status: 200, json: { access_token: "token", expires_in: 7200 } };
			}
			if (options.url.includes("/material/add_material")) {
				return { status: 200, json: { media_id: "cover" } };
			}
			if (options.url === "https://images.example.com/remote.png") {
				return {
					status: 200,
					headers: { "content-type": "image/png" },
					arrayBuffer: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]).buffer
				};
			}
			if (options.url.includes("/media/uploadimg")) {
				const uploads = uploadRequests++;
				return {
					status: 200,
					json: { url: uploads === 0 ? "https://mmbiz.qpic.cn/local" : "https://mmbiz.qpic.cn/remote" }
				};
			}
			if (options.url.includes("/draft/add")) {
				const body = JSON.parse(String(options.body));
				draftContent = body.articles[0].content;
				return { status: 200, json: { media_id: "draft" } };
			}
			throw new Error(`Unexpected URL: ${options.url}`);
		};
		let uploadRequests = 0;
		let draftContent = "";

		const result = await createWechatDraftFromPackage(pkg, createWechatSettings(), request);

		expect(result.uploadedImages).toBe(2);
		expect(draftContent.indexOf("https://mmbiz.qpic.cn/remote"))
			.toBeLessThan(draftContent.indexOf("https://mmbiz.qpic.cn/local"));
		expect(draftContent).not.toContain("images.example.com");
		expect(result.warnings).toEqual([]);
	});

	it("keeps only the latest cached record for the same account and source", () => {
		const draftRecords = upsertWechatDraftRecord([], {
			appId: "wx-app",
			notePath: "posts/demo.md",
			mediaId: "draft-1",
			title: "Demo",
			updatedAt: "2026-08-05T00:00:00.000Z"
		});
		const coverRecords = upsertWechatCoverMediaRecord([], {
			appId: "wx-app",
			assetHash: "sha256:abc",
			mediaId: "cover-1",
			updatedAt: "2026-08-05T00:00:00.000Z"
		});

		expect(upsertWechatDraftRecord(draftRecords, {
			...draftRecords[0],
			mediaId: "draft-2"
		})).toHaveLength(1);
		expect(upsertWechatCoverMediaRecord(coverRecords, {
			...coverRecords[0],
			mediaId: "cover-2"
		})).toHaveLength(1);
	});

	it("parses Feishu folder URLs and preserves raw tokens", () => {
		expect(parseFeishuFolderToken("https://example.feishu.cn/drive/folder/fldabc123")).toBe("fldabc123");
		expect(parseFeishuFolderToken("https://example.feishu.cn/docs/docxxx?folder_token=fldquery")).toBe("fldquery");
		expect(parseFeishuFolderToken("fldraw")).toBe("fldraw");
	});

	it("keeps Feishu image positions explicit until block image upload is added", () => {
		const result = prepareFeishuMarkdown(createPackage());

		expect(result.markdown).toContain("> 图片待补：Cover");
		expect(result.replacedAssetImages).toBe(1);
		expect(result.warnings[0]).toContain("尚未自动上传图片块");
	});

	it("imports Markdown into a Feishu cloud document", async () => {
		const requests: Array<{ url: string; method: string }> = [];
		const request: OfficialRequest = async (options) => {
			requests.push({
				url: options.url,
				method: options.method || "GET"
			});
			if (options.url.includes("/auth/v3/tenant_access_token/internal")) {
				return { status: 200, json: { code: 0, tenant_access_token: "tenant-token", expire: 7200 } };
			}
			if (options.url.includes("/drive/v1/medias/upload_all")) {
				return { status: 200, json: { code: 0, data: { file_token: "file-token" } } };
			}
			if (options.url.endsWith("/drive/v1/import_tasks")) {
				return { status: 200, json: { code: 0, data: { ticket: "ticket" } } };
			}
			if (options.url.includes("/drive/v1/import_tasks/ticket")) {
				return {
					status: 200,
					json: {
						code: 0,
						data: {
							result: {
								job_status: 0,
								token: "doc-token",
								url: "https://example.feishu.cn/docx/doc-token"
							}
						}
					}
				};
			}

			throw new Error(`Unexpected URL: ${options.url}`);
		};

		const result = await syncPackageToFeishuDoc(createPackage(), {
			enabled: true,
			appId: "cli-app",
			appSecret: "secret",
			folderToken: "fldtarget",
			ownerUserId: ""
		}, request, async () => undefined);

		expect(result.token).toBe("doc-token");
		expect(result.url).toBe("https://example.feishu.cn/docx/doc-token");
		expect(requests.some((item) => item.url.includes("/drive/v1/medias/upload_all"))).toBe(true);
		expect(requests.some((item) => item.url.endsWith("/drive/v1/import_tasks"))).toBe(true);
		expect(requests.find((item) => item.url.includes("/drive/v1/import_tasks/ticket"))?.method).toBe("GET");
	});

	it("explains how to resolve a Feishu folder permission rejection", async () => {
		const request: OfficialRequest = async (options) => {
			if (options.url.includes("/auth/v3/tenant_access_token/internal")) {
				return { status: 200, json: { code: 0, tenant_access_token: "tenant-token", expire: 7200 } };
			}
			if (options.url.includes("/drive/v1/medias/upload_all")) {
				return { status: 200, json: { code: 0, data: { file_token: "file-token" } } };
			}
			if (options.url.endsWith("/drive/v1/import_tasks")) {
				return { status: 200, json: { code: 0, data: { ticket: "ticket" } } };
			}
			return {
				status: 200,
				json: {
					code: 0,
					data: {
						result: {
							job_status: -116,
							job_error_msg: "mount point has no permission"
						}
					}
				}
			};
		};

		await expect(syncPackageToFeishuDoc(createPackage(), {
			enabled: true,
			appId: "cli-app",
			appSecret: "secret",
			folderToken: "fldtarget",
			ownerUserId: ""
		}, request, async () => undefined)).rejects.toThrow(
			"应用无权写入目标文件夹"
		);
	});
});
