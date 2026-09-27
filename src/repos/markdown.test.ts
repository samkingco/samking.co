import assert from "node:assert/strict"
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import test from "node:test"
import {isTid} from "@atcute/lexicons/syntax"
import {parse} from "@atcute/tid"
import {markdownToBlueskyRecord} from "../atproto/bluesky.ts"
import {readNotes, writeNote} from "./notes.ts"
import {readPosts, writePost} from "./posts.ts"

test("new Markdown files retain source text and carry usable identities", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "content-"))
	t.after(() => rm(root, {recursive: true, force: true}))
	const text = "\nA **crow** near [home](/photos/a/).\n\n"
	const path = await writeNote(root, text)
	const [note] = await readNotes(root)
	assert.ok(note && isTid(note.tid))
	assert.equal(note.text, text)
	assert.equal(
		note.date.toISOString(),
		new Date(parse(note.tid).timestamp / 1000).toISOString(),
	)
	assert.equal(note.path, path)
	const converted = markdownToBlueskyRecord(
		note,
		new URL("https://samking.co/journal/note/test/"),
	)
	assert.equal(converted.text, "A crow near home.")
	assert.deepEqual(converted.facets?.[0]?.features, [
		{
			$type: "app.bsky.richtext.facet#link",
			uri: "https://samking.co/photos/a/",
		},
	])
	assert.ok((await readFile(path, "utf8")).includes("](/photos/a/)"))
	const postPath = await writePost(
		root,
		'A "quoted" title',
		"A colon: and a\nsecond line",
	)
	const [post] = await readPosts(root)
	assert.ok(post)
	assert.equal(post.slug, "a-quoted-title")
	assert.equal(post.title, 'A "quoted" title')
	assert.equal(post.excerpt, "A colon: and a\nsecond line")
	assert.equal(post.text, "")
	const saved = await readFile(postPath, "utf8")
	await assert.rejects(writePost(root, 'A "quoted" title', "replacement"), {
		code: "EEXIST",
	})
	assert.equal(await readFile(postPath, "utf8"), saved)
})

test("readers reject invalid content and duplicate identities", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "content-invalid-"))
	t.after(() => rm(root, {recursive: true, force: true}))
	assert.deepEqual(await readNotes(root), [])
	assert.deepEqual(await readPosts(root), [])
	const path = await writeNote(root, "A note")
	await copyFile(path, join(root, "notes", "duplicate.md"))
	await assert.rejects(readNotes(root))
	await writeFile(
		join(root, "notes", "duplicate.md"),
		"---\ntid: invalid\ndate: 2025-02-30T00:00:00Z\n---\n\ntext",
	)
	await assert.rejects(readNotes(root))
	await mkdir(join(root, "posts"), {recursive: true})
	await writeFile(
		join(root, "posts", "invalid.md"),
		"---\ntid: 3mv4qn47k2222\ntitle: Test\nexcerpt: Test\ndate: not-a-date\n---\n\ntext",
	)
	await assert.rejects(readPosts(root))
})

test("quoted dates, CRLF, and stored slugs retain their source meaning", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "content-format-"))
	t.after(() => rm(root, {recursive: true, force: true}))
	await mkdir(join(root, "posts", "Nested"), {recursive: true})
	await writeFile(
		join(root, "posts", "Nested", "A Post.md"),
		"---\r\ntid: 3mv4qn47k2222\r\ntitle: Test\r\nslug: explicit-slug\r\nexcerpt: Test\r\ndate: '2025-01-02'\r\n---\r\n\r\n[relative](../other/)\r\n",
	)
	const [post] = await readPosts(root)
	assert.equal(post?.slug, "explicit-slug")
	assert.equal(post?.date.toISOString(), "2025-01-02T00:00:00.000Z")
	assert.equal(post?.text, "[relative](../other/)\r\n")
})

test("notes return Dates and serialize timestamps only for publishing", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "content-dates-"))
	t.after(() => rm(root, {recursive: true, force: true}))
	await mkdir(join(root, "notes"), {recursive: true})
	const path = join(root, "notes", "example.md")
	const source =
		"---\ntid: 3mv4qn47k2222\ndate: '2025-02-28T20:30:00-08:00'\n---\n\nA note"
	await writeFile(path, source)
	const [note] = await readNotes(root)
	assert.ok(note)
	assert.equal(note.date.toISOString(), "2025-03-01T04:30:00.000Z")
	const converted = markdownToBlueskyRecord(
		note,
		new URL("https://samking.co/"),
	)
	assert.equal(converted.createdAt, "2025-03-01T04:30:00.000Z")
	assert.equal(await readFile(path, "utf8"), source)
	for (const invalid of ["2025-02-28", "2025-02-30T00:00:00Z", "not-a-date"]) {
		await writeFile(path, source.replace("2025-02-28T20:30:00-08:00", invalid))
		await assert.rejects(readNotes(root))
	}
})
