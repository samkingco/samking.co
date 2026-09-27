import {relative, resolve, sep} from "node:path"
import {fileURLToPath, pathToFileURL} from "node:url"
import type {Loader} from "astro/loaders"
import {readNotes} from "../repos/notes.ts"

export function notesLoader(): Loader {
	return {
		name: "notes-markdown",
		async load(context) {
			const root = fileURLToPath(new URL("src/content/", context.config.root))
			const directory = resolve(root, "notes")
			const reload = async () => {
				const notes = await readNotes(root)
				const entries = await Promise.all(
					notes.map(async ({path, text, ...metadata}) => {
						const rendered = await context.renderMarkdown(text, {
							fileURL: pathToFileURL(path),
						})
						return {
							id: metadata.tid,
							data: metadata,
							body: text,
							filePath: relative(fileURLToPath(context.config.root), path),
							rendered,
							assetImports: rendered.metadata?.imagePaths,
							digest: context.generateDigest({metadata, text}),
						}
					}),
				)
				context.store.clear()
				for (const entry of entries) {
					context.store.set(entry)
				}
			}
			await reload()
			context.watcher?.add(directory)
			let pending = Promise.resolve()
			for (const event of ["add", "change", "unlink"] as const) {
				context.watcher?.on(event, (path) => {
					if (
						!resolve(path).startsWith(directory + sep) ||
						!path.endsWith(".md")
					) {
						return
					}
					pending = pending
						.then(reload)
						.catch((error) => context.logger.error(String(error)))
				})
			}
		},
	}
}
