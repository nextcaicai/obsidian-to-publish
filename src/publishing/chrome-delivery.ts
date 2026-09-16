import type { CopyPlatform } from "../platforms/types";

export type ChromeCompanionFallbackAction = "copy-and-open" | "copy-only";

/**
 * A public Substack URL cannot identify a publisher and is often redirected to
 * the discovery page. Preserve the copied draft instead of treating it as a
 * usable editor fallback.
 */
export function getChromeCompanionFallbackAction(platform: CopyPlatform): ChromeCompanionFallbackAction {
	return platform === "substack" ? "copy-only" : "copy-and-open";
}

export async function sendToChromeCompanionAndActivate(
	send: () => Promise<boolean>,
	activateBrowser: () => Promise<boolean>
): Promise<boolean> {
	const sent = await send();
	if (!sent) {
		return false;
	}

	await activateBrowser();
	return true;
}
