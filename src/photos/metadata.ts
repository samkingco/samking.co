import ExifReader, {type ExpandedTags} from "exifreader"
import * as v from "valibot"
import {
	type NormalizedMetadata,
	NormalizedMetadataSchema,
	type TagEdgeSchema,
} from "./schema.ts"

type MetadataTag = {description?: string; value?: unknown}
type MetadataTags = Omit<ExpandedTags, "Thumbnail" | "xmp"> & {
	xmp?: Record<string, MetadataTag>
}

type TagEdge = v.InferOutput<typeof TagEdgeSchema>

export function extractMetadata(
	buffer: Buffer,
	width: number,
	height: number,
	colors: Pick<NormalizedMetadata, "dominantColor" | "palette"> = {
		dominantColor: null,
		palette: [],
	},
): {normalized: NormalizedMetadata; raw: string} {
	// oxlint-disable-next-line import/no-named-as-default-member -- ExifReader exposes load on its CommonJS default export.
	const loaded = ExifReader.load(buffer, {
		expanded: true,
		includeUnknown: true,
		async: false,
	})
	const {Thumbnail: _thumbnail, xmp, ...groups} = loaded
	const xmpTags = stripRawXmp(xmp)
	const tags: MetadataTags = xmpTags ? {...groups, xmp: xmpTags} : groups
	const capture = captureTime(tags)
	const {tags: keywords, edges} = keywordsFrom(tags)
	const exif = tags.exif ?? {}
	const iptc = tags.iptc ?? {}
	const xmpMetadata = tags.xmp ?? {}

	const normalized = v.parse(NormalizedMetadataSchema, {
		title: firstText(xmpMetadata.Title, xmpMetadata.title, iptc["Object Name"]),
		headline: firstText(
			xmpMetadata.Headline,
			xmpMetadata.headline,
			iptc.Headline,
		),
		caption: firstText(
			xmpMetadata.Description,
			xmpMetadata.description,
			iptc["Caption/Abstract"],
			exif.ImageDescription,
		),
		alt: firstText(
			xmpMetadata.AltTextAccessibility,
			xmpMetadata.altTextAccessibility,
		),
		creator: firstText(
			xmpMetadata.Creator,
			xmpMetadata.creator,
			xmpMetadata.Author,
			xmpMetadata.Artist,
			iptc["By-line"],
			exif.Artist,
		),
		creatorUrl: firstText(
			xmpMetadata.CreatorWorkURL,
			xmpMetadata.CreatorWorkUrl,
			xmpMetadata.creatorWorkURL,
			xmpMetadata.creatorWorkUrl,
		),
		credit: firstText(xmpMetadata.Credit, iptc.Credit),
		copyright: firstText(
			xmpMetadata.Rights,
			xmpMetadata.rights,
			xmpMetadata.Copyright,
			iptc["Copyright Notice"],
			exif.Copyright,
		),
		license: firstText(xmpMetadata.License, xmpMetadata.license),
		usageTerms: firstText(xmpMetadata.UsageTerms),
		attributionUrl: firstText(
			xmpMetadata.WebStatement,
			xmpMetadata.AttributionURL,
		),
		dominantColor: colors.dominantColor,
		palette: colors.palette,
		capturedAt: capture,
		cameraMake: firstText(exif.Make),
		cameraModel: firstText(exif.Model),
		lensMake: firstText(exif.LensMake),
		lensModel: firstText(exif.LensModel),
		focalLength: firstText(exif.FocalLength),
		focalLength35mm: firstText(exif.FocalLengthIn35mmFilm),
		aperture: firstText(exif.FNumber, exif.ApertureValue),
		shutter: firstText(exif.ExposureTime),
		iso: firstNumber(exif.ISOSpeedRatings),
		flash: flashValue(exif.Flash),
		width,
		height,
		tags: keywords,
		tagEdges: edges,
	})

	return {normalized, raw: JSON.stringify(tags)}
}

function captureTime(tags: MetadataTags): string | null {
	return (
		exifCaptureTime(tags.exif) ??
		iptcCaptureTime(tags.iptc) ??
		xmpCaptureTime(tags.xmp)
	)
}

function exifCaptureTime(exif: MetadataTags["exif"]): string | null {
	const date = firstText(exif?.DateTimeOriginal)
	if (!date) {
		return null
	}

	return localTimestamp(
		date.replace(/^(\d{4}):(\d{2}):(\d{2})\s+(.+)$/, "$1-$2-$3T$4"),
	)
}

function iptcCaptureTime(iptc: MetadataTags["iptc"]): string | null {
	const date = normalizeDate(firstText(iptc?.["Date Created"]))
	const time = normalizeTime(firstText(iptc?.["Time Created"]))

	if (!date || !time) {
		return null
	}

	return localTimestamp(`${date}T${time}`)
}

function xmpCaptureTime(xmp: MetadataTags["xmp"]): string | null {
	const date = firstText(xmp?.DateCreated, xmp?.CreateDate)
	return date ? localTimestamp(date) : null
}

function localTimestamp(timestamp: string): string | null {
	const match = timestamp
		.trim()
		.match(
			/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?)(?:Z|[+-]\d{2}:?\d{2})?$/,
		)
	return match?.[1] ?? null
}

function normalizeDate(value: string | null): string | null {
	if (!value) {
		return null
	}

	return value.replace(/^(\d{4}):?(\d{2}):?(\d{2})$/, "$1-$2-$3")
}

function normalizeTime(value: string | null): string | null {
	if (!value) {
		return null
	}

	return value.replace(
		/^(\d{2}):?(\d{2}):?(\d{2})(Z|[+-]\d{2}:?\d{2})?$/,
		"$1:$2:$3$4",
	)
}

function keywordsFrom(tags: MetadataTags): {
	tags: Array<{name: string; key: string}>
	edges: TagEdge[]
} {
	const names = new Map<string, string>()
	addKeywords(names, allText(tags.xmp?.Subject))
	addKeywords(names, allText(tags.xmp?.subject))
	addKeywords(names, allText(tags.iptc?.Keywords))

	const hierarchies = [
		...allText(tags.xmp?.HierarchicalSubject),
		...allText(tags.xmp?.hierarchicalSubject),
	]
	const edges = hierarchyEdges(names, hierarchies)

	return {
		tags: [...names].map(([key, name]) => ({key, name})),
		edges,
	}
}

function addKeywords(names: Map<string, string>, values: string[]): void {
	for (const value of values) {
		addKeyword(names, value)
	}
}

function addKeyword(names: Map<string, string>, name: string): void {
	const trimmed = name.trim()
	if (!trimmed) {
		return
	}

	const key = normalizedKey(trimmed)
	if (names.has(key)) {
		return
	}

	names.set(key, trimmed)
}

function hierarchyEdges(
	names: Map<string, string>,
	hierarchies: string[],
): TagEdge[] {
	const edges = new Map<string, TagEdge>()

	for (const hierarchy of hierarchies) {
		const parts = hierarchy
			.split("|")
			.map((part) => part.trim())
			.filter(Boolean)

		addKeywords(names, parts)
		addHierarchyEdges(edges, parts)
	}

	return [...edges.values()]
}

function addHierarchyEdges(edges: Map<string, TagEdge>, parts: string[]): void {
	for (let index = 1; index < parts.length; index += 1) {
		const edge = {
			parentKey: normalizedKey(parts[index - 1]),
			childKey: normalizedKey(parts[index]),
		}

		edges.set(`${edge.parentKey}\0${edge.childKey}`, edge)
	}
}

function stripRawXmp(
	xmp: ExpandedTags["xmp"],
): Record<string, MetadataTag> | undefined {
	if (!xmp) {
		return undefined
	}

	const {_raw: _rawXmp, ...tags} = xmp
	return tags
}

function normalizedKey(value: string): string {
	return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()
}

function firstText(...values: unknown[]): string | null {
	for (const value of values) {
		const texts = allText(value)
		if (texts.length > 0) {
			return texts[0]
		}
	}
	return null
}

function allText(value: unknown): string[] {
	if (typeof value === "string") {
		const trimmed = value.trim()
		return trimmed ? [trimmed] : []
	}

	if (Array.isArray(value)) {
		return value.flatMap(allText)
	}

	if (isMetadataTag(value)) {
		const fromValue = allText(value.value)
		return fromValue.length > 0 ? fromValue : allText(value.description)
	}
	return []
}

function isMetadataTag(value: unknown): value is MetadataTag {
	return Boolean(
		value &&
		typeof value === "object" &&
		("description" in value || "value" in value),
	)
}

function firstNumber(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value
	}

	if (Array.isArray(value)) {
		return firstNumberIn(value)
	}

	if (isMetadataTag(value)) {
		return firstNumber(value.value)
	}

	return null
}

function firstNumberIn(values: unknown[]): number | null {
	for (const value of values) {
		const number = firstNumber(value)
		if (number !== null) {
			return number
		}
	}

	return null
}

function flashValue(value: unknown): boolean | null {
	const number = firstNumber(value)
	return number === null ? null : (number & 1) === 1
}
