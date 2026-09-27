import {resolve} from "node:path"
import {isCancel, text as promptText} from "@clack/prompts"
import {writePost} from "../repos/posts.ts"

export async function createPost(
	title: string | undefined,
	options: {excerpt: string},
): Promise<void> {
	const heading =
		title ??
		(await promptText({
			message: "Post title",
			validate: (value) =>
				value?.trim() ? undefined : "Post title must not be blank.",
		}))
	if (isCancel(heading)) {
		return
	}
	console.log(await writePost(resolve("src/content"), heading, options.excerpt))
}
