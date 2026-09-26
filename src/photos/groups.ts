import type {PhotoContext, PhotoContextReference} from "./context.ts"
export type {PhotoContext} from "./context.ts"
import {capturedDate, newestCaptureFirst} from "./presentation.ts"
import type {PhotoEntry, PhotoSetEntry} from "./schema.ts"
import {photoSlug} from "./slug.ts"

export interface PhotoGroup {
	path: string
	label: string
	photos: PhotoEntry[]
	reference?: PhotoContextReference
}

export interface PhotoDateGroups {
	year: PhotoGroup
	months: PhotoGroup[]
	days: PhotoGroup[]
}

export interface PhotoGroups {
	all: PhotoGroup
	cameras: PhotoGroup[]
	lenses: PhotoGroup[]
	tags: PhotoGroup[]
	dates: PhotoDateGroups[]
	sets: PhotoGroup[]
}

type GroupValue = {label: string; photos: PhotoEntry[]}

const monthYearFormatter = new Intl.DateTimeFormat("en-GB", {
	month: "long",
	year: "numeric",
	timeZone: "UTC",
})

const fullDateFormatter = new Intl.DateTimeFormat("en-GB", {
	day: "numeric",
	month: "long",
	year: "numeric",
	timeZone: "UTC",
})

function addPhoto(
	groups: Map<string, GroupValue>,
	key: string,
	label: string,
	photo: PhotoEntry,
): void {
	const group = groups.get(key) ?? {label, photos: []}
	group.photos.push(photo)
	groups.set(key, group)
}

function facetGroups(
	type: "camera" | "lens" | "tag",
	path: "cameras" | "lenses" | "tags",
	groups: Map<string, GroupValue>,
): PhotoGroup[] {
	return [...groups].map(([id, group]) => ({
		path: `/photos/${path}/${id}/`,
		label: group.label,
		photos: group.photos,
		reference: {type, id},
	}))
}

function buildFacetGroups(photos: PhotoEntry[]): {
	cameras: PhotoGroup[]
	lenses: PhotoGroup[]
	tags: PhotoGroup[]
} {
	const cameras = new Map<string, GroupValue>()
	const lenses = new Map<string, GroupValue>()
	const tags = new Map<string, GroupValue>()

	for (const photo of photos) {
		if (photo.cameraName) {
			addPhoto(cameras, photoSlug(photo.cameraName), photo.cameraName, photo)
		}
		if (photo.lensName) {
			addPhoto(lenses, photoSlug(photo.lensName), photo.lensName, photo)
		}
		for (const tag of photo.metadata.tags) {
			addPhoto(tags, photoSlug(tag.name), tag.name, photo)
		}
	}

	return {
		cameras: facetGroups("camera", "cameras", cameras),
		lenses: facetGroups("lens", "lenses", lenses),
		tags: facetGroups("tag", "tags", tags),
	}
}

function dateGroup(
	path: string,
	label: string,
	photos: PhotoEntry[],
): PhotoGroup {
	return {
		path: `/photos/date/${path}/`,
		label,
		photos,
		reference: {type: "date", id: path.replaceAll("/", "-")},
	}
}

function buildDateGroups(photos: PhotoEntry[]): PhotoDateGroups[] {
	const years = new Map<string, GroupValue>()
	const months = new Map<string, GroupValue>()
	const days = new Map<string, GroupValue>()

	for (const photo of photos) {
		const [year, month, day] =
			capturedDate(photo.metadata.capturedAt)?.split("-") ?? []
		if (!year || !month || !day) {
			continue
		}

		const date = new Date(
			Date.UTC(Number(year), Number(month) - 1, Number(day)),
		)

		addPhoto(years, year, year, photo)
		addPhoto(months, `${year}/${month}`, monthYearFormatter.format(date), photo)
		addPhoto(
			days,
			`${year}/${month}/${day}`,
			fullDateFormatter.format(date),
			photo,
		)
	}

	return [...years]
		.sort(([left], [right]) => right.localeCompare(left))
		.map(([year, group]) => ({
			year: dateGroup(year, group.label, group.photos),
			months: [...months]
				.filter(([path]) => path.startsWith(`${year}/`))
				.sort(([left], [right]) => right.localeCompare(left))
				.map(([path, month]) => dateGroup(path, month.label, month.photos)),
			days: [...days]
				.filter(([path]) => path.startsWith(`${year}/`))
				.sort(([left], [right]) => right.localeCompare(left))
				.map(([path, day]) => dateGroup(path, day.label, day.photos)),
		}))
}

function buildSetGroups(
	photos: PhotoEntry[],
	sets: PhotoSetEntry[],
): PhotoGroup[] {
	const photosById = new Map(photos.map((photo) => [photo.id, photo]))

	return sets.map((set) => ({
		path: `/photos/sets/${set.slug}/`,
		label: set.title,
		photos: set.photoIds.flatMap((id) => {
			const photo = photosById.get(id)
			return photo ? [photo] : []
		}),
		reference: {type: "set", id: set.slug},
	}))
}

export function buildPhotoGroups(
	photos: PhotoEntry[],
	sets: PhotoSetEntry[],
): PhotoGroups {
	const ordered = [...photos].sort(
		(left, right) => right.position - left.position,
	)

	const dated = [...photos]
		.filter((photo) => capturedDate(photo.metadata.capturedAt))
		.sort(newestCaptureFirst)

	return {
		all: {path: "/photos/", label: "All", photos: ordered},
		...buildFacetGroups(ordered),
		dates: buildDateGroups(dated),
		sets: buildSetGroups(photos, sets),
	}
}

export function flattenPhotoGroups(groups: PhotoGroups): PhotoGroup[] {
	return [
		groups.all,
		...groups.cameras,
		...groups.lenses,
		...groups.tags,
		...groups.dates.map((group) => group.year),
		...groups.dates.flatMap((group) => group.months),
		...groups.dates.flatMap((group) => group.days),
		...groups.sets,
	]
}

function photoContext(group: PhotoGroup, index: number): PhotoContext {
	const total = group.photos.length
	let previousId: string | null = null
	let nextId: string | null = null

	if (total > 1) {
		previousId = group.photos[(index - 1 + total) % total]?.id ?? null
		nextId = group.photos[(index + 1) % total]?.id ?? null
	}

	return {
		path: group.path,
		label: group.label,
		reference: group.reference,
		index: index + 1,
		total,
		previousId,
		nextId,
	}
}

export function buildPhotoContexts(
	photos: PhotoEntry[],
	groups: PhotoGroups,
): Map<string, PhotoContext[]> {
	const contexts = new Map<string, PhotoContext[]>()
	for (const photo of photos) {
		contexts.set(photo.id, [])
	}

	for (const group of flattenPhotoGroups(groups)) {
		for (const [index, photo] of group.photos.entries()) {
			contexts.get(photo.id)?.push(photoContext(group, index))
		}
	}

	return contexts
}
