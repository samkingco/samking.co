type Point = {x: number; y: number}

type Pinch = {
	distance: number
	scale: number
	panX: number
	panY: number
	center: Point
}

type ZoomMode = "fit" | "actual" | "custom"

type ZoomElements = {
	viewport: HTMLElement
	image: HTMLImageElement
	originalImage: HTMLImageElement
	actualButton: HTMLButtonElement
	fitButton: HTMLButtonElement
	navigation: HTMLElement | null
}

type ZoomState = {
	mode: ZoomMode
	scale: number
	panX: number
	panY: number
	suppressNavigationUntil: number
	lastPoint: Point | null
	pinch: Pinch | null
	originalLoading: boolean
	pointers: Map<number, Point>
}

function getZoomElements(detail: HTMLElement): ZoomElements | null {
	const viewport = detail.querySelector("[data-photo-viewport]")
	const image = detail.querySelector("[data-photo-image]")
	const originalImage = detail.querySelector("[data-photo-original]")
	const actualButton = detail.querySelector("[data-photo-actual]")
	const fitButton = detail.querySelector("[data-photo-fit]")
	const navigation = detail.querySelector("[data-context-navigation]")

	if (
		!(viewport instanceof HTMLElement) ||
		!(image instanceof HTMLImageElement) ||
		!(originalImage instanceof HTMLImageElement) ||
		!(actualButton instanceof HTMLButtonElement) ||
		!(fitButton instanceof HTMLButtonElement)
	) {
		return null
	}

	return {
		viewport,
		image,
		originalImage,
		actualButton,
		fitButton,
		navigation: navigation instanceof HTMLElement ? navigation : null,
	}
}

function createZoomState(): ZoomState {
	return {
		mode: "fit",
		scale: 1,
		panX: 0,
		panY: 0,
		suppressNavigationUntil: 0,
		lastPoint: null,
		pinch: null,
		originalLoading: false,
		pointers: new Map(),
	}
}

function maximumScale(elements: ZoomElements): number {
	const sourceLongEdge = Math.max(
		Number(elements.image.dataset.photoWidth),
		Number(elements.image.dataset.photoHeight),
	)
	const displayedLongEdge = Math.max(
		elements.image.clientWidth,
		elements.image.clientHeight,
	)

	return Math.max(
		1,
		sourceLongEdge /
			(Math.max(1, window.devicePixelRatio) * Math.max(1, displayedLongEdge)),
	)
}

function clampPan(elements: ZoomElements, state: ZoomState): void {
	const margin = state.scale > 1 ? 80 : 0

	const maxX =
		Math.max(
			0,
			(elements.image.clientWidth * state.scale -
				elements.viewport.clientWidth) /
				2,
		) + margin

	const maxY =
		Math.max(
			0,
			(elements.image.clientHeight * state.scale -
				elements.viewport.clientHeight) /
				2,
		) + margin

	state.panX = Math.max(-maxX, Math.min(maxX, state.panX))
	state.panY = Math.max(-maxY, Math.min(maxY, state.panY))
}

function renderZoom(elements: ZoomElements, state: ZoomState): void {
	const maximum = maximumScale(elements)
	state.scale = Math.max(1, Math.min(maximum, state.scale))

	if (state.scale === 1) {
		state.panX = 0
		state.panY = 0
	}

	clampPan(elements, state)

	const transform = `translate3d(${state.panX}px, ${state.panY}px, 0) scale(${state.scale})`
	elements.image.style.transform = transform
	elements.originalImage.style.transform = transform

	elements.actualButton.ariaPressed = String(
		Math.abs(state.scale - maximum) < 0.01,
	)
	elements.fitButton.ariaPressed = String(state.scale === 1)

	if (elements.navigation) {
		elements.navigation.style.pointerEvents =
			state.scale > 1 || state.pointers.size > 1 ? "none" : ""
	}

	elements.viewport.style.cursor = state.scale > 1 ? "grab" : ""
}

function loadOriginal(elements: ZoomElements, state: ZoomState): void {
	const source = elements.originalImage.dataset.photoSource
	if (
		!source ||
		state.originalLoading ||
		elements.originalImage.src === source
	) {
		return
	}

	state.originalLoading = true
	elements.originalImage.addEventListener(
		"load",
		() => {
			requestAnimationFrame(() => {
				elements.originalImage.style.opacity = "1"
			})
		},
		{once: true},
	)
	elements.originalImage.src = source
}

function point(event: PointerEvent): Point {
	return {x: event.clientX, y: event.clientY}
}

function distance(left: Point, right: Point): number {
	return Math.hypot(right.x - left.x, right.y - left.y)
}

function center(left: Point, right: Point): Point {
	return {x: (left.x + right.x) / 2, y: (left.y + right.y) / 2}
}

function startPinch(elements: ZoomElements, state: ZoomState): void {
	const [left, right] = [...state.pointers.values()]
	if (!left || !right) {
		return
	}

	state.pinch = {
		distance: distance(left, right),
		scale: state.scale,
		panX: state.panX,
		panY: state.panY,
		center: center(left, right),
	}

	for (const id of state.pointers.keys()) {
		elements.viewport.setPointerCapture(id)
	}
}

function updatePinch(elements: ZoomElements, state: ZoomState): boolean {
	const [left, right] = [...state.pointers.values()]
	if (!left || !right) {
		return false
	}

	if (!state.pinch) {
		startPinch(elements, state)
	}

	const pinch = state.pinch
	if (!pinch) {
		return false
	}

	const currentCenter = center(left, right)
	const nextScale = Math.max(
		1,
		Math.min(
			maximumScale(elements),
			pinch.scale * (distance(left, right) / Math.max(1, pinch.distance)),
		),
	)

	const ratio = nextScale / pinch.scale

	const bounds = elements.viewport.getBoundingClientRect()
	const viewportCenter = {
		x: bounds.left + bounds.width / 2,
		y: bounds.top + bounds.height / 2,
	}

	state.panX =
		currentCenter.x -
		viewportCenter.x -
		(pinch.center.x - viewportCenter.x - pinch.panX) * ratio
	state.panY =
		currentCenter.y -
		viewportCenter.y -
		(pinch.center.y - viewportCenter.y - pinch.panY) * ratio
	state.mode =
		nextScale === 1
			? "fit"
			: Math.abs(nextScale - maximumScale(elements)) < 0.01
				? "actual"
				: "custom"

	if (nextScale > 1) {
		loadOriginal(elements, state)
	}

	state.scale = nextScale
	state.suppressNavigationUntil = Date.now() + 500
	renderZoom(elements, state)

	return true
}

function updatePan(
	event: PointerEvent,
	elements: ZoomElements,
	state: ZoomState,
): void {
	if (state.scale <= 1 || !state.lastPoint) {
		return
	}

	const currentPoint = point(event)
	state.panX += currentPoint.x - state.lastPoint.x
	state.panY += currentPoint.y - state.lastPoint.y
	state.lastPoint = currentPoint
	state.suppressNavigationUntil = Date.now() + 500

	renderZoom(elements, state)
	elements.viewport.style.cursor = "grabbing"
}

function bindPointerGestures(elements: ZoomElements, state: ZoomState): void {
	elements.viewport.addEventListener("pointerdown", (event) => {
		state.pointers.set(event.pointerId, point(event))

		if (state.pointers.size === 2) {
			startPinch(elements, state)
			state.suppressNavigationUntil = Date.now() + 500
			return
		}

		state.lastPoint = point(event)
		if (state.scale > 1) {
			elements.viewport.setPointerCapture(event.pointerId)
		}
	})

	elements.viewport.addEventListener("pointermove", (event) => {
		if (!state.pointers.has(event.pointerId)) {
			return
		}

		state.pointers.set(event.pointerId, point(event))
		if (state.pointers.size > 1 && updatePinch(elements, state)) {
			return
		}

		updatePan(event, elements, state)
	})

	const endPointer = (event: PointerEvent) => {
		state.pointers.delete(event.pointerId)
		state.pinch = null
		state.lastPoint = [...state.pointers.values()][0] ?? null
		renderZoom(elements, state)
	}

	elements.viewport.addEventListener("pointerup", endPointer)
	elements.viewport.addEventListener("pointercancel", endPointer)
}

function bindZoomControls(elements: ZoomElements, state: ZoomState): void {
	elements.actualButton.addEventListener("click", () => {
		state.mode = "actual"
		loadOriginal(elements, state)
		state.scale = maximumScale(elements)
		state.panX = 0
		state.panY = 0
		renderZoom(elements, state)
	})

	elements.fitButton.addEventListener("click", () => {
		state.mode = "fit"
		state.scale = 1
		renderZoom(elements, state)
	})

	elements.viewport.addEventListener(
		"wheel",
		(event) => {
			if (state.scale === 1) {
				return
			}

			event.preventDefault()
			state.panX -= event.deltaX
			state.panY -= event.deltaY
			renderZoom(elements, state)
		},
		{passive: false},
	)

	if (elements.navigation) {
		elements.navigation.addEventListener("click", (event) => {
			if (state.scale > 1 || Date.now() < state.suppressNavigationUntil) {
				event.preventDefault()
			}
		})
	}
}

function observeZoomSize(elements: ZoomElements, state: ZoomState): void {
	elements.image.addEventListener("load", () => {
		if (state.mode === "actual") {
			state.scale = maximumScale(elements)
		}

		renderZoom(elements, state)
	})

	const resizeObserver = new ResizeObserver(() => {
		if (state.mode === "actual") {
			state.scale = maximumScale(elements)
		}
		if (state.mode === "fit") {
			state.scale = 1
		}

		renderZoom(elements, state)
	})

	resizeObserver.observe(elements.viewport)
	document.addEventListener(
		"astro:before-swap",
		() => resizeObserver.disconnect(),
		{once: true},
	)
}

export function initializePhotoZoom(detail: HTMLElement): void {
	const elements = getZoomElements(detail)
	if (!elements) {
		return
	}

	const state = createZoomState()

	bindZoomControls(elements, state)
	bindPointerGestures(elements, state)
	observeZoomSize(elements, state)
	renderZoom(elements, state)
}
