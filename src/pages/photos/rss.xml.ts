import rss from "@astrojs/rss"
import {getCollection} from "astro:content"
import sanitizeHtml from "sanitize-html"
import * as v from "valibot"
import {
	capturedDateParts,
	photoExposure,
	photoTitle,
} from "../../photos/presentation.ts"
import {PHOTO_CDN_URL} from "../../photos/r2.ts"
import {PhotoEntrySchema, PhotoSetEntrySchema} from "../../photos/schema.ts"
import {photoSlug} from "../../photos/slug.ts"
import {siteConfig} from "../../site.config.ts"

const escapeHtml = (value: string) =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;")

export async function GET() {
	if (!siteConfig.photos.enabled) {
		return new Response("404 Not found", {status: 404})
	}

	const site = "https://samking.co"
	const photoLink = (path: string, label: string) =>
		`<a href="${escapeHtml(`${site}${path}`)}">${escapeHtml(label)}</a>`
	const equipmentLink = (kind: "cameras" | "lenses", name: string | null) =>
		name ? photoLink(`/photos/${kind}/${photoSlug(name)}/`, name) : ""
	const photos = (await getCollection("photos"))
		.map((entry) => v.parse(PhotoEntrySchema, entry.data))
		.sort((a, b) => b.position - a.position)
	const sets = (await getCollection("photoSets")).map((entry) =>
		v.parse(PhotoSetEntrySchema, entry.data),
	)

	return rss({
		title: "Sam King's Photos",
		description: "Photos by Sam King",
		site,
		items: photos.map((photo) => {
			const title = photoTitle(photo)
			const imageUrl = photo.detailUrl.replace(/^\/cdn/, PHOTO_CDN_URL)
			const photoSets = sets.filter((set) => set.photoIds.includes(photo.id))
			const date = capturedDateParts(photo.metadata.capturedAt)
			const equipment = [
				equipmentLink("cameras", photo.cameraName),
				equipmentLink("lenses", photo.lensName),
				escapeHtml(photoExposure(photo).join(" • ")),
			]
				.filter(Boolean)
				.join("<br>")
			const collections = [
				photoSets.length > 0 &&
					`<strong>Sets:</strong> ${photoSets.map((set) => photoLink(`/photos/sets/${set.slug}/`, set.title)).join(", ")}`,
				photo.metadata.tags.length > 0 &&
					`<strong>Tags:</strong> ${photo.metadata.tags.map((tag) => photoLink(`/photos/tags/${photoSlug(tag.name)}/`, tag.name)).join(", ")}`,
			]
				.filter(Boolean)
				.join("<br>")
			const metadata = [
				date && `<p>${date.dayLabel} ${date.monthLabel} ${date.year}</p>`,
				equipment && `<p>${equipment}</p>`,
				collections && `<p>${collections}</p>`,
			]
				.filter(Boolean)
				.join("")

			return {
				title,
				link: `${site}/photos/${photo.id}/`,
				content: sanitizeHtml(
					`<p><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(photo.metadata.alt ?? title)}" width="${photo.metadata.width}" height="${photo.metadata.height}"></p>${photo.metadata.caption ? `<p>${escapeHtml(photo.metadata.caption)}</p>` : ""}${metadata}`,
					{allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"])},
				),
			}
		}),
		xmlns: {atom: "http://www.w3.org/2005/Atom"},
		customData: [
			"<language>en-us</language>",
			`<atom:link href="${site}/photos/rss.xml" rel="self" type="application/rss+xml" />`,
		].join(""),
		trailingSlash: false,
	})
}
