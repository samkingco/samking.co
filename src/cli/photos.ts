import {log, taskLog} from "@clack/prompts"
import {backupPhotoDatabase} from "../repos/photos/backup.ts"
import {openPhotoDatabase} from "../repos/photos/database.ts"
import {emptyPhotoTrash} from "../repos/photos/empty-trash.ts"
import {
	createR2Client,
	isR2ConnectionError,
	loadR2Config,
} from "../repos/photos/r2.ts"
import {
	regenerateOpenGraphImages,
	syncPhotos,
	uploadPhotos,
} from "../repos/photos/sync.ts"

export async function syncPhotosCommand(): Promise<void> {
	const task = taskLog({title: "Sync local photos", limit: 5, retainLog: true})
	let missingExports: string[]
	try {
		const result = await syncPhotos(task.message)
		missingExports = result.missingExports
		task.success(`Synced ${result.synced} photos to the local catalog`)
	} catch (error) {
		task.error("Local sync failed")
		throw error
	}
	try {
		await uploadPhotoChanges({backupCatalog: true})
	} finally {
		if (missingExports.length > 0) {
			log.warn(
				`Missing exports — export these files, then run sync again:\n${missingExports.join("\n")}`,
			)
		}
	}
}

export async function backupPhotoCatalogCommand(): Promise<void> {
	const task = taskLog({
		title: "Back up photo catalog",
		limit: 5,
		retainLog: true,
	})
	try {
		const config = loadR2Config()
		const database = openPhotoDatabase()
		using _ = database.$client
		const client = createR2Client(config)
		try {
			const key = await backupPhotoDatabase(database, client, config)
			task.success(`Saved catalog backup to R2: ${key}`)
		} finally {
			client.destroy()
		}
	} catch (error) {
		task.error("Catalog backup failed; local changes are saved")
		throw error
	}
}

export async function regenerateOpenGraphImagesCommand(): Promise<void> {
	const task = taskLog({
		title: "Regenerate OG images",
		limit: 5,
		retainLog: true,
	})
	try {
		const count = await regenerateOpenGraphImages(task.message)
		task.success(`Regenerated ${count} OG images`)
	} catch (error) {
		task.error("OG regeneration failed")
		throw error
	}
	await uploadPhotoChanges({backupCatalog: false})
}

async function uploadPhotoChanges(options: {
	backupCatalog: boolean
}): Promise<void> {
	const task = taskLog({title: "Sync photos to R2", limit: 5, retainLog: true})
	try {
		const uploaded = await uploadPhotos(task.message, options)
		if (uploaded) {
			task.success("R2 sync complete")
		} else {
			task.success(
				"R2 sync skipped: not configured; remote work remains pending",
			)
		}
	} catch (error) {
		if (isR2ConnectionError(error)) {
			task.success("R2 sync deferred")
			log.warn(
				"Could not connect to R2; remote work remains pending. Run sync again when connected.",
			)
			return
		}
		task.error("R2 sync failed; local changes are saved")
		throw error
	}
}

export async function emptyPhotoTrashCommand(): Promise<void> {
	const task = taskLog({title: "Empty photo trash", limit: 5, retainLog: true})
	try {
		const result = await emptyPhotoTrash(task.message)
		task.success(
			result.derivatives === 0 && result.exports === 0
				? "Trash is empty"
				: `Emptied trash: removed ${result.derivatives} derivative files and ${result.exports} export records.`,
		)
	} catch (error) {
		task.error("Empty trash failed")
		throw error
	}
}
