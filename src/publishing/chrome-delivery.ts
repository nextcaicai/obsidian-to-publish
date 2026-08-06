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
