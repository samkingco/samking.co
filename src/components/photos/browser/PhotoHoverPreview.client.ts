const previewGap = 16
const cycleTime = 400
const hideDelay = 150

type PreviewPosition = {
	left: number
	top: number
}

type PreviewSize = {
	width: number
	height: number
}

const previewUrls = new WeakMap<HTMLElement, string[]>()

function urlsFor(target: HTMLElement): string[] {
	const cached = previewUrls.get(target)
	if (cached) {
		return cached
	}

	const parsed: unknown = JSON.parse(target.dataset.photoPreviews ?? "[]")
	const urls =
		Array.isArray(parsed) && parsed.every((url) => typeof url === "string")
			? parsed
			: []

	previewUrls.set(target, urls)
	return urls
}

function previewTarget(
	index: HTMLElement,
	source: EventTarget | null,
): HTMLElement | null {
	if (!(source instanceof Element)) {
		return null
	}

	const target = source.closest<HTMLElement>("[data-photo-previews]")
	if (!target || !index.contains(target)) {
		return null
	}

	const layout = target.dataset.photoPreviewLayout
	const activeLayout = target.closest<HTMLElement>("[data-photo-browser]")
		?.dataset.photoLayout

	return !layout || activeLayout === layout ? target : null
}

// Sides are chosen against the largest preview the CSS allows rather than the
// current image, so cycling between portrait and landscape photos never flips
// the preview across the cursor.
function pointerPosition(
	pointer: PointerEvent,
	size: PreviewSize,
	room: PreviewSize,
): PreviewPosition {
	const rightSpace = window.innerWidth - pointer.clientX - previewGap * 2
	const leftSpace = pointer.clientX - previewGap * 2
	const belowSpace = window.innerHeight - pointer.clientY - previewGap * 2
	const aboveSpace = pointer.clientY - previewGap * 2

	return {
		left:
			rightSpace >= room.width || rightSpace >= leftSpace
				? pointer.clientX + previewGap
				: pointer.clientX - size.width - previewGap,
		top:
			belowSpace >= room.height || belowSpace >= aboveSpace
				? pointer.clientY + previewGap
				: pointer.clientY - size.height - previewGap,
	}
}

function focusPosition(
	target: HTMLElement,
	size: PreviewSize,
	room: PreviewSize,
): PreviewPosition {
	const bounds = target.getBoundingClientRect()
	const rightSpace = window.innerWidth - bounds.right - previewGap
	const leftSpace = bounds.left - previewGap

	if (rightSpace >= room.width) {
		return {left: bounds.right + previewGap, top: bounds.top}
	}

	if (leftSpace >= room.width) {
		return {left: bounds.left - size.width - previewGap, top: bounds.top}
	}

	const belowSpace = window.innerHeight - bounds.bottom - previewGap
	const aboveSpace = bounds.top - previewGap
	const below = belowSpace >= room.height || belowSpace >= aboveSpace
	return {
		left: bounds.left,
		top: below
			? bounds.bottom + previewGap
			: bounds.top - size.height - previewGap,
	}
}

function previewPosition(
	pointer: PointerEvent | null,
	focusTarget: HTMLElement | null,
	size: PreviewSize,
	room: PreviewSize,
): PreviewPosition | null {
	if (pointer) {
		return pointerPosition(pointer, size, room)
	}

	if (focusTarget) {
		return focusPosition(focusTarget, size, room)
	}

	return null
}

function clampToViewport(
	value: number,
	size: number,
	viewport: number,
): number {
	return Math.max(previewGap, Math.min(value, viewport - size - previewGap))
}

function initializePhotoPreview(index: HTMLElement): void {
	if (index.dataset.photoPreviewReady === "true") {
		return
	}

	const preview = index.querySelector<HTMLImageElement>(
		"[data-photo-index-preview]",
	)
	if (!preview) {
		return
	}

	index.dataset.photoPreviewReady = "true"

	const reduceMotion = window.matchMedia(
		"(prefers-reduced-motion: reduce)",
	).matches

	let pointer: PointerEvent | null = null
	let focusTarget: HTMLElement | null = null
	let activeTarget: HTMLElement | null = null
	let timer: number | undefined
	let hideTimer: number | undefined

	const positionPreview = () => {
		const style = getComputedStyle(preview)
		const size = {width: preview.offsetWidth, height: preview.offsetHeight}
		const room = {
			width: parseFloat(style.maxWidth),
			height: parseFloat(style.maxHeight),
		}
		const position = previewPosition(pointer, focusTarget, size, room)
		if (!position) {
			return
		}

		const left = clampToViewport(position.left, size.width, window.innerWidth)
		const top = clampToViewport(position.top, size.height, window.innerHeight)

		preview.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`
	}

	const cancelHide = () => {
		window.clearTimeout(hideTimer)
		hideTimer = undefined
	}

	const clearPreview = () => {
		cancelHide()
		window.clearInterval(timer)
		pointer = null
		focusTarget = null
		activeTarget = null
		preview.hidden = true
	}

	const scheduleHide = () => {
		hideTimer ??= window.setTimeout(clearPreview, hideDelay)
	}

	const showPreview = (target: HTMLElement) => {
		cancelHide()
		window.clearInterval(timer)

		const urls = urlsFor(target)
		if (urls.length === 0) {
			clearPreview()
			return
		}

		activeTarget = target
		let current = 0
		preview.src = urls[current]
		preview.hidden = false
		requestAnimationFrame(positionPreview)

		if (reduceMotion || urls.length === 1) {
			return
		}

		timer = window.setInterval(() => {
			current = (current + 1) % urls.length
			preview.src = urls[current]
		}, cycleTime)
	}

	preview.addEventListener("load", positionPreview)

	index.addEventListener("pointerdown", (event) => {
		if (event.pointerType !== "mouse") {
			clearPreview()
		}
	})

	index.addEventListener("pointermove", (event) => {
		if (event.pointerType !== "mouse") {
			clearPreview()
			return
		}

		const target = previewTarget(index, event.target)

		if (!target) {
			// Keep the preview alive across the gaps between links so moving
			// from one link to the next swaps the image instead of flashing.
			if (activeTarget && !focusTarget) {
				pointer = event
				positionPreview()
				scheduleHide()
			}
			return
		}

		cancelHide()
		pointer = event
		focusTarget = null

		if (target !== activeTarget) {
			showPreview(target)
			return
		}

		positionPreview()
	})

	index.addEventListener("pointerleave", clearPreview)

	index.addEventListener("focusin", (event) => {
		const target = previewTarget(index, event.target)
		if (!target?.matches(":focus-visible")) {
			return
		}

		pointer = null
		focusTarget = target
		showPreview(target)
	})

	index.addEventListener("focusout", clearPreview)
}

function initializePhotoPreviews(): void {
	for (const index of document.querySelectorAll<HTMLElement>(
		"[data-photo-index]",
	)) {
		initializePhotoPreview(index)
	}
}

export function registerPhotoPreviews(): void {
	document.addEventListener("astro:page-load", initializePhotoPreviews)
}
