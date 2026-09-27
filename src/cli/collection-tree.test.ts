import assert from "node:assert/strict"
import {PassThrough, Writable} from "node:stream"
import test from "node:test"
import {setImmediate} from "node:timers/promises"
import {isCancel} from "@clack/prompts"
import {CollectionTree, selectCollections} from "./collection-tree.ts"

const collections = [
	{id: "site", parentId: "root", name: "Site", kind: "project"},
	{id: "blog", parentId: "site", name: "Blog", kind: "album"},
	{id: "sets", parentId: "site", name: "Sets", kind: "group"},
	{id: "rodeo", parentId: "sets", name: "Rodeo", kind: "album"},
	{id: "alpine", parentId: "sets", name: "Alpine", kind: "album"},
	{id: "other", parentId: "root", name: "Other", kind: "album"},
]

test("selection states describe subtree inclusion without adding exclusions", () => {
	const tree = new CollectionTree(collections, ["rodeo"])
	assert.equal(tree.state("rodeo"), "selected")
	assert.equal(tree.state("site"), "partial")
	assert.equal(tree.state("sets"), "partial")
	assert.equal(tree.state("alpine"), "empty")
	tree.toggle("sets")
	assert.deepEqual([...tree.selected], ["sets"])
	assert.equal(tree.state("rodeo"), "included")
	assert.equal(tree.state("alpine"), "included")
	tree.toggle("alpine")
	assert.deepEqual([...tree.selected], ["sets"])
	tree.toggle("sets")
	assert.deepEqual([...tree.selected], [])
	assert.equal(tree.state("site"), "empty")
})

test("arrow navigation uses visible rows and does not change selection", () => {
	const tree = new CollectionTree(collections, ["site"])
	assert.deepEqual(
		tree.visible.map(({collection}) => collection.id),
		["site", "other"],
	)
	tree.move("right")
	assert.deepEqual(
		tree.visible.map(({collection}) => collection.id),
		["site", "blog", "sets", "other"],
	)
	tree.move("right")
	assert.equal(tree.visible[tree.cursor]?.collection.id, "blog")
	tree.move("down")
	tree.move("right")
	tree.move("right")
	assert.equal(tree.visible[tree.cursor]?.collection.id, "rodeo")
	tree.move("down")
	assert.equal(tree.visible[tree.cursor]?.collection.id, "alpine")
	tree.move("down")
	assert.equal(tree.visible[tree.cursor]?.collection.id, "other")
	tree.move("up")
	tree.move("left")
	assert.equal(tree.visible[tree.cursor]?.collection.id, "sets")
	tree.move("left")
	assert.equal(tree.expanded.has("sets"), false)
	tree.move("left")
	assert.equal(tree.visible[tree.cursor]?.collection.id, "site")
	assert.deepEqual([...tree.selected], ["site"])
})

test("saved selections are visible and redundant descendants are normalized", () => {
	const tree = new CollectionTree(collections, ["rodeo"])
	assert.ok(tree.visible.some(({collection}) => collection.id === "rodeo"))
	const redundant = new CollectionTree(collections, ["site", "rodeo"])
	assert.deepEqual([...redundant.selected], ["site"])
	const future = new CollectionTree(
		[
			...collections,
			{
				id: "new",
				parentId: "site",
				name: "New album",
				kind: "album",
			},
		],
		redundant.selected,
	)
	assert.equal(future.state("new"), "included")
})

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
