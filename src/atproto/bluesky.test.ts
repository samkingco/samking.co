import assert from "node:assert/strict"
import test from "node:test"
import {noteToBlueskyRecord} from "./bluesky.ts"
import {prepareMentions} from "./mentions.ts"

const date = new Date("2025-01-01T00:00:00.000Z")
const url = new URL("https://samking.co/journal/note/example/")
const did = "did:plc:653egim2jcy2f4j4abtunvhj"

test("formatting becomes plain text", () => {
	const converted = noteToBlueskyRecord(
		{
			date,
			text: '**A _crow_** and `code`.\n\n```js\nconst bird = "crow"\n```\n\n[**Photos**][photos]\n\n[photos]: /photos/ "A title"',
		},
		url,
	)
	assert.equal(
		converted.text,
		'A crow and code.\n\nconst bird = "crow"\n\nPhotos',
	)
	assert.deepEqual(converted.facets, [
		{
			index: {byteStart: 39, byteEnd: 45},
			features: [
				{
					$type: "app.bsky.richtext.facet#link",
					uri: "https://samking.co/photos/",
				},
			],
		},
	])
})

test("hashtags span emphasis but not code or link labels", () => {
	const converted = noteToBlueskyRecord(
		{
			date,
			text: "#bir**ds** `#code` [#linked](/photos/) @unresolved.test",
		},
		url,
	)
	assert.equal(converted.text, "#birds #code #linked @unresolved.test")
	assert.deepEqual(converted.facets, [
		{
			index: {byteStart: 0, byteEnd: 6},
			features: [{$type: "app.bsky.richtext.facet#tag", tag: "birds"}],
		},
		{
			index: {byteStart: 13, byteEnd: 20},
			features: [
				{
					$type: "app.bsky.richtext.facet#link",
					uri: "https://samking.co/photos/",
				},
			],
		},
	])
})

test("Bluesky facets use UTF-8 offsets and resolve relative destinations", () => {
	const record = noteToBlueskyRecord(
		{date, text: "🐦 [home](/photos/) and [next](../next/)"},
		url,
	)
	assert.equal(record?.text, "🐦 home and next")
	assert.deepEqual(record?.facets, [
		{
			index: {byteStart: 5, byteEnd: 9},
			features: [
				{
					$type: "app.bsky.richtext.facet#link",
					uri: "https://samking.co/photos/",
				},
			],
		},
		{
			index: {byteStart: 14, byteEnd: 18},
			features: [
				{
					$type: "app.bsky.richtext.facet#link",
					uri: "https://samking.co/journal/note/next/",
				},
			],
		},
	])
})

test("typed mentions become profile links and then mention facets", async () => {
	const calls: string[] = []
	const source =
		"Hi @samking.co. `@code.test` [@label.test](/photos/) mail@example.test"
	const prepared = await prepareMentions(source, async (handle) => {
		calls.push(handle)
		return did
	})
	assert.deepEqual(calls, ["samking.co"])
	assert.equal(
		prepared,
		`Hi [@samking.co](https://bsky.app/profile/${encodeURIComponent(did)}). \`@code.test\` [@label.test](/photos/) mail@example.test`,
	)
	const converted = noteToBlueskyRecord({date, text: prepared}, url)
	assert.deepEqual(converted.facets?.[0]?.features, [
		{$type: "app.bsky.richtext.facet#mention", did},
	])
	await assert.rejects(
		prepareMentions("Hi @samking.co", async () => {
			throw new Error("Offline")
		}),
	)
})

test("mention creation handles repeated names without changing emails or existing links", async () => {
	const calls: string[] = []
	const source =
		"@SamKing.co, again @samking.co.\n(@samking.co) mail@samking.co [@samking.co](https://bsky.app/profile/example)"
	const prepared = await prepareMentions(source, async (handle) => {
		calls.push(handle)
		return did
	})
	const profile = `https://bsky.app/profile/${encodeURIComponent(did)}`
	assert.deepEqual(calls, ["samking.co"])
	assert.equal(
		prepared,
		`[@SamKing.co](${profile}), again [@samking.co](${profile}).\n([@samking.co](${profile})) mail@samking.co [@samking.co](https://bsky.app/profile/example)`,
	)
})

test("unsupported content and oversized posts do not produce publishable records", () => {
	for (const text of ["![image](/image.jpg)", "a".repeat(301), " \n"]) {
		assert.throws(() => noteToBlueskyRecord({date, text}, url))
	}
})

test("invalid dates do not produce publishable records", () => {
	assert.throws(() =>
		noteToBlueskyRecord({date: new Date(NaN), text: "A note"}, url),
	)
})
