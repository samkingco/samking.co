import {AppBskyFeedPost} from "@atcute/bluesky"
import RichtextBuilder, {
	type FacetFeature,
} from "@atcute/bluesky-richtext-builder"
import {type Did, isDid, isGenericUri} from "@atcute/lexicons/syntax"
import {parse} from "@atcute/lexicons/validations"
import type {Definition, Nodes} from "mdast"
import {fromMarkdown} from "mdast-util-from-markdown"
import {gfmFromMarkdown} from "mdast-util-gfm"
import {gfm} from "micromark-extension-gfm"

type Fragment = {text: string; detectHashtags?: boolean; feature?: FacetFeature}

export function markdownToBlueskyRecord(
	input: {date: Date; text: string},
	baseUrl: URL,
): AppBskyFeedPost.Main {
	const {text, facets} = buildRichtext(markdownFragments(input.text, baseUrl))
	if (!text.trim()) {
		throw new Error("Bluesky text must not be blank.")
	}
	return parse(AppBskyFeedPost.mainSchema, {
		$type: "app.bsky.feed.post",
		text,
		createdAt: input.date.toISOString(),
		...(facets.length ? {facets} : {}),
	})
}

function markdownFragments(text: string, baseUrl: URL): Fragment[] {
	const root = fromMarkdown(text, {
		extensions: [gfm()],
		mdastExtensions: [gfmFromMarkdown()],
	})
	const definitions = new Map<string, Definition>()
	for (const node of root.children) {
		if (node.type === "definition" && !definitions.has(node.identifier)) {
			definitions.set(node.identifier, node)
		}
	}
	const fragments: Fragment[] = []
	for (const node of root.children) {
		if (node.type === "definition") {
			continue
		}
		if (fragments.some((fragment) => fragment.text.length > 0)) {
			fragments.push({text: "\n\n"})
		}
		fragments.push(...render(node, definitions, baseUrl))
	}
	return fragments
}

function render(
	node: Nodes,
	definitions: ReadonlyMap<string, Definition>,
	baseUrl: URL,
): Fragment[] {
	switch (node.type) {
		case "paragraph":
		case "emphasis":
		case "strong":
			return node.children.flatMap((child) =>
				render(child, definitions, baseUrl),
			)
		case "text":
			return [{text: node.value, detectHashtags: true}]
		case "break":
			return [{text: "\n"}]
		case "inlineCode":
		case "code":
			return [{text: node.value}]
		default:
			return renderLink(node, definitions, baseUrl)
	}
}

function renderLink(
	node: Nodes,
	definitions: ReadonlyMap<string, Definition>,
	baseUrl: URL,
): Fragment[] {
	if (node.type !== "link" && node.type !== "linkReference") {
		throw new Error(`Unsupported Markdown construct: ${node.type}.`)
	}

	const target = node.type === "link" ? node : definitions.get(node.identifier)
	if (!target) {
		throw new Error("Markdown link has no definition.")
	}

	const uri = isGenericUri(target.url)
		? target.url
		: new URL(target.url, baseUrl).href

	if (!isGenericUri(uri)) {
		throw new Error("Markdown link must have a valid URI.")
	}

	const did = profileDid(uri)
	return [
		{
			// A link label is one facet, even when it contains formatting or hashtags.
			text: node.children
				.flatMap((child) => render(child, definitions, baseUrl))
				.map(({text}) => text)
				.join(""),
			feature: did
				? {$type: "app.bsky.richtext.facet#mention", did}
				: {$type: "app.bsky.richtext.facet#link", uri},
		},
	]
}

function buildRichtext(fragments: Fragment[]) {
	let text = ""
	const spans: {
		start: number
		end: number
		detectHashtags?: boolean
		feature?: FacetFeature
	}[] = []

	for (const fragment of fragments) {
		const start = text.length
		text += fragment.text
		const previous = spans.at(-1)
		// Detect hashtags across emphasis, but not across code or links.
		if (fragment.detectHashtags && previous?.detectHashtags) {
			previous.end = text.length
		} else {
			spans.push({
				start,
				end: text.length,
				detectHashtags: fragment.detectHashtags,
				feature: fragment.feature,
			})
		}
	}

	const decorated = spans.filter(
		(span) => span.feature && span.end > span.start,
	)

	const tags = [
		...text.matchAll(/(?<![\p{L}\p{N}_/@])#([\p{L}\p{M}\p{N}_\p{S}\u200d]+)/gu),
	].flatMap((match) => {
		const start = match.index
		const end = start + match[0].length
		const token =
			text.slice(0, start).split(/\s/).pop() + text.slice(start).split(/\s/)[0]

		if (/^[\d_]+$/.test(match[1]) || token.includes("@")) {
			return []
		}

		if (
			spans.some(
				(span) => span.detectHashtags && span.start <= start && span.end >= end,
			)
		) {
			return [
				{
					start,
					end,
					feature: {
						$type: "app.bsky.richtext.facet#tag",
						tag: match[1],
					} satisfies FacetFeature,
				},
			]
		}

		return []
	})

	const builder = new RichtextBuilder()
	let offset = 0
	for (const span of [...decorated, ...tags].sort(
		(a, b) => a.start - b.start,
	)) {
		builder.addText(text.slice(offset, span.start))
		builder.addDecoratedText(text.slice(span.start, span.end), span.feature!)
		offset = span.end
	}

	return builder.addText(text.slice(offset)).build()
}

function profileDid(uri: string): Did | null {
	const profile = /^https:\/\/bsky\.app\/profile\/([^/?#]+)\/?$/.exec(uri)
	if (!profile) {
		return null
	}

	try {
		// Raw DID URLs are also accepted: their internal percent escapes are identity.
		const did = profile[1].startsWith("did:")
			? profile[1]
			: decodeURIComponent(profile[1])
		return isDid(did) ? did : null
	} catch {
		return null
	}
}
