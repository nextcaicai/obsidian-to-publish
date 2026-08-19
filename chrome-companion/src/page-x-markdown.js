(function () {
	const HEADING_TYPES = [
		"header-one",
		"header-two",
		"header-three",
		"header-four",
		"header-five",
		"header-six"
	];
	const IMAGE_MARKER_PATTERN = /^\[\[OTP_IMAGE_[^\]]+\]\]$/;

	function markdownToDraftBlocks(markdown) {
		const blocks = [];
		let paragraphLines = [];

		const pushParagraph = () => {
			const text = paragraphLines.join(" ").replace(/\s+/g, " ").trim();
			if (text) {
				blocks.push({ type: "unstyled", text });
			}
			paragraphLines = [];
		};

		for (const sourceLine of String(markdown || "").split(/\r?\n/)) {
			const line = sourceLine.trim();
			if (!line) {
				pushParagraph();
				continue;
			}

			const heading = line.match(/^(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/);
			if (heading) {
				pushParagraph();
				blocks.push({
					type: HEADING_TYPES[heading[1].length - 1],
					text: heading[2].trim()
				});
				continue;
			}

			if (IMAGE_MARKER_PATTERN.test(line)) {
				pushParagraph();
				blocks.push({ type: "unstyled", text: line });
				continue;
			}

			paragraphLines.push(line);
		}

		pushParagraph();
		return blocks.length > 0 ? blocks : [{ type: "unstyled", text: "" }];
	}

	const api = { markdownToDraftBlocks };
	globalThis.OTPXMarkdown = api;
	if (typeof module !== "undefined" && module.exports) {
		module.exports = api;
	}
})();
