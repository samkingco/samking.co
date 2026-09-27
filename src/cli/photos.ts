import {taskLog} from "@clack/prompts"
import {emptyPhotoTrash} from "../repos/photos/empty-trash.ts"
import {regenerateOpenGraphImages, syncPhotos} from "../repos/photos/sync.ts"

export async function syncPhotosCommand(): Promise<void> {
	const task = taskLog({title: "Sync photos", limit: 5, retainLog: true})
	try {
		const count = await syncPhotos(task.message)
		task.success(`Synced ${count} photos to the local catalog`)
	} catch (error) {
		task.error("Sync failed")
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
