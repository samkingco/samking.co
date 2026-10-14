import {readFile} from "node:fs/promises"
import {
	ComAtprotoIdentityResolveHandle,
	ComAtprotoRepoPutRecord,
	ComAtprotoRepoUploadBlob,
} from "@atcute/atproto"
import {fromString as parseCid} from "@atcute/cid"
import {Client, ok, simpleFetchHandler} from "@atcute/client"
import type {Did} from "@atcute/lexicons/syntax"
import {
	blob,
	handleString,
	nsidString,
	object,
	parse,
} from "@atcute/lexicons/validations"
import {PasswordSession} from "@atcute/password-session"
import {readExportFiles} from "../repos/photos/catalog.ts"
import {openReadonlyPhotoDatabase} from "../repos/photos/database.ts"
import type {planRefrakt} from "./plan.ts"
import type {PlannedRecord} from "./records.ts"

/** Refrakt's local network, from apps/localnet in at-refrakt. Every account there uses this password. */
export const LOCALNET = {
	service: "http://localhost:2583",
	identifier: "sam.test",
	password: "password",
}

const photoSourceSchema = object({source: blob()})

export async function resolveLocalnetDid(): Promise<string> {
	const client = new Client({
		handler: simpleFetchHandler({service: LOCALNET.service}),
	})
	try {
		const {did} = await ok(
			client.call(ComAtprotoIdentityResolveHandle, {
				params: {handle: parse(handleString(), LOCALNET.identifier)},
				signal: AbortSignal.timeout(5_000),
			}),
		)
		return did
	} catch (cause) {
		throw new Error(
			`Could not find ${LOCALNET.identifier} on localnet. Start Refrakt's localnet and run its seed.`,
			{cause},
		)
	}
}

export async function publishRefraktToLocalnet(
	result: Awaited<ReturnType<typeof planRefrakt>>,
	onPublished: (record: PlannedRecord) => void,
): Promise<number> {
	if (result.endpoint !== LOCALNET.service) {
		throw new Error("This plan is not for localnet.")
	}
	const records = [...result.plan.creates, ...result.plan.updates]
	if (records.length === 0) {
		return 0
	}
	const session = await PasswordSession.login(LOCALNET)
	if (session.did !== result.did) {
		throw new Error(`${LOCALNET.identifier} does not match the planned DID.`)
	}
	const client = new Client({handler: session})
	const database = openReadonlyPhotoDatabase()
	let files: Map<string, string>
	try {
		files = new Map(
			readExportFiles(database, result.profile).map((row) => [
				row.sha256,
				row.sourcePath,
			]),
		)
	} finally {
		database.$client.close()
	}
	let completed = 0
	for (const record of records) {
		try {
			await publishRecord(client, session.did, record, files)
		} catch (cause) {
			throw new Error(
				`Publishing stopped after ${completed} of ${records.length} confirmed writes. Could not confirm ${record.uri}. Run the plan again before retrying.`,
				{cause},
			)
		}
		completed++
		onPublished(record)
	}
	return completed
}

async function publishRecord(
	client: Client,
	repo: Did,
	record: PlannedRecord,
	files: Map<string, string>,
): Promise<void> {
	if (record.collection === "app.refrakt.photo") {
		await uploadPhotoSource(client, record, files)
	}
	await ok(
		client.call(ComAtprotoRepoPutRecord, {
			input: {
				repo,
				collection: parse(nsidString(), record.collection),
				rkey: record.rkey,
				record: record.record,
			},
			signal: AbortSignal.timeout(10_000),
		}),
	)
}

async function uploadPhotoSource(
	client: Client,
	record: PlannedRecord,
	files: Map<string, string>,
): Promise<void> {
	const {source} = parse(photoSourceSchema, record.record)
	const path = files.get(parseCid(source.ref.$link).digest.contents.toHex())
	if (!path) {
		throw new Error(
			`No local export for ${record.label}. Run pnpm content photos sync.`,
		)
	}
	const {blob: uploaded} = await ok(
		client.call(ComAtprotoRepoUploadBlob, {
			input: new Blob([await readFile(path)], {type: source.mimeType}),
			signal: AbortSignal.timeout(60_000),
		}),
	)
	if (uploaded.ref.$link !== source.ref.$link) {
		throw new Error(
			`${path} changed after the last sync. Run pnpm content photos sync.`,
		)
	}
}
