export type Point = {x: number; y: number}
export type ZoomPosition = {scale: number; panX: number; panY: number}
type Size = {width: number; height: number}
type Rect = Size & {left: number; top: number}

// Positions and layout sizes are viewport CSS pixels; source sizes are image pixels.
const elasticLimit = 0.25

function center(rect: Rect): Point {
	return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2}
}

export function actualScale(
	source: Size,
	fit: Size,
	pixelRatio: number,
): number {
	return Math.max(
		1,
		Math.max(source.width, source.height) /
			(pixelRatio * Math.max(1, fit.width, fit.height)),
	)
}

export function panBounds(
	image: Size,
	viewport: Size,
	scale: number,
	pinching: boolean,
): Point {
	const padding = scale > 1 || pinching ? 80 : 0
	return {
		x: Math.max(0, (image.width * scale - viewport.width) / 2) + padding,
		y: Math.max(0, (image.height * scale - viewport.height) / 2) + padding,
	}
}

export function zoomScales(logScale: number, maximum: number) {
	const bounded = Math.max(0, Math.min(Math.log(maximum), logScale))
	const excess = logScale - bounded
	const scale = Math.exp(bounded)
	const stretch = elasticLimit * -Math.expm1(-Math.abs(excess) / elasticLimit)
	return {scale, elasticScale: scale * (1 + Math.sign(excess) * stretch)}
}

/** Keep the same image point under a fixed cursor or a moving pinch center. */
export function pinchPan(
	previous: ZoomPosition & {center: Point},
	current: {scale: number; center: Point},
	viewport: Rect,
): Pick<ZoomPosition, "panX" | "panY"> {
	const origin = center(viewport)
	const ratio = current.scale / previous.scale
	return {
		panX:
			current.center.x -
			origin.x -
			(previous.center.x - origin.x - previous.panX) * ratio,
		panY:
			current.center.y -
			origin.y -
			(previous.center.y - origin.y - previous.panY) * ratio,
	}
}

/** Recover a bounded position and unresisted scale from an interrupted animation. */
export function resumeZoom(
	image: Rect,
	viewport: Rect,
	pointer: Point,
	limits: {fitWidth: number; maximum: number},
) {
	const visibleScale = image.width / Math.max(1, limits.fitWidth)
	const scale = Math.max(1, Math.min(limits.maximum, visibleScale))
	const ratio = visibleScale / scale
	const imageCenter = center(image)
	const origin = center(viewport)
	const stretch = Math.min(
		Math.abs(ratio - 1) / elasticLimit,
		1 - Number.EPSILON,
	)
	return {
		scale,
		panX: pointer.x + (imageCenter.x - pointer.x) / ratio - origin.x,
		panY: pointer.y + (imageCenter.y - pointer.y) / ratio - origin.y,
		logScale:
			Math.log(scale) -
			Math.sign(visibleScale - scale) * elasticLimit * Math.log1p(-stretch),
	}
}

/** Translate relative to the measured layer, retaining fractional scroll offsets. */
export function zoomTransform(
	position: ZoomPosition,
	viewport: Rect,
	layer: Rect,
	elastic?: {center: Point; ratio: number},
) {
	const origin = center(viewport)
	const layerCenter = center(layer)
	let x = origin.x + position.panX
	let y = origin.y + position.panY
	let scale = position.scale
	if (elastic) {
		const {ratio} = elastic
		scale *= ratio
		x = elastic.center.x + (x - elastic.center.x) * ratio
		y = elastic.center.y + (y - elastic.center.y) * ratio
	}
	return {x: x - layerCenter.x, y: y - layerCenter.y, scale}
}
