import {
	actualScale,
	panBounds,
	pinchPan,
	type Point,
	resumeZoom,
	type ZoomPosition,
	zoomScales,
	zoomTransform,
} from "./PhotoZoomGeometry.ts"

const loupeInput = window.matchMedia(
	"(any-hover: hover) and (any-pointer: fine)",
)

type Pinch = ZoomPosition & {
	distance: number
	logScale: number
	center: Point
}

type ZoomMode = "fit" | "actual" | "custom"

type ZoomElements = {
	detail: HTMLElement
	signal: AbortSignal
	loupeButton: HTMLButtonElement | null
	viewport: HTMLElement
	presentation: HTMLElement
	imageLayers: HTMLElement[]
	animations: Set<Animation>
	image: HTMLImageElement
	originalImage: HTMLImageElement
	actualButton: HTMLButtonElement
	fitButton: HTMLButtonElement
}

type ZoomState = ZoomPosition & {
	loupeActive: boolean
	loupePoint: Point | null
	mode: ZoomMode
	scroll: Point
	pinch: Pinch | null
	pinchLogScale: number | null
	pinchCenter: Point | null
	originalLoading: boolean
	pointers: Map<number, Point>
}

function getZoomElements(
	frame: HTMLElement,
	detail: HTMLElement,
	signal: AbortSignal,
): ZoomElements {
	const presentation = frame.querySelector("[data-photo-presentation]")
	const imageLayer = frame.querySelector('[data-photo-image-layer="detail"]')
	const originalLayer = frame.querySelector(
		'[data-photo-image-layer="original"]',
	)
	const image = frame.querySelector("[data-photo-image]")
	const originalImage = frame.querySelector("[data-photo-original]")
	const actualButton = detail.querySelector("[data-photo-actual]")
	const fitButton = detail.querySelector("[data-photo-fit]")

	if (
		!(image instanceof HTMLImageElement) ||
		!(originalImage instanceof HTMLImageElement) ||
		!(actualButton instanceof HTMLButtonElement) ||
		!(fitButton instanceof HTMLButtonElement)
	) {
		throw new Error(
			"PhotoZoom requires image elements [data-photo-image], [data-photo-original] and buttons [data-photo-actual], [data-photo-fit]",
		)
	}
	if (
		!(presentation instanceof HTMLElement) ||
		!(imageLayer instanceof HTMLElement) ||
		!(originalLayer instanceof HTMLElement)
	) {
		throw new Error(
			'PhotoZoom requires [data-photo-presentation] and [data-photo-image-layer="detail"/"original"] elements',
		)
	}

	return {
		viewport: frame,
		presentation,
		imageLayers: [imageLayer, originalLayer],
		animations: new Set(),
		detail,
		signal,
		loupeButton: detail.querySelector<HTMLButtonElement>("[data-photo-loupe]"),
		image,
		originalImage,
		actualButton,
		fitButton,
	}
}

function createZoomState(): ZoomState {
	return {
		loupeActive: false,
		loupePoint: null,
		mode: "fit",
		scale: 1,
		panX: 0,
		panY: 0,
		scroll: {x: 0, y: 0},
		pinch: null,
		pinchLogScale: null,
		pinchCenter: null,
		originalLoading: false,
		pointers: new Map(),
	}
}

function imageSize(elements: ZoomElements): {width: number; height: number} {
	const style = getComputedStyle(elements.image)
	return {
		width: parseFloat(style.width) || 0,
		height: parseFloat(style.height) || 0,
	}
}

function maximumScale(elements: ZoomElements): number {
	return actualScale(
		{
			width: Number(elements.image.dataset.photoWidth),
			height: Number(elements.image.dataset.photoHeight),
		},
		imageSize(elements),
		window.devicePixelRatio,
	)
}

function panLimits(elements: ZoomElements, state: ZoomState): Point {
	return panBounds(
		imageSize(elements),
		elements.viewport.getBoundingClientRect(),
		state.scale,
		state.pinchLogScale !== null,
	)
}

function clampPan(elements: ZoomElements, state: ZoomState): void {
	const limits = panLimits(elements, state)
	state.panX = Math.max(-limits.x, Math.min(limits.x, state.panX))
	state.panY = Math.max(-limits.y, Math.min(limits.y, state.panY))
}

function photoCursor(state: ZoomState): string {
	return state.loupeActive ? "crosshair" : state.scale > 1 ? "grab" : ""
}

function animateZoom(
	elements: ZoomElements,
	state: ZoomState,
	before: DOMRect,
	kind: "zoom" | "spring",
): void {
	const after = elements.image.getBoundingClientRect()
	if (
		!after.width ||
		!before.width ||
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	) {
		return
	}
	const transform = elements.image.style.transform
	const layer = elements.imageLayers[0].getBoundingClientRect()
	const from = `translate(${before.left + before.width / 2 - layer.left - layer.width / 2}px, ${before.top + before.height / 2 - layer.top - layer.height / 2}px) scale(${(state.scale * before.width) / after.width})`
	for (const image of [elements.image, elements.originalImage]) {
		const animation = image.animate([{transform: from}, {transform}], {
			duration: kind === "spring" ? 320 : 160,
			easing: kind === "spring" ? "cubic-bezier(0.2, 1.3, 0.3, 1)" : "ease-out",
		})
		elements.animations.add(animation)
		animation.onfinish = animation.oncancel = () => {
			elements.animations.delete(animation)
		}
	}
}

function sizeZoomCanvas(elements: ZoomElements, state: ZoomState): void {
	const {width, height} = elements.viewport.getBoundingClientRect()
	const limits = panLimits(elements, state)
	const canvasWidth = width + limits.x * 2
	const canvasHeight = height + limits.y * 2
	const zoomed = state.scale > 1 || state.pinchLogScale !== null
	elements.detail.dataset.photoZoomed = String(zoomed)
	elements.viewport.style.overflow = zoomed ? "auto" : ""
	elements.viewport.style.overscrollBehavior = zoomed ? "contain" : ""
	elements.presentation.style.width = zoomed ? `${canvasWidth}px` : ""
	elements.presentation.style.height = zoomed ? `${canvasHeight}px` : ""
	// Elastic image transforms must not expand the native scroll bounds.
	elements.presentation.style.overflow = "clip"
	const style = zoomed
		? {
				position: "absolute",
				inset: "auto",
				width: `${width}px`,
				height: `${height}px`,
				left: `${(canvasWidth - width) / 2}px`,
				top: `${(canvasHeight - height) / 2}px`,
			}
		: {position: "", inset: "", width: "", height: "", left: "", top: ""}
	for (const layer of elements.imageLayers) {
		Object.assign(layer.style, style)
	}
}

function renderZoom(
	elements: ZoomElements,
	state: ZoomState,
	animation?: "zoom" | "spring",
): void {
	const before = elements.image.getBoundingClientRect()
	cancelZoomAnimation(elements)
	const maximum = maximumScale(elements)
	state.scale = Math.max(1, Math.min(maximum, state.scale))

	// Keep the gesture's position through fit; recenter only after release.
	if (state.scale === 1 && state.pinchLogScale === null) {
		state.panX = 0
		state.panY = 0
	}

	clampPan(elements, state)
	synchronizeLoupe(elements, state)

	sizeZoomCanvas(elements, state)
	const limits = panLimits(elements, state)
	elements.viewport.scrollLeft = limits.x - state.panX
	elements.viewport.scrollTop = limits.y - state.panY
	state.scroll = {
		x: elements.viewport.scrollLeft,
		y: elements.viewport.scrollTop,
	}

	// Keep the image center in fractional viewport CSS pixels. Native scroll
	// positions can be rounded; compensate visually, never feed rounding back.
	const {x, y, scale} = zoomTransform(
		state,
		elements.viewport.getBoundingClientRect(),
		elements.imageLayers[0].getBoundingClientRect(),
		state.pinchLogScale !== null && state.pinchCenter
			? {
					center: state.pinchCenter,
					ratio: elasticRatio(elements, state),
				}
			: undefined,
	)
	const transform = `translate(${x}px, ${y}px) scale(${scale})`
	elements.image.style.transform = transform
	elements.originalImage.style.transform = transform
	if (animation) {
		animateZoom(elements, state, before, animation)
	}

	elements.actualButton.ariaPressed = String(
		Math.abs(state.scale - maximum) < 0.01,
	)
	elements.fitButton.ariaPressed = String(state.scale === 1)

	elements.viewport.style.cursor = photoCursor(state)
}

function cancelZoomAnimation(elements: ZoomElements): void {
	for (const animation of elements.animations) {
		animation.cancel()
	}
	elements.animations.clear()
}

async function loadOriginal(
	elements: ZoomElements,
	state: ZoomState,
): Promise<void> {
	const source = elements.originalImage.dataset.photoSource
	if (
		!source ||
		state.originalLoading ||
		elements.originalImage.style.opacity === "1"
	) {
		return
	}
	state.originalLoading = true
	if (elements.originalImage.getAttribute("src") !== source) {
		elements.originalImage.src = source
	}
	try {
		await elements.originalImage.decode()
	} catch {
		state.originalLoading = false
		if (!elements.signal.aborted) {
			elements.originalImage.removeAttribute("src")
		}
		return
	}
	requestAnimationFrame(() => {
		state.originalLoading = false
		if (!elements.signal.aborted) {
			elements.originalImage.style.opacity = "1"
		}
	})
}

function point(event: MouseEvent): Point {
	return {x: event.clientX, y: event.clientY}
}

function distance(left: Point, right: Point): number {
	return Math.hypot(right.x - left.x, right.y - left.y)
}

function center(left: Point, right: Point): Point {
	return {x: (left.x + right.x) / 2, y: (left.y + right.y) / 2}
}

function synchronizePan(elements: ZoomElements, state: ZoomState): void {
	const {scrollLeft, scrollTop} = elements.viewport
	const ratio = elasticRatio(elements, state)
	state.panX += (state.scroll.x - scrollLeft) / ratio
	state.panY += (state.scroll.y - scrollTop) / ratio
	state.scroll = {x: scrollLeft, y: scrollTop}
}

function resumePinch(
	elements: ZoomElements,
	state: ZoomState,
	pointer: Point,
): void {
	synchronizePan(elements, state)
	if (!elements.animations.size) {
		return
	}
	const {logScale, ...position} = resumeZoom(
		elements.image.getBoundingClientRect(),
		elements.viewport.getBoundingClientRect(),
		pointer,
		{fitWidth: imageSize(elements).width, maximum: maximumScale(elements)},
	)
	Object.assign(state, position)
	state.pinchLogScale = logScale
	state.pinchCenter = pointer
	cancelZoomAnimation(elements)
}

function startPinch(elements: ZoomElements, state: ZoomState): void {
	const [left, right] = [...state.pointers.values()]
	if (!left || !right) {
		return
	}

	resumePinch(elements, state, center(left, right))
	state.pinch = {
		distance: distance(left, right),
		scale: state.scale,
		logScale: state.pinchLogScale ?? Math.log(state.scale),
		panX: state.panX,
		panY: state.panY,
		center: center(left, right),
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

	applyPinch(elements, state, pinch, {
		center: center(left, right),
		logScale:
			pinch.logScale +
			Math.log(distance(left, right) / Math.max(1, pinch.distance)),
	})

	return true
}

function scaleMode(scale: number, maximum: number): ZoomMode {
	return scale === 1
		? "fit"
		: Math.abs(scale - maximum) < 0.01
			? "actual"
			: "custom"
}

function elasticRatio(elements: ZoomElements, state: ZoomState): number {
	return state.pinchLogScale === null
		? 1
		: zoomScales(state.pinchLogScale, maximumScale(elements)).elasticScale /
				state.scale
}

function applyPinch(
	elements: ZoomElements,
	state: ZoomState,
	pinch: Omit<Pinch, "distance" | "logScale">,
	current: {center: Point; logScale: number},
): void {
	state.pinchLogScale = current.logScale
	state.pinchCenter = current.center
	const maximum = maximumScale(elements)
	const {scale} = zoomScales(current.logScale, maximum)
	Object.assign(
		state,
		pinchPan(
			pinch,
			{scale, center: current.center},
			elements.viewport.getBoundingClientRect(),
		),
	)
	state.mode = scaleMode(scale, maximum)

	if (scale > 1) {
		loadOriginal(elements, state)
	}

	state.scale = scale
	renderZoom(elements, state)
}

function settlePinch(elements: ZoomElements, state: ZoomState): void {
	if (state.pinchLogScale === null) {
		return
	}
	const stretched =
		state.pinchLogScale < 0 ||
		state.pinchLogScale > Math.log(maximumScale(elements))
	state.pinchLogScale = null
	state.pinchCenter = null
	const maximum = maximumScale(elements)
	const bounded = Math.max(1, Math.min(maximum, state.scale))
	state.mode = scaleMode(bounded, maximum)
	renderZoom(elements, state, stretched || bounded === 1 ? "spring" : undefined)
}

function bindTrackpadGestures(elements: ZoomElements, state: ZoomState): void {
	const options = {passive: false, signal: elements.signal}
	let gestureScale: number | null = null
	let wheelEnd: ReturnType<typeof setTimeout> | undefined
	const zoom = (pointer: Point, logRatio: number) => {
		resumePinch(elements, state, pointer)
		applyPinch(
			elements,
			state,
			{scale: state.scale, panX: state.panX, panY: state.panY, center: pointer},
			{
				center: pointer,
				logScale: (state.pinchLogScale ?? Math.log(state.scale)) + logRatio,
			},
		)
	}
	elements.signal.addEventListener("abort", () => clearTimeout(wheelEnd), {
		once: true,
	})

	// Chrome and Firefox report trackpad pinches as Ctrl+wheel.
	elements.viewport.addEventListener(
		"wheel",
		(event) => {
			if (!event.ctrlKey) {
				return
			}
			event.preventDefault()
			if (gestureScale !== null) {
				return
			}
			const unit =
				event.deltaMode === 1
					? 16
					: event.deltaMode === 2
						? elements.viewport.clientHeight
						: 1
			zoom(point(event), -event.deltaY * unit * 0.01)
			clearTimeout(wheelEnd)
			// Wheel has no gesture-end event; settle after a short pause.
			wheelEnd = setTimeout(() => settlePinch(elements, state), 150)
		},
		options,
	)

	// Safari uses gesture events instead. Ignore its matching wheel events.
	type GestureEvent = MouseEvent & {scale: number}
	elements.viewport.addEventListener(
		"gesturestart",
		(event) => {
			if (state.pointers.size > 1) {
				return
			}
			event.preventDefault()
			clearTimeout(wheelEnd)
			gestureScale = (event as GestureEvent).scale
		},
		options,
	)
	elements.viewport.addEventListener(
		"gesturechange",
		(event) => {
			if (gestureScale === null) {
				return
			}
			event.preventDefault()
			const gesture = event as GestureEvent
			zoom(point(gesture), Math.log(gesture.scale / gestureScale))
			gestureScale = gesture.scale
		},
		options,
	)
	elements.viewport.addEventListener(
		"gestureend",
		(event) => {
			if (gestureScale !== null) {
				event.preventDefault()
				gestureScale = null
				settlePinch(elements, state)
			}
		},
		options,
	)
}

function bindPointerGestures(elements: ZoomElements, state: ZoomState): void {
	elements.viewport.addEventListener(
		"scroll",
		() => synchronizePan(elements, state),
		{signal: elements.signal},
	)
	elements.viewport.addEventListener(
		"touchstart",
		(event) => {
			if (event.touches.length === 2) {
				state.pointers.clear()
				for (const finger of Array.from(event.touches)) {
					state.pointers.set(finger.identifier, {
						x: finger.clientX,
						y: finger.clientY,
					})
				}
				state.pinch = null
				startPinch(elements, state)
			}
		},
		{passive: true, signal: elements.signal},
	)
	elements.viewport.addEventListener(
		"touchmove",
		(event) => {
			if (event.touches.length === 2) {
				event.preventDefault()
				state.pointers.clear()
				for (const touch of Array.from(event.touches)) {
					state.pointers.set(touch.identifier, {
						x: touch.clientX,
						y: touch.clientY,
					})
				}
				updatePinch(elements, state)
				return
			}
		},
		{passive: false, signal: elements.signal},
	)
	const endTouch = () => {
		const pinching = state.pinch !== null
		state.pointers.clear()
		state.pinch = null
		if (pinching) {
			settlePinch(elements, state)
		}
	}
	elements.viewport.addEventListener("touchend", endTouch, {
		signal: elements.signal,
	})
	elements.viewport.addEventListener("touchcancel", endTouch, {
		signal: elements.signal,
	})
	elements.signal.addEventListener(
		"abort",
		() => {
			for (const id of state.pointers.keys()) {
				if (elements.viewport.hasPointerCapture(id)) {
					elements.viewport.releasePointerCapture(id)
				}
			}
			state.pointers.clear()
		},
		{once: true},
	)
	elements.viewport.addEventListener(
		"pointerdown",
		(event) => {
			if (event.pointerType === "touch") {
				return
			}
			if (elements.animations.size) {
				resumePinch(elements, state, point(event))
				renderZoom(elements, state)
			}
			state.pointers.set(event.pointerId, point(event))

			if (state.pointers.size === 2) {
				startPinch(elements, state)
				return
			}

			if (state.scale > 1) {
				elements.viewport.setPointerCapture(event.pointerId)
			}
		},
		{signal: elements.signal},
	)

	elements.viewport.addEventListener(
		"pointermove",
		(event) => {
			const previous = state.pointers.get(event.pointerId)
			if (!previous) {
				return
			}

			state.pointers.set(event.pointerId, point(event))
			if (state.pointers.size > 1 && updatePinch(elements, state)) {
				return
			}

			if (state.scale > 1) {
				const ratio = elasticRatio(elements, state)
				state.panX += (event.clientX - previous.x) / ratio
				state.panY += (event.clientY - previous.y) / ratio
				renderZoom(elements, state)
				elements.viewport.style.cursor = state.loupeActive
					? "crosshair"
					: "grabbing"
			}
		},
		{signal: elements.signal},
	)

	const endPointer = (event: PointerEvent) => {
		if (!state.pointers.has(event.pointerId) || event.pointerType === "touch") {
			return
		}
		state.pointers.delete(event.pointerId)
		state.pinch = null
		if (state.pinchLogScale !== null) {
			settlePinch(elements, state)
		} else {
			renderZoom(elements, state)
		}
	}

	window.addEventListener("pointerup", endPointer, {
		signal: elements.signal,
	})
	window.addEventListener("pointercancel", endPointer, {
		signal: elements.signal,
	})
}

function fitZoom(elements: ZoomElements, state: ZoomState): void {
	state.pinchLogScale = null
	state.pinchCenter = null
	state.mode = "fit"
	state.scale = 1
	renderZoom(elements, state, "zoom")
}

function actualZoom(
	elements: ZoomElements,
	state: ZoomState,
	pointer?: Point,
): void {
	state.pinchLogScale = null
	state.pinchCenter = null
	const scale = maximumScale(elements)
	if (pointer) {
		const image = elements.image.getBoundingClientRect()
		const viewport = elements.viewport.getBoundingClientRect()
		const ratio = scale / state.scale
		state.panX =
			pointer.x -
			viewport.left -
			viewport.width / 2 -
			(pointer.x - image.left - image.width / 2) * ratio
		state.panY =
			pointer.y -
			viewport.top -
			viewport.height / 2 -
			(pointer.y - image.top - image.height / 2) * ratio
	} else {
		state.panX = 0
		state.panY = 0
	}
	state.scale = scale
	state.mode = "actual"
	loadOriginal(elements, state)
	renderZoom(elements, state, "zoom")
}

function zoomAtPoint(
	elements: ZoomElements,
	state: ZoomState,
	pointer: Point,
): void {
	if (!loupeContainsPointer(elements, pointer)) {
		return
	}
	if (state.mode !== "fit") {
		fitZoom(elements, state)
	} else if (maximumScale(elements) > state.scale) {
		actualZoom(elements, state, pointer)
	}
}

function bindDoubleZoom(elements: ZoomElements, state: ZoomState): void {
	const options = {signal: elements.signal}
	const scroll = elements.viewport.closest<HTMLElement>("[data-photo-scroll]")
	const scrollPosition = (): Point => ({
		x: elements.viewport.scrollLeft + (scroll?.scrollLeft ?? 0),
		y: elements.viewport.scrollTop + (scroll?.scrollTop ?? 0),
	})
	type Tap = {point: Point; time: number; scroll: Point}
	let touch: (Tap & {id: number}) | null = null
	let previous: Tap | null = null
	elements.viewport.addEventListener(
		"dblclick",
		(event) => {
			zoomAtPoint(elements, state, point(event))
		},
		options,
	)
	elements.viewport.addEventListener(
		"pointerdown",
		(event) => {
			if (event.pointerType !== "touch") {
				return
			}
			if (touch) {
				touch = null
				previous = null
				return
			}
			touch = {
				id: event.pointerId,
				point: point(event),
				time: performance.now(),
				scroll: scrollPosition(),
			}
		},
		options,
	)
	elements.viewport.addEventListener(
		"pointermove",
		(event) => {
			if (touch && distance(touch.point, point(event)) > 24) {
				touch = null
				previous = null
			}
		},
		options,
	)
	elements.viewport.addEventListener(
		"pointerup",
		(event) => {
			if (touch?.id !== event.pointerId) {
				return
			}
			const tap = {
				point: point(event),
				time: performance.now(),
				scroll: scrollPosition(),
			}
			const valid = tap.time - touch.time < 300
			touch = null
			if (!valid) {
				previous = null
				return
			}
			if (
				previous &&
				tap.time - previous.time < 300 &&
				distance(previous.point, tap.point) < 24 &&
				distance(previous.scroll, tap.scroll) <= 12
			) {
				zoomAtPoint(elements, state, tap.point)
				previous = null
				return
			}
			previous = tap
		},
		options,
	)
	const cancel = () => {
		touch = null
		previous = null
	}
	elements.viewport.addEventListener("pointercancel", cancel, options)
	window.addEventListener(
		"scroll",
		() => {
			const start = touch ?? previous
			// Native snap can still move a few pixels between intentional taps.
			if (start && distance(start.scroll, scrollPosition()) > 12) {
				cancel()
			}
		},
		{...options, capture: true},
	)
}

function observeZoomSize(elements: ZoomElements, state: ZoomState): void {
	elements.image.addEventListener(
		"load",
		() => {
			if (state.mode === "actual") {
				state.scale = maximumScale(elements)
			}

			renderZoom(elements, state)
		},
		{signal: elements.signal},
	)

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
	elements.signal.addEventListener("abort", () => resizeObserver.disconnect(), {
		once: true,
	})
}

function loupeContainsPointer(elements: ZoomElements, pointer: Point): boolean {
	const bounds = elements.image.getBoundingClientRect()
	const viewport = elements.viewport.getBoundingClientRect()
	return (
		pointer.x >= Math.max(bounds.left, viewport.left) &&
		pointer.x <= Math.min(bounds.right, viewport.right) &&
		pointer.y >= Math.max(bounds.top, viewport.top) &&
		pointer.y <= Math.min(bounds.bottom, viewport.bottom)
	)
}

function synchronizeLoupe(elements: ZoomElements, state: ZoomState): void {
	const available =
		loupeInput.matches && state.mode === "fit" && state.pinchLogScale === null
	if (!available) {
		state.loupeActive = false
		const loupe = elements.detail.querySelector<HTMLElement>(
			"[data-photo-loupe-view]",
		)
		if (loupe) {
			loupe.hidden = true
		}
	}
	if (elements.loupeButton) {
		elements.loupeButton.hidden = !loupeInput.matches
		elements.loupeButton.disabled = !available
		elements.loupeButton.ariaPressed = String(state.loupeActive)
	}
	elements.viewport.style.touchAction =
		state.scale > 1 ? "pan-x pan-y" : "pan-y"
}

function bindLoupe(elements: ZoomElements, state: ZoomState) {
	const loupe = document.createElement("div")
	loupe.dataset.photoLoupeView = ""
	loupe.setAttribute("aria-hidden", "true")
	loupe.className =
		"pointer-events-none fixed z-30 size-60 overflow-hidden rounded-full bg-black bg-no-repeat shadow-xl ring-2 ring-foreground/70"
	loupe.hidden = true
	elements.detail.append(loupe)
	const render = () => {
		elements.viewport.style.cursor = photoCursor(state)
		const pointer = state.loupePoint
		const bounds = elements.image.getBoundingClientRect()
		const visible =
			state.loupeActive && pointer && loupeContainsPointer(elements, pointer)
		loupe.hidden = !visible
		if (!visible || !pointer) {
			return
		}
		loadOriginal(elements, state)
		const size = Math.min(240, window.innerWidth, window.innerHeight)
		const ratio = Math.max(1, window.devicePixelRatio)
		const width = Number(elements.image.dataset.photoWidth) / ratio
		const height = Number(elements.image.dataset.photoHeight) / ratio
		let x = pointer.x + 8
		let y = pointer.y - size - 8
		if (x + size > window.innerWidth) {
			x = pointer.x - size - 8
		}
		if (y < 0) {
			y = pointer.y + 8
		}
		loupe.style.width = loupe.style.height = `${size}px`
		loupe.style.left = `${Math.max(0, Math.min(window.innerWidth - size, x))}px`
		loupe.style.top = `${Math.max(0, Math.min(window.innerHeight - size, y))}px`
		loupe.style.backgroundImage = `url(${JSON.stringify(elements.originalImage.dataset.photoSource)})`
		loupe.style.backgroundSize = `${width}px ${height}px`
		loupe.style.backgroundPosition = `${size / 2 - ((pointer.x - bounds.left) / bounds.width) * width}px ${size / 2 - ((pointer.y - bounds.top) / bounds.height) * height}px`
	}
	const options = {signal: elements.signal}
	elements.viewport.addEventListener(
		"pointerdown",
		(event) => {
			if (event.pointerType === "touch") {
				state.loupePoint = null
				render()
			}
		},
		options,
	)
	elements.detail.addEventListener(
		"pointermove",
		(event) => {
			state.loupePoint = event.pointerType === "touch" ? null : point(event)
			render()
		},
		options,
	)
	elements.detail.addEventListener(
		"pointerleave",
		() => {
			state.loupePoint = null
			render()
		},
		options,
	)
	window.addEventListener(
		"scroll",
		() => {
			state.loupePoint = null
			render()
		},
		{...options, capture: true},
	)
	window.addEventListener("resize", render, options)
	elements.signal.addEventListener("abort", () => loupe.remove(), {once: true})
	loupeInput.addEventListener(
		"change",
		() => {
			state.loupePoint = null
			synchronizeLoupe(elements, state)
			render()
		},
		options,
	)
	return () => {
		if (!loupeInput.matches || state.mode !== "fit") {
			return
		}
		state.loupeActive = !state.loupeActive
		synchronizeLoupe(elements, state)
		if (state.loupeActive) {
			loadOriginal(elements, state)
		}
		render()
	}
}

export function initializePhotoZoom(
	frame: HTMLElement,
	detail: HTMLElement,
	loupeActive = false,
) {
	const controller = new AbortController()
	const elements = getZoomElements(frame, detail, controller.signal)

	const state = createZoomState()
	state.loupeActive = loupeActive

	elements.viewport.classList.add(
		"scrollbar-none",
		"[&::-webkit-scrollbar]:hidden",
	)
	bindDoubleZoom(elements, state)
	bindPointerGestures(elements, state)
	bindTrackpadGestures(elements, state)
	const toggleLoupe = bindLoupe(elements, state)
	observeZoomSize(elements, state)
	renderZoom(elements, state)
	return {
		fit() {
			fitZoom(elements, state)
		},
		actual() {
			actualZoom(elements, state)
		},
		toggleLoupe,
		get loupeActive() {
			return state.loupeActive
		},
		dispose() {
			controller.abort()
			cancelZoomAnimation(elements)
		},
	}
}
