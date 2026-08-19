export const PREVIEW_REFRESH_DEBOUNCE_MS = 280;

export interface PreviewRenderKey {
	filePath: string | null;
	markdown: string;
	platform: string;
	inlineStyles: boolean;
	embedLocalImages: boolean;
}

export interface PreviewScrollElement {
	innerHTML: string;
	scrollTop: number;
}

export function shouldSkipPreviewRender(
	previous: PreviewRenderKey | null,
	next: PreviewRenderKey,
	options: { force?: boolean } = {}
): boolean {
	if (options.force || !previous) {
		return false;
	}

	return (
		previous.filePath === next.filePath
		&& previous.markdown === next.markdown
		&& previous.platform === next.platform
		&& previous.inlineStyles === next.inlineStyles
		&& previous.embedLocalImages === next.embedLocalImages
	);
}

export function shouldReplacePreviewFragment(currentFragment: string, nextFragment: string): boolean {
	return currentFragment !== nextFragment;
}

export function replacePreviewFragment(previewEl: PreviewScrollElement, fragment: string): void {
	const scrollTop = previewEl.scrollTop;
	previewEl.innerHTML = fragment;
	previewEl.scrollTop = scrollTop;
}
