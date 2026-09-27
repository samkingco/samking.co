import {log, taskLog} from "@clack/prompts"
import {emptyPhotoTrash} from "../repos/photos/empty-trash.ts"
import {isR2ConnectionError} from "../repos/photos/r2.ts"
import {
	regenerateOpenGraphImages,
	syncPhotos,
	uploadPhotos,
} from "../repos/photos/sync.ts"

export async function syncPhotosCommand(): Promise<void> {
	const task = taskLog({title: "Sync local photos", limit: 5, retainLog: true})
	try {
		const count = await syncPhotos(task.message)
		task.success(`Synced ${count} photos to the local catalog`)
	} catch (error) {
		task.error("Local sync failed")
		throw error
	}
	await uploadPhotoChanges({backupCatalog: true})
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
