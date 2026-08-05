(function () {
	function buildReplacementOrder(blockKeys, replacements) {
		const moves = new Map();
		const destinationKeys = new Set();
		for (const replacement of replacements || []) {
			if (!replacement?.markerKey || !replacement?.mediaKey || destinationKeys.has(replacement.mediaKey)) {
				continue;
			}
			moves.set(replacement.markerKey, replacement);
			destinationKeys.add(replacement.mediaKey);
		}

		const orderedKeys = [];
		for (const key of blockKeys || []) {
			const move = moves.get(key);
			if (move) {
				orderedKeys.push(move.mediaKey);
				if (move.preserveMarker) {
					orderedKeys.push(key);
				}
			} else if (!destinationKeys.has(key)) {
				orderedKeys.push(key);
			}
		}
		return orderedKeys;
	}

	const api = { buildReplacementOrder };
	globalThis.OTPPageEditorOrder = api;
	if (typeof module !== "undefined" && module.exports) {
		module.exports = api;
	}
})();
