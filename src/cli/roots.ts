import {isCancel, select} from "@clack/prompts"
import type {CaptureOneCollection} from "../repos/photos/capture-one.ts"
import {openPhotoDatabase} from "../repos/photos/database.ts"
import {addRoot, loadRoots, removeRoot} from "../repos/photos/roots.ts"

export async function manageRoots(): Promise<void> {
	const database = openPhotoDatabase()
	using _ = database.$client
	const startedAt = Date.now()
	console.log("Reading Capture One roots...")
	const snapshot = await loadRoots(database)
	console.log(
		`Read ${snapshot.collections.length} roots in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`,
	)
	const {added} = snapshot
	const action = await select({
		message: "C1 roots",
		options: [
			{label: "Add root", value: "add"},
			{label: "Remove root", value: "remove"},
			{label: "List roots", value: "list"},
			{label: "Back", value: "back"},
		],
	})
	if (isCancel(action) || action === "back") {
		return
	}
	if (action === "list") {
		printCollections(snapshot.collections, added)
		return
	}
	const candidates = snapshot.collections.filter(
		(collection) => added.has(collection.id) !== (action === "add"),
	)
	if (candidates.length === 0) {
		console.log(`No roots available to ${action}.`)
		return
	}
	const collectionId = await select({
		message: `Select a root to ${action}`,
		maxItems: 20,
		options: [
			...candidates.map((collection) => ({
				label: collectionLabel(collection, snapshot.collections),
				value: collection.id,
			})),
			{label: "Back", value: ""},
		],
	})
	if (isCancel(collectionId) || !collectionId) {
		return
	}
	if (action === "add") {
		const collection = addRoot(database, snapshot, collectionId)
		console.log(`Added ${collection.name} (${collection.id})`)
	} else {
		removeRoot(database, collectionId)
	}
}

function printCollections(
	items: CaptureOneCollection[],
	added: Set<string>,
): void {
	for (const collection of items) {
		console.log(
			`${added.has(collection.id) ? "[added]    " : "[not added]"} ${collectionLabel(collection, items)}`,
		)
	}
}

function collectionLabel(
	collection: CaptureOneCollection,
	items: CaptureOneCollection[],
): string {
	const names = [collection.name]
	let parentId = collection.parentId
	while (true) {
		const parent = items.find(({id}) => id === parentId)
		if (!parent) {
			break
		}
		names.unshift(parent.name)
		parentId = parent.parentId
	}
	return `${names.join(" / ")} [${collection.kind}] ${collection.id}`
}
