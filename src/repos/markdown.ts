import {glob, readFile} from "node:fs/promises"
import {join} from "node:path"
import {parse} from "yaml"

/** Read source Markdown without rendering it or changing its links. */
export async function readMarkdown(root: string) {
	const files = await Array.fromAsync(glob("**/*.md", {cwd: root}))
	return Promise.all(
		files.sort().map(async (file) => {
			const path = join(root, file)
			const source = await readFile(path, "utf8")
			const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source)
			if (!match) {
				throw new Error(`Missing YAML frontmatter: ${path}`)
			}
			try {
				return {
					path,
					frontmatter: parse(match[1]) as unknown,
					// The first blank line separates frontmatter from the exact body.
					text: source.slice(match[0].length).replace(/^\r?\n/, ""),
				}
			} catch (cause) {
				throw new Error(`Invalid YAML frontmatter: ${path}`, {cause})
			}
		}),
	)
}
