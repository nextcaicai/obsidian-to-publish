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

	function parseInlineStyles(markdown) {
		const text = String(markdown || "");
		const output = [];
		const inlineStyleRanges = [];
		let index = 0;

		while (index < text.length) {
			const delimiter = text.startsWith("**", index)
				? "**"
				: text.startsWith("__", index)
					? "__"
					: null;
			if (!delimiter) {
				output.push(text[index]);
				index += 1;
				continue;
			}

			const contentStart = index + delimiter.length;
			const closingIndex = text.indexOf(delimiter, contentStart);
			if (closingIndex === -1 || closingIndex === contentStart) {
				output.push(delimiter);
				index = contentStart;
				continue;
			}

			const boldText = text.slice(contentStart, closingIndex);
			inlineStyleRanges.push({
				offset: output.join("").length,
				length: boldText.length,
				style: "BOLD"
			});
			output.push(boldText);
			index = closingIndex + delimiter.length;
		}

		return {
			text: output.join(""),
			...(inlineStyleRanges.length > 0 ? { inlineStyleRanges } : {})
		};
	}

	function markdownToDraftBlocks(markdown) {
		const blocks = [];
		let paragraphLines = [];

		const pushParagraph = () => {
			const markdown = paragraphLines.join(" ").replace(/\s+/g, " ").trim();
			if (markdown) {
				blocks.push({ type: "unstyled", ...parseInlineStyles(markdown) });
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
				blocks.push({ type: HEADING_TYPES[heading[1].length - 1], ...parseInlineStyles(heading[2].trim()) });
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
