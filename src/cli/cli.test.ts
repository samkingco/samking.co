import assert from "node:assert/strict"
import {spawn} from "node:child_process"
import {once} from "node:events"
import {mkdtemp, readFile, realpath, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import test, {type TestContext} from "node:test"
import {fileURLToPath} from "node:url"
import {readNotes, writeNote} from "../repos/notes.ts"
import {readPosts} from "../repos/posts.ts"

const cli = fileURLToPath(new URL("./index.ts", import.meta.url))

async function workspace(t: TestContext) {
	const cwd = await realpath(await mkdtemp(join(tmpdir(), "content-cli-")))
	t.after(() => rm(cwd, {recursive: true, force: true}))
	return cwd
}

async function run(
	cwd: string,
	args: string[],
	options: {input?: string; interactive?: boolean} = {},
) {
	assert.ok(
		process.allowedNodeEnvironmentFlags.has("--allow-net"),
		"CLI tests require Node with network permissions.",
	)
	using child = spawn(
		process.execPath,
		[
			// Exercise the real CLI without granting network access or writes outside its workspace.
			"--permission",
			"--allow-fs-read=*",
			`--allow-fs-write=${cwd}`,
			"--allow-addons",
			"--disable-warning=SecurityWarning",
			cli,
			...args,
		],
		{
			cwd,
			stdio: ["pipe", "pipe", "pipe"],
			timeout: 10_000,
			env: {
				...process.env,
				NODE_OPTIONS: "",
				ATPROTO_APP_PASSWORD: "",
				PHOTO_DATABASE_PATH: join(cwd, "catalog.sqlite"),
			},
		},
	)
	let stdout = ""
	let stderr = ""
	child.stdout.on("data", (chunk) => {
		stdout += chunk.toString()
	})
	child.stderr.on("data", (chunk) => {
		stderr += chunk.toString()
	})
	const completed = once(child, "close")
	if (options.interactive) {
		await Promise.race([
			once(child.stdout, "data"),
			completed.then(() => {
				throw new Error(`CLI exited before prompting: ${stderr}`)
			}),
		])
	}
	child.stdin.end(options.input ?? "")
	const [status] = await completed
	return {status, stdout, stderr}
}

test("CLI arguments and stdin create real notes and journal files", async (t) => {
	const cwd = await workspace(t)
	const root = join(cwd, "src/content")
	const input = "\nA crow 🐦 and [photos](/photos/).\n\n"
	const created = await run(cwd, ["note", "--stdin"], {input})
	assert.equal(created.status, 0, created.stderr)
	const [note] = await readNotes(root)
	assert.ok(note)
	assert.equal(note.text, input)

	const postResult = await run(cwd, [
		"journal",
		"A café visit",
		"--excerpt",
		"A summary",
	])
	assert.equal(postResult.status, 0, postResult.stderr)
	const [post] = await readPosts(root)
	assert.ok(post)
	assert.equal(post.title, "A café visit")
	assert.equal(post.slug, "a-cafe-visit")
	assert.equal(post.excerpt, "A summary")
})

test("real Clack editors accept multiline input and keyboard edits", async (t) => {
	const cwd = await workspace(t)
	const note = await run(cwd, ["note"], {
		interactive: true,
		input: "First line\rSecond linx\x7fe\t\r",
	})
	assert.equal(note.status, 0, note.stderr)
	assert.equal(
		(await readNotes(join(cwd, "src/content")))[0]?.text,
		"First line\nSecond line",
	)

	const post = await run(cwd, ["journal", "--excerpt", "An excerpt"], {
		interactive: true,
		input: "A café visix\x7ft\r",
	})
	assert.equal(post.status, 0, post.stderr)
	assert.equal(
		(await readPosts(join(cwd, "src/content")))[0]?.title,
		"A café visit",
	)
})

test("conflicting input does not write content", async (t) => {
	const cwd = await workspace(t)
	assert.equal(
		(await run(cwd, ["note", "argument", "--stdin"], {input: "stdin"})).status,
		1,
	)
	assert.deepEqual(await readNotes(join(cwd, "src/content")), [])
})

test("non-interactive menus require a terminal", async (t) => {
	const cwd = await workspace(t)
	for (const args of [
		[],
		["photos"],
		["photos", "alt"],
		["atproto"],
		["atproto", "share"],
	]) {
		assert.equal((await run(cwd, args)).status, 1)
	}
})

test("Escape and Ctrl+C leave editors without creating files", async (t) => {
	const cwd = await workspace(t)
	for (const command of ["note", "journal"]) {
		const cancelled = await run(cwd, [command], {
			interactive: true,
			input: "Unsaved text\x1b",
		})
		assert.equal(cancelled.status, 0, cancelled.stderr)
		const interrupted = await run(cwd, [command], {
			interactive: true,
			input: "Unsaved text\x03",
		})
		assert.equal(interrupted.status, 130, interrupted.stderr)
	}
	assert.deepEqual(await readNotes(join(cwd, "src/content")), [])
	assert.deepEqual(await readPosts(join(cwd, "src/content")), [])
})

test("failed mention lookup does not save a partially converted note", async (t) => {
	const cwd = await workspace(t)
	assert.equal((await run(cwd, ["note", "Hi @samking.co"])).status, 1)
	assert.deepEqual(await readNotes(join(cwd, "src/content")), [])
})

test("an invalid note stops the whole plan without changing source files", async (t) => {
	const cwd = await workspace(t)
	const root = join(cwd, "src/content")
	const valid = await writeNote(root, "A valid note")
	const invalid = await writeNote(root, "![photo](/photo.jpg)")
	const before = await Promise.all([
		readFile(valid, "utf8"),
		readFile(invalid, "utf8"),
	])
	const result = await run(cwd, ["atproto", "plan", "bluesky", "--json"])
	assert.equal(result.status, 1)
	assert.ok(result.stderr.includes(invalid), result.stderr)
	assert.equal(result.stdout.trim(), "")
	assert.deepEqual(
		await Promise.all([readFile(valid, "utf8"), readFile(invalid, "utf8")]),
		before,
	)
})
