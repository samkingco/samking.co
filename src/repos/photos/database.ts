import {createHash} from "node:crypto"
import {mkdirSync} from "node:fs"
import {dirname} from "node:path"
import {DatabaseSync} from "node:sqlite"
import {eq} from "drizzle-orm"
import {drizzle} from "drizzle-orm/node-sqlite"
import {catalog} from "./database-schema.ts"

export const PHOTO_DATABASE_PATH =
	process.env.PHOTO_DATABASE_PATH ?? "photos/catalog.sqlite"

export function openPhotoDatabase(path = PHOTO_DATABASE_PATH) {
	mkdirSync(dirname(path), {recursive: true})
	const client = new DatabaseSync(path)
	client.exec(`
		PRAGMA journal_mode = WAL;
		PRAGMA synchronous = NORMAL;
		PRAGMA foreign_keys = ON;
		PRAGMA busy_timeout = 5000;
	`)
	return drizzle({client})
}

export function openReadonlyPhotoDatabase(path = PHOTO_DATABASE_PATH) {
	const client = new DatabaseSync(path, {readOnly: true})
	client.exec(
		"PRAGMA query_only = ON; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000",
	)
	return drizzle({client})
}

export type PhotoDatabase = ReturnType<typeof openPhotoDatabase>

export function checkDocument(
	database: PhotoDatabase,
	documentId: string,
): void {
	const row = database.select().from(catalog).where(eq(catalog.id, 1)).get()
	if (row && row.documentId !== documentId) {
		throw new Error(
			"The photo catalog belongs to a different Capture One document",
		)
	}
}

export function bindDocument(
	database: PhotoDatabase,
	documentId: string,
): void {
	checkDocument(database, documentId)
	database
		.insert(catalog)
		.values({
			id: 1,
			documentId,
			syncedAt: new Date().toISOString(),
		})
		.onConflictDoNothing()
		.run()
}

export function photoIdForVariant(variantId: string): string {
	return createHash("sha256")
		.update("capture-one-variant\0")
		.update(variantId)
		.digest("hex")
		.slice(0, 12)
}
