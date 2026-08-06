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
					settleSelection(): Promise<void>;
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
				return new Promise((resolve) => setTimeout(resolve, 0));
			},
			async uploadImage() {
				return editorSelection;
			}
		});

		expect(uploadPosition).toBe("marker");
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
		setTimeout(() => {
			markerPresent = true;
		}, 0);

		const cleaned = await companion?.removeRestoredMarkerAfterUpload({
			hasMarker: () => markerPresent,
			removeMarker() {
				markerPresent = false;
				return true;
			},
			settle() {
				return new Promise((resolve) => setTimeout(resolve, 0));
			}
		});

		expect(cleaned).toBe(true);
		expect(markerPresent).toBe(false);
	});
});
