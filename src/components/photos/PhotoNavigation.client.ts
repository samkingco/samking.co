import {navigate} from "astro:transitions/client"

let registered = false
let photoToReveal: string | undefined

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

export function replacePhotoDetail(href: string): void {
	void navigate(href, {history: "replace", state: history.state})
}

export function closePhotoDetail(detail: HTMLElement): void {
	const link = detail.querySelector<HTMLAnchorElement>("[data-context-close]")
	if (!link) {
		return
	}
	const target = new URL(link.href)
	if (photoReturnPath(history.state) === `${target.pathname}${target.search}`) {
		photoToReveal = detail.dataset.photoId
		history.back()
		return
	}
	void navigate(link.href, {sourceElement: link})
}

function handlePhotoNavigation(event: MouseEvent): void {
	if (!isPlainNavigation(event) || !(event.target instanceof Element)) {
		return
	}
	const link = event.target.closest<HTMLAnchorElement>("a")
	if (!link) {
		return
	}
	if (link.matches("[data-photo-id]") && link.closest("[data-photo-browser]")) {
		event.preventDefault()
		void navigate(link.href, {
			state: {photoReturnPath: `${location.pathname}${location.search}`},
			sourceElement: link,
		})
		return
	}
	const detail = link.closest<HTMLElement>("[data-photo-detail]")
	if (detail && link.matches("[data-context-close]")) {
		event.preventDefault()
		closePhotoDetail(detail)
	}
}

function revealFocusedPhoto(): void {
	const id = photoToReveal
	photoToReveal = undefined
	if (!id) {
		return
	}
	// Layout controls finish assigning the active view's IDs before restoring focus.
	requestAnimationFrame(() => {
		const target = document.getElementById(`photo-${id}`)
		if (!(target instanceof HTMLAnchorElement)) {
			return
		}
		target.focus({preventScroll: true})
		const bounds = target.getBoundingClientRect()
		if (bounds.top < 0 || bounds.bottom > window.innerHeight) {
			target.scrollIntoView({block: "start"})
		}
	})
}

export function registerPhotoNavigation(): void {
	if (registered) {
		return
	}
	registered = true
	document.addEventListener("click", handlePhotoNavigation, {capture: true})
	document.addEventListener("astro:page-load", revealFocusedPhoto)
}
