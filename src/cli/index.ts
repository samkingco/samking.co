import type {Key} from "node:readline"
import {MULTISELECT_INSTRUCTIONS, SELECT_INSTRUCTIONS} from "@clack/prompts"
import {Command, InvalidArgumentError} from "commander"
import {generateAltTextCommand, manageAltText} from "./alt-text.ts"
import {
	manageAtproto,
	runBlueskyPlan,
	runBlueskyPublish,
	runRefraktPlan,
	runRefraktPublish,
} from "./atproto.ts"
import {editCollectionDescriptions} from "./collections.ts"
import {editEquipment} from "./equipment.ts"
import {errorMessage, menu} from "./menu.ts"
import {createNote} from "./notes.ts"
import {
	backupPhotoCatalogCommand,
	emptyPhotoTrashCommand,
	regenerateOpenGraphImagesCommand,
	syncPhotosCommand,
} from "./photos.ts"
import {createPost, sharePosts} from "./posts.ts"
import {setupPhotos} from "./setup.ts"

SELECT_INSTRUCTIONS.push("Esc: back", "Ctrl+C: exit")
MULTISELECT_INSTRUCTIONS.push("Esc: back", "Ctrl+C: exit")

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
		await menu(
			"Content",
			[
				{label: "New note", run: () => createNote(undefined, {})},
				{label: "New post", run: () => createPost(undefined, {excerpt: ""})},
				{label: "Manage photos", run: managePhotos},
				{label: "Manage AT Protocol", run: manageAtproto},
			],
			{root: true},
		)
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
	.action(managePhotos)

const photoActions = [
	{name: "sync", label: "Sync photos", run: syncPhotosCommand},
	{name: "alt", label: "Alt text", run: manageAltText},
	{
		name: "collections",
		label: "Edit collection descriptions",
		run: editCollectionDescriptions,
	},
	{name: "equipment", label: "Edit equipment", run: editEquipment},
	{name: "backup", label: "Backup catalog", run: backupPhotoCatalogCommand},
	{
		name: "empty-trash",
		label: "Empty photo trash",
		run: emptyPhotoTrashCommand,
	},
	{
		name: "regenerate-og",
		label: "Regenerate OG images",
		run: regenerateOpenGraphImagesCommand,
	},
	{name: "setup", label: "Choose collections to sync", run: setupPhotos},
]
for (const {name, label, run} of photoActions) {
	const command = photos.command(name).description(label).action(run)
	if (name === "alt") {
		command
			.command("generate")
			.description("Generate missing or changed alt text")
			.action(() => generateAltTextCommand())
	}
}

async function managePhotos(): Promise<void> {
	if (!process.stdin.isTTY) {
		photos.outputHelp()
		process.exitCode = 1
		return
	}
	await menu("Photos", photoActions)
}

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

atproto
	.command("share")
	.description("Share posts to Bluesky")
	.action(sharePosts)

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
	.option("--localnet", "Plan against sam.test on Refrakt's localnet")
	.action(runRefraktPlan)

const publish = atproto.command("publish").description("Publish record changes")
publish
	.command("bluesky")
	.description("Publish Bluesky notes")
	.option("--yes", "Publish without an interactive confirmation")
	.action(runBlueskyPublish)
publish
	.command("refrakt")
	.description("Publish Refrakt photos")
	.option("--localnet", "Publish to sam.test on Refrakt's localnet")
	.option("--limit <count>", "Publish only the first <count> photos", count)
	.option("--yes", "Publish without an interactive confirmation")
	.action(runRefraktPublish)

function count(value: string): number {
	const parsed = Number(value)
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new InvalidArgumentError("Expected a positive whole number.")
	}
	return parsed
}

// Let Clack restore the terminal before exiting; Escape only leaves one prompt.
function exitOnInterrupt(_value: string, key: Key): void {
	if (key.ctrl && key.name === "c") {
		queueMicrotask(() => process.exit(130))
	}
}

process.stdin.on("keypress", exitOnInterrupt)
try {
	await program.parseAsync()
} catch (error) {
	console.error(`Error: ${errorMessage(error)}`)
	process.exitCode = 1
} finally {
	process.stdin.off("keypress", exitOnInterrupt)
	if (process.stdin.isTTY) {
		process.stdin.pause()
		process.stdin.unref()
	}
}
