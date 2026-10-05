import {
	adjacentPhotoHref,
	parsePhotoContexts,
	type PhotoContext,
	photoContextHref,
	selectedPhotoContext,
} from "../PhotoContext.ts"
import {
	closePhotoDetail,
	registerPhotoNavigation,
	replacePhotoDetail,
} from "../PhotoNavigation.client.ts"
import {initializePhotoSnap, type PhotoSnapPage} from "./PhotoSnap.client.ts"
import {initializePhotoZoom} from "./PhotoZoom.client.ts"

let registered = false
let photoInfoOpen = false
let disposeDetail: (() => void) | undefined

function bindDetail(detail: HTMLElement) {
	const frame = detail.querySelector("[data-photo-frame]")
	const info = detail.querySelector("[data-photo-info]")
	const content = detail.querySelector("[data-photo-info-content]")
	const summary = detail.querySelector("[data-photo-info] summary")
	const label = detail.querySelector("[data-context-label]")
	const position = detail.querySelector("[data-context-position]")
	const close = detail.querySelector("[data-context-close]")
	if (
		!(frame instanceof HTMLElement) ||
		!(info instanceof HTMLDetailsElement) ||
		!(content instanceof HTMLElement) ||
		!(summary instanceof HTMLElement) ||
		!(label instanceof HTMLElement) ||
		!(position instanceof HTMLElement) ||
		!(close instanceof HTMLAnchorElement)
	) {
		throw new Error(
			"Photo detail requires its frame, info panel, and context controls",
		)
	}
	return {frame, info, content, summary, label, position, close}
}

function applyContext(
	elements: ReturnType<typeof bindDetail>,
	photoId: string | undefined,
	contexts: PhotoContext[],
	search: URLSearchParams,
): void {
	const context = selectedPhotoContext(contexts, search)
	if (!context) {
		return
	}
	elements.label.textContent = context.label
	elements.position.textContent = `${context.index}/${context.total}`
	elements.close.href = photoContextHref(
		`${context.path}#photo-${photoId}`,
		search,
	)
}

function updateInfo(
	elements: ReturnType<typeof bindDetail>,
	source: HTMLElement,
): void {
	const {content, summary} = elements
	const focused = content.contains(document.activeElement)
	content.replaceChildren(
		...Array.from(source.childNodes, (node) => node.cloneNode(true)),
	)
	if (focused) {
		summary.focus({preventScroll: true})
	}
}

function ignoresViewerKey(event: KeyboardEvent): boolean {
	return (
		event.defaultPrevented ||
		event.metaKey ||
		event.ctrlKey ||
		event.altKey ||
		(event.target instanceof Element &&
			Boolean(
				event.target.closest(
					"input, textarea, select, [contenteditable]:not([contenteditable='false'])",
				),
			))
	)
}

function initializePhotoDetail(): void {
	disposeDetail?.()
	const root = document.querySelector<HTMLElement>("[data-photo-detail]")
	if (!root) {
		photoInfoOpen = false
		return
	}
	const detail = root
	const elements = bindDetail(detail)
	const {frame, info} = elements
	const controller = new AbortController()
	const {signal} = controller
	const search = new URLSearchParams(location.search)
	let contexts = parsePhotoContexts(detail.dataset.photoContexts)
	let zoom: ReturnType<typeof initializePhotoZoom> | null = null
	applyContext(elements, detail.dataset.photoId, contexts, search)
	info.open = photoInfoOpen
	info.addEventListener(
		"toggle",
		() => {
			photoInfoOpen = info.open
		},
		{signal},
	)

	function activate(page: PhotoSnapPage, activeFrame: HTMLElement): void {
		contexts = page.contexts
		detail.dataset.photoId = page.id
		updateInfo(elements, page.info)
		applyContext(elements, page.id, contexts, search)
		document.title = page.title
		for (const {selector, content} of page.metadata) {
			document.querySelector(selector)?.setAttribute("content", content)
		}
		const loupeActive = zoom?.loupeActive ?? false
		zoom?.dispose()
		zoom = initializePhotoZoom(activeFrame, detail, loupeActive)
	}

	const scroll = initializePhotoSnap(
		detail,
		(candidates) => selectedPhotoContext(candidates, search),
		activate,
	)
	zoom = initializePhotoZoom(frame, detail)

	async function step(direction: -1 | 1): Promise<void> {
		const href = adjacentPhotoHref(
			selectedPhotoContext(contexts, search),
			direction,
			search,
		)
		if (!href) {
			return
		}
		if (detail.dataset.photoZoomed === "true") {
			zoom?.fit()
		}
		const handled = await scroll?.step(direction)
		if (!handled && !signal.aborted) {
			replacePhotoDetail(href)
		}
	}

	const actions: Record<string, () => void> = {
		escape: () => closePhotoDetail(detail),
		arrowleft: () => {
			void step(-1)
		},
		arrowup: () => {
			void step(-1)
		},
		arrowright: () => {
			void step(1)
		},
		arrowdown: () => {
			void step(1)
		},
		p: () => zoom?.toggleLoupe(),
		"=": () => zoom?.actual(),
		"+": () => zoom?.actual(),
		"-": () => zoom?.fit(),
		_: () => zoom?.fit(),
		i: () => {
			info.open = !info.open
		},
	}
	document.addEventListener(
		"keydown",
		(event) => {
			if (ignoresViewerKey(event)) {
				return
			}
			const action = actions[event.key.toLowerCase()]
			if (action) {
				event.preventDefault()
				action()
			}
		},
		{signal},
	)

	const controls = new Map([
		[detail.querySelector("[data-photo-fit]"), actions["-"]],
		[detail.querySelector("[data-photo-actual]"), actions["+"]],
		[detail.querySelector("[data-photo-loupe]"), actions.p],
	])
	detail.addEventListener(
		"click",
		(event) => {
			if (event.target instanceof Element) {
				const button = event.target.closest("button")
				if (button) {
					controls.get(button)?.()
				}
			}
		},
		{signal},
	)

	disposeDetail = () => {
		controller.abort()
		scroll?.dispose()
		zoom?.dispose()
	}
}

export function registerPhotoDetail(): void {
	if (registered) {
		return
	}
	registered = true
	registerPhotoNavigation()
	document.addEventListener("astro:page-load", initializePhotoDetail)
	document.addEventListener("astro:before-swap", () => {
		disposeDetail?.()
		disposeDetail = undefined
	})
}
