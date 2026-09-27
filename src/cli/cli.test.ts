import assert from "node:assert/strict"
import {spawn, spawnSync} from "node:child_process"
import {once} from "node:events"
import {mkdtemp, readFile, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import test, {type TestContext} from "node:test"
import {setTimeout as delay} from "node:timers/promises"
import {fileURLToPath} from "node:url"
import type {RemoteRecord} from "../atproto/records.ts"
import {readNotes, writeNote} from "../repos/notes.ts"
import {readPosts} from "../repos/posts.ts"
import {siteConfig} from "../site.config.ts"

const cli = fileURLToPath(new URL("./index.ts", import.meta.url))
const noNetwork =
	"globalThis.fetch = async () => { throw new Error('Unexpected network request') }"

async function workspace(t: TestContext) {
	const cwd = await mkdtemp(join(tmpdir(), "content-cli-"))
	t.after(() => rm(cwd, {recursive: true, force: true}))
	return cwd
}

function run(cwd: string, args: string[], input = "", preload = noNetwork) {
	return spawnSync(
		process.execPath,
		[
			"--import",
			`data:text/javascript,${encodeURIComponent(preload)}`,
			cli,
			...args,
		],
		{
			cwd,
			input,
			encoding: "utf8",
			timeout: 10_000,
			env: {
				...process.env,
				ATPROTO_APP_PASSWORD: "",
				PHOTO_DATABASE_PATH: join(cwd, "catalog.sqlite"),
			},
		},
	)
}

// Only the external identity/PDS boundary is replaced. Commands, files, parsing,
// conversion and comparison run through the real CLI.
function mockNetwork(records: RemoteRecord[] = []) {
	return `
		const did = ${JSON.stringify(siteConfig.atproto.did)};
		globalThis.fetch = async (input, init) => {
			const url = new URL(input instanceof Request ? input.url : input);
			if ((init?.method ?? "GET").toUpperCase() !== "GET") throw new Error("Write attempted");
			if (url.origin === "https://bsky.social" && url.pathname === "/xrpc/com.atproto.identity.resolveHandle") {
				return Response.json({did});
			}
			if (url.origin === "https://plc.directory" && decodeURIComponent(url.pathname) === "/" + did) {
				return Response.json({id: did, service: [{id: did + "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: "https://pds.test"}]});
			}
			if (url.origin === "https://pds.test" && url.pathname === "/xrpc/com.atproto.repo.listRecords") {
				return Response.json({records: ${JSON.stringify(records)}});
			}
			throw new Error("Unexpected request: " + url);
		};
	`
}

test("create content, publish a note, and skip it on a repeat run", async (t) => {
	const cwd = await workspace(t)
	const root = join(cwd, "src/content")
	const input = "\nA crow 🐦 and [photos](/photos/) with @samking.co.\n\n"
	const created = run(cwd, ["note", "--stdin"], input, mockNetwork())
	assert.equal(created.status, 0, created.stderr)
	const [note] = await readNotes(root)
	assert.ok(note)
	assert.equal(
		note.text,
		`\nA crow 🐦 and [photos](/photos/) with [@samking.co](https://bsky.app/profile/${encodeURIComponent(siteConfig.atproto.did)}).\n\n`,
	)
	const saved = await readFile(note.path, "utf8")

	const postResult = run(cwd, [
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

	const result = run(
		cwd,
		["atproto", "plan", "bluesky", "--json"],
		"",
		mockNetwork(),
	)
	assert.equal(result.status, 0, result.stderr)
	const plan = JSON.parse(result.stdout).plan
	assert.equal(plan.creates.length, 1)
	const createdRecord = plan.creates[0]
	assert.equal(
		createdRecord.uri,
		`at://${siteConfig.atproto.did}/app.bsky.feed.post/${note.tid}`,
	)
	assert.equal(
		createdRecord.record.text,
		"A crow 🐦 and photos with @samking.co.",
	)
	assert.deepEqual(
		createdRecord.record.facets.flatMap(
			(facet: {features: unknown[]}) => facet.features,
		),
		[
			{
				$type: "app.bsky.richtext.facet#link",
				uri: "https://samking.co/photos/",
			},
			{$type: "app.bsky.richtext.facet#mention", did: siteConfig.atproto.did},
		],
	)

	const publishing = run(
		cwd,
		["atproto", "publish", "bluesky", "--yes"],
		"",
		`${mockNetwork()}
		import assert from "node:assert/strict";
		process.env.ATPROTO_APP_PASSWORD = "test-app-password";
		const read = globalThis.fetch;
		let writes = 0;
		process.on("exit", () => {
			if (writes !== 1) {
				console.error("Expected one PDS record write, received " + writes);
				process.exitCode = 1;
			}
		});
		globalThis.fetch = async (input, init) => {
			const url = new URL(input instanceof Request ? input.url : input);
			if (url.origin !== "https://pds.test" || init?.method?.toUpperCase() !== "POST") return read(input, init);
			const body = JSON.parse(init.body);
			if (url.pathname === "/xrpc/com.atproto.server.createSession") {
				assert.equal(body.identifier, did);
				assert.equal(body.password, "test-app-password");
				return Response.json({did, handle: "samking.co", accessJwt: "test-access", refreshJwt: "test-refresh"});
			}
			if (url.pathname === "/xrpc/com.atproto.repo.putRecord") {
				assert.equal(new Headers(init.headers).get("authorization"), "Bearer test-access");
				assert.equal(body.repo, did);
				assert.equal(body.collection, "app.bsky.feed.post");
				assert.equal(body.rkey, ${JSON.stringify(note.tid)});
				assert.deepEqual(body.record, ${JSON.stringify(createdRecord.record)});
				writes++;
				return Response.json(${JSON.stringify({uri: createdRecord.uri, cid: createdRecord.cid})});
			}
			throw new Error("Unexpected write: " + url);
		};`,
	)
	assert.equal(publishing.status, 0, publishing.stderr)

	const published = [
		{
			uri: createdRecord.uri,
			cid: createdRecord.cid,
			value: createdRecord.record,
		},
	]
	const repeated = run(
		cwd,
		["atproto", "plan", "bluesky", "--json"],
		"",
		mockNetwork(published),
	)
	assert.equal(repeated.status, 0, repeated.stderr)
	const nextPlan = JSON.parse(repeated.stdout).plan
	assert.deepEqual(nextPlan.creates, [])
	assert.deepEqual(nextPlan.updates, [])
	assert.equal(nextPlan.unchanged.length, 1)
	assert.equal(await readFile(note.path, "utf8"), saved)
	const republished = run(
		cwd,
		["atproto", "publish", "bluesky", "--yes"],
		"",
		mockNetwork(published),
	)
	assert.equal(republished.status, 0, republished.stderr)
})

test("conflicting input does not write content", async (t) => {
	const cwd = await workspace(t)
	assert.equal(run(cwd, ["note", "argument", "--stdin"], "stdin").status, 1)
	assert.deepEqual(await readNotes(join(cwd, "src/content")), [])
})

test("photo setup replaces the roots command", async (t) => {
	const cwd = await workspace(t)
	const help = run(cwd, ["photos", "--help"])
	assert.equal(help.status, 0, help.stderr)
	assert.match(help.stdout, /\bsetup\b/)
	assert.doesNotMatch(help.stdout, /\broots\b/)
	assert.equal(run(cwd, ["photos", "setup", "--help"]).status, 0)
	assert.equal(run(cwd, ["photos", "roots"]).status, 1)
})

test(
	"Escape returns from a submenu but the root waits for Ctrl+C",
	{timeout: 10_000},
	async (t) => {
		const cwd = await workspace(t)
		const preload = `${noNetwork};
		Object.assign(process.stdin, {isTTY: true, setRawMode() {}});
	`
		for (const args of [[], ["photos"]]) {
			const child = spawn(
				process.execPath,
				[
					"--import",
					`data:text/javascript,${encodeURIComponent(preload)}`,
					cli,
					...args,
				],
				{cwd, stdio: ["pipe", "pipe", "pipe"]},
			)
			t.after(() => child.kill())
			const exit = once(child, "exit")
			await once(child.stdout, "data")
			child.stdin.write("\x1b")
			if (args.length === 0) {
				await delay(100)
				assert.equal(child.exitCode, null)
				child.stdin.write("\x03")
			}
			const [code] = await exit
			assert.equal(code, args.length === 0 ? 130 : 0)
		}
	},
)

test("failed mention lookup does not save a partially converted note", async (t) => {
	const cwd = await workspace(t)
	assert.equal(run(cwd, ["note", "Hi @samking.co"]).status, 1)
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
	const result = run(cwd, ["atproto", "plan", "bluesky", "--json"])
	assert.equal(result.status, 1)
	assert.equal(result.stdout.trim(), "")
	assert.deepEqual(
		await Promise.all([readFile(valid, "utf8"), readFile(invalid, "utf8")]),
		before,
	)
})
