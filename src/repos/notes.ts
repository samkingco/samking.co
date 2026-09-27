import {mkdir, writeFile} from "node:fs/promises"
import {dirname, join, resolve} from "node:path"
import {isDatetime, isTid} from "@atcute/lexicons/syntax"
import {now, parse} from "@atcute/tid"
import {z} from "zod"
import {readMarkdown} from "./markdown.ts"

function isValidNoteDate(value: unknown): value is string {
	return (
		isDatetime(value) &&
		Number.isFinite(Date.parse(value)) &&
		new Date(value.slice(0, 10)).toISOString().slice(0, 10) ===
			value.slice(0, 10)
	)
}

export const noteMetadataSchema = z.object({
	tid: z.string().refine(isTid, "Must be a valid TID"),
	date: z
		.string()
		.refine(isValidNoteDate, "Must be a valid AT Protocol datetime")
		.pipe(z.coerce.date()),
})

export type NoteMetadata = z.infer<typeof noteMetadataSchema>
export type Note = NoteMetadata & {text: string; path: string}

export async function writeNote(root: string, text: string): Promise<string> {
	if (!text.trim()) {
		throw new Error("Note text must not be blank.")
	}
	const tid = now()
	const date = new Date(parse(tid).timestamp / 1000).toISOString()
	const path = join(root, "notes", date.slice(0, 4), `${tid}.md`)
	await mkdir(dirname(path), {recursive: true})
	await writeFile(path, `---\ntid: ${tid}\ndate: ${date}\n---\n\n${text}`, {
		flag: "wx",
	})
	return path
}

export async function readNotes(
	root = resolve("src/content"),
): Promise<Note[]> {
	const notes = (await readMarkdown(join(root, "notes"))).map(
		({frontmatter, text, path}) => {
			const parsed = noteMetadataSchema.safeParse(frontmatter)
			if (!parsed.success) {
				throw new Error(
					`Invalid note metadata in ${path}: ${parsed.error.message}`,
				)
			}
			if (!text.trim()) {
				throw new Error(`Note text must not be blank: ${path}`)
			}
			return {...parsed.data, text, path}
		},
	)
	const tids = new Set<string>()
	for (const note of notes) {
		if (tids.has(note.tid)) {
			throw new Error(`Duplicate note TID ${note.tid}: ${note.path}`)
		}
		tids.add(note.tid)
	}
	return notes
}
