import assert from "node:assert/strict"
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import test from "node:test"
import {pathToFileURL} from "node:url"
import type {LoaderContext} from "astro/loaders"
import {notesLoader} from "./notes.ts"

test("notes use TID entry IDs and keep source URLs for asset rendering", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "astro-notes-"))
	t.after(() => rm(root, {recursive: true, force: true}))
	const directory = join(root, "src/content/notes/2025")
	await mkdir(directory, {recursive: true})
	const path = join(directory, "example.md")
	await writeFile(
		path,
		"---\ntid: 3mv4qn47k2222\ndate: '2025-01-02T03:04:05.000Z'\n---\n\nA [photo](/photos/a/).\n",
	)
	const entries = new Map<
		string,
		{id: string; body: string; data: {date: Date; tid: string}}
	>()
	const context = {
		config: {root: pathToFileURL(root + "/")},
		store: {
			clear: () => entries.clear(),
			set: (entry: {
				id: string
				body: string
				data: {date: Date; tid: string}
			}) => entries.set(entry.id, entry),
		},
		generateDigest: () => "test",
		renderMarkdown: async (body: string, options: {fileURL: URL}) => {
			assert.equal(body, "A [photo](/photos/a/).\n")
			assert.equal(options.fileURL.href, pathToFileURL(path).href)
			return {html: ""}
		},
	} as unknown as LoaderContext
	await notesLoader().load(context)
	assert.equal(entries.size, 1)
	const entry = entries.get("3mv4qn47k2222")!
	assert.equal(entry.data.tid, "3mv4qn47k2222")
	assert.equal(entry.data.date.toISOString(), "2025-01-02T03:04:05.000Z")
	assert.equal(entry.body, "A [photo](/photos/a/).\n")
	await writeFile(
		path,
		"---\ntid: invalid\ndate: '2025-01-02T03:04:05.000Z'\n---\n\ntext",
	)
	await assert.rejects(notesLoader().load(context))
	assert.equal(entries.get("3mv4qn47k2222"), entry)
})
