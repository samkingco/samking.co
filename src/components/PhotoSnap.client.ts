import type {PhotoContext} from "./PhotoContext.ts"
import {photoDetailHref} from "./PhotoContext.ts"
import {createPhotoScrollSpring} from "./PhotoScrollSpring.ts"

export type PhotoSnapPage = {
	detail: HTMLElement
	title: string
	metadata: Array<{selector: string; content: string}>
}

type Panel = {element: HTMLElement; page: PhotoSnapPage; href: string}
type Direction = -1 | 1

const adjacentPanels = 4
const scrollers = new WeakMap<HTMLElement, (direction: Direction) => boolean>()

function markPanel(element: HTMLElement): void {
	element.dataset.photoPanel = ""
	for (const name of ["viewport", "image", "original"]) {
		const target =
			name === "viewport"
				? element
				: element.querySelector(`[data-photo-${name}]`)
		target?.setAttribute(`data-panel-${name}`, "")
	}
}

function snapshot(detail: HTMLElement, document: Document): PhotoSnapPage {
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
		detail,
		title: document.title,
		metadata: selectors.flatMap((selector) => {
			const content = document.querySelector(selector)?.getAttribute("content")
			return content === null || content === undefined
				? []
				: [{selector, content}]
		}),
	}
}

function panelFor(page: PhotoSnapPage, href: string): Panel | null {
	const source = page.detail.querySelector("[data-photo-viewport]")
	if (!(source instanceof HTMLElement)) {
		return null
	}
	const element = source.cloneNode(true)
	if (!(element instanceof HTMLElement)) {
		return null
	}
	markPanel(element)
	const panel = {element, page, href}
	setActive(panel, false)
	return panel
}

function setActive(panel: Panel, active: boolean): void {
	panel.element.inert = !active
	panel.element.setAttribute("aria-hidden", String(!active))
	for (const name of ["viewport", "image", "original"]) {
		const target =
			name === "viewport"
				? panel.element
				: panel.element.querySelector(`[data-panel-${name}]`)
		if (!(target instanceof HTMLElement)) {
			continue
		}
		if (active) {
			target.setAttribute(`data-photo-${name}`, "")
		} else {
			target.removeAttribute(`data-photo-${name}`)
			target.style.transform = ""
		}
	}
}

export function scrollToAdjacentPhoto(
	detail: HTMLElement,
	direction: Direction,
): boolean {
	const step = scrollers.get(detail)
	if (!step) {
		return false
	}
	return step(direction)
}

export function initializePhotoSnap(
	detail: HTMLElement,
	contextFor: (source: HTMLElement) => PhotoContext | undefined,
	activate: (page: PhotoSnapPage) => void,
): void {
	const scrollElement = detail.querySelector("[data-photo-scroll]")
	const viewport = detail.querySelector("[data-photo-viewport]")
	const context = contextFor(detail)
	if (
		!(scrollElement instanceof HTMLElement) ||
		!(viewport instanceof HTMLElement) ||
		!context ||
		context.total < 2 ||
		scrollers.has(detail)
	) {
		return
	}

	const scroll = scrollElement
	const controller = new AbortController()
	const {signal} = controller
	const search = new URLSearchParams(location.search)
	const initial = snapshot(detail.cloneNode(true) as HTMLElement, document)
	const first: Panel = {
		element: viewport,
		page: initial,
		href: `${location.pathname}${location.search}`,
	}
	markPanel(viewport)

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
	const navigation = detail.querySelector<HTMLElement>(
		"[data-context-navigation]",
	)
	if (navigation) {
		navigation.classList.add("pointer-events-none")
	}

	function hrefFor(panel: Panel, direction: Direction): string | null {
		const selected = contextFor(panel.page.detail)
		const id = direction < 0 ? selected?.previousId : selected?.nextId
		if (!id) {
			return null
		}
		const url = new URL(
			photoDetailHref(id, selected?.reference),
			location.origin,
		)
		for (const key of ["sort", "direction"]) {
			const value = search.get(key)
			if (value) {
				url.searchParams.set(key, value)
			}
		}
		return `${url.pathname}${url.search}`
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
			return snapshot(source, parsed)
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
			panel.element.querySelector<HTMLImageElement>("[data-panel-image]")
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
			activate(active.page)
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
		if (detail.dataset.photoZoomed === "true") {
			detail.querySelector<HTMLElement>("[data-photo-fit]")?.click()
		}
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

	scrollers.set(detail, (direction) => {
		if (failed.has(direction)) {
			return false
		}
		void step(direction)
		return true
	})

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

	const observer = new MutationObserver(() => {
		const zoomed = detail.dataset.photoZoomed === "true"
		scroll.classList.toggle("overflow-y-hidden", zoomed)
		scroll.classList.toggle("overflow-y-auto", !zoomed)
	})
	observer.observe(detail, {
		attributes: true,
		attributeFilter: ["data-photo-zoomed"],
	})

	document.addEventListener(
		"astro:before-swap",
		() => {
			controller.abort()
			spring.cancel()
			observer.disconnect()
			cancelAnimationFrame(scrollFrame)
			clearTimeout(settleTimer)
			scrollers.delete(detail)
		},
		{once: true, signal},
	)

	void fill(-1)
	void fill(1)
}
