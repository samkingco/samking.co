import {readNotes} from "../repos/notes.ts"
import {readRefraktCatalog} from "../repos/photos/catalog.ts"
import {openReadonlyPhotoDatabase} from "../repos/photos/database.ts"
import type {siteConfig} from "../site.config.ts"
import {journalPath} from "../utils/journal-path.ts"
import {noteToBlueskyRecord} from "./bluesky.ts"
import {readRemoteRecords} from "./pds.ts"
import {
	compareRecords,
	createPlannedRecord,
	type PlannedRecord,
} from "./records.ts"
import {createRefraktRecords, REFRAKT_COLLECTIONS} from "./refrakt.ts"

export async function planRefrakt(
	did: string,
	config: typeof siteConfig.atproto.refrakt,
) {
	const database = openReadonlyPhotoDatabase()
	let catalog: ReturnType<typeof readRefraktCatalog>
	try {
		catalog = readRefraktCatalog(database, config)
	} finally {
		database.$client.close()
	}
	const desired = await createRefraktRecords({did, catalog})
	const {endpoint, records} = await readRemoteRecords(did, REFRAKT_COLLECTIONS)
	return {
		destination: "refrakt" as const,
		did,
		root: config.rootCollectionId,
		profile: config.exportProfile,
		endpoint,
		plan: compareRecords(desired, records),
	}
}

export async function planBluesky(did: string, siteUrl: URL) {
	const notes = await readNotes()
	const desired: PlannedRecord[] = []
	for (const note of notes) {
		const noteUrl = new URL(
			journalPath({collection: "notes", id: note.tid}),
			siteUrl,
		)
		try {
			desired.push(
				await createPlannedRecord({
					did,
					collection: "app.bsky.feed.post",
					rkey: note.tid,
					label: note.text.replace(/\s+/g, " ").slice(0, 100),
					record: noteToBlueskyRecord(note, noteUrl),
				}),
			)
		} catch (cause) {
			throw new Error(
				`Cannot convert ${note.path}: ${cause instanceof Error ? cause.message : String(cause)}`,
				{cause},
			)
		}
	}
	const {endpoint, records} = await readRemoteRecords(did, [
		"app.bsky.feed.post",
	])
	return {
		destination: "bluesky" as const,
		did,
		endpoint,
		plan: compareRecords(desired, records),
	}
}
