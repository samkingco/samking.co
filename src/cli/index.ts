import {isCancel, select} from "@clack/prompts"
import {Command} from "commander"
import {manageAtproto, runBlueskyPlan, runRefraktPlan} from "./atproto.ts"
import {editCollectionDescriptions} from "./collections.ts"
import {editEquipment} from "./equipment.ts"
import {createNote} from "./notes.ts"
import {
	emptyPhotoTrashCommand,
	regenerateOpenGraphImagesCommand,
	syncPhotosCommand,
} from "./photos.ts"
import {createPost} from "./posts.ts"
import {manageRoots} from "./roots.ts"

const program = new Command()
	.name("content")
	.description("Manage content")
	.showHelpAfterError()
	.action(async () => {
		if (!process.stdin.isTTY) {
			program.outputHelp()
			process.exitCode = 1
			return
		}
		const args = await select({
			message: "Content",
			options: [
				{label: "New note", value: ["note"]},
				{label: "New post", value: ["journal"]},
				{label: "Manage photos", value: ["photos"]},
				{
					label: "Manage AT Protocol",
					value: ["atproto"],
				},
			],
		})
		if (isCancel(args)) {
			return
		}
		await program.parseAsync(args, {from: "user"})
	})

program
	.command("note")
	.description("New note")
	.argument("[text]", "Note text")
	.option("--stdin", "Read text from stdin")
	.action(createNote)

program
	.command("journal")
	.description("New post")
	.argument("[title]", "Post title")
	.option("--excerpt <text>", "Post excerpt", "")
	.action(createPost)

const photos = program
	.command("photos")
	.description("Manage photos")
	.action(async () => {
		if (!process.stdin.isTTY) {
			photos.outputHelp()
			process.exitCode = 1
			return
		}
		const selectedCommand = await select({
			message: "Photos",
			options: photos.commands.map((command) => ({
				label: command.description(),
				value: command.name(),
			})),
		})
		if (isCancel(selectedCommand)) {
			return
		}
		await program.parseAsync(["photos", selectedCommand], {from: "user"})
	})

photos.command("sync").description("Sync photos").action(syncPhotosCommand)
photos
	.command("regenerate-og")
	.description("Regenerate OG images")
	.action(regenerateOpenGraphImagesCommand)
photos.command("roots").description("Manage C1 roots").action(manageRoots)
photos
	.command("collections")
	.description("Edit collection descriptions")
	.action(editCollectionDescriptions)
photos.command("equipment").description("Edit equipment").action(editEquipment)
photos
	.command("empty-trash")
	.description("Empty photo trash")
	.action(emptyPhotoTrashCommand)

const atproto = program
	.command("atproto")
	.description("Manage AT Protocol records")
	.action(async () => {
		if (!process.stdin.isTTY) {
			atproto.outputHelp()
			process.exitCode = 1
			return
		}
		await manageAtproto()
	})

const plan = atproto.command("plan").description("Preview record changes")
plan
	.command("bluesky")
	.description("Plan Bluesky notes")
	.option("--json", "Print plan as JSON")
	.action(runBlueskyPlan)
plan
	.command("refrakt")
	.description("Plan Refrakt photos")
	.option("--json", "Print plan as JSON")
	.action(runRefraktPlan)

try {
	await program.parseAsync()
} catch (error) {
	console.error(`Error: ${errorMessage(error)}`)
	process.exitCode = 1
}

function errorMessage(error: unknown): string {
	if (!(error instanceof Error)) {
		return String(error)
	}
	if (error.name === "DrizzleQueryError" && error.cause instanceof Error) {
		return errorMessage(error.cause)
	}
	return error.message
}
