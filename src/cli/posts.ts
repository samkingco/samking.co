import {resolve} from "node:path"
import {
	confirm,
	isCancel,
	log,
	multiline,
	multiselect,
	note,
	text as promptText,
	taskLog,
} from "@clack/prompts"
import {resolveHandle} from "../atproto/identity.ts"
import {
	journalShareRecord,
	journalShares,
	publishJournalShare,
	readJournalCard,
} from "../atproto/journal.ts"
import {prepareMentions} from "../atproto/mentions.ts"
import {readRemoteRecords} from "../atproto/pds.ts"
import {
	createBlueskyClient,
	requireBlueskyPublishing,
} from "../atproto/publish.ts"
import {readPosts, writePost} from "../repos/posts.ts"
import {siteConfig} from "../site.config.ts"
import {journalPath} from "../utils/journal-path.ts"
import {errorMessage} from "./menu.ts"

type ShareEntry = {
	post: {title: string; date: Date; slug: string; excerpt: string}
	url: URL
	shares: Set<string>
}

export async function createPost(
	title: string | undefined,
	options: {excerpt: string},
): Promise<void> {
	const heading =
		title ??
		(await promptText({
			message: "Post title",
			validate: (value) =>
				value?.trim() ? undefined : "Post title must not be blank.",
		}))
	if (isCancel(heading)) {
		return
	}
	console.log(await writePost(resolve("src/content"), heading, options.excerpt))
}

export async function sharePosts(): Promise<void> {
	if (!process.stdin.isTTY) {
		throw new Error("Use an interactive terminal to share posts to Bluesky.")
	}
	requireBlueskyPublishing()
	const posts = (await readPosts()).sort(
		(a, b) => b.date.getTime() - a.date.getTime(),
	)
	if (posts.length === 0) {
		log.info("No journal posts to share.")
		return
	}
	const did = siteConfig.atproto.did
	const task = taskLog({title: "Read existing Bluesky shares"})
	let remote: Awaited<ReturnType<typeof readRemoteRecords>>
	try {
		remote = await readRemoteRecords(did, ["app.bsky.feed.post"])
		task.success("Read existing shares — nothing published")
	} catch (error) {
		task.error("Could not read existing shares")
		throw error
	}
	const shares = journalShares(remote.records)
	const entries = posts.map((post) => {
		const url = new URL(
			journalPath({collection: "posts", id: post.slug}),
			`https://${siteConfig.domain}`,
		)
		return {
			post,
			url,
			shares: shares.get(url.href.replace(/\/$/, "")) ?? new Set<string>(),
		}
	})
	while (true) {
		const selected = await multiselect({
			message: "Share posts to Bluesky",
			required: false,
			maxItems: 15,
			options: entries.map((entry) => ({
				value: entry,
				label: entry.post.title,
				hint: `${entry.post.date.toISOString().slice(0, 10)} · ${entry.shares.size ? `Shared ${entry.shares.size} times` : "Not shared"}`,
			})),
		})
		if (isCancel(selected) || selected.length === 0) {
			return
		}
		await publishShares(selected, remote.endpoint)
	}
}

async function publishShares(entries: ShareEntry[], endpoint: string) {
	const did = siteConfig.atproto.did
	let client: Awaited<ReturnType<typeof createBlueskyClient>> | undefined
	for (const entry of entries) {
		const draft = await composeShare(entry)
		if (!draft) {
			return
		}
		const task = taskLog({title: "Publish Bluesky post"})
		try {
			client ??= await createBlueskyClient(did, endpoint)
			const published = await publishJournalShare(
				client,
				did,
				draft.record,
				draft.card,
			)
			entry.shares.add(published.uri)
			task.success(`Published ${blueskyUrl(published.uri)}`)
		} catch (error) {
			task.error("Publishing stopped; earlier confirmed posts remain published")
			throw error
		}
	}
}

async function composeShare(entry: ShareEntry) {
	log.info([entry.url.href, ...[...entry.shares].map(blueskyUrl)].join("\n"))
	const task = taskLog({title: "Read journal link metadata"})
	let card: Awaited<ReturnType<typeof readJournalCard>>
	try {
		card = await readJournalCard(entry.post, entry.url)
		task.success("Link card ready")
	} catch (error) {
		task.error("Could not prepare the link card")
		throw error
	}
	let message = `New post: ${entry.post.title}`
	while (true) {
		const text = await multiline({
			message: "Post text (the journal link is appended automatically)",
			initialValue: message,
			showSubmit: true,
			validate: (value = "") => {
				try {
					journalShareRecord(value, entry.url)
				} catch (error) {
					return errorMessage(error)
				}
			},
		})
		if (isCancel(text)) {
			return
		}
		message = text
		const prepared = await prepareMentions(text, resolveHandle)
		const record = journalShareRecord(prepared, entry.url)
		note(
			`${record.text}\n\nLink card: ${card.external.title}\n${card.external.description}\nImage: ${card.imagePath}`,
			"Bluesky preview",
		)
		const approved = await confirm({
			message: `Publish as a new Bluesky post as ${siteConfig.atproto.did}?`,
			initialValue: false,
		})
		if (!isCancel(approved) && approved) {
			return {record, card}
		}
	}
}

function blueskyUrl(uri: string): string {
	const [, did, rkey] = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/.exec(
		uri,
	)!
	return `https://bsky.app/profile/${did}/post/${rkey}`
}
