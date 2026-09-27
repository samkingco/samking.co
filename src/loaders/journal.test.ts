import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {mkdtemp, readFile, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import test from "node:test"
import {fileURLToPath} from "node:url"
import {parse} from "node-html-parser"
import sharp from "sharp"
import {readNotes} from "../repos/notes.ts"
import {readPosts} from "../repos/posts.ts"

test("a real build preserves journal URLs, feed entries, and share images", async (t) => {
	const output = await mkdtemp(join(tmpdir(), "journal-build-"))
	t.after(() => rm(output, {recursive: true, force: true}))
	const root = fileURLToPath(new URL("../../", import.meta.url))
	const manifest = new URL(import.meta.resolve("astro/package.json"))
	const {bin} = JSON.parse(await readFile(manifest, "utf8"))
	const astro = fileURLToPath(new URL(bin.astro, manifest))
	const result = spawnSync(
		process.execPath,
		[astro, "build", "--force", "--outDir", output],
		{
			cwd: root,
			encoding: "utf8",
			timeout: 120_000,
			env: {...process.env, NODE_OPTIONS: "", ASTRO_TELEMETRY_DISABLED: "1"},
		},
	)
	assert.equal(result.status, 0, result.stderr + result.stdout)
	const feed = parse(await readFile(join(output, "rss.xml"), "utf8"), {
		voidTag: {tags: []},
	})
	const links = new Set(
		feed
			.querySelectorAll("item > link")
			.map((link) => new URL(link.text).pathname.replace(/\/$/, "")),
	)
	const content = join(root, "src/content")
	for (const post of await readPosts(content)) {
		const path = `/journal/${post.slug}`
		const page = parse(await readFile(join(output, path, "index.html"), "utf8"))
		assert.ok(
			page
				.querySelectorAll("h1, h2, h3, h4, h5, h6")
				.some((heading) => heading.text.trim() === post.title.trim()),
			`Missing post title: ${path}`,
		)
		assert.equal(
			page.querySelector('meta[name="description"]')?.getAttribute("content"),
			post.excerpt,
		)
		assert.ok(links.has(path), `Missing feed entry: ${path}`)
		const imageUrl = page
			.querySelector('meta[property="og:image"]')
			?.getAttribute("content")
		assert.ok(imageUrl, `Missing share image: ${path}`)
		const image = await sharp(
			join(output, new URL(imageUrl).pathname),
		).metadata()
		assert.equal(image.format, "png")
	}
	for (const note of await readNotes(content)) {
		const path = `/journal/note/${note.tid}`
		const page = parse(await readFile(join(output, path, "index.html"), "utf8"))
		const date = page.querySelector("time")?.getAttribute("datetime")
		assert.ok(date, `Missing note date: ${path}`)
		assert.equal(new Date(date).getTime(), note.date.getTime())
		assert.ok(links.has(path), `Missing feed entry: ${path}`)
	}
})
