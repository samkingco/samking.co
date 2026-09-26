import rss from "@astrojs/rss"
import {getCollection} from "astro:content"
import MarkdownIt from "markdown-it"
import sanitizeHtml from "sanitize-html"

const markdown = new MarkdownIt()

export async function GET() {
	const site = "https://samking.co"
	const entries = (await getCollection("now")).sort(
		(a, b) => b.data.date.getTime() - a.data.date.getTime(),
	)

	return rss({
		title: "Sam King's /now",
		description: "Updates from Sam King",
		site,
		items: entries.map((entry) => {
			if (entry.body === undefined) {
				throw new Error(`/now entry ${entry.id} must have a body`)
			}
			return {
				title: `/now — ${entry.data.date.toISOString().slice(0, 10)}`,
				pubDate: entry.data.date,
				link: `${site}/now/${entry.id}/`,
				content: sanitizeHtml(markdown.render(entry.body)),
			}
		}),
		xmlns: {atom: "http://www.w3.org/2005/Atom"},
		customData: [
			"<language>en-us</language>",
			`<atom:link href="${site}/now/rss.xml" rel="self" type="application/rss+xml" />`,
		].join(""),
		trailingSlash: false,
	})
}
