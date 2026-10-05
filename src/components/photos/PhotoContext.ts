export type PhotoContextType = "camera" | "date" | "lens" | "set" | "tag"

export interface PhotoContextReference {
	type: PhotoContextType
	id: string
}

export interface PhotoContext {
	path: string
	label: string
	index: number
	total: number
	previousId: string | null
	nextId: string | null
	reference?: PhotoContextReference
}

export function parsePhotoContexts(value: string | undefined): PhotoContext[] {
	try {
		const parsed: unknown = JSON.parse(value ?? "[]")
		return Array.isArray(parsed) ? parsed : []
	} catch {
		return []
	}
}

export function selectedPhotoContext(
	contexts: PhotoContext[],
	search: URLSearchParams,
): PhotoContext | undefined {
	const type = search.get("ctx")
	const id = search.get("ctxid")
	if (type && id) {
		return contexts.find(
			(context) =>
				context.reference?.type === type && context.reference.id === id,
		)
	}
	return contexts.find((context) => !context.reference) ?? contexts[0]
}

export function photoContextHref(
	path: string,
	search: URLSearchParams,
): string {
	const sort = search.get("sort")
	const direction = search.get("direction")
	if (!sort || (direction !== "ascending" && direction !== "descending")) {
		return path
	}
	const url = new URL(path, "https://photos.invalid")
	url.searchParams.set("sort", sort)
	url.searchParams.set("direction", direction)
	return `${url.pathname}${url.search}${url.hash}`
}

export const photoDetailHref = (
	photoId: string,
	context?: PhotoContextReference,
) => {
	const path = `/photos/${photoId}/`
	if (!context) {
		return path
	}
	const search = new URLSearchParams({ctx: context.type, ctxid: context.id})
	return `${path}?${search}`
}
