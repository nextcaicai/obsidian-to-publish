import type {
	CopyPlatform,
	PlatformCapability,
	PlatformProfile,
	PlatformStyleRule
} from "./types";

const RICH_HTML_CAPABILITIES: PlatformCapability = {
	supportsRichHtml: true,
	supportsMarkdown: false,
	supportsImages: true,
	supportsCover: false,
	supportsTags: false,
	supportsDraftApi: false,
	requiresManualImageUpload: false,
	requiresRemoteImageUrl: false
};

const MARKDOWN_CAPABILITIES: PlatformCapability = {
	supportsRichHtml: false,
	supportsMarkdown: true,
	supportsImages: true,
	supportsCover: true,
	supportsTags: true,
	supportsDraftApi: false,
	requiresManualImageUpload: true,
	requiresRemoteImageUrl: false
};

const PLAIN_TEXT_CAPABILITIES: PlatformCapability = {
	supportsRichHtml: false,
	supportsMarkdown: false,
	supportsImages: true,
	supportsCover: false,
	supportsTags: false,
	supportsDraftApi: false,
	requiresManualImageUpload: true,
	requiresRemoteImageUrl: false
};

const DEFAULT_WRAPPER_STYLE = [
	"box-sizing:border-box",
	"color:#2f3033",
	"font-family:-apple-system,BlinkMacSystemFont,\"Helvetica Neue\",Helvetica,\"PingFang SC\",\"Microsoft YaHei\",Arial,sans-serif",
	"font-size:16px",
	"letter-spacing:0",
	"line-height:1.75",
	"margin:0 auto",
	"max-width:760px",
	"overflow-wrap:break-word",
	"word-break:break-word"
].join(";");

const LONG_FORM_RULES: PlatformStyleRule[] = [
	{
		selector: "h1",
		style: "color:#1d2129;font-size:26px;font-weight:700;line-height:1.35;margin:1.4em 0 0.8em;"
	},
	{
		selector: "h2",
		style: "color:#1d2129;font-size:22px;font-weight:700;line-height:1.45;margin:1.6em 0 0.75em;"
	},
	{
		selector: "h3",
		style: "color:#1d2129;font-size:18px;font-weight:700;line-height:1.5;margin:1.3em 0 0.65em;"
	},
	{
		selector: "h4,h5,h6",
		style: "color:#1d2129;font-size:16px;font-weight:700;line-height:1.5;margin:1.1em 0 0.55em;"
	},
	{
		selector: "p",
		style: "color:#2f3033;font-size:16px;line-height:1.8;margin:1em 0;"
	},
	{
		selector: "strong",
		style: "color:#1d2129;font-weight:700;"
	},
	{
		selector: "a",
		style: "color:#1e6bb8;text-decoration:none;"
	},
	{
		selector: "ul,ol",
		style: "margin:1em 0;padding-left:1.5em;"
	},
	{
		selector: "li",
		style: "color:#2f3033;line-height:1.8;margin:0.35em 0;"
	},
	{
		selector: "blockquote",
		style: "background:#f7f8fa;border-left:4px solid #d7dce5;color:#515866;margin:1.2em 0;padding:10px 14px;"
	},
	{
		selector: "blockquote p",
		style: "color:#515866;margin:0.5em 0;"
	},
	{
		selector: "code",
		style: "background:#f5f6f8;border-radius:4px;color:#d6336c;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,\"Liberation Mono\",monospace;font-size:0.9em;padding:2px 4px;"
	},
	{
		selector: "pre",
		style: "background:#f5f6f8;border-radius:6px;box-sizing:border-box;color:#24292f;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,\"Liberation Mono\",monospace;font-size:14px;line-height:1.65;margin:1.2em 0;overflow-x:auto;padding:12px 14px;white-space:pre-wrap;word-break:break-word;"
	},
	{
		selector: "pre code",
		style: "background:transparent;color:#24292f;font-size:14px;line-height:1.65;padding:0;"
	},
	{
		selector: "table",
		style: "border-collapse:collapse;border-spacing:0;margin:1.2em 0;width:100%;"
	},
	{
		selector: "th,td",
		style: "border:1px solid #d8dee4;color:#2f3033;font-size:15px;line-height:1.6;padding:8px 10px;text-align:left;vertical-align:top;"
	},
	{
		selector: "th",
		style: "background:#f5f6f8;color:#1d2129;font-weight:700;"
	},
	{
		selector: "img",
		style: "border-radius:4px;display:block;height:auto;margin:16px auto;max-width:100%;"
	},
	{
		selector: "hr",
		style: "border:0;border-top:1px solid #e5e6eb;margin:2em 0;"
	},
	{
		selector: ".callout",
		style: "background:#f7fbff;border-left:4px solid #1e80ff;border-radius:6px;box-sizing:border-box;color:#2f3033;margin:1.2em 0;padding:12px 16px;"
	},
	{
		selector: ".callout-title",
		style: "color:#1d2129;font-size:16px;font-weight:700;line-height:1.6;margin:0 0 6px;"
	},
	{
		selector: ".callout-content",
		style: "color:#2f3033;font-size:16px;line-height:1.8;"
	},
	{
		selector: ".callout-icon,.heading-collapse-indicator,.collapse-indicator",
		remove: true
	}
];

const PLAIN_TEXT_PREVIEW_RULES: PlatformStyleRule[] = [
	...LONG_FORM_RULES,
	{
		selector: "table",
		style: "border-collapse:collapse;border-spacing:0;margin:1em 0;width:100%;"
	},
	{
		selector: "img",
		style: "border-radius:4px;display:block;height:auto;margin:12px auto;max-width:100%;"
	}
];

export const PLATFORM_PROFILES: Record<CopyPlatform, PlatformProfile> = {
	wechat: {
		id: "wechat",
		label: "微信公众号",
		copyLabel: "微信公众号",
		editorUrl: "https://mp.weixin.qq.com/",
		preferredFormat: "rich-html",
		capabilities: {
			...RICH_HTML_CAPABILITIES,
			supportsCover: true
		},
		wrapperStyle: [
			"box-sizing:border-box",
			"color:#3f3f3f",
			"font-family:-apple-system,BlinkMacSystemFont,\"Helvetica Neue\",Helvetica,\"PingFang SC\",\"Microsoft YaHei\",Arial,sans-serif",
			"font-size:16px",
			"letter-spacing:0",
			"line-height:1.75",
			"margin:0 auto",
			"max-width:677px",
			"overflow-wrap:break-word",
			"word-break:break-word"
		].join(";"),
		rules: [
			{
				selector: "h1",
				style: "border-bottom:1px solid #e5e6eb;color:#1d2129;font-size:24px;font-weight:700;line-height:1.35;margin:1.4em 0 0.8em;padding:0 0 0.35em;"
			},
			{
				selector: "h2",
				style: "border-left:0;color:#1d2129;font-size:20px;font-weight:700;line-height:1.45;margin:1.8em 0 0.8em;padding:0;"
			},
			{
				selector: "h3",
				style: "color:#1d2129;font-size:18px;font-weight:700;line-height:1.5;margin:1.5em 0 0.7em;"
			},
			{
				selector: "h4,h5,h6",
				style: "color:#1d2129;font-size:16px;font-weight:700;line-height:1.5;margin:1.2em 0 0.6em;"
			},
			{
				selector: "p",
				style: "color:#3f3f3f;font-size:16px;line-height:1.8;margin:1em 0;"
			},
			{
				selector: "strong",
				style: "color:#1d2129;font-weight:700;"
			},
			{
				selector: "em",
				style: "color:#4e5969;font-style:italic;"
			},
			{
				selector: "a",
				style: "color:#576b95;text-decoration:none;"
			},
			{
				selector: "ul,ol",
				style: "margin:1em 0;padding-left:1.4em;"
			},
			{
				selector: "li",
				style: "color:#3f3f3f;line-height:1.8;margin:0.35em 0;"
			},
			{
				selector: "blockquote",
				style: "background:transparent;border-left:3px solid #dedede;box-sizing:border-box;color:#8a8a8a;font-size:16px;line-height:1.7;margin:1.2em 0;padding:3px 0 3px 12px;"
			},
			{
				selector: "blockquote p",
				style: "color:#8a8a8a;font-size:16px;line-height:1.7;margin:0;"
			},
			{
				selector: "code",
				style: "background:#f6f8fa;border-radius:4px;color:#d6336c;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,\"Liberation Mono\",monospace;font-size:0.9em;padding:2px 4px;"
			},
			{
				selector: "pre",
				style: "background:#f6f8fa;border-radius:6px;box-sizing:border-box;color:#24292f;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,\"Liberation Mono\",monospace;font-size:14px;line-height:1.65;margin:1.2em 0;overflow-x:auto;padding:12px 14px;white-space:pre-wrap;word-break:break-word;"
			},
			{
				selector: "pre code",
				style: "background:transparent;color:#24292f;font-size:14px;line-height:1.65;padding:0;"
			},
			{
				selector: "table",
				style: "border-collapse:collapse;border-spacing:0;margin:1.2em 0;width:100%;"
			},
			{
				selector: "th,td",
				style: "border:1px solid #d8dee4;color:#3f3f3f;font-size:15px;line-height:1.6;padding:8px 10px;text-align:left;vertical-align:top;"
			},
			{
				selector: "th",
				style: "background:#f6f8fa;color:#1d2129;font-weight:700;"
			},
			{
				selector: "img",
				style: "border-radius:4px;display:block;height:auto;margin:16px auto;max-width:100%;"
			},
			{
				selector: "hr",
				style: "border:0;border-top:1px solid #e5e6eb;margin:2em 0;"
			},
			{
				selector: ".callout",
				style: "background:#f7fbff;border-left:4px solid #1e80ff;border-radius:6px;box-sizing:border-box;color:#3f3f3f;margin:1.2em 0;padding:12px 16px;"
			},
			{
				selector: ".callout-title",
				style: "color:#1d2129;font-size:16px;font-weight:700;line-height:1.6;margin:0 0 6px;"
			},
			{
				selector: ".callout-content",
				style: "color:#3f3f3f;font-size:16px;line-height:1.8;"
			},
			{
				selector: ".callout-icon,.heading-collapse-indicator,.collapse-indicator",
				remove: true
			}
		],
		transform: transformWechatArticle
	},
	feishu: {
		id: "feishu",
		label: "飞书云文档",
		copyLabel: "飞书云文档",
		editorUrl: "https://www.feishu.cn/drive/home/",
		preferredFormat: "markdown",
		capabilities: {
			...MARKDOWN_CAPABILITIES,
			supportsDraftApi: true
		},
		wrapperStyle: DEFAULT_WRAPPER_STYLE,
		rules: LONG_FORM_RULES,
		transform: transformInternalLinksToPlainText
	},
	zhishixingqiu: {
		id: "zhishixingqiu",
		label: "知识星球",
		copyLabel: "知识星球",
		editorUrl: "https://wx.zsxq.com/",
		preferredFormat: "rich-html",
		capabilities: RICH_HTML_CAPABILITIES,
		wrapperStyle: [
			"box-sizing:border-box",
			"color:#2f3033",
			"font-family:-apple-system,BlinkMacSystemFont,\"Helvetica Neue\",Helvetica,\"PingFang SC\",\"Microsoft YaHei\",Arial,sans-serif",
			"font-size:16px",
			"letter-spacing:0",
			"line-height:1.75",
			"margin:0",
			"max-width:100%",
			"overflow-wrap:break-word",
			"word-break:break-word"
		].join(";"),
		rules: [
			{
				selector: "h1",
				style: "color:#1d2129;font-size:24px;font-weight:700;line-height:1.4;margin:1.2em 0 0.8em;"
			},
			{
				selector: "h2",
				style: "color:#1d2129;font-size:21px;font-weight:700;line-height:1.45;margin:1.4em 0 0.75em;"
			},
			{
				selector: "h3",
				style: "color:#1d2129;font-size:18px;font-weight:700;line-height:1.5;margin:1.2em 0 0.65em;"
			},
			{
				selector: "h4,h5,h6",
				style: "color:#1d2129;font-size:16px;font-weight:700;line-height:1.5;margin:1em 0 0.55em;"
			},
			{
				selector: "p",
				style: "color:#2f3033;font-size:16px;line-height:1.8;margin:0;"
			},
			{
				selector: "strong",
				style: "color:#1d2129;font-size:16px;font-weight:700;"
			},
			{
				selector: "em",
				style: "color:#515866;font-style:italic;"
			},
			{
				selector: "a",
				style: "color:#246bfe;font-size:16px;text-decoration:none;"
			},
			{
				selector: "ul,ol",
				style: "font-size:16px;margin:0;padding-left:1.4em;"
			},
			{
				selector: "li",
				style: "color:#2f3033;font-size:16px;line-height:1.8;margin:0.2em 0;"
			},
			{
				selector: "blockquote",
				style: "background:#f7f8fa;border-left:4px solid #d7dce5;color:#515866;margin:0;padding:12px 16px;"
			},
			{
				selector: "blockquote p",
				style: "color:#515866;margin:0;"
			},
			{
				selector: "code",
				style: "background:#f5f6f8;border-radius:4px;color:#d6336c;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,\"Liberation Mono\",monospace;font-size:0.9em;padding:2px 4px;"
			},
			{
				selector: "pre",
				style: "background:#f5f6f8;border-radius:6px;box-sizing:border-box;color:#24292f;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,\"Liberation Mono\",monospace;font-size:14px;line-height:1.65;margin:0;overflow-x:auto;padding:12px 14px;white-space:pre-wrap;word-break:break-word;"
			},
			{
				selector: "pre code",
				style: "background:transparent;color:#24292f;font-size:14px;line-height:1.65;padding:0;"
			},
			{
				selector: "table",
				style: "border-collapse:collapse;border-spacing:0;margin:0;width:100%;"
			},
			{
				selector: "th,td",
				style: "border:1px solid #d8dee4;color:#2f3033;font-size:16px;line-height:1.6;padding:8px 10px;text-align:left;vertical-align:top;"
			},
			{
				selector: "th",
				style: "background:#f5f6f8;color:#1d2129;font-weight:700;"
			},
			{
				selector: "img",
				style: "border-radius:4px;display:block;height:auto;margin:0 auto;max-width:100%;"
			},
			{
				selector: "hr",
				style: "border:0;border-top:1px solid #e5e6eb;margin:0;"
			},
			{
				selector: ".callout",
				style: "background:#f7fbff;border-left:4px solid #246bfe;border-radius:6px;box-sizing:border-box;color:#2f3033;margin:0;padding:12px 16px;"
			},
			{
				selector: ".callout-title",
				style: "color:#1d2129;font-size:16px;font-weight:700;line-height:1.6;margin:0 0 6px;"
			},
			{
				selector: ".callout-content",
				style: "color:#2f3033;font-size:16px;line-height:1.8;"
			},
			{
				selector: ".callout-icon,.heading-collapse-indicator,.collapse-indicator",
				remove: true
			}
		],
		transform: transformZhishixingqiuArticle
	},
	zhihu: {
		id: "zhihu",
		label: "知乎",
		copyLabel: "知乎",
		editorUrl: "https://zhuanlan.zhihu.com/write",
		preferredFormat: "rich-html",
		capabilities: {
			...RICH_HTML_CAPABILITIES,
			supportsCover: true,
			supportsTags: true,
			requiresManualImageUpload: true,
			requiresRemoteImageUrl: true
		},
		wrapperStyle: DEFAULT_WRAPPER_STYLE,
		rules: LONG_FORM_RULES,
		transform: transformInternalLinksToPlainText
	},
	csdn: {
		id: "csdn",
		label: "CSDN",
		copyLabel: "CSDN",
		editorUrl: "https://editor.csdn.net/md/",
		preferredFormat: "markdown",
		// Temporarily hidden: CSDN draft import is still unstable.
		visibleInUi: false,
		capabilities: MARKDOWN_CAPABILITIES,
		wrapperStyle: DEFAULT_WRAPPER_STYLE,
		rules: LONG_FORM_RULES,
		transform: transformInternalLinksToPlainText
	},
	juejin: {
		id: "juejin",
		label: "掘金",
		copyLabel: "掘金",
		editorUrl: "https://juejin.cn/editor/drafts/new?v=2",
		preferredFormat: "markdown",
		capabilities: {
			...MARKDOWN_CAPABILITIES,
			supportsRichHtml: true,
			requiresRemoteImageUrl: true
		},
		wrapperStyle: DEFAULT_WRAPPER_STYLE,
		rules: LONG_FORM_RULES,
		transform: transformInternalLinksToPlainText
	},
	substack: {
		id: "substack",
		label: "Substack",
		copyLabel: "Substack",
		editorUrl: "https://substack.com/publish/post/",
		preferredFormat: "rich-html",
		capabilities: {
			...RICH_HTML_CAPABILITIES,
			supportsCover: true,
			requiresManualImageUpload: true
		},
		wrapperStyle: DEFAULT_WRAPPER_STYLE,
		rules: LONG_FORM_RULES,
		transform: transformInternalLinksToPlainText
	},
	x: {
		id: "x",
		label: "X Articles",
		copyLabel: "X Articles",
		editorUrl: "https://x.com/compose/articles",
		preferredFormat: "markdown",
		capabilities: MARKDOWN_CAPABILITIES,
		wrapperStyle: DEFAULT_WRAPPER_STYLE,
		rules: LONG_FORM_RULES,
		transform: transformInternalLinksToPlainText
	},
	xiaohongshu: {
		id: "xiaohongshu",
		label: "小红书图文",
		copyLabel: "小红书",
		editorUrl: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article",
		preferredFormat: "plain-text",
		capabilities: PLAIN_TEXT_CAPABILITIES,
		wrapperStyle: DEFAULT_WRAPPER_STYLE,
		rules: PLAIN_TEXT_PREVIEW_RULES,
		transform: transformInternalLinksToPlainText
	},
	bilibili: {
		id: "bilibili",
		label: "Bilibili 图文",
		copyLabel: "Bilibili",
		editorUrl: "https://member.bilibili.com/platform/upload/text",
		preferredFormat: "rich-html",
		capabilities: {
			...RICH_HTML_CAPABILITIES,
			requiresManualImageUpload: true
		},
		wrapperStyle: DEFAULT_WRAPPER_STYLE,
		rules: LONG_FORM_RULES,
		transform: transformInternalLinksToPlainText
	}
};

export const PLATFORM_PROFILE_LIST: PlatformProfile[] = Object.values(PLATFORM_PROFILES);

/** Platforms shown in picker/settings UI. Hidden platforms remain available to adapters. */
export const PLATFORM_PICKER_LIST: PlatformProfile[] = PLATFORM_PROFILE_LIST.filter(
	(profile) => profile.visibleInUi !== false
);

export function isCopyPlatform(value: string): value is CopyPlatform {
	return Object.prototype.hasOwnProperty.call(PLATFORM_PROFILES, value);
}

export function isPlatformVisibleInUi(platform: CopyPlatform): boolean {
	return PLATFORM_PROFILES[platform]?.visibleInUi !== false;
}

export function applyPlatformProfile(root: HTMLElement, platform: CopyPlatform) {
	const profile = PLATFORM_PROFILES[platform];

	for (const rule of profile.rules) {
		for (const element of Array.from(root.querySelectorAll(rule.selector))) {
			if (!(element instanceof HTMLElement)) {
				continue;
			}

			if (rule.remove) {
				element.remove();
			} else if (rule.style) {
				appendInlineStyle(element, rule.style);
			}
		}
	}

	profile.transform?.(root);
}

export function wrapPlatformFragment(fragment: string, platform: CopyPlatform): string {
	const profile = PLATFORM_PROFILES[platform];
	const wrapper = document.createElement("section");
	wrapper.setAttribute("style", profile.wrapperStyle);
	wrapper.innerHTML = fragment;
	return wrapper.outerHTML;
}

function transformWechatArticle(root: HTMLElement) {
	for (const link of Array.from(root.querySelectorAll<HTMLAnchorElement>("a.internal-link"))) {
		link.removeAttribute("href");
		link.setAttribute("title", "Internal Obsidian link");
		appendInlineStyle(link, "color:#3f3f3f;text-decoration:none;");
	}

	normalizeWechatListDom(root);

	for (const paragraph of Array.from(root.querySelectorAll<HTMLElement>("p:empty"))) {
		paragraph.remove();
	}
}

/**
 * Clean list DOM for WeChat.
 * Whitespace text nodes between <li> and sole <p> wrappers become empty bullets
 * after WeChat re-parses the HTML.
 */
function normalizeWechatListDom(root: HTMLElement) {
	for (const list of Array.from(root.querySelectorAll("ul,ol"))) {
		for (const node of Array.from(list.childNodes)) {
			if (node.nodeType === Node.TEXT_NODE && !(node.textContent ?? "").trim()) {
				node.remove();
			}
		}
	}

	for (const listItem of Array.from(root.querySelectorAll("li"))) {
		const meaningfulChildren = Array.from(listItem.childNodes).filter((node) => {
			if (node.nodeType === Node.TEXT_NODE) {
				return Boolean((node.textContent ?? "").trim());
			}
			return true;
		});

		if (
			meaningfulChildren.length === 1
			&& meaningfulChildren[0] instanceof HTMLElement
			&& meaningfulChildren[0].tagName === "P"
		) {
			const paragraph = meaningfulChildren[0];
			while (paragraph.firstChild) {
				listItem.insertBefore(paragraph.firstChild, paragraph);
			}
			paragraph.remove();
		}

		const hasMedia = Boolean(listItem.querySelector("img,table,pre,ul,ol,blockquote"));
		if (!hasMedia && !(listItem.textContent ?? "").trim()) {
			listItem.remove();
		}
	}
}

function transformZhishixingqiuArticle(root: HTMLElement) {
	for (const link of Array.from(root.querySelectorAll<HTMLAnchorElement>("a.internal-link"))) {
		link.removeAttribute("href");
		link.setAttribute("title", "Internal Obsidian link");
		appendInlineStyle(link, "color:#2f3033;text-decoration:none;");
	}

	replaceZhishixingqiuTables(root);

	for (const paragraph of Array.from(root.querySelectorAll<HTMLElement>("p:empty"))) {
		turnIntoZhishixingqiuSpacer(paragraph);
	}

	insertZhishixingqiuSpacers(root);
}

export interface ZhishixingqiuTableLine {
	label?: string;
	value: string;
}

export function buildZhishixingqiuTableRows(
	headers: string[],
	rows: string[][]
): ZhishixingqiuTableLine[][] {
	const normalizedHeaders = headers.map(normalizeTableCellText);
	const normalizedRows = rows
		.map((row) => row.map(normalizeTableCellText))
		.filter((row) => row.some((cell) => cell.length > 0));

	if (normalizedHeaders.length === 0) {
		return normalizedRows.map((row) => [
			{
				value: row.filter((cell) => cell.length > 0).join(" ｜ ")
			}
		]);
	}

	return normalizedRows.map((row) =>
		Array.from({ length: Math.max(normalizedHeaders.length, row.length) }, (_, index) => ({
			label: normalizedHeaders[index] || `第 ${index + 1} 列`,
			value: row[index] ?? ""
		}))
	);
}

function replaceZhishixingqiuTables(root: HTMLElement) {
	for (const table of Array.from(root.querySelectorAll<HTMLTableElement>("table"))) {
		const headerCells = getZhishixingqiuTableHeaderCells(table);
		const bodyRows = getZhishixingqiuTableBodyRows(table, headerCells.sourceRow);
		const renderedRows = buildZhishixingqiuTableRows(
			headerCells.labels,
			bodyRows.map((row) => Array.from(row.cells).map((cell) => cell.textContent ?? ""))
		);

		if (renderedRows.length === 0) {
			table.remove();
			continue;
		}

		const replacement = document.createElement("div");
		replacement.classList.add("zhishixingqiu-table");
		replacement.setAttribute("style", [
			"border:1px solid #d8dee4",
			"border-radius:6px",
			"box-sizing:border-box",
			"font-size:16px",
			"line-height:1.7",
			"margin:0",
			"overflow:hidden"
		].join(";"));

		for (let rowIndex = 0; rowIndex < renderedRows.length; rowIndex += 1) {
			const sourceRow = bodyRows[rowIndex];
			const row = renderedRows[rowIndex];
			const rowElement = document.createElement("div");
			rowElement.classList.add("zhishixingqiu-table-row");
			rowElement.setAttribute("style", [
				rowIndex === 0 ? "" : "border-top:1px solid #e5e6eb",
				"box-sizing:border-box",
				"padding:8px 10px"
			].filter(Boolean).join(";"));

			for (let cellIndex = 0; cellIndex < row.length; cellIndex += 1) {
				const line = row[cellIndex];
				const sourceCell = sourceRow?.cells.item(cellIndex) ?? null;
				rowElement.append(createZhishixingqiuTableLine(line, sourceCell));
			}

			replacement.append(rowElement);
		}

		table.replaceWith(replacement);
	}
}

function getZhishixingqiuTableHeaderCells(table: HTMLTableElement): {
	labels: string[];
	sourceRow: HTMLTableRowElement | null;
} {
	const headRow = table.tHead?.rows.item(0) ?? null;
	if (headRow) {
		return {
			labels: Array.from(headRow.cells).map((cell) => cell.textContent ?? ""),
			sourceRow: headRow
		};
	}

	const firstRow = table.rows.item(0);
	if (!firstRow || !Array.from(firstRow.cells).some((cell) => cell.tagName.toLowerCase() === "th")) {
		return {
			labels: [],
			sourceRow: null
		};
	}

	return {
		labels: Array.from(firstRow.cells).map((cell) => cell.textContent ?? ""),
		sourceRow: firstRow
	};
}

function getZhishixingqiuTableBodyRows(
	table: HTMLTableElement,
	headerRow: HTMLTableRowElement | null
): HTMLTableRowElement[] {
	const bodyRows = Array.from(table.tBodies).flatMap((body) => Array.from(body.rows));
	if (bodyRows.length > 0) {
		return bodyRows;
	}

	return Array.from(table.rows).filter((row) => row !== headerRow);
}

function createZhishixingqiuTableLine(
	line: ZhishixingqiuTableLine,
	sourceCell: HTMLTableCellElement | null
): HTMLParagraphElement {
	const paragraph = document.createElement("p");
	paragraph.setAttribute("style", [
		"color:#2f3033",
		"font-size:16px",
		"line-height:1.7",
		"margin:0.2em 0"
	].join(";"));

	if (line.label) {
		const label = document.createElement("strong");
		label.textContent = line.label;
		label.setAttribute("style", "color:#1d2129;font-size:16px;font-weight:700;");
		paragraph.append(label, "：");
	}

	if (sourceCell && sourceCell.childNodes.length > 0) {
		for (const child of Array.from(sourceCell.childNodes)) {
			paragraph.append(child.cloneNode(true));
		}
	} else {
		paragraph.append(line.value);
	}

	return paragraph;
}

function normalizeTableCellText(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function transformInternalLinksToPlainText(root: HTMLElement) {
	for (const link of Array.from(root.querySelectorAll<HTMLAnchorElement>("a.internal-link"))) {
		link.removeAttribute("href");
		link.setAttribute("title", "Internal Obsidian link");
		appendInlineStyle(link, "color:inherit;text-decoration:none;");
	}

	for (const paragraph of Array.from(root.querySelectorAll<HTMLElement>("p:empty"))) {
		paragraph.remove();
	}
}

function insertZhishixingqiuSpacers(root: HTMLElement) {
	const children = Array.from(root.children);

	for (let index = 0; index < children.length - 1; index += 1) {
		const current = children[index];
		const next = children[index + 1];

		if (!isZhishixingqiuBlock(current) || !isZhishixingqiuBlock(next)) {
			continue;
		}

		const spacer = document.createElement("p");
		turnIntoZhishixingqiuSpacer(spacer);
		current.after(spacer);
	}
}

function turnIntoZhishixingqiuSpacer(element: HTMLElement) {
	element.innerHTML = "&nbsp;";
	element.classList.add("zhishixingqiu-spacer");
	element.setAttribute("style", [
		"color:transparent",
		"font-size:16px",
		"line-height:1.2",
		"margin:0",
		"min-height:1.2em"
	].join(";"));
}

function isZhishixingqiuBlock(element: Element): boolean {
	if (element.classList.contains("zhishixingqiu-spacer")) {
		return false;
	}

	const tagName = element.tagName.toLowerCase();
	return [
		"blockquote",
		"h1",
		"h2",
		"h3",
		"h4",
		"h5",
		"h6",
		"hr",
		"img",
		"ol",
		"p",
		"pre",
		"table",
		"ul"
	].includes(tagName) || element.classList.contains("callout");
}

function appendInlineStyle(element: HTMLElement, declaration: string) {
	const existing = element.getAttribute("style")?.trim();
	const normalizedDeclaration = declaration.trim().replace(/;+$/, "");
	element.setAttribute(
		"style",
		existing ? `${existing};${normalizedDeclaration}` : normalizedDeclaration
	);
}
