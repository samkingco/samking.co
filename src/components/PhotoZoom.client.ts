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
	detail: HTMLElement
	signal: AbortSignal
	loupeButton: HTMLButtonElement | null
	viewport: HTMLElement
	presentation: HTMLElement
	image: HTMLImageElement
	originalImage: HTMLImageElement
	actualButton: HTMLButtonElement
	fitButton: HTMLButtonElement
	navigation: HTMLElement | null
}

type ZoomState = {
	loupeActive: boolean
	loupePoint: Point | null
	mode: ZoomMode
	scale: number
	panX: number
	panY: number
	suppressNavigationUntil: number
	lastPoint: Point | null
	pinch: Pinch | null
	originalLoading: boolean
	pointers: Map<number, Point>
	wheelTime: number
	wheelNavigated: boolean
	edgeGesture: number
	touchStart: Point | null
	animation: Animation | null
}

function getZoomElements(
	detail: HTMLElement,
	signal: AbortSignal,
): ZoomElements | null {
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
		presentation:
			viewport.querySelector<HTMLElement>("[data-photo-presentation]") ??
			viewport,
		detail,
		signal,
		loupeButton: detail.querySelector<HTMLButtonElement>("[data-photo-loupe]"),
		image,
		originalImage,
		actualButton,
		fitButton,
		navigation: navigation instanceof HTMLElement ? navigation : null,
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
		suppressNavigationUntil: 0,
		lastPoint: null,
		pinch: null,
		originalLoading: false,
		pointers: new Map(),
		wheelTime: 0,
		wheelNavigated: false,
		edgeGesture: 0,
		touchStart: null,
		animation: null,
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

function panLimits(elements: ZoomElements, state: ZoomState): Point {
	const padding = state.scale > 1 ? 80 : 0
	const x =
		Math.max(
			0,
			(elements.image.clientWidth * state.scale -
				elements.viewport.clientWidth) /
				2,
		) + padding

	const y =
		Math.max(
			0,
			(elements.image.clientHeight * state.scale -
				elements.viewport.clientHeight) /
				2,
		) + padding
	return {x, y}
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
): void {
	const after = elements.image.getBoundingClientRect()
	if (
		!after.width ||
		!before.width ||
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	) {
		return
	}
	const transform = `scale(${state.scale})`
	const from = `translate(${before.left - after.left + (before.width - after.width) / 2}px, ${before.top - after.top + (before.height - after.height) / 2}px) scale(${(state.scale * before.width) / after.width})`
	for (const image of [elements.image, elements.originalImage]) {
		const animation = image.animate([{transform: from}, {transform}], {
			duration: 160,
			easing: "ease-out",
		})
		state.animation = animation
		elements.signal.addEventListener("abort", () => animation.cancel(), {
			once: true,
		})
	}
}

function sizeZoomCanvas(elements: ZoomElements, state: ZoomState): void {
	const width = elements.viewport.clientWidth
	const height = elements.viewport.clientHeight
	const limits = panLimits(elements, state)
	const canvasWidth = width + limits.x * 2
	const canvasHeight = height + limits.y * 2
	const zoomed = state.scale > 1
	elements.detail.dataset.photoZoomed = String(zoomed)
	elements.viewport.style.overflow = zoomed ? "auto" : ""
	elements.viewport.style.overscrollBehavior = zoomed ? "contain" : ""
	elements.presentation.style.width = zoomed ? `${canvasWidth}px` : ""
	elements.presentation.style.height = zoomed ? `${canvasHeight}px` : ""
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
	for (const wrapper of new Set([
		elements.image.parentElement,
		elements.originalImage.parentElement,
	])) {
		if (wrapper) {
			Object.assign(wrapper.style, style)
		}
	}
}

function renderZoom(
	elements: ZoomElements,
	state: ZoomState,
	animate = false,
): void {
	const before = elements.image.getBoundingClientRect()
	cancelZoomAnimation(elements)
	state.animation = null
	const maximum = maximumScale(elements)
	state.scale = Math.max(1, Math.min(maximum, state.scale))

	if (state.scale === 1) {
		state.panX = 0
		state.panY = 0
	}

	clampPan(elements, state)
	synchronizeLoupe(elements, state)

	sizeZoomCanvas(elements, state)
	const transform = `scale(${state.scale})`
	elements.image.style.transform = transform
	elements.originalImage.style.transform = transform
	const limits = panLimits(elements, state)
	elements.viewport.scrollLeft = limits.x - state.panX
	elements.viewport.scrollTop = limits.y - state.panY
	if (animate) {
		animateZoom(elements, state, before)
	}

	elements.actualButton.ariaPressed = String(
		Math.abs(state.scale - maximum) < 0.01,
	)
	elements.fitButton.ariaPressed = String(state.scale === 1)

	if (elements.navigation) {
		elements.navigation.style.pointerEvents =
			state.scale > 1 || state.pointers.size > 1 ? "none" : ""
	}

	elements.viewport.style.cursor = photoCursor(state)
	elements.detail.dataset.photoZoomed = String(state.scale > 1)
	elements.viewport.style.touchAction =
		state.scale > 1 ? "pan-x pan-y" : "pan-y"
}

function cancelZoomAnimation(elements: ZoomElements): void {
	for (const image of [elements.image, elements.originalImage]) {
		for (const animation of image.getAnimations()) {
			animation.cancel()
		}
	}
}

function edgeDirection(elements: ZoomElements, delta: number): number {
	const viewport = elements.viewport
	if (delta < 0 && viewport.scrollTop <= 1) {
		return -1
	}
	if (
		delta > 0 &&
		viewport.scrollTop >= viewport.scrollHeight - viewport.clientHeight - 1
	) {
		return 1
	}
	return 0
}

function navigateFromZoom(
	elements: ZoomElements,
	state: ZoomState,
	direction: number,
): void {
	const button = elements.detail.querySelector<HTMLElement>(
		direction > 0 ? "[data-context-next]" : "[data-context-previous]",
	)
	if (!button || state.scale <= 1) {
		return
	}
	state.mode = "fit"
	state.scale = 1
	state.suppressNavigationUntil = 0
	renderZoom(elements, state, true)
	const navigate = () => {
		if (!elements.signal.aborted && state.scale === 1) {
			button.click()
		}
	}
	if (state.animation) {
		void state.animation.finished.then(navigate, () => {})
	} else {
		navigate()
	}
}

function loadOriginal(elements: ZoomElements, state: ZoomState): void {
	const source = elements.originalImage.dataset.photoSource
	if (!source || state.originalLoading) {
		return
	}

	if (
		elements.originalImage.complete &&
		elements.originalImage.naturalWidth > 0
	) {
		elements.originalImage.style.opacity = "1"
		return
	}
	state.originalLoading = true
	elements.originalImage.addEventListener(
		"load",
		() => {
			state.originalLoading = false
			requestAnimationFrame(() => {
				if (!elements.signal.aborted) {
					elements.originalImage.style.opacity = "1"
				}
			})
		},
		{once: true, signal: elements.signal},
	)
	elements.originalImage.addEventListener(
		"error",
		() => {
			state.originalLoading = false
			elements.originalImage.removeAttribute("src")
		},
		{once: true, signal: elements.signal},
	)
	if (elements.originalImage.getAttribute("src") !== source) {
		elements.originalImage.src = source
	}
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

function startPinch(state: ZoomState): void {
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
}

function updatePinch(elements: ZoomElements, state: ZoomState): boolean {
	const [left, right] = [...state.pointers.values()]
	if (!left || !right) {
		return false
	}

	if (!state.pinch) {
		startPinch(state)
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
	elements.viewport.style.cursor = state.loupeActive ? "crosshair" : "grabbing"
}

function navigateFromTouch(
	event: TouchEvent,
	elements: ZoomElements,
	state: ZoomState,
): void {
	const touch = event.touches[0]
	if (!touch || !state.touchStart || !state.edgeGesture) {
		return
	}
	const delta = state.touchStart.y - touch.clientY
	const direction =
		state.edgeGesture === 2 ? Math.sign(delta) : state.edgeGesture
	if (
		delta * direction > 60 &&
		Math.abs(delta) > Math.abs(touch.clientX - state.touchStart.x)
	) {
		event.preventDefault()
		navigateFromZoom(elements, state, direction)
		state.edgeGesture = 0
	}
}

function bindPointerGestures(elements: ZoomElements, state: ZoomState): void {
	elements.viewport.addEventListener(
		"scroll",
		() => {
			state.panX =
				(elements.viewport.scrollWidth - elements.viewport.clientWidth) / 2 -
				elements.viewport.scrollLeft
			state.panY =
				(elements.viewport.scrollHeight - elements.viewport.clientHeight) / 2 -
				elements.viewport.scrollTop
		},
		{signal: elements.signal},
	)
	elements.viewport.addEventListener(
		"touchstart",
		(event) => {
			const touch = event.touches[0]
			state.touchStart = touch ? {x: touch.clientX, y: touch.clientY} : null
			state.edgeGesture = 0
			if (event.touches.length === 1 && state.scale > 1) {
				const previous = edgeDirection(elements, -1)
				const next = edgeDirection(elements, 1)
				state.edgeGesture = previous && next ? 2 : previous + next
			}
			if (event.touches.length === 2) {
				state.pointers.clear()
				for (const finger of Array.from(event.touches)) {
					state.pointers.set(finger.identifier, {
						x: finger.clientX,
						y: finger.clientY,
					})
				}
				state.pinch = null
				startPinch(state)
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
			navigateFromTouch(event, elements, state)
		},
		{passive: false, signal: elements.signal},
	)
	const endTouch = () => {
		const pinching = state.pinch !== null
		state.pointers.clear()
		state.pinch = null
		state.touchStart = null
		state.edgeGesture = 0
		if (pinching) {
			renderZoom(elements, state)
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
			state.pointers.set(event.pointerId, point(event))

			if (state.pointers.size === 2) {
				startPinch(state)
				state.suppressNavigationUntil = Date.now() + 500
				return
			}

			state.lastPoint = point(event)
			if (state.scale > 1) {
				elements.viewport.setPointerCapture(event.pointerId)
			}
		},
		{signal: elements.signal},
	)

	elements.viewport.addEventListener(
		"pointermove",
		(event) => {
			if (!state.pointers.has(event.pointerId)) {
				return
			}

			state.pointers.set(event.pointerId, point(event))
			if (state.pointers.size > 1 && updatePinch(elements, state)) {
				return
			}

			updatePan(event, elements, state)
		},
		{signal: elements.signal},
	)

	const endPointer = (event: PointerEvent) => {
		if (!state.pointers.has(event.pointerId) || event.pointerType === "touch") {
			return
		}
		state.pointers.delete(event.pointerId)
		state.pinch = null
		state.lastPoint = [...state.pointers.values()][0] ?? null
		renderZoom(elements, state)
	}

	window.addEventListener("pointerup", endPointer, {
		signal: elements.signal,
	})
	window.addEventListener("pointercancel", endPointer, {
		signal: elements.signal,
	})
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
		state.mode = "fit"
		state.scale = 1
		renderZoom(elements, state, true)
		return
	}
	const scale = maximumScale(elements)
	if (scale <= state.scale) {
		return
	}
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
	state.scale = scale
	state.mode = "actual"
	loadOriginal(elements, state)
	renderZoom(elements, state, true)
}

function bindDoubleZoom(elements: ZoomElements, state: ZoomState): void {
	const options = {signal: elements.signal}
	let touch: {id: number; point: Point; time: number} | null = null
	let previous: {point: Point; time: number} | null = null
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
			if (!touch || touch.id !== event.pointerId) {
				return
			}
			const tap = {point: point(event), time: performance.now()}
			const valid = tap.time - touch.time < 300
			touch = null
			if (!valid) {
				previous = null
				return
			}
			if (
				previous &&
				tap.time - previous.time < 300 &&
				distance(previous.point, tap.point) < 24
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
	window.addEventListener("scroll", cancel, {...options, capture: true})
}

function bindZoomControls(elements: ZoomElements, state: ZoomState): void {
	bindDoubleZoom(elements, state)
	elements.actualButton.addEventListener(
		"click",
		() => {
			state.mode = "actual"
			loadOriginal(elements, state)
			state.scale = maximumScale(elements)
			state.panX = 0
			state.panY = 0
			renderZoom(elements, state, true)
		},
		{signal: elements.signal},
	)

	elements.fitButton.addEventListener(
		"click",
		() => {
			state.mode = "fit"
			state.scale = 1
			renderZoom(elements, state, true)
		},
		{signal: elements.signal},
	)

	elements.viewport.addEventListener(
		"wheel",
		(event) => {
			const now = performance.now()
			const newGesture = now - state.wheelTime > 180
			state.wheelTime = now
			if (newGesture) {
				state.wheelNavigated = false
			}
			if (state.wheelNavigated) {
				event.preventDefault()
				return
			}
			if (state.scale === 1) {
				return
			}

			if (newGesture && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
				const direction = edgeDirection(elements, event.deltaY)
				if (direction) {
					event.preventDefault()
					state.wheelNavigated = true
					navigateFromZoom(elements, state, direction)
				}
			}
		},
		{passive: false, signal: elements.signal},
	)

	if (elements.navigation) {
		elements.navigation.addEventListener(
			"click",
			(event) => {
				if (state.scale > 1 || Date.now() < state.suppressNavigationUntil) {
					event.preventDefault()
				}
			},
			{signal: elements.signal},
		)
	}
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

const sessions = new WeakMap<
	HTMLElement,
	{controller: AbortController; state: ZoomState}
>()

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
	const available = state.mode === "fit"
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
		elements.loupeButton.disabled = !available
		elements.loupeButton.ariaPressed = String(state.loupeActive)
	}
}

function bindLoupe(elements: ZoomElements, state: ZoomState): void {
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
	elements.loupeButton?.addEventListener(
		"click",
		() => {
			if (elements.loupeButton?.disabled) {
				return
			}
			state.loupeActive = !state.loupeActive
			elements.loupeButton!.ariaPressed = String(state.loupeActive)
			if (state.loupeActive) {
				loadOriginal(elements, state)
			}
			render()
		},
		options,
	)
	elements.detail.addEventListener(
		"pointermove",
		(event) => {
			state.loupePoint = point(event)
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
	if (elements.loupeButton) {
		elements.loupeButton.ariaPressed = String(state.loupeActive)
	}
}

export function initializePhotoZoom(detail: HTMLElement): void {
	const previous = sessions.get(detail)
	previous?.controller.abort()
	const controller = new AbortController()
	const elements = getZoomElements(detail, controller.signal)
	if (!elements) {
		return
	}

	const state = createZoomState()
	state.loupeActive = previous?.state.loupeActive ?? false
	sessions.set(detail, {controller, state})

	elements.viewport.classList.add(
		"[scrollbar-width:none]",
		"[&::-webkit-scrollbar]:hidden",
	)
	bindZoomControls(elements, state)
	bindPointerGestures(elements, state)
	bindLoupe(elements, state)
	observeZoomSize(elements, state)
	renderZoom(elements, state)
	document.addEventListener(
		"astro:before-swap",
		() => {
			controller.abort()
			sessions.delete(detail)
		},
		{once: true, signal: controller.signal},
	)
}
