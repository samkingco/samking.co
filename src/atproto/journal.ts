import {readFile} from "node:fs/promises"
import {resolve} from "node:path"
import {
	ComAtprotoRepoCreateRecord,
	ComAtprotoRepoUploadBlob,
} from "@atcute/atproto"
import {AppBskyEmbedExternal, AppBskyFeedPost} from "@atcute/bluesky"
import RichtextBuilder from "@atcute/bluesky-richtext-builder"
import {type Client, ok} from "@atcute/client"
import {
	didString,
	genericUriString,
	is,
	parse,
} from "@atcute/lexicons/validations"
import {now, parse as parseTid} from "@atcute/tid"
import {markdownToBlueskyRecord} from "./bluesky.ts"
import {requireBlueskyPublishing} from "./publish.ts"
import type {RemoteRecord} from "./records.ts"

export function journalShares(records: RemoteRecord[]) {
	const shares = new Map<string, Set<string>>()
	for (const {uri, value} of records) {
		if (!is(AppBskyFeedPost.mainSchema, value)) {
			continue
		}
		const embed =
			value.embed?.$type === "app.bsky.embed.recordWithMedia"
				? value.embed.media
				: value.embed
		if (embed?.$type !== "app.bsky.embed.external") {
			continue
		}
		const url = embed.external.uri.replace(/\/$/, "")
		const matches = shares.get(url) ?? new Set<string>()
		matches.add(uri)
		shares.set(url, matches)
	}
	return shares
}

export function journalShareRecord(message: string, url: URL) {
	const record = markdownToBlueskyRecord(
		{date: new Date(), text: message.trim()},
		url,
	)
	const label = url.href.replace(/^https:\/\/|\/$/g, "")
	const {text, facets} = new RichtextBuilder()
		.addText(`${record.text}\n\n`)
		.addLink(label, parse(genericUriString(), url.href))
		.build()
	return parse(AppBskyFeedPost.mainSchema, {
		...record,
		text,
		facets: [...(record.facets ?? []), ...facets],
	})
}

export async function readJournalCard(
	post: {slug: string; title: string; excerpt: string},
	url: URL,
) {
	const external = parse(AppBskyEmbedExternal.externalSchema, {
		uri: url.href,
		title: post.title,
		description: post.excerpt,
	})
	const imagePath = resolve("dist/journal", `${post.slug}.og.png`)
	const image = await readFile(imagePath).catch((cause) => {
		throw new Error(`Could not read ${imagePath}. Run pnpm build first.`, {
			cause,
		})
	})
	if (image.byteLength > 1_000_000) {
		throw new Error(
			`OG image for ${url.href} exceeds Bluesky's thumbnail limit.`,
		)
	}
	return {
		external,
		image: new Blob([image], {type: "image/png"}),
		imagePath,
	}
}

export async function publishJournalShare(
	client: Client,
	did: string,
	record: AppBskyFeedPost.Main,
	card: Awaited<ReturnType<typeof readJournalCard>>,
) {
	requireBlueskyPublishing()
	const repo = parse(didString(), did)
	const {blob} = await ok(
		client.call(ComAtprotoRepoUploadBlob, {
			input: card.image,
			signal: AbortSignal.timeout(30_000),
		}),
	)
	const rkey = now()
	const createdAt = new Date(parseTid(rkey).timestamp / 1000).toISOString()
	const value = parse(AppBskyFeedPost.mainSchema, {
		...record,
		createdAt,
		embed: {
			$type: "app.bsky.embed.external",
			external: {...card.external, thumb: blob},
		},
	})
	try {
		return await ok(
			client.call(ComAtprotoRepoCreateRecord, {
				input: {
					repo,
					collection: "app.bsky.feed.post",
					rkey,
					record: value,
					validate: true,
				},
				signal: AbortSignal.timeout(10_000),
			}),
		)
	} catch (cause) {
		throw new Error(
			`Could not confirm at://${did}/app.bsky.feed.post/${rkey}. Check Bluesky or reopen the composer before retrying; the post may have been published.`,
			{cause},
		)
	}
}
