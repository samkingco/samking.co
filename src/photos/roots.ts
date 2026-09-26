import {select} from "@inquirer/prompts"
import {asc, eq} from "drizzle-orm"
import {readCaptureOneRoots} from "./capture-one.ts"
import {catalog, collectionRoots, collections} from "./database-schema.ts"
import {openPhotoDatabase, type PhotoDatabase} from "./database.ts"
import type {CaptureOneCollection} from "./schema.ts"

export function configuredRootIds(): string[] {
	const database = openPhotoDatabase()
	try {
		return database
			.select({collectionId: collectionRoots.collectionId})
			.from(collectionRoots)
			.orderBy(asc(collectionRoots.addedAt))
			.all()
			.map(({collectionId}) => collectionId)
	} finally {
		database.$client.close()
	}
}

export async function manageRoots(): Promise<void> {
	const startedAt = Date.now()
	console.log("Reading Capture One roots...")

	const snapshot = await readCaptureOneRoots()
	console.log(
		`Read ${snapshot.collections.length} roots in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`,
	)

	const database = openPhotoDatabase()
	try {
		bindDocument(database, snapshot.documentId)

		const added = new Set(
			database
				.select({collectionId: collectionRoots.collectionId})
				.from(collectionRoots)
				.all()
				.map(({collectionId}) => collectionId),
		)

		const action = await select({
			message: "Manage Capture One roots",
			choices: [
				{name: "Add root", value: "add"},
				{name: "Remove root", value: "remove"},
				{name: "List roots and IDs", value: "list"},
				{name: "Back", value: "back"},
			],
		})

		if (action === "back") {
			return
		}

		if (action === "list") {
			printCollections(snapshot.collections, added)
			return
		}

		const candidates = snapshot.collections.filter((collection) =>
			action === "add" ? !added.has(collection.id) : added.has(collection.id),
		)
		if (candidates.length === 0) {
			console.log(
				action === "add"
					? "All roots are already added."
					: "No roots are added.",
			)
			return
		}

		const collectionId = await select({
			message: action === "add" ? "Add which root?" : "Remove which root?",
			pageSize: 20,
			choices: [
				...candidates.map((collection) => ({
					name: collectionLabel(collection, snapshot.collections),
					value: collection.id,
				})),
				{name: "Back", value: ""},
			],
		})
		if (!collectionId) {
			return
		}

		if (action === "add") {
			addRoot(database, snapshot.collections, collectionId)
		} else {
			database
				.delete(collectionRoots)
				.where(eq(collectionRoots.collectionId, collectionId))
				.run()
		}
	} finally {
		database.$client.close()
	}
}

function addRoot(
	database: PhotoDatabase,
	captureOneCollections: CaptureOneCollection[],
	collectionId: string,
): void {
	const collection = captureOneCollections.find(({id}) => id === collectionId)
	if (!collection) {
		throw new Error(`Capture One root ${collectionId} was not found`)
	}

	const now = new Date().toISOString()

	database
		.insert(collections)
		.values({
			id: collection.id,
			parentId: collection.parentId,
			name: collection.name,
			kind: collection.kind,
			position: collection.index,
			sortOrder: collection.sort,
			reversed: collection.reversed,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: collections.id,
			set: {
				parentId: collection.parentId,
				name: collection.name,
				kind: collection.kind,
				position: collection.index,
				sortOrder: collection.sort,
				reversed: collection.reversed,
				updatedAt: now,
			},
		})
		.run()

	database
		.insert(collectionRoots)
		.values({collectionId: collection.id, addedAt: now})
		.onConflictDoNothing()
		.run()

	console.log(`Added ${collection.name} (${collection.id})`)
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

function bindDocument(database: PhotoDatabase, documentId: string): void {
	const row = database
		.select({documentId: catalog.documentId})
		.from(catalog)
		.where(eq(catalog.id, 1))
		.get()

	if (!row) {
		database
			.insert(catalog)
			.values({
				id: 1,
				documentId,
				syncedAt: new Date().toISOString(),
			})
			.run()
		return
	}

	if (row.documentId !== documentId) {
		throw new Error(
			"The photo catalog belongs to a different Capture One document",
		)
	}
}
