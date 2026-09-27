import * as v from "valibot"

export const TagSchema = v.object({
	name: v.string(),
	key: v.string(),
})

export const TagEdgeSchema = v.object({
	parentKey: v.string(),
	childKey: v.string(),
})

export const ColorSwatchSchema = v.object({
	hex: v.pipe(v.string(), v.regex(/^#[0-9a-f]{6}$/i)),
	weight: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
})

const CapturedAtSchema = v.pipe(
	v.string(),
	v.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/),
)

export const NormalizedMetadataSchema = v.object({
	title: v.optional(v.nullable(v.string()), null),
	headline: v.optional(v.nullable(v.string()), null),
	caption: v.nullable(v.string()),
	alt: v.nullable(v.string()),
	creator: v.nullable(v.string()),
	creatorUrl: v.nullable(v.string()),
	credit: v.nullable(v.string()),
	copyright: v.nullable(v.string()),
	license: v.nullable(v.string()),
	usageTerms: v.nullable(v.string()),
	attributionUrl: v.nullable(v.string()),
	dominantColor: v.optional(v.nullable(v.string()), null),
	palette: v.optional(v.array(ColorSwatchSchema), []),
	capturedAt: v.nullable(CapturedAtSchema),
	cameraMake: v.nullable(v.string()),
	cameraModel: v.nullable(v.string()),
	lensMake: v.nullable(v.string()),
	lensModel: v.nullable(v.string()),
	focalLength: v.nullable(v.string()),
	focalLength35mm: v.optional(v.nullable(v.string()), null),
	aperture: v.nullable(v.string()),
	shutter: v.nullable(v.string()),
	iso: v.nullable(v.number()),
	flash: v.nullable(v.boolean()),
	width: v.pipe(v.number(), v.integer(), v.minValue(1)),
	height: v.pipe(v.number(), v.integer(), v.minValue(1)),
	tags: v.array(TagSchema),
	tagEdges: v.array(TagEdgeSchema),
})

export type NormalizedMetadata = v.InferOutput<typeof NormalizedMetadataSchema>

const PhotoUrlSchema = v.pipe(
	v.string(),
	v.check((value) => value.startsWith("/") || URL.canParse(value)),
)

export const PhotoEntrySchema = v.object({
	id: v.string(),
	name: v.string(),
	sha256: v.string(),
	position: v.pipe(v.number(), v.integer(), v.minValue(0)),
	sourceUrl: PhotoUrlSchema,
	thumbUrl: PhotoUrlSchema,
	detailUrl: PhotoUrlSchema,
	ogUrl: PhotoUrlSchema,
	cameraName: v.nullable(v.string()),
	lensName: v.nullable(v.string()),
	displayFocalLength: v.nullable(v.string()),
	metadata: NormalizedMetadataSchema,
})

export type PhotoEntry = v.InferOutput<typeof PhotoEntrySchema>

export const PhotoSetEntrySchema = v.object({
	id: v.string(),
	slug: v.string(),
	title: v.string(),
	description: v.string(),
	position: v.pipe(v.number(), v.integer(), v.minValue(1)),
	photoIds: v.array(v.string()),
})

export type PhotoSetEntry = v.InferOutput<typeof PhotoSetEntrySchema>
