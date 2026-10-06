import type {APIContext, ImageMetadata} from "astro"
import {getImage} from "astro:assets"
import {getCollection} from "astro:content"
import * as v from "valibot"
import {
	buildPhotoGroups,
	flattenPhotoGroups,
} from "../components/photos/PhotoGroups.ts"
import {
	photoExposure,
	photoTitle,
} from "../components/photos/PhotoPresentation.ts"
import {PhotoEntrySchema, PhotoSetEntrySchema} from "../repos/photos/schema.ts"
import {siteConfig} from "../site.config"
import {getJournalEntries} from "../utils/journal"
import {journalPath} from "../utils/journal-path"
import {getLatestVideoInfo} from "../utils/youtube"

const site = `https://${siteConfig.domain}`
const images = import.meta.glob<{default: ImageMetadata}>(
	"/src/assets/**/*.{jpeg,jpg,png,gif}",
)

function link(title: string, path: string) {
	return `[${title.replace(/[\\[\]]/g, "\\$&").replace(/\s+/g, " ")}](${new URL(path, site).href})`
}

function source(entry: {id: string; body?: string}) {
	if (entry.body === undefined) {
		throw new Error(`Markdown entry ${entry.id} must have a body`)
	}
	return entry.body
}

export async function getStaticPaths() {
	const pages: {params: {path: string}; props: {body: string}}[] = []
	function add(path: string, ...parts: (string | null | undefined)[]) {
		pages.push({
			params: {path: path.replace(/^\/|\/$/g, "") || "index"},
			props: {body: parts.filter(Boolean).join("\n\n") + "\n"},
		})
	}

	const journal = await getJournalEntries()
	journal.forEach((entry) => {
		add(
			journalPath(entry),
			`# ${entry.collection === "posts" ? entry.data.title : "Note"}`,
			entry.data.date.toISOString().slice(0, 10),
			source(entry),
		)
	})
	add(
		"/journal",
		"# Journal",
		link("RSS", "/rss.xml"),
		...journal.map((entry) =>
			[
				`## ${link(entry.collection === "posts" ? entry.data.title : "Note", journalPath(entry))}`,
				entry.data.date.toISOString().slice(0, 10),
				entry.collection === "posts" ? entry.data.excerpt : source(entry),
			].join("\n\n"),
		),
	)

	const now = (await getCollection("now")).sort(
		(a, b) => b.data.date.getTime() - a.data.date.getTime(),
	)
	now.forEach((entry, index) => {
		const parts = [
			"# Now",
			`${entry.data.date.toISOString().slice(0, 10)} ${entry.data.location}`,
			source(entry),
			now[index + 1] && link("Previous version", `/now/${now[index + 1].id}/`),
		]
		add(`/now/${entry.id}`, ...parts)
		if (index === 0) {
			add("/now", ...parts)
		}
	})
	for (const entry of await getCollection("freelance")) {
		add(
			entry.id === "index" ? "/freelance" : `/freelance/${entry.id}`,
			source(entry),
		)
	}
	for (const entry of await getCollection("rights")) {
		add(`/rights/${entry.id}`, source(entry))
	}
	const roles = (await getCollection("cv")).sort(
		(a, b) => b.data.sortYear - a.data.sortYear,
	)
	add(
		"/cv",
		"# Work history",
		...roles.map((entry) =>
			[
				`## ${entry.data.role}${entry.data.company ? ` at ${entry.data.company}` : ""}`,
				entry.data.period,
				source(entry),
				entry.data.url &&
					link(new URL(entry.data.url).hostname, entry.data.url),
			]
				.filter(Boolean)
				.join("\n\n"),
		),
	)

	const photos = (await getCollection("photos"))
		.map((entry) => v.parse(PhotoEntrySchema, entry.data))
		.sort((a, b) => b.position - a.position)
	async function addPhotos() {
		if (siteConfig.photos.enabled) {
			const sets = (await getCollection("photoSets"))
				.map((entry) => v.parse(PhotoSetEntrySchema, entry.data))
				.sort((a, b) => a.position - b.position)
			const groups = buildPhotoGroups(photos, sets)
			photos.forEach((photo) => {
				add(
					`/photos/${photo.id}`,
					`# ${photoTitle(photo)}`,
					`!${link(photo.metadata.alt ?? photoTitle(photo), photo.detailUrl)}`,
					photo.metadata.caption ?? undefined,
					[
						photo.metadata.capturedAt,
						photo.cameraName,
						photo.lensName,
						...photoExposure(photo),
					]
						.filter(Boolean)
						.join(" · "),
					photo.metadata.tags.map((tag) => tag.name).join(", "),
					link("Photography rights and licensing", "/rights/photos/"),
				)
			})
			flattenPhotoGroups(groups).forEach((group) => {
				add(
					group.path,
					`# ${group.path === "/photos/" ? "Photos" : group.label}`,
					group.reference?.type === "set"
						? sets.find((set) => set.slug === group.reference?.id)?.description
						: undefined,
					group.photos
						.map((photo) => {
							const description = photo.metadata.caption ?? photo.metadata.alt
							return `- ${link(photoTitle(photo), `/photos/${photo.id}/`)}${description ? `: ${description}` : ""}`
						})
						.join("\n"),
				)
			})
			const browse = []
			for (const [path, title, items] of [
				["sets", "Sets", groups.sets],
				["tags", "Tags", groups.tags],
				[
					"date",
					"Date",
					groups.dates.flatMap((date) => [date.year, ...date.months]),
				],
				["cameras", "Cameras", groups.cameras],
				["lenses", "Lenses", groups.lenses],
			] as const) {
				const list = items
					.map(
						(group) =>
							`- ${link(group.label, group.path)} (${group.photos.length})`,
					)
					.join("\n")
				add(`/photos/${path}`, `# ${title}`, list)
				browse.push(`## ${title}\n\n${list}`)
			}
			add("/photos/browse", "# Browse photos", ...browse)
		}
	}
	await addPhotos()

	add(
		"/",
		`# ${siteConfig.title}`,
		...siteConfig.bio,
		...(siteConfig.photos.enabled
			? [
					"## Recent photos",
					link("View", "/photos/"),
					photos
						.slice(0, 3)
						.map(
							(photo) => `- ${link(photoTitle(photo), `/photos/${photo.id}/`)}`,
						)
						.join("\n"),
				]
			: []),
		"## Meaningful to me",
		siteConfig.coreValues,
		"## Big fan of",
		siteConfig.bigFanOf,
		"## Email",
		link("mail@samking.co", "mailto:mail@samking.co"),
		"## More",
		[
			...["journal", "now", "freelance", "links", "cv"].map(
				(path) => `- ${link(path, `/${path}/`)}`,
			),
			`- ${link("Support me", siteConfig.supportUrl)}`,
		].join("\n"),
	)
	const latestPost = journal.find((entry) => entry.collection === "posts")
	const latestVideo = await getLatestVideoInfo(siteConfig.youtube.channelId)
	add(
		"/links",
		"# Links",
		"## Photography",
		siteConfig.photos.enabled ? link("Archive", "/photos/") : undefined,
		link("Refrakt", `https://refrakt.app/${siteConfig.refrakt.handle}`),
		latestVideo &&
			`## Latest YouTube video\n\n${link(latestVideo.title, latestVideo.watchUrl)}`,
		latestPost &&
			`## Latest journal entry\n\n${link(latestPost.data.title, journalPath(latestPost))}`,
		"## Building",
		link("Refrakt", "https://refrakt.app"),
		link("Sesame", "https://opensesame.software"),
		"## Social",
		link("Bluesky", `https://bsky.app/profile/${siteConfig.bluesky.handle}`),
		link("GitHub", `https://github.com/${siteConfig.github.handle}`),
		link("YouTube", `https://www.youtube.com/@${siteConfig.youtube.handle}`),
		link("Substack", `https://${siteConfig.substack.handle}.substack.com`),
		link("LinkedIn", `https://linkedin.com/in/${siteConfig.linkedin.handle}`),
		"## Support",
		link("Support my work", siteConfig.supportUrl),
	)
	return pages
}

export async function GET({props}: APIContext) {
	let body: string = props.body
	// Use the same published images as the RSS feed, not source-file paths.
	for (const [path, load] of Object.entries(images)) {
		const reference = path.replace("/src/", "../../")
		if (!body.includes(reference)) {
			continue
		}
		const image = await getImage({src: (await load()).default, format: "webp"})
		body = body.replaceAll(reference, new URL(image.src, site).href)
	}
	return new Response(body, {
		headers: {"Content-Type": "text/markdown; charset=utf-8"},
	})
}
