import {
	type CommonOptions,
	isCancel,
	log,
	multiline,
	multiselect,
	select,
	taskLog,
} from "@clack/prompts"
import {
	type AltTextPhoto,
	generateAltText,
	readAltTextPhotos,
	saveAltText,
} from "../repos/photos/alt-text.ts"
import {
	openPhotoDatabase,
	type PhotoDatabase,
} from "../repos/photos/database.ts"
import {menu} from "./menu.ts"

export async function generateAltTextCommand(ids?: string[]): Promise<void> {
	const database = openPhotoDatabase()
	using _ = database.$client
	const task = taskLog({
		title: "Generate photo alt text",
		limit: 5,
		retainLog: true,
	})
	try {
		const count = await generateAltText(database, ids, task.message)
		task.success(
			count
				? `Saved alt text for ${count} photos`
				: "No photos need alt text generation",
		)
	} catch (error) {
		task.error("Generation stopped; completed photos are saved")
		throw error
	}
}

export async function manageAltText(): Promise<void> {
	if (!process.stdin.isTTY) {
		throw new Error(
			"Use a terminal to manage alt text, or run: pnpm content photos alt generate",
		)
	}
	await menu("Alt text", [
		{
			label: "Generate missing or changed text",
			run: () => generateAltTextCommand(),
		},
		{
			label: "Review generated text",
			run: async () => {
				const database = openPhotoDatabase()
				using _ = database.$client
				await reviewGeneratedAltText(database)
			},
		},
		{label: "Review / edit text", run: () => selectAltText(false)},
		{label: "Regenerate selected photos", run: () => selectAltText(true)},
	])
}

export async function reviewGeneratedAltText(
	database: PhotoDatabase,
	options: CommonOptions = {},
): Promise<void> {
	const queue = readAltTextPhotos(database).filter(
		(photo) =>
			!photo.metadata.alt &&
			photo.altTextStatus === "generated" &&
			photo.altText?.trim(),
	)
	if (queue.length === 0) {
		log.info("No generated alt text to review.", options)
		return
	}
	for (const [index, photo] of queue.entries()) {
		showPhotoContext(photo, options)
		log.info(`Alt text: ${photo.altText}`, options)
		const action = await select({
			...options,
			message: `${index + 1}/${queue.length} — ${photo.captureOneVariantName}`,
			options: [
				{value: "approve", label: "Approve"},
				{value: "edit", label: "Edit"},
				{value: "skip", label: "Skip"},
			],
		})
		if (isCancel(action)) {
			return
		}
		if (action === "skip") {
			continue
		}
		const text =
			action === "edit" ? await editAltText(photo, options) : photo.altText!
		if (isCancel(text)) {
			return
		}
		saveAltText(database, photo, text)
	}
	log.success("Review complete. Skipped text stays generated.", options)
}

async function selectAltText(regenerate: boolean): Promise<void> {
	const database = openPhotoDatabase()
	using _ = database.$client
	const choices = readAltTextPhotos(database).filter(
		(photo) =>
			!photo.metadata.alt &&
			(!regenerate ||
				!photo.altTextStatus ||
				photo.altTextStatus === "generated"),
	)
	if (choices.length === 0) {
		log.info("No eligible photos. IPTC alt text is managed in the source file.")
		return
	}
	const selected = await multiselect({
		message: regenerate
			? "Select photos to regenerate"
			: "Select photos to review or edit",
		required: false,
		maxItems: 20,
		options: choices.map((photo) => ({
			value: photo,
			label: `${photo.captureOneVariantName} — ${photo.metadata.title ?? photo.metadata.headline ?? photo.id}`,
			hint: photo.altTextStatus ?? "missing",
		})),
	})
	if (isCancel(selected) || selected.length === 0) {
		return
	}
	if (regenerate) {
		await generateAltTextCommand(selected.map(({id}) => id))
		return
	}
	for (const photo of selected) {
		const text = await editAltText(photo)
		if (isCancel(text)) {
			return
		}
		saveAltText(database, photo, text)
	}
}

function showPhotoContext(photo: AltTextPhoto, options: CommonOptions = {}) {
	log.info(
		[
			`http://localhost:4321/photos/${photo.id}/`,
			`Title: ${photo.metadata.title ?? photo.metadata.headline ?? "—"}`,
			`Description: ${photo.metadata.caption ?? "—"}`,
		].join("\n"),
		options,
	)
}

function editAltText(photo: AltTextPhoto, options: CommonOptions = {}) {
	showPhotoContext(photo, options)
	return multiline({
		...options,
		message:
			"Submit to save and approve, or press Escape to leave without saving",
		initialValue: photo.altText ?? "",
		showSubmit: true,
		validate: (value = "") =>
			!value.trim() || value.trim().length > 1000
				? "Enter 1–1000 characters"
				: undefined,
	})
}
