import {
	parsePhotoContexts,
	type PhotoContext,
	photoContextHref,
	photoDetailHref,
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

function applyContext(
	detail: HTMLElement,
	contexts: PhotoContext[],
	search: URLSearchParams,
): void {
	const context = selectedPhotoContext(contexts, search)
	if (!context) {
		return
	}
	const label = detail.querySelector<HTMLElement>("[data-context-label]")
	const position = detail.querySelector<HTMLElement>("[data-context-position]")
	const close = detail.querySelector<HTMLAnchorElement>("[data-context-close]")
	if (label) {
		label.textContent = context.label
	}
	if (position) {
		position.textContent = `${context.index}/${context.total}`
	}
	if (close) {
		close.href = photoContextHref(
			`${context.path}#photo-${detail.dataset.photoId}`,
			search,
		)
	}
}

function updateInfo(detail: HTMLElement, source: HTMLElement | null): void {
	const content = detail.querySelector<HTMLElement>("[data-photo-info-content]")
	if (!content || !source) {
		return
	}
	const focused = content.contains(document.activeElement)
	content.replaceChildren(
		...Array.from(source.childNodes, (node) => node.cloneNode(true)),
	)
	if (focused) {
		detail
			.querySelector<HTMLElement>("[data-photo-info] summary")
			?.focus({preventScroll: true})
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
	const frame = root?.querySelector<HTMLElement>("[data-photo-frame]")
	if (!root || !frame) {
		photoInfoOpen = false
		return
	}
	const detail = root
	const controller = new AbortController()
	const {signal} = controller
	const search = new URLSearchParams(location.search)
	let contexts = parsePhotoContexts(detail.dataset.photoContexts)
	let zoom: ReturnType<typeof initializePhotoZoom> = null
	applyContext(detail, contexts, search)

	const info = detail.querySelector<HTMLDetailsElement>("[data-photo-info]")
	if (info) {
		info.open = photoInfoOpen
		info.addEventListener(
			"toggle",
			() => {
				photoInfoOpen = info.open
			},
			{signal},
		)
	}

	function activate(page: PhotoSnapPage, activeFrame: HTMLElement): void {
		contexts = page.contexts
		detail.dataset.photoId = page.id
		updateInfo(detail, page.info)
		applyContext(detail, contexts, search)
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

	function step(direction: -1 | 1): void {
		const context = selectedPhotoContext(contexts, search)
		if (!context) {
			return
		}
		const id = direction < 0 ? context.previousId : context.nextId
		if (!id) {
			return
		}
		if (detail.dataset.photoZoomed === "true") {
			zoom?.fit()
		}
		if (!scroll?.step(direction)) {
			replacePhotoDetail(
				photoContextHref(photoDetailHref(id, context.reference), search),
			)
		}
	}

	const actions: Record<string, () => void> = {
		escape: () => closePhotoDetail(detail),
		arrowleft: () => step(-1),
		arrowup: () => step(-1),
		arrowright: () => step(1),
		arrowdown: () => step(1),
		p: () => zoom?.toggleLoupe(),
		"=": () => zoom?.actual(),
		"+": () => zoom?.actual(),
		"-": () => zoom?.fit(),
		_: () => zoom?.fit(),
		i: () => {
			if (info) {
				info.open = !info.open
			}
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
