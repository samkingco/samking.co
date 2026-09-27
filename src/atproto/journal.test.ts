import assert from "node:assert/strict"
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import test from "node:test"
import {AppBskyEmbedExternal} from "@atcute/bluesky"
import {Client} from "@atcute/client"
import {parse} from "@atcute/lexicons/validations"
import {parse as parseTid} from "@atcute/tid"
import sharp from "sharp"
import {
	journalShareRecord,
	journalShares,
	publishJournalShare,
	readJournalCard,
} from "./journal.ts"
import {createPlannedRecord, type RemoteRecord} from "./records.ts"

const did = "did:plc:653egim2jcy2f4j4abtunvhj"
const url = new URL("https://samking.co/journal/example/")
const record = journalShareRecord("A journal post", url)
const planned = await createPlannedRecord({
	did,
	collection: "app.bsky.feed.post",
	rkey: "3m25abcdefg22",
	label: "Example",
	record,
})
const external = parse(AppBskyEmbedExternal.mainSchema, {
	$type: "app.bsky.embed.external",
	external: {uri: url.href, title: "Example", description: "An excerpt"},
})

function remote(rkey: string, value: RemoteRecord["value"]): RemoteRecord {
	return {
		uri: `at://${did}/app.bsky.feed.post/${rkey}`,
		cid: planned.cid,
		value,
	}
}

test("share counts use embed URLs, ignore trailing slashes, and count each record once", () => {
	const first = remote("first", {...record, embed: external})
	const repeated = remote("second", {
		...record,
		embed: {
			...external,
			external: {
				...external.external,
				uri: "https://samking.co/journal/example",
			},
		},
	})
	const quoteWithLink = remote("third", {
		...record,
		embed: {
			$type: "app.bsky.embed.recordWithMedia",
			record: {
				$type: "app.bsky.embed.record",
				record: {uri: planned.uri, cid: planned.cid},
			},
			media: external,
		},
	})
	const shares = journalShares([
		first,
		first,
		repeated,
		quoteWithLink,
		remote("facet-only", record),
		remote("invalid", {text: "Not a post"}),
		remote("other", {
			...record,
			embed: {
				...external,
				external: {...external.external, uri: `${url.href}other/`},
			},
		}),
	])
	assert.deepEqual(
		shares.get("https://samking.co/journal/example"),
		new Set([first.uri, repeated.uri, quoteWithLink.uri]),
	)
	assert.equal(shares.size, 2)
})

test("composition appends a short clickable URL and validates the complete text", () => {
	const result = journalShareRecord("A 🐦 with [photos](/photos/) #birds", url)
	assert.equal(
		result.text,
		"A 🐦 with photos #birds\n\nsamking.co/journal/example",
	)
	const facet = result.facets!.at(-1)!
	assert.deepEqual(facet.features, [
		{$type: "app.bsky.richtext.facet#link", uri: url.href},
	])
	assert.equal(
		Buffer.from(result.text)
			.subarray(facet.index.byteStart, facet.index.byteEnd)
			.toString(),
		"samking.co/journal/example",
	)
	assert.equal(result.facets!.length, 3)
	assert.throws(() => journalShareRecord("a".repeat(280), url))
	const code = journalShareRecord("```\nAn unclosed code block", url)
	assert.deepEqual(code.facets!.at(-1)!.features, facet.features)
})

test("shares use local metadata and image bytes, then upload and create a new record", async (t) => {
	const cwd = await mkdtemp(join(tmpdir(), "journal-card-"))
	t.after(() => rm(cwd, {recursive: true, force: true}))
	t.mock.method(process, "cwd", () => cwd)
	t.mock.method(globalThis, "fetch", () =>
		assert.fail("Unexpected network request"),
	)
	const post = {slug: "example", title: "Example", excerpt: "An excerpt"}
	const path = join(cwd, "dist/journal/example.og.png")
	await assert.rejects(readJournalCard(post, url))
	await mkdir(join(cwd, "dist/journal"), {recursive: true})
	const png = await sharp({
		create: {width: 20, height: 10, channels: 3, background: "#888"},
	})
		.png()
		.toBuffer()
	await writeFile(path, png)
	const card = await readJournalCard(post, url)
	assert.deepEqual(card.external, external.external)
	assert.deepEqual(Buffer.from(await card.image.arrayBuffer()), png)
	const writes: {rkey: string; record: typeof record & {embed: unknown}}[] = []
	let failUpload = false
	const blob = {
		$type: "blob",
		ref: {$link: planned.cid},
		mimeType: "image/png",
		size: card.image.size,
	}
	const client = new Client({
		handler: async (endpoint, init) => {
			const request = new Request(new URL(endpoint, "https://pds.test"), init)
			assert.equal(request.method, "POST")
			if (endpoint.endsWith("uploadBlob")) {
				if (failUpload) {
					return Response.json({error: "InvalidBlob"}, {status: 400})
				}
				assert.equal(request.headers.get("content-type"), "image/png")
				assert.deepEqual(Buffer.from(await request.arrayBuffer()), png)
				return Response.json({blob})
			}
			assert.ok(endpoint.endsWith("createRecord"))
			const body = JSON.parse(String(init.body))
			assert.equal(body.repo, did)
			assert.equal(body.collection, "app.bsky.feed.post")
			assert.equal(body.validate, true)
			writes.push(body)
			return Response.json({
				uri: `at://${did}/app.bsky.feed.post/${body.rkey}`,
				cid: planned.cid,
			})
		},
	})
	const started = Date.now()
	const first = await publishJournalShare(client, did, record, card)
	const second = await publishJournalShare(client, did, record, card)
	assert.notEqual(first.uri, second.uri)
	assert.equal(writes.length, 2)
	for (const write of writes) {
		const timestamp = Math.floor(parseTid(write.rkey).timestamp / 1000)
		assert.ok(timestamp >= started && timestamp <= Date.now())
		assert.equal(write.record.createdAt, new Date(timestamp).toISOString())
		assert.deepEqual(write.record.embed, {
			...external,
			external: {...card.external, thumb: blob},
		})
	}
	failUpload = true
	await assert.rejects(publishJournalShare(client, did, record, card))
	assert.equal(writes.length, 2)
	await writeFile(path, Buffer.alloc(1_000_001))
	await assert.rejects(readJournalCard(post, url))
})
