import {mkdir, writeFile} from "node:fs/promises"
import {dirname, join, resolve} from "node:path"
import {isTid} from "@atcute/lexicons/syntax"
import {now, parse} from "@atcute/tid"
import {z} from "zod"
import {slugify} from "../utils/slugify.ts"
import {readMarkdown} from "./markdown.ts"

export const postMetadataSchema = z.object({
	tid: z.string().refine(isTid, "Must be a valid TID"),
	title: z.string(),
	date: z.union([z.string(), z.date()]).pipe(z.coerce.date()),
	excerpt: z.string(),
	slug: z.string().min(1),
})

export async function readPosts(root = resolve("src/content")) {
	const posts = (await readMarkdown(join(root, "posts"))).map(
		({frontmatter, text, path}) => {
			const parsed = postMetadataSchema.safeParse(frontmatter)
			if (!parsed.success) {
				throw new Error(
					`Invalid post metadata in ${path}: ${parsed.error.message}`,
				)
			}
			return {...parsed.data, text, path}
		},
	)
	const tids = new Set<string>()
	const slugs = new Set<string>()
	for (const post of posts) {
		if (tids.has(post.tid) || slugs.has(post.slug)) {
			throw new Error(`Duplicate post identity: ${post.path}`)
		}
		tids.add(post.tid)
		slugs.add(post.slug)
	}
	return posts
}

export async function writePost(
	root: string,
	title: string,
	excerpt: string,
): Promise<string> {
	if (!title.trim()) {
		throw new Error("Post title must not be blank.")
	}
	const slug = slugify(title)
	if (!slug) {
		throw new Error("Post title must contain a letter or number for its slug.")
	}
	const tid = now()
	const date = new Date(parse(tid).timestamp / 1000).toISOString()
	const path = join(root, "posts", `${date.slice(0, 10)}-${slug}.md`)
	await mkdir(dirname(path), {recursive: true})
	await writeFile(
		path,
		`---\ntid: ${tid}\ndate: ${date}\ntitle: ${JSON.stringify(title.trim())}\nslug: ${slug}\nexcerpt: ${JSON.stringify(excerpt)}\n---\n\n`,
		{flag: "wx"},
	)
	return path
}
