import {select} from "@inquirer/prompts"
import {Command} from "commander"
import {editCollectionDescriptions} from "./collections.ts"
import {emptyPhotoTrash} from "./empty-trash.ts"
import {planRefrakt} from "./refrakt.ts"
import {manageRoots} from "./roots.ts"
import {regenerateOpenGraphImages, syncPhotos} from "./sync.ts"

const program = new Command()
	.name("photos")
	.description("Sync and manage the photo catalog")
	.showHelpAfterError()

program
	.command("sync")
	.description("Sync configured Capture One roots")
	.action(() => runTimed("Sync", syncPhotos))
program
	.command("regenerate-og")
	.description("Regenerate website Open Graph images")
	.action(() => runTimed("Open Graph regeneration", regenerateOpenGraphImages))
program
	.command("roots")
	.description("Add, remove, or list Capture One roots")
	.action(manageRoots)

const refrakt = program.command("refrakt").description("Plan Refrakt records")
refrakt
	.command("plan")
	.description("Compare a catalog root with records on the PDS")
	.option("--json", "Print the complete plan as JSON")
	.action((options: {json: boolean}) =>
		runTimed(
			"Refrakt plan",
			() => planRefrakt(options),
			options.json ? console.error : console.log,
		),
	)

program
	.command("collections")
	.description("Edit collection descriptions")
	.action(editCollectionDescriptions)
program
	.command("empty-trash")
	.description("Delete retired photo files")
	.action(() => runTimed("Empty trash", emptyPhotoTrash))

try {
	if (process.argv.length > 2) {
		await program.parseAsync()
	} else if (process.stdin.isTTY) {
		await interactiveMenu()
	} else {
		program.outputHelp()
		process.exitCode = 1
	}
} catch (error) {
	if (error instanceof Error && error.name === "ExitPromptError") {
		process.exitCode = 0
	} else {
		console.error(`Error: ${errorMessage(error)}`)
		process.exitCode = 1
	}
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

async function interactiveMenu(): Promise<void> {
	const action = await select({
		message: "What do you want to do?",
		choices: [
			{
				name: "Sync photos",
				value: {label: "Sync", run: syncPhotos, timed: true},
			},
			{
				name: "Regenerate Open Graph images",
				value: {
					label: "Open Graph regeneration",
					run: regenerateOpenGraphImages,
					timed: true,
				},
			},
			{
				name: "Add or remove Capture One roots",
				value: {label: "Root management", run: manageRoots, timed: false},
			},
			{
				name: "Plan Refrakt records",
				value: {
					label: "Refrakt plan",
					run: () => planRefrakt({json: false}),
					timed: true,
				},
			},
			{
				name: "Edit collection descriptions",
				value: {
					label: "Collection editing",
					run: editCollectionDescriptions,
					timed: false,
				},
			},
			{
				name: "Empty trash",
				value: {label: "Empty trash", run: emptyPhotoTrash, timed: true},
			},
		],
	})
	if (action.timed) {
		await runTimed(action.label, action.run)
	} else {
		await action.run()
	}
}

async function runTimed(
	label: string,
	action: () => Promise<void>,
	log: (message: string) => void = console.log,
): Promise<void> {
	const startedAt = Date.now()
	await action()
	log(`${label} completed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`)
}
