import assert from "node:assert/strict"
import test from "node:test"
import {markdownToBlueskyRecord} from "./bluesky.ts"
import {prepareMentions} from "./mentions.ts"

const date = new Date("2025-01-01T00:00:00.000Z")
const url = new URL("https://samking.co/journal/note/example/")
const did = "did:plc:653egim2jcy2f4j4abtunvhj"

test("a Markdown note becomes a Bluesky post with working links and mentions", async () => {
	const source = "A **café** near [home](/photos/) with @samking.co #birds"
	const prepared = await prepareMentions(source, async () => did)
	const converted = markdownToBlueskyRecord({date, text: prepared}, url)
	assert.equal(converted.text, "A café near home with @samking.co #birds")
	assert.deepEqual(
		converted.facets?.map(({index, features}) => ({
			text: Buffer.from(converted.text)
				.subarray(index.byteStart, index.byteEnd)
				.toString(),
			feature: features[0],
		})),
		[
			{
				text: "home",
				feature: {
					$type: "app.bsky.richtext.facet#link",
					uri: "https://samking.co/photos/",
				},
			},
			{
				text: "@samking.co",
				feature: {$type: "app.bsky.richtext.facet#mention", did},
			},
			{
				text: "#birds",
				feature: {$type: "app.bsky.richtext.facet#tag", tag: "birds"},
			},
		],
	)
})

test("unsupported content and oversized posts do not produce publishable records", () => {
	for (const text of ["![image](/image.jpg)", "a".repeat(301), " \n"]) {
		assert.throws(() => markdownToBlueskyRecord({date, text}, url))
	}
})
