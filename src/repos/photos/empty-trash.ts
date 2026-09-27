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
import {
	createR2Client,
	deleteR2File,
	loadR2Config,
	type R2Config,
} from "./r2.ts"

type DerivativeTrashRow = ReturnType<typeof derivativeTrashRows>[number]
type ExportTrashRow = ReturnType<typeof exportTrashRows>[number]

export async function emptyPhotoTrash(
	progress: (message: string) => void = () => {},
): Promise<{derivatives: number; exports: number}> {
	const database = openPhotoDatabase()
	let r2: S3Client | null = null

	try {
		const derivatives = derivativeTrashRows(database)
		const exports = exportTrashRows(database)

		if (derivatives.length === 0 && exports.length === 0) {
			return {derivatives: 0, exports: 0}
		}

		const hasRemoteFiles = derivatives.some((row) => row.uploadedAt !== null)
		const config = hasRemoteFiles ? loadR2Config() : null
		r2 = config ? createR2Client(config) : null

		progress("Removing derivative files")
		await emptyDerivatives(database, {r2, config}, derivatives, progress)
		progress(`Removed ${derivatives.length} derivative files`)
		progress("Removing exports")
		await emptyExports(database, exports, progress)
		progress(`Removed ${exports.length} export records`)

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

		return {derivatives: derivatives.length, exports: exports.length}
	} finally {
		database.$client.close()
		r2?.destroy()
	}
}

function derivativeTrashRows(database: PhotoDatabase) {
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

function exportTrashRows(database: PhotoDatabase) {
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
	remote: {r2: S3Client | null; config: R2Config | null},
	rows: DerivativeTrashRow[],
	progress: (message: string) => void,
): Promise<void> {
	for (const [index, row] of rows.entries()) {
		progress(`${index + 1}/${rows.length} ${row.r2Key}`)
		await deleteRemoteDerivative(row, remote.r2, remote.config)
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
	progress: (message: string) => void,
): Promise<void> {
	for (const [index, row] of rows.entries()) {
		progress(`${index + 1}/${rows.length} ${row.filename}`)
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
