export const PHOTO_DERIVATIVES = {
	source: {filename: "source.jpg", format: "jpeg"},
	thumb: {filename: "thumb.webp", format: "webp", size: 1024, quality: 70},
	detail: {filename: "detail.webp", format: "webp", size: 3072, quality: 70},
	og: {
		filename: "og.jpg",
		format: "jpeg",
		width: 1200,
		height: 630,
		padding: 40,
		quality: 95,
	},
} as const

export type PhotoDerivativeKind = keyof typeof PHOTO_DERIVATIVES

export const PHOTO_DERIVATIVE_KINDS = Object.keys(
	PHOTO_DERIVATIVES,
) as PhotoDerivativeKind[]
