import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {mkdtemp, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import type {Readable} from "node:stream"
import test from "node:test"
import {HeadObjectCommand, PutObjectCommand, S3Client} from "@aws-sdk/client-s3"
import {uploadR2File} from "./r2.ts"

const bytes = Buffer.from("photo")
const sha256 = createHash("sha256").update(bytes).digest("hex")
const matching = {
	Metadata: {sha256},
	ContentLength: bytes.length,
	ContentType: "image/jpeg",
}
const config = {
	endpoint: "https://r2.test",
	accessKeyId: "test",
	secretAccessKey: "test",
	bucket: "photos",
	backupBucket: "backups",
}

test("R2 uploads only missing or different objects", async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "r2-upload-"))
	t.after(() => rm(directory, {recursive: true, force: true}))
	const path = join(directory, "source.jpg")
	await writeFile(path, bytes)
	const cases = [
		{remote: matching, expected: "reused"},
		{
			remote: {...matching, Metadata: {sha256: "different"}},
			expected: "uploaded",
		},
		{remote: {$metadata: {httpStatusCode: 404}}, expected: "uploaded"},
		{remote: {$metadata: {httpStatusCode: 403}}, expected: "error"},
	]
	for (const {remote, expected} of cases) {
		const client = new S3Client({region: "auto"})
		t.after(() => client.destroy())
		let uploaded: Buffer | undefined
		const send = t.mock.method(
			client,
			"send",
			async (command: HeadObjectCommand | PutObjectCommand) => {
				assert.equal(command.input.Bucket, config.bucket)
				assert.equal(command.input.Key, "photos/source.jpg")
				if (command instanceof HeadObjectCommand) {
					if ("$metadata" in remote) {
						throw remote
					}
					return remote
				}
				assert.ok(command instanceof PutObjectCommand)
				assert.equal(command.input.Metadata?.sha256, sha256)
				const body = await Array.fromAsync(command.input.Body as Readable)
				uploaded = Buffer.concat(body)
				return {}
			},
		)
		const input = {
			client,
			config,
			path,
			key: "photos/source.jpg",
			byteSize: bytes.length,
			mimeType: "image/jpeg",
			sha256,
		}
		if (expected === "error") {
			await assert.rejects(uploadR2File(input))
		} else {
			assert.equal(await uploadR2File(input), expected)
		}
		assert.deepEqual(uploaded, expected === "uploaded" ? bytes : undefined)
		send.mock.restore()
	}
})
