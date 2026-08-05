export type CopyPlatform =
	| "wechat"
	| "feishu"
	| "zhishixingqiu"
	| "zhihu"
	| "csdn"
	| "juejin"
	| "substack"
	| "x"
	| "xiaohongshu"
	| "bilibili";

export type PlatformOutputFormat = "rich-html" | "markdown" | "plain-text";

export interface PlatformCapability {
	supportsRichHtml: boolean;
	supportsMarkdown: boolean;
	supportsImages: boolean;
	supportsCover: boolean;
	supportsTags: boolean;
	supportsDraftApi: boolean;
	requiresManualImageUpload: boolean;
	requiresRemoteImageUrl: boolean;
}

export interface PlatformProfile {
	id: CopyPlatform;
	label: string;
	copyLabel: string;
	editorUrl: string;
	preferredFormat: PlatformOutputFormat;
	capabilities: PlatformCapability;
	wrapperStyle: string;
	rules: PlatformStyleRule[];
	transform?: (root: HTMLElement) => void;
}

export interface PlatformStyleRule {
	selector: string;
	style?: string;
	remove?: boolean;
}
