import {isCancel, log, note, taskLog} from "@clack/prompts"
import {openPhotoDatabase} from "../repos/photos/database.ts"
import {loadRoots, saveRoots} from "../repos/photos/roots.ts"
import {selectCollections} from "./collection-tree.ts"

export async function setupPhotos(): Promise<void> {
	if (!process.stdin.isTTY) {
		throw new Error("Choose collections to sync in an interactive terminal.")
	}
	const database = openPhotoDatabase()
	using _ = database.$client
	const task = taskLog({title: "Read Capture One collections"})
	let snapshot: Awaited<ReturnType<typeof loadRoots>>
	try {
		snapshot = await loadRoots(database)
		task.success(`Read ${snapshot.collections.length} collections`)
	} catch (error) {
		task.error("Could not read Capture One collections")
		throw error
	}
	if (snapshot.collections.length === 0) {
		log.info("No Capture One collections found.")
		return
	}
	note(
		"Selecting a collection includes everything below it, including future collections.\n■ selected · ✓ included by a parent · - contains a selection · □ not selected\nChanges are read when you run sync. Scripts and apps can read the local catalog.",
		"Sync scope",
	)
	const selected = await selectCollections(snapshot.collections, snapshot.added)
	if (isCancel(selected) || !selected) {
		return
	}
	saveRoots(database, snapshot, selected)
	log.success(
		"Collection selection saved. Run sync to update the local catalog.",
	)
}
