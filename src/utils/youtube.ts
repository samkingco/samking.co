export async function getLatestVideoInfo(channelId: string): Promise<{
	title: string;
	watchUrl: string;
	publishedAt: number;
}> {
	const response = await fetch(
		`https://samkingco-youtubelatestvideoinfo.web.val.run?channelId=${channelId}`,
	);
	if (!response.ok) {
		throw new Error("Failed to fetch latest video info");
	}
	const json = await response.json();
	const latestVideo = {
		title: json.title,
		watchUrl: json.watchUrl,
		publishedAt: json.publishedAt,
	};
	return latestVideo;
}
