import {isHandle} from "@atcute/lexicons/syntax"
import {didString, parse} from "@atcute/lexicons/validations"

const mention = /(^|[\s(])@([a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9])(?![\w-])/g

export async function prepareMentions(
	text: string,
	resolveHandle: (handle: string) => Promise<string>,
): Promise<string> {
	const handles = new Set(
		[...text.matchAll(mention)]
			.map((match) => match[2].toLowerCase())
			.filter(isHandle),
	)
	const resolved = new Map<string, string>()
	for (const handle of handles) {
		try {
			const did = parse(didString(), await resolveHandle(handle))
			resolved.set(handle, did)
		} catch (cause) {
			throw new Error(`Could not resolve @${handle}`, {cause})
		}
	}
	return text.replace(mention, (match, prefix: string, handle: string) => {
		const did = resolved.get(handle.toLowerCase())
		return did
			? `${prefix}[@${handle}](https://bsky.app/profile/${encodeURIComponent(did)})`
			: match
	})
}
