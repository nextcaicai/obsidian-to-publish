import type { CopyPlatform } from "./types";
import { isCopyPlatform, PLATFORM_PROFILES } from "./profiles";

export function normalizeSelectedPlatforms(
	value: unknown,
	fallbackPlatform: CopyPlatform
): CopyPlatform[] {
	const rawList = Array.isArray(value) ? value : [];
	const selected: CopyPlatform[] = [];
	const seen = new Set<CopyPlatform>();

	for (const item of rawList) {
		if (typeof item !== "string" || !isCopyPlatform(item) || seen.has(item)) {
			continue;
		}
		seen.add(item);
		selected.push(item);
	}

	if (selected.length === 0) {
		return [fallbackPlatform];
	}

	return selected;
}

export function ensurePrimaryInSelectedPlatforms(
	selectedPlatforms: CopyPlatform[],
	primaryPlatform: CopyPlatform
): CopyPlatform[] {
	const normalized = normalizeSelectedPlatforms(selectedPlatforms, primaryPlatform);
	if (normalized.includes(primaryPlatform)) {
		return normalized;
	}
	return [primaryPlatform, ...normalized];
}

export function resolvePrimaryPlatform(
	selectedPlatforms: CopyPlatform[],
	preferredPrimary: CopyPlatform
): CopyPlatform {
	const normalized = normalizeSelectedPlatforms(selectedPlatforms, preferredPrimary);
	if (normalized.includes(preferredPrimary)) {
		return preferredPrimary;
	}
	return normalized[0];
}

export function formatSelectedPlatformsLabel(
	selectedPlatforms: CopyPlatform[],
	primaryPlatform: CopyPlatform
): string {
	const platforms = ensurePrimaryInSelectedPlatforms(selectedPlatforms, primaryPlatform);
	const primaryLabel = PLATFORM_PROFILES[primaryPlatform]?.label
		?? PLATFORM_PROFILES[platforms[0]].label;

	if (platforms.length === 1) {
		return primaryLabel;
	}

	return `${primaryLabel} +${platforms.length - 1}`;
}

export function togglePlatformSelection(
	selectedPlatforms: CopyPlatform[],
	platform: CopyPlatform,
	checked: boolean,
	primaryPlatform: CopyPlatform
): {
	selectedPlatforms: CopyPlatform[];
	primaryPlatform: CopyPlatform;
} {
	const current = ensurePrimaryInSelectedPlatforms(selectedPlatforms, primaryPlatform);

	if (checked) {
		const nextSelected = current.includes(platform)
			? current
			: [...current, platform];
		return {
			selectedPlatforms: nextSelected,
			// Newly checked platform becomes the preview/primary target.
			primaryPlatform: platform
		};
	}

	if (current.length <= 1) {
		return {
			selectedPlatforms: current,
			primaryPlatform: resolvePrimaryPlatform(current, primaryPlatform)
		};
	}

	const nextSelected = current.filter((item) => item !== platform);
	return {
		selectedPlatforms: nextSelected,
		primaryPlatform: resolvePrimaryPlatform(nextSelected, primaryPlatform)
	};
}
