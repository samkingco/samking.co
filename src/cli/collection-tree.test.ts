import assert from "node:assert/strict"
import {PassThrough, Writable} from "node:stream"
import test from "node:test"
import {setImmediate} from "node:timers/promises"
import {isCancel} from "@clack/prompts"
import {selectCollections} from "./collection-tree.ts"

const collections = [
	{id: "site", parentId: "root", name: "Site", kind: "project"},
	{id: "blog", parentId: "site", name: "Blog", kind: "album"},
	{id: "sets", parentId: "site", name: "Sets", kind: "group"},
	{id: "rodeo", parentId: "sets", name: "Rodeo", kind: "album"},
	{id: "alpine", parentId: "sets", name: "Alpine", kind: "album"},
	{id: "other", parentId: "root", name: "Other", kind: "album"},
]

test("the real prompt submits saved values and cancels without changing them", async (t) => {
	const input = new PassThrough()
	const output = new Writable({
		write(_chunk, _encoding, done) {
			done()
		},
	})
	t.after(() => {
		input.destroy()
		output.destroy()
	})
	const initial = new Set(["rodeo"])
	const unchanged = selectCollections(collections, initial, {input, output})
	input.write("\r")
	assert.deepEqual(await unchanged, ["rodeo"])
	const selected = selectCollections(collections, initial, {input, output})
	for (let step = 0; step < 4; step++) {
		input.emit("keypress", "", {name: "down"})
	}
	input.write(" ")
	await setImmediate()
	input.write("\r")
	assert.deepEqual(await selected, ["rodeo", "alpine"])
	const changed = selectCollections(collections, initial, {input, output})
	input.write(" ")
	await setImmediate()
	input.write("\r")
	assert.deepEqual(await changed, ["site"])
	const cancelled = selectCollections(collections, initial, {input, output})
	input.write(" ")
	await setImmediate()
	input.write("\x1b")
	assert.ok(isCancel(await cancelled))
	assert.deepEqual([...initial], ["rodeo"])
})
