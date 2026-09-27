import {asc, eq} from "drizzle-orm"
import {collections} from "./database-schema.ts"
import type {PhotoDatabase} from "./database.ts"

export function readCollections(database: PhotoDatabase) {
	return database
		.select()
		.from(collections)
		.orderBy(asc(collections.parentId), asc(collections.position))
		.all()
}

export function saveCollectionDescription(
	database: PhotoDatabase,
	id: string,
	description: string,
): void {
	database
		.update(collections)
		.set({description})
		.where(eq(collections.id, id))
		.run()
}
