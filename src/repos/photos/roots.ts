import {asc, eq} from "drizzle-orm"
import {type CaptureOneSnapshot, readCaptureOneRoots} from "./capture-one.ts"
import {collectionRoots, collections} from "./database-schema.ts"
import {bindDocument, checkDocument, type PhotoDatabase} from "./database.ts"

export function configuredRootIds(database: PhotoDatabase): string[] {
	return database
		.select({collectionId: collectionRoots.collectionId})
		.from(collectionRoots)
		.orderBy(asc(collectionRoots.addedAt))
		.all()
		.map(({collectionId}) => collectionId)
}

export async function loadRoots(database: PhotoDatabase) {
	const snapshot = await readCaptureOneRoots()
	checkDocument(database, snapshot.documentId)
	return {...snapshot, added: new Set(configuredRootIds(database))}
}

export function addRoot(
	database: PhotoDatabase,
	snapshot: CaptureOneSnapshot,
	collectionId: string,
) {
	const collection = snapshot.collections.find(({id}) => id === collectionId)
	if (!collection) {
		throw new Error(`Capture One root ${collectionId} was not found`)
	}
	return database.transaction(() => {
		bindDocument(database, snapshot.documentId)
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
		return collection
	})
}

export function removeRoot(
	database: PhotoDatabase,
	collectionId: string,
): void {
	database
		.delete(collectionRoots)
		.where(eq(collectionRoots.collectionId, collectionId))
		.run()
}
