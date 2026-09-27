import assert from "node:assert/strict"
import {once} from "node:events"
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises"
import {createServer, type IncomingHttpHeaders} from "node:http"
import {tmpdir} from "node:os"
import {join} from "node:path"
import test from "node:test"
import {AppBskyEmbedExternal} from "@atcute/bluesky"
import {parse} from "@atcute/lexicons/validations"
import {parse as parseTid} from "@atcute/tid"
import sharp from "sharp"
import {
	journalShareRecord,
	journalShares,
	publishJournalShare,
	readJournalCard,
} from "./journal.ts"
import {createBlueskyClient, publishBluesky} from "./publish.ts"
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

test("publishing sends local image bytes over HTTP and skips unchanged records", async (t) => {
	const cwd = await mkdtemp(join(tmpdir(), "journal-card-"))
	const previousCwd = process.cwd()
	const previousPassword = process.env.ATPROTO_APP_PASSWORD
	process.chdir(cwd)
	process.env.ATPROTO_APP_PASSWORD = "test-app-password"
	t.after(async () => {
		process.chdir(previousCwd)
		if (previousPassword === undefined) {
			delete process.env.ATPROTO_APP_PASSWORD
		} else {
			process.env.ATPROTO_APP_PASSWORD = previousPassword
		}
		await rm(cwd, {recursive: true, force: true})
	})
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
	const requests: {
		path: string | undefined
		headers: IncomingHttpHeaders
		body: Buffer
	}[] = []
	let failUpload = false
	const blob = {
		$type: "blob",
		ref: {$link: planned.cid},
		mimeType: "image/png",
		size: card.image.size,
	}
	await using server = createServer(async (request, response) => {
		const body = Buffer.concat(await Array.fromAsync(request))
		requests.push({path: request.url, headers: request.headers, body})
		response.setHeader("content-type", "application/json")
		switch (request.url) {
			case "/xrpc/com.atproto.server.createSession":
				response.end(
					JSON.stringify({
						did,
						handle: "samking.co",
						accessJwt: "test-access",
						refreshJwt: "test-refresh",
					}),
				)
				break
			case "/xrpc/com.atproto.repo.uploadBlob":
				response.statusCode = failUpload ? 400 : 200
				response.end(
					JSON.stringify(failUpload ? {error: "InvalidBlob"} : {blob}),
				)
				break
			case "/xrpc/com.atproto.repo.createRecord":
			case "/xrpc/com.atproto.repo.putRecord":
				response.end(
					JSON.stringify({
						uri: `at://${did}/app.bsky.feed.post/${JSON.parse(body.toString()).rkey}`,
						cid: planned.cid,
					}),
				)
				break
			default:
				response.statusCode = 404
				response.end()
		}
	})
	server.listen(0, "127.0.0.1")
	await once(server, "listening")
	const address = server.address()
	assert.ok(address && typeof address !== "string")
	const endpoint = `http://127.0.0.1:${address.port}`
	const client = await createBlueskyClient(did, endpoint)
	const started = Date.now()
	const first = await publishJournalShare(client, did, record, card)
	const second = await publishJournalShare(client, did, record, card)
	assert.notEqual(first.uri, second.uri)
	const login = requests.find((request) =>
		request.path?.endsWith("createSession"),
	)!
	const credentials = JSON.parse(login.body.toString())
	assert.equal(credentials.identifier, did)
	assert.equal(credentials.password, "test-app-password")
	const uploads = requests.filter((request) =>
		request.path?.endsWith("uploadBlob"),
	)
	assert.equal(uploads.length, 2)
	for (const upload of uploads) {
		assert.equal(upload.headers.authorization, "Bearer test-access")
		assert.equal(upload.headers["content-type"], "image/png")
		assert.deepEqual(upload.body, png)
	}
	const writes = requests.filter((request) =>
		request.path?.endsWith("createRecord"),
	)
	assert.equal(writes.length, 2)
	for (const request of writes) {
		assert.equal(request.headers.authorization, "Bearer test-access")
		const write = JSON.parse(request.body.toString())
		assert.equal(write.repo, did)
		assert.equal(write.collection, "app.bsky.feed.post")
		const timestamp = Math.floor(parseTid(write.rkey).timestamp / 1000)
		assert.ok(timestamp >= started && timestamp <= Date.now())
		const createdAt = Date.parse(write.record.createdAt)
		assert.ok(createdAt >= started && createdAt <= Date.now())
		assert.equal(write.record.embed.$type, "app.bsky.embed.external")
		assert.equal(write.record.embed.external.uri, url.href)
		assert.equal(write.record.embed.external.title, post.title)
		assert.equal(write.record.embed.external.description, post.excerpt)
		assert.deepEqual(write.record.embed.external.thumb, blob)
	}
	const result = {
		destination: "bluesky" as const,
		did,
		endpoint,
		plan: {creates: [planned], updates: [], unchanged: [], unmatched: []},
	}
	assert.equal(await publishBluesky(result, () => {}), 1)
	assert.equal(requests.at(-1)?.path, "/xrpc/com.atproto.repo.putRecord")
	const written = JSON.parse(requests.at(-1)!.body.toString())
	assert.equal(written.repo, did)
	assert.equal(written.collection, planned.collection)
	assert.equal(written.rkey, planned.rkey)
	assert.deepEqual(written.record, planned.record)
	const unchanged = {
		...result,
		plan: {...result.plan, creates: [], unchanged: [planned]},
	}
	const beforeRepeat = requests.length
	assert.equal(await publishBluesky(unchanged, () => {}), 0)
	assert.equal(requests.length, beforeRepeat)
	failUpload = true
	await assert.rejects(publishJournalShare(client, did, record, card))
	assert.equal(requests.length, beforeRepeat + 1)
	assert.equal(requests.at(-1)?.path, "/xrpc/com.atproto.repo.uploadBlob")
	await writeFile(path, Buffer.alloc(1_000_001))
	await assert.rejects(readJournalCard(post, url))
})
