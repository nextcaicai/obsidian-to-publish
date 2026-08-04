(function () {
	const REQUEST_SOURCE = "OTP_COMPANION_JUEJIN_UPLOAD_REQUEST_V3";
	const RESPONSE_SOURCE = "OTP_COMPANION_JUEJIN_UPLOAD_RESPONSE_V3";
	let webpackRequire = null;

	function getWebpackRequire() {
		if (webpackRequire) {
			return webpackRequire;
		}

		const jsonp = window.webpackJsonp;
		if (!jsonp || typeof jsonp.push !== "function") {
			throw new Error("Juejin webpack runtime is not available.");
		}

		const moduleId = `otp-companion-${Date.now()}-${Math.random().toString(16).slice(2)}`;
		jsonp.push([[moduleId], {
			[moduleId]: function (module, exports, require) {
				webpackRequire = require;
			}
		}, [[moduleId]]]);

		if (!webpackRequire) {
			throw new Error("Unable to capture Juejin webpack require.");
		}
		return webpackRequire;
	}

	function base64ToFile(asset) {
		const binary = atob(asset.base64);
		const bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index += 1) {
			bytes[index] = binary.charCodeAt(index);
		}
		return new File([bytes], asset.name || "image.png", {
			type: asset.type || "image/png"
		});
	}

	async function uploadAssets(assets, options = {}) {
		const require = getWebpackRequire();
		const Uploader = getUploaderConstructor(require);
		const files = assets.map(base64ToFile);
		const token = await getUploadToken();
		return mapWithConcurrency(files, normalizePositiveInteger(options.concurrency, 2), async (file) => {
			try {
				const result = await retry(() => uploadFile(file, token, Uploader), normalizePositiveInteger(options.retries, 2));
				const imageUrl = await retry(() => getImageUrl(result.Uri), normalizePositiveInteger(options.retries, 2));
				return {
					url: imageUrl.url,
					width: result?.ImageWidth || 0,
					height: result?.ImageHeight || 0
				};
			} catch (error) {
				return {
					url: "",
					error: error?.message || "Juejin image upload failed."
				};
			}
		});
	}

	function getUploaderConstructor(require) {
		const module = require("4791");
		const Uploader = module?.default || module;
		if (typeof Uploader !== "function") {
			throw new Error("Juejin low-level image uploader is not available.");
		}
		return Uploader;
	}

	async function getUploadToken() {
		const response = await fetch(withBaseQuery("/imagex/v2/gen_token", {
			client: "web"
		}), {
			credentials: "include"
		});
		const data = await response.json();
		const token = data?.data?.token;
		if (!token) {
			throw new Error(data?.err_msg || "Unable to get Juejin image upload token.");
		}
		return token;
	}

	function uploadFile(file, token, Uploader) {
		return new Promise((resolve, reject) => {
			const uploader = new Uploader({
				userId: "",
				appId: 2608,
				imageConfig: {
					serviceId: "73owjymdk6"
				}
			});
			const key = uploader.addFile({
				file,
				stsToken: token,
				type: "image"
			});
			if (!key) {
				reject(new Error("Unable to register Juejin image upload task."));
				return;
			}
			uploader.on("complete", (event) => {
				if (event?.uploadResult?.Uri) {
					resolve(event.uploadResult);
				} else {
					reject(new Error("Juejin image upload completed without Uri."));
				}
			});
			uploader.on("error", (event) => {
				reject(new Error(event?.message || "Juejin image upload failed."));
			});
			uploader.start(key);
		});
	}

	async function getImageUrl(uri) {
		const response = await fetch(withBaseQuery("/imagex/v2/get_img_url", {
			uri,
			img_type: "private"
		}), {
			credentials: "include"
		});
		const data = await response.json();
		const mainUrl = data?.data?.main_url || data?.data?.url || data?.data;
		if (!mainUrl) {
			throw new Error(data?.err_msg || "Unable to resolve Juejin image URL.");
		}
		return {
			uri,
			url: mainUrl
		};
	}

	function withBaseQuery(path, params) {
		const url = new URL(path, window.location.origin);
		url.searchParams.set("aid", "2608");
		url.searchParams.set("uuid", `${Date.now()}${Math.random().toString(16).slice(2)}`);
		for (const [key, value] of Object.entries(params)) {
			url.searchParams.set(key, value);
		}
		return `${url.pathname}${url.search}`;
	}

	async function mapWithConcurrency(items, concurrency, mapper) {
		const results = new Array(items.length);
		let cursor = 0;
		const workers = new Array(Math.min(concurrency, items.length)).fill(null).map(async () => {
			while (cursor < items.length) {
				const index = cursor;
				cursor += 1;
				results[index] = await mapper(items[index], index);
			}
		});
		await Promise.all(workers);
		return results;
	}

	async function retry(task, retries) {
		let lastError = null;
		for (let attempt = 0; attempt <= retries; attempt += 1) {
			try {
				return await task();
			} catch (error) {
				lastError = error;
				if (attempt < retries) {
					await delay(800 * (attempt + 1));
				}
			}
		}
		throw lastError || new Error("Juejin image upload failed.");
	}

	function normalizePositiveInteger(value, fallback) {
		const number = Number(value);
		return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
	}

	function delay(ms) {
		return new Promise((resolve) => window.setTimeout(resolve, ms));
	}

	window.addEventListener("message", async (event) => {
		if (event.source !== window || event.data?.source !== REQUEST_SOURCE) {
			return;
		}

		const requestId = event.data.requestId;
		try {
			const uploads = await uploadAssets(event.data.assets || [], event.data.options || {});
			window.postMessage({
				source: RESPONSE_SOURCE,
				requestId,
				ok: true,
				uploads
			}, window.location.origin);
		} catch (error) {
			window.postMessage({
				source: RESPONSE_SOURCE,
				requestId,
				ok: false,
				error: error?.stack || error?.message || "Juejin image upload failed."
			}, window.location.origin);
		}
	});
})();
