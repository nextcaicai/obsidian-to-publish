import { createRequire } from "node:module";

import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const contentSharedPath = require.resolve("../../chrome-companion/src/content-shared.js");

describe("Chrome companion marker image positioning", () => {
	afterEach(() => {
		delete (globalThis as { OTPCompanion?: unknown }).OTPCompanion;
		delete require.cache[contentSharedPath];
	});

	it("waits for the editor selection to settle before starting file upload", async () => {
		delete require.cache[contentSharedPath];
		require(contentSharedPath);
		const companion = (globalThis as {
			OTPCompanion?: {
				runMarkerFileUploadSequence(options: {
					removeMarker(): boolean;
					settleSelection(): Promise<boolean>;
					uploadImage(): Promise<string>;
				}): Promise<string | false>;
			};
		}).OTPCompanion;
		let editorSelection = "end";

		const uploadPosition = await companion?.runMarkerFileUploadSequence({
			removeMarker() {
				setTimeout(() => {
					editorSelection = "marker";
				}, 0);
				return true;
			},
			settleSelection() {
				return new Promise((resolve) => setTimeout(() => resolve(true), 0));
			},
			async uploadImage() {
				return editorSelection;
			}
		});

		expect(uploadPosition).toBe("marker");
	});

	it("does not start a file upload until the marker selection is confirmed", async () => {
		delete require.cache[contentSharedPath];
		require(contentSharedPath);
		const companion = (globalThis as {
			OTPCompanion?: {
				runMarkerFileUploadSequence(options: {
					removeMarker(): boolean;
					settleSelection(): Promise<boolean>;
					uploadImage(): Promise<string>;
				}): Promise<string | false>;
			};
		}).OTPCompanion;
		let uploadStarted = false;

		const uploadPosition = await companion?.runMarkerFileUploadSequence({
			removeMarker: () => true,
			settleSelection: async () => false,
			uploadImage: async () => {
				uploadStarted = true;
				return "marker";
			}
		});

		expect(uploadPosition).toBe(false);
		expect(uploadStarted).toBe(false);
	});

	it("removes a marker restored asynchronously after image upload", async () => {
		delete require.cache[contentSharedPath];
		require(contentSharedPath);
		const companion = (globalThis as {
			OTPCompanion?: {
				removeRestoredMarkerAfterUpload(options: {
					hasMarker(): boolean;
					removeMarker(): boolean;
					settle(): Promise<void>;
				}): Promise<boolean>;
			};
		}).OTPCompanion;
		let markerPresent = false;
		let settled = false;

		const cleaned = await companion?.removeRestoredMarkerAfterUpload({
			hasMarker: () => markerPresent,
			removeMarker() {
				markerPresent = false;
				return true;
			},
			async settle() {
				if (!settled) {
					settled = true;
					markerPresent = true;
				}
			}
		});

		expect(cleaned).toBe(true);
		expect(markerPresent).toBe(false);
	});
});
