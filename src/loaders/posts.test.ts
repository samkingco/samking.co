import assert from "node:assert/strict"
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import test from "node:test"
import {pathToFileURL} from "node:url"
import type {LoaderContext} from "astro/loaders"
import {postsLoader} from "./posts.ts"

test("posts use stored slugs and keep source URLs for asset rendering", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "astro-posts-"))
	t.after(() => rm(root, {recursive: true, force: true}))
	const directory = join(root, "src/content/posts")
	await mkdir(directory, {recursive: true})
	const path = join(directory, "2025-01-02-example.md")
	await writeFile(
		path,
		"---\ntid: 3mv4qn47k2222\nslug: stored-slug\ntitle: Example\nexcerpt: Summary\ndate: '2025-01-02'\n---\n\nA [photo](/photos/a/).\n",
	)
	const entries = new Map<
		string,
		{id: string; body: string; data: {date: Date; title: string}}
	>()
	const context = {
		config: {root: pathToFileURL(root + "/")},
		store: {
			clear: () => entries.clear(),
			set: (entry: {
				id: string
				body: string
				data: {date: Date; title: string}
			}) => entries.set(entry.id, entry),
		},
		generateDigest: () => "test",
		renderMarkdown: async (body: string, options: {fileURL: URL}) => {
			assert.equal(body, "A [photo](/photos/a/).\n")
			assert.equal(options.fileURL.href, pathToFileURL(path).href)
			return {html: ""}
		},
	} as unknown as LoaderContext
	await postsLoader().load(context)
	assert.equal(entries.size, 1)
	const entry = entries.get("stored-slug")!
	assert.equal(entry.data.title, "Example")
	assert.equal(entry.data.date.toISOString(), "2025-01-02T00:00:00.000Z")
	assert.equal(entry.body, "A [photo](/photos/a/).\n")
	await writeFile(
		path,
		"---\ntid: 3mv4qn47k2222\ntitle: Missing slug\nexcerpt: Summary\ndate: '2025-01-02'\n---\n\ntext",
	)
	await assert.rejects(postsLoader().load(context))
	assert.equal(entries.get("stored-slug"), entry)
})
