import {navigate} from "astro:transitions/client"
import {type PhotoContext, photoDetailHref} from "./context.ts"
import {initializePhotoZoom} from "./photo-zoom.client.ts"

function parseContexts(detail: HTMLElement): PhotoContext[] {
	try {
		const parsed: unknown = JSON.parse(detail.dataset.photoContexts ?? "[]")
		return Array.isArray(parsed) ? parsed : []
	} catch {
		return []
	}
}

function selectedContext(
	contexts: PhotoContext[],
	search: URLSearchParams,
): PhotoContext | undefined {
	const type = search.get("ctx")
	const id = search.get("ctxid")

	if (type && id) {
		return contexts.find(
			(context) =>
				context.reference?.type === type && context.reference.id === id,
		)
	}

	return contexts.find((context) => !context.reference) ?? contexts[0]
}

function setContextHref(
	link: HTMLAnchorElement,
	href: string,
	search: URLSearchParams,
): void {
	const url = new URL(href, window.location.origin)
	const sort = search.get("sort")
	const direction = search.get("direction")

	if (sort && (direction === "ascending" || direction === "descending")) {
		url.searchParams.set("sort", sort)
		url.searchParams.set("direction", direction)
	}

	link.href = `${url.pathname}${url.search}${url.hash}`
}

type ContextElements = {
	photoId: string
	label: HTMLElement
	position: HTMLElement
	close: HTMLAnchorElement
	previous: HTMLAnchorElement
	next: HTMLAnchorElement
	navigation: HTMLElement
}

function getContextElements(detail: HTMLElement): ContextElements | null {
	const photoId = detail.dataset.photoId
	const label = detail.querySelector("[data-context-label]")
	const position = detail.querySelector("[data-context-position]")
	const close = detail.querySelector("[data-context-close]")
	const previous = detail.querySelector("[data-context-previous]")
	const next = detail.querySelector("[data-context-next]")
	const navigation = detail.querySelector("[data-context-navigation]")

	if (
		!photoId ||
		!(label instanceof HTMLElement) ||
		!(position instanceof HTMLElement) ||
		!(close instanceof HTMLAnchorElement) ||
		!(previous instanceof HTMLAnchorElement) ||
		!(next instanceof HTMLAnchorElement) ||
		!(navigation instanceof HTMLElement)
	) {
		return null
	}

	return {photoId, label, position, close, previous, next, navigation}
}

function applyContext(
	detail: HTMLElement,
	context: PhotoContext,
	search: URLSearchParams,
): void {
	const elements = getContextElements(detail)
	if (!elements) {
		return
	}

	elements.label.textContent = context.label
	elements.position.textContent = `${context.index}/${context.total}`
	setContextHref(
		elements.close,
		`${context.path}#photo-${elements.photoId}`,
		search,
	)

	elements.navigation.hidden = !context.previousId || !context.nextId

	if (context.previousId) {
		setContextHref(
			elements.previous,
			photoDetailHref(context.previousId, context.reference),
			search,
		)
	}

	if (context.nextId) {
		setContextHref(
			elements.next,
			photoDetailHref(context.nextId, context.reference),
			search,
		)
	}
}

function photoReturnPath(state: unknown): string | undefined {
	if (
		typeof state !== "object" ||
		state === null ||
		!("photoReturnPath" in state) ||
		typeof state.photoReturnPath !== "string"
	) {
		return undefined
	}
	return state.photoReturnPath
}

function isPlainNavigation(event: MouseEvent): boolean {
	return (
		event.button === 0 &&
		!event.metaKey &&
		!event.ctrlKey &&
		!event.altKey &&
		!event.shiftKey
	)
}

function currentPath(): string {
	return `${window.location.pathname}${window.location.search}`
}

function openPhotoFromCollection(
	event: MouseEvent,
	link: HTMLAnchorElement,
): boolean {
	if (
		!link.matches("[data-photo-id]") ||
		!link.closest("[data-photo-browser]")
	) {
		return false
	}
	event.preventDefault()

	void navigate(link.href, {
		state: {photoReturnPath: currentPath()},
		sourceElement: link,
	})

	return true
}

let photoToReveal: string | undefined

function closePhotoDetail(
	event: MouseEvent,
	link: HTMLAnchorElement,
	detail: HTMLElement,
): void {
	const target = new URL(link.href)
	const targetPath = `${target.pathname}${target.search}`

	if (photoReturnPath(history.state) !== targetPath) {
		return
	}

	event.preventDefault()
	photoToReveal = detail.dataset.photoId
	history.back()
}

function navigateWithinDetail(
	event: MouseEvent,
	link: HTMLAnchorElement,
	detail: HTMLElement,
): void {
	if (link.matches("[data-context-previous], [data-context-next]")) {
		event.preventDefault()
		void navigate(link.href, {
			history: "replace",
			state: history.state,
			sourceElement: link,
		})
		return
	}

	if (link.matches("[data-context-close]")) {
		closePhotoDetail(event, link, detail)
	}
}

function handlePhotoNavigation(event: MouseEvent): void {
	if (!isPlainNavigation(event) || !(event.target instanceof Element)) {
		return
	}

	const link = event.target.closest<HTMLAnchorElement>("a")
	if (!link || openPhotoFromCollection(event, link)) {
		return
	}

	const detail = link.closest<HTMLElement>("[data-photo-detail]")
	if (detail) {
		navigateWithinDetail(event, link, detail)
	}
}

function revealFocusedPhoto(): void {
	if (!photoToReveal) {
		return
	}

	const photoId = photoToReveal
	photoToReveal = undefined

	const target = document.getElementById(`photo-${photoId}`)
	if (!(target instanceof HTMLAnchorElement)) {
		return
	}

	target.focus({preventScroll: true})

	const bounds = target.getBoundingClientRect()
	if (bounds.top < 0 || bounds.bottom > window.innerHeight) {
		target.scrollIntoView({block: "start"})
	}
}

let photoNavigationRegistered = false

export function registerPhotoNavigation(): void {
	if (photoNavigationRegistered) {
		return
	}
	photoNavigationRegistered = true
	document.addEventListener("click", handlePhotoNavigation, {capture: true})
	document.addEventListener("astro:page-load", revealFocusedPhoto)
}

let photoInfoOpen = false

function initializePhotoInfo(detail: HTMLElement): void {
	const info = detail.querySelector("[data-photo-info]")
	if (!(info instanceof HTMLDetailsElement)) {
		return
	}

	info.open = photoInfoOpen
	info.addEventListener("toggle", () => {
		photoInfoOpen = info.open
	})
}

const keyboardControlSelectors: Record<string, string> = {
	Escape: "[data-context-close]",
	ArrowLeft: "[data-context-previous]",
	ArrowRight: "[data-context-next]",
	"=": "[data-photo-actual]",
	"+": "[data-photo-actual]",
	"-": "[data-photo-fit]",
	_: "[data-photo-fit]",
}

function hasKeyboardModifier(event: KeyboardEvent): boolean {
	return event.metaKey || event.ctrlKey || event.altKey
}

function handlePhotoKeydown(event: KeyboardEvent): void {
	if (hasKeyboardModifier(event)) {
		return
	}

	const detail = document.querySelector("[data-photo-detail]")
	if (!(detail instanceof HTMLElement)) {
		return
	}

	if (event.key.toLowerCase() === "i") {
		const info = detail.querySelector("[data-photo-info]")
		if (info instanceof HTMLDetailsElement) {
			info.open = !info.open
			event.preventDefault()
		}
		return
	}

	const selector = keyboardControlSelectors[event.key]
	if (!selector) {
		return
	}

	event.preventDefault()
	detail.querySelector<HTMLElement>(selector)?.click()
}

function initializePhotoDetail(): void {
	const detail = document.querySelector("[data-photo-detail]")
	if (!(detail instanceof HTMLElement)) {
		photoInfoOpen = false
		return
	}

	const search = new URLSearchParams(window.location.search)
	const context = selectedContext(parseContexts(detail), search)

	if (context) {
		applyContext(detail, context, search)
	}

	initializePhotoInfo(detail)
	initializePhotoZoom(detail)
}

export function registerPhotoDetail(): void {
	registerPhotoNavigation()
	document.addEventListener("keydown", handlePhotoKeydown)
	document.addEventListener("astro:page-load", initializePhotoDetail)
}
