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
