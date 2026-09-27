import assert from "node:assert/strict"
import {PassThrough, Writable} from "node:stream"
import test from "node:test"
import {setImmediate} from "node:timers/promises"
import {menu} from "./menu.ts"

test("menus resume after tasks, keep focus, return one level, and recover from errors", async (t) => {
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
	const options = {input, output}
	let tasks = 0
	let errors = 0
	let last = 0
	const session = menu(
		"root",
		[
			{
				label: "child",
				run: () =>
					menu(
						"child",
						[
							{
								label: "task",
								run: async () => {
									tasks++
								},
							},
						],
						options,
					),
			},
			{
				label: "error",
				run: async () => {
					errors++
					throw new Error("test failure")
				},
			},
			{
				label: "last",
				run: async () => {
					last++
				},
			},
		],
		options,
	)
	const key = async (name: string) => {
		input.emit("keypress", "", {name})
		await setImmediate()
	}
	await key("return") // Open child.
	await key("return")
	await key("return") // Repeat its task without reopening the menu.
	assert.equal(tasks, 2)
	await key("escape")
	await key("return") // Root retained focus on child.
	await key("return")
	assert.equal(tasks, 3)
	await key("escape")
	await key("down")
	await key("return")
	assert.equal(errors, 1)
	await key("down")
	await key("return")
	await key("return")
	assert.equal(last, 2)
	await key("escape")
	await session
})

test("Escape leaves the root menu open and an abort closes it", async (t) => {
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
	const controller = new AbortController()
	let calls = 0
	const session = menu(
		"root",
		[
			{
				label: "task",
				run: async () => {
					calls++
				},
			},
		],
		{input, output, root: true, signal: controller.signal},
	)
	input.emit("keypress", "", {name: "escape"})
	await setImmediate()
	input.emit("keypress", "", {name: "return"})
	await setImmediate()
	assert.equal(calls, 1)
	controller.abort()
	await session
})
