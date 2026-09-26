interface LatestVideoInfo {
	title: string
	watchUrl: string
}

function parseLatestVideoInfo(value: unknown): LatestVideoInfo | null {
	if (
		typeof value !== "object" ||
		value === null ||
		!("title" in value) ||
		typeof value.title !== "string" ||
		!("watchUrl" in value) ||
		typeof value.watchUrl !== "string"
	) {
		return null
	}

	return {
		title: value.title,
		watchUrl: value.watchUrl,
	}
}

export async function getLatestVideoInfo(
	channelId: string,
): Promise<LatestVideoInfo | null> {
	const url = new URL("https://samkingco-youtubelatestvideoinfo.web.val.run")
	url.searchParams.set("channelId", channelId)

	try {
		const response = await fetch(url)
		if (!response.ok) {
			return null
		}
		return parseLatestVideoInfo(await response.json())
	} catch {
		return null
	}
}
