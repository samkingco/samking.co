import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {mkdtemp, readdir, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import test from "node:test"
import {fileURLToPath} from "node:url"

const cli = fileURLToPath(new URL("./photo-migration.ts", import.meta.url))

test("migration generation requires a non-empty, safe name", async (t) => {
	const cwd = await mkdtemp(join(tmpdir(), "photo-migration-"))
	t.after(() => rm(cwd, {recursive: true, force: true}))
	for (const args of [
		[],
		["--name", ""],
		["--name", " "],
		["--name", "../initial"],
	]) {
		const result = spawnSync(process.execPath, [cli, ...args], {
			cwd,
			encoding: "utf8",
			timeout: 10_000,
		})
		assert.equal(result.status, 1, result.stderr)
	}
	assert.deepEqual(await readdir(cwd), [])
})

test("migration generation forwards the name and failure status", () => {
	const preload = `
		import assert from "node:assert/strict";
		import childProcess from "node:child_process";
		import {syncBuiltinESMExports} from "node:module";
		childProcess.spawnSync = (command, args) => {
			assert.equal(command, "pnpm");
			assert.deepEqual(args, ["exec", "drizzle-kit", "generate", "--name", "initial"]);
			return {status: 7};
		};
		syncBuiltinESMExports();
	`
	const result = spawnSync(
		process.execPath,
		[
			"--import",
			`data:text/javascript,${encodeURIComponent(preload)}`,
			cli,
			"--name",
			"initial",
		],
		{encoding: "utf8", timeout: 10_000},
	)
	assert.equal(result.status, 7, result.stderr)
})
