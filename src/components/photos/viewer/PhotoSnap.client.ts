import type {PhotoContext} from "../PhotoContext.ts"
import {
	parsePhotoContexts,
	photoContextHref,
	photoDetailHref,
} from "../PhotoContext.ts"
import {createPhotoScrollSpring} from "./PhotoScrollSpring.ts"

export type PhotoSnapPage = {
	id: string
	contexts: PhotoContext[]
	frame: HTMLElement
	info: HTMLElement | null
	title: string
	metadata: Array<{selector: string; content: string}>
}

type Panel = {element: HTMLElement; page: PhotoSnapPage; href: string}
type Direction = -1 | 1

const adjacentPanels = 4

function snapshot(
	detail: HTMLElement,
	sourceDocument: Document,
): PhotoSnapPage | null {
	const id = detail.dataset.photoId
	const frame = detail.querySelector<HTMLElement>("[data-photo-frame]")
	if (!id || !frame) {
		return null
	}
	const info = detail.querySelector<HTMLElement>("[data-photo-info-content]")
	const selectors = [
		'meta[name="description"]',
		'meta[property="og:title"]',
		'meta[property="og:description"]',
		'meta[property="og:image"]',
		'meta[property="og:url"]',
		'meta[name="twitter:title"]',
		'meta[name="twitter:description"]',
		'meta[name="twitter:image"]',
	]
	return {
		id,
		contexts: parsePhotoContexts(detail.dataset.photoContexts),
		frame: document.importNode(frame, true),
		info: info ? document.importNode(info, true) : null,
		title: sourceDocument.title,
		metadata: selectors.flatMap((selector) => {
			const content = sourceDocument
				.querySelector(selector)
				?.getAttribute("content")
			return content === null || content === undefined
				? []
				: [{selector, content}]
		}),
	}
}

function panelFor(page: PhotoSnapPage, href: string): Panel | null {
	const element = page.frame.cloneNode(true)
	if (!(element instanceof HTMLElement)) {
		return null
	}
	element.dataset.photoPanel = ""
	const panel = {element, page, href}
	setActive(panel, false)
	return panel
}

function setActive(panel: Panel, active: boolean): void {
	panel.element.inert = !active
	panel.element.setAttribute("aria-hidden", String(!active))
}

export function initializePhotoSnap(
	detail: HTMLElement,
	contextFor: (contexts: PhotoContext[]) => PhotoContext | undefined,
	activate: (page: PhotoSnapPage, frame: HTMLElement) => void,
) {
	const scrollElement = detail.querySelector("[data-photo-scroll]")
	const viewport = detail.querySelector("[data-photo-frame]")
	const context = contextFor(parsePhotoContexts(detail.dataset.photoContexts))
	if (
		!(scrollElement instanceof HTMLElement) ||
		!(viewport instanceof HTMLElement) ||
		!context ||
		context.total < 2
	) {
		return null
	}

	const scroll = scrollElement
	const initial = snapshot(detail, document)
	if (!initial) {
		return null
	}
	const controller = new AbortController()
	const {signal} = controller
	const search = new URLSearchParams(location.search)
	const first: Panel = {
		element: viewport,
		page: initial,
		href: `${location.pathname}${location.search}`,
	}
	viewport.dataset.photoPanel = ""

	const panels = [first]
	const pendingPrevious: Panel[] = []
	let active = first
	let destination: Panel | null = null
	let adjusting = false
	let scrollFrame = 0
	let lastScroll = 0
	let settleTimer = 0
	const spring = createPhotoScrollSpring(scroll, settle)
	const filling = new Map<Direction, Promise<void>>()
	const failed = new Set<Direction>()
	const pages = new Map<string, Promise<PhotoSnapPage>>()
	pages.set(first.href, Promise.resolve(initial))

	function hrefFor(panel: Panel, direction: Direction): string | null {
		const selected = contextFor(panel.page.contexts)
		const id = direction < 0 ? selected?.previousId : selected?.nextId
		if (!id) {
			return null
		}
		return photoContextHref(photoDetailHref(id, selected?.reference), search)
	}

	async function fetchPage(href: string): Promise<PhotoSnapPage> {
		const cached = pages.get(href)
		if (cached) {
			return cached
		}
		const request = (async () => {
			const response = await fetch(href, {signal})
			if (!response.ok) {
				throw new Error("Photo page could not be loaded")
			}
			const parsed = new DOMParser().parseFromString(
				await response.text(),
				"text/html",
			)
			const source = parsed.querySelector("[data-photo-detail]")
			if (!(source instanceof HTMLElement)) {
				throw new Error("Photo page is missing its viewer")
			}
			const page = snapshot(source, parsed)
			if (!page) {
				throw new Error("Photo page is missing its frame")
			}
			return page
		})()
		pages.set(href, request)
		try {
			const page = await request
			// Keep a bounded page cache even when a collection wraps repeatedly.
			const oldest =
				pages.size > adjacentPanels * 4 ? pages.keys().next().value : undefined
			if (oldest !== undefined) {
				pages.delete(oldest)
			}
			return page
		} catch (error) {
			pages.delete(href)
			throw error
		}
	}

	function preservePosition(change: () => void): void {
		const before = active.element.offsetTop
		const top = scroll.scrollTop
		adjusting = true
		scroll.classList.remove("snap-y", "snap-mandatory")
		change()
		scroll.scrollTop = top + active.element.offsetTop - before
		adjusting = false
		requestAnimationFrame(() => {
			if (!spring.running) {
				scroll.classList.add("snap-y", "snap-mandatory")
			}
		})
	}

	function insertPrevious(): void {
		if (!pendingPrevious.length || signal.aborted) {
			return
		}
		preservePosition(() => {
			const previous = pendingPrevious.splice(0)
			panels.unshift(...previous)
			scroll.prepend(...previous.map((panel) => panel.element))
		})
	}

	function nextHref(direction: Direction): string | null {
		const index = panels.indexOf(destination ?? active)
		const available =
			direction < 0 ? index + pendingPrevious.length : panels.length - index - 1
		if (available >= adjacentPanels) {
			return null
		}
		const edge =
			direction < 0
				? (pendingPrevious[0] ?? panels[0])
				: panels[panels.length - 1]
		return edge ? hrefFor(edge, direction) : null
	}

	function insertPanel(panel: Panel, direction: Direction): void {
		if (direction < 0) {
			pendingPrevious.unshift(panel)
			// Do not move the scroll origin during an active gesture.
			if (Date.now() - lastScroll >= 180) {
				insertPrevious()
			}
		} else {
			panels.push(panel)
			scroll.append(panel.element)
		}
		const preview =
			panel.element.querySelector<HTMLImageElement>("[data-photo-image]")
		if (preview) {
			preview.loading = "eager"
		}
	}

	async function loadAdjacent(direction: Direction): Promise<boolean> {
		const href = nextHref(direction)
		if (!href || signal.aborted) {
			return false
		}
		const page = await fetchPage(href)
		if (signal.aborted) {
			return false
		}
		const panel = panelFor(page, href)
		if (!panel) {
			throw new Error("Photo panel could not be loaded")
		}
		insertPanel(panel, direction)
		return true
	}

	async function fillBuffer(direction: Direction): Promise<void> {
		try {
			while (await loadAdjacent(direction)) {
				// Follow the adjacent IDs until the preview buffer is ready.
			}
		} catch {
			if (!signal.aborted) {
				failed.add(direction)
			}
		} finally {
			filling.delete(direction)
		}
	}

	function fill(direction: Direction): Promise<void> {
		const current = filling.get(direction)
		if (current) {
			return current
		}
		if (failed.has(direction)) {
			return Promise.resolve()
		}
		const request = fillBuffer(direction)
		filling.set(direction, request)
		return request
	}

	function updateActive(): void {
		if (adjusting || signal.aborted || detail.dataset.photoZoomed === "true") {
			return
		}
		const index = Math.round(
			scroll.scrollTop / Math.max(1, scroll.clientHeight),
		)
		const next = panels[index]
		if (next && next !== active) {
			setActive(active, false)
			active = next
			setActive(active, true)
			history.replaceState(history.state, "", active.href)
			activate(active.page, active.element)
		}
		void fill(-1)
		void fill(1)
	}

	function settle(): void {
		if (spring.running) {
			return
		}
		destination = null
		updateActive()
		if (adjusting || signal.aborted || detail.dataset.photoZoomed === "true") {
			return
		}
		if (pendingPrevious.length) {
			insertPrevious()
		}
		const index = panels.indexOf(active)
		const removeBefore = Math.max(0, index - adjacentPanels)
		const removeAfter = Math.max(0, panels.length - index - adjacentPanels - 1)
		if (removeBefore || removeAfter) {
			preservePosition(() => {
				for (const panel of panels.splice(0, removeBefore)) {
					panel.element.remove()
				}
				for (const panel of panels.splice(
					panels.length - removeAfter,
					removeAfter,
				)) {
					panel.element.remove()
				}
			})
		}
	}

	function moveTo(panel: Panel): void {
		destination = panel
		spring.to(panel.element)
		updateActive()
	}

	function adjacentTarget(direction: Direction): Panel | undefined {
		return panels[panels.indexOf(destination ?? active) + direction]
	}

	async function step(direction: Direction): Promise<void> {
		if (direction < 0) {
			insertPrevious()
		}
		const next = adjacentTarget(direction)
		if (next) {
			moveTo(next)
			return
		}
		await fill(direction)
		if (signal.aborted) {
			return
		}
		if (direction < 0) {
			insertPrevious()
		}
		const loaded = adjacentTarget(direction)
		if (loaded) {
			moveTo(loaded)
		}
	}

	scroll.addEventListener(
		"wheel",
		() => {
			spring.cancel()
			destination = null
		},
		{signal, passive: true},
	)

	scroll.addEventListener(
		"scroll",
		() => {
			if (adjusting) {
				return
			}
			lastScroll = Date.now()
			cancelAnimationFrame(scrollFrame)
			scrollFrame = requestAnimationFrame(updateActive)
			clearTimeout(settleTimer)
			settleTimer = window.setTimeout(settle, 180)
		},
		{signal, passive: true},
	)
	scroll.addEventListener("scrollend", settle, {signal})

	scroll.addEventListener(
		"pointerdown",
		() => {
			spring.cancel()
			destination = null
		},
		{signal},
	)

	void fill(-1)
	void fill(1)
	return {
		step(direction: Direction): boolean {
			if (failed.has(direction) || signal.aborted) {
				return false
			}
			void step(direction)
			return true
		},
		dispose() {
			controller.abort()
			spring.cancel()
			cancelAnimationFrame(scrollFrame)
			clearTimeout(settleTimer)
		},
	}
}
