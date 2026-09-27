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
	const key = async (sequence: string) => {
		input.write(sequence)
		await setImmediate()
	}
	await key("\r") // Open child.
	await key("\r")
	await key("\r") // Repeat its task without reopening the menu.
	assert.equal(tasks, 2)
	input.write("\x1b")
	await new Promise((resolve) => setTimeout(resolve, 80))
	await key("\r") // Root retained focus on child.
	await key("\r")
	assert.equal(tasks, 3)
	input.write("\x1b") // Escape also returns one level.
	await new Promise((resolve) => setTimeout(resolve, 80))
	await key("\x1b[B")
	await key("\r")
	assert.equal(errors, 1)
	await key("\x1b[B")
	await key("\r")
	await key("\r")
	assert.equal(last, 2)
	input.write("\x1b")
	await session
})
