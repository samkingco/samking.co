import {rm} from "node:fs/promises"
import type {S3Client} from "@aws-sdk/client-s3"
import {and, asc, eq, isNotNull, notExists} from "drizzle-orm"
import {
	collectionPhotos,
	photoDerivatives,
	photoExports,
	photos,
} from "./database-schema.ts"
import {openPhotoDatabase, type PhotoDatabase} from "./database.ts"
import {hashFile} from "./file-hash.ts"
import {createR2Client, deleteR2File, loadR2Config} from "./r2.ts"
import type {R2Config} from "./schema.ts"

type DerivativeTrashRow = Pick<
	typeof photoDerivatives.$inferSelect,
	"id" | "path" | "r2Key" | "uploadedAt"
>
type ExportTrashRow = Pick<
	typeof photoExports.$inferSelect,
	"id" | "filename" | "sourcePath" | "sha256"
>

export async function emptyPhotoTrash(): Promise<void> {
	const database = openPhotoDatabase()
	let r2: S3Client | null = null

	try {
		const derivatives = derivativeTrashRows(database)
		const exports = exportTrashRows(database)

		if (derivatives.length === 0 && exports.length === 0) {
			console.log("Trash is empty.")
			return
		}

		console.log(
			`Emptying ${derivatives.length} derivative files and ${exports.length} export records...`,
		)

		const hasRemoteFiles = derivatives.some((row) => row.uploadedAt !== null)
		const config = hasRemoteFiles ? loadR2Config() : null
		r2 = config ? createR2Client(config) : null

		await emptyDerivatives(database, r2, config, derivatives)
		await emptyExports(database, exports)

		database
			.delete(photos)
			.where(
				and(
					eq(photos.status, "deleted"),
					notExists(
						database
							.select({id: photoExports.id})
							.from(photoExports)
							.where(eq(photoExports.photoId, photos.id)),
					),
					notExists(
						database
							.select({photoId: collectionPhotos.photoId})
							.from(collectionPhotos)
							.where(eq(collectionPhotos.photoId, photos.id)),
					),
				),
			)
			.run()

		console.log(
			`Emptied trash: removed ${derivatives.length} derivative files and ${exports.length} export records.`,
		)
	} finally {
		database.$client.close()
		r2?.destroy()
	}
}

function derivativeTrashRows(database: PhotoDatabase): DerivativeTrashRow[] {
	return database
		.select({
			id: photoDerivatives.id,
			path: photoDerivatives.path,
			r2Key: photoDerivatives.r2Key,
			uploadedAt: photoDerivatives.uploadedAt,
		})
		.from(photoDerivatives)
		.where(isNotNull(photoDerivatives.deletedAt))
		.orderBy(asc(photoDerivatives.deletedAt))
		.all()
}

function exportTrashRows(database: PhotoDatabase): ExportTrashRow[] {
	return database
		.select({
			id: photoExports.id,
			filename: photoExports.filename,
			sourcePath: photoExports.sourcePath,
			sha256: photoExports.sha256,
		})
		.from(photoExports)
		.where(isNotNull(photoExports.deletedAt))
		.orderBy(asc(photoExports.deletedAt))
		.all()
}

async function emptyDerivatives(
	database: PhotoDatabase,
	r2: S3Client | null,
	config: R2Config | null,
	rows: DerivativeTrashRow[],
): Promise<void> {
	for (const [index, row] of rows.entries()) {
		console.log(`Deleting derivative ${index + 1}/${rows.length}: ${row.r2Key}`)
		await deleteRemoteDerivative(row, r2, config)
		await rm(row.path, {force: true})
		database
			.delete(photoDerivatives)
			.where(eq(photoDerivatives.id, row.id))
			.run()
	}
}

async function deleteRemoteDerivative(
	row: DerivativeTrashRow,
	r2: S3Client | null,
	config: R2Config | null,
): Promise<void> {
	if (row.uploadedAt === null) {
		return
	}

	if (!r2 || !config) {
		throw new Error("R2 credentials are required to delete uploaded files")
	}

	await deleteR2File(r2, config, row.r2Key)
}

async function emptyExports(
	database: PhotoDatabase,
	rows: ExportTrashRow[],
): Promise<void> {
	for (const [index, row] of rows.entries()) {
		console.log(`Removing export ${index + 1}/${rows.length}: ${row.filename}`)
		database.delete(photoExports).where(eq(photoExports.id, row.id)).run()
		await removeMatchingSource(row)
	}
}

async function removeMatchingSource(row: ExportTrashRow): Promise<void> {
	try {
		if ((await hashFile(row.sourcePath)) === row.sha256) {
			await rm(row.sourcePath)
		}
	} catch {
		// The source export was already removed or replaced.
	}
}
