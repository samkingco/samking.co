const previewGap = 16
const cycleTime = 400

type PreviewPosition = {
	left: number
	top: number
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

function pointerPosition(
	pointer: PointerEvent,
	width: number,
	height: number,
): PreviewPosition {
	const right = pointer.clientX + previewGap
	const bottom = pointer.clientY + previewGap

	return {
		left:
			right + width <= window.innerWidth - previewGap
				? right
				: pointer.clientX - width - previewGap,
		top:
			bottom + height <= window.innerHeight - previewGap
				? bottom
				: pointer.clientY - height - previewGap,
	}
}

function focusPosition(
	target: HTMLElement,
	width: number,
	height: number,
): PreviewPosition {
	const bounds = target.getBoundingClientRect()
	const rightSpace = window.innerWidth - bounds.right - previewGap
	const leftSpace = bounds.left - previewGap

	if (rightSpace >= width) {
		return {left: bounds.right + previewGap, top: bounds.top}
	}

	if (leftSpace >= width) {
		return {left: bounds.left - width - previewGap, top: bounds.top}
	}

	const below = window.innerHeight - bounds.bottom - previewGap >= height
	return {
		left: bounds.left,
		top: below ? bounds.bottom + previewGap : bounds.top - height - previewGap,
	}
}

function previewPosition(
	pointer: PointerEvent | null,
	focusTarget: HTMLElement | null,
	width: number,
	height: number,
): PreviewPosition | null {
	if (pointer) {
		return pointerPosition(pointer, width, height)
	}

	if (focusTarget) {
		return focusPosition(focusTarget, width, height)
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

	const positionPreview = () => {
		const width = preview.offsetWidth
		const height = preview.offsetHeight
		const position = previewPosition(pointer, focusTarget, width, height)
		if (!position) {
			return
		}

		const left = clampToViewport(position.left, width, window.innerWidth)
		const top = clampToViewport(position.top, height, window.innerHeight)

		preview.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`
	}

	const clearPreview = () => {
		window.clearInterval(timer)
		pointer = null
		focusTarget = null
		activeTarget = null
		preview.hidden = true
	}

	const showPreview = (target: HTMLElement) => {
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

	index.addEventListener("pointermove", (event) => {
		const target = previewTarget(index, event.target)

		if (!target && !focusTarget) {
			clearPreview()
		}
		if (!target) {
			return
		}

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
		if (!target) {
			return
		}

		if (target.matches(":focus-visible")) {
			pointer = null
		}

		focusTarget = target
		showPreview(target)
	})

	index.addEventListener("focusout", (event) => {
		const target = previewTarget(index, event.relatedTarget)
		if (!target) {
			clearPreview()
			return
		}

		focusTarget = target
		showPreview(target)
	})
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
