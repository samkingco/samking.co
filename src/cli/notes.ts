import {resolve} from "node:path"
import {isCancel, multiline} from "@clack/prompts"
import {resolveHandle} from "../atproto/identity.ts"
import {prepareMentions} from "../atproto/mentions.ts"
import {writeNote} from "../repos/notes.ts"

export async function createNote(
	text: string | undefined,
	options: {stdin?: boolean},
): Promise<void> {
	const body = await noteText(text, options.stdin ?? false)
	if (isCancel(body)) {
		return
	}
	if (!body.trim()) {
		throw new Error("Note text must not be blank.")
	}
	const prepared = await prepareMentions(body, resolveHandle)
	const path = await writeNote(resolve("src/content"), prepared)
	console.log(path)
}

async function noteText(text: string | undefined, stdin: boolean) {
	if (stdin && text !== undefined) {
		throw new Error("Use note text or --stdin, not both.")
	}
	if (stdin) {
		process.stdin.setEncoding("utf8")
		let body = ""
		for await (const chunk of process.stdin) {
			body += chunk
		}
		return body
	}
	return (
		text ??
		multiline({
			message: "Note text (Tab then Enter to save)",
			showSubmit: true,
			validate: (value) =>
				value?.trim() ? undefined : "Note text must not be blank.",
		})
	)
}
