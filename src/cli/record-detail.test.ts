import assert from "node:assert/strict"
import {PassThrough, Writable} from "node:stream"
import test from "node:test"
import {setImmediate} from "node:timers/promises"
import {createPlannedRecord} from "../atproto/records.ts"
import {viewRecord} from "./record-detail.ts"

test("long record details stay open, scroll, and return only when dismissed", async (t) => {
	const input = new PassThrough()
	let rendered = ""
	const output = Object.assign(
		new Writable({
			write(chunk, _encoding, done) {
				rendered += chunk.toString()
				done()
			},
		}),
		{rows: 16, columns: 72},
	)
	t.after(() => {
		input.destroy()
		output.destroy()
	})
	const record = await createPlannedRecord({
		did: "did:plc:653egim2jcy2f4j4abtunvhj",
		collection: "app.refrakt.photo",
		rkey: "test",
		label: "Example photo",
		record: {
			$type: "app.refrakt.photo",
			values: Array.from({length: 50}, (_, index) => `value-${index}`),
		},
	})
	let closed = false
	const detail = viewRecord("Create", record, {input, output}).then(() => {
		closed = true
	})
	await setImmediate()
	assert.equal(closed, false)
	assert.ok(rendered.includes(record.uri))
	assert.ok(!rendered.includes("value-49"))
	rendered = ""
	input.write("\x1b[6~") // Page down.
	await setImmediate()
	assert.ok(rendered.includes("value-"))
	assert.equal(closed, false)
	rendered = ""
	input.write("\x1b[F") // End.
	await setImmediate()
	assert.ok(rendered.includes("value-49"))
	rendered = ""
	input.write("\x1b[H") // Home.
	await setImmediate()
	assert.ok(rendered.includes(record.uri))
	assert.equal(closed, false)
	input.write("\r")
	await setImmediate()
	assert.equal(closed, false)
	input.write("\x1b")
	await detail
	assert.equal(closed, true)
})
