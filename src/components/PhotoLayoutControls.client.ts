type PhotoLayout = "index" | "grid" | "scroll"

function isPhotoLayout(value: string | null | undefined): value is PhotoLayout {
	return value === "index" || value === "grid" || value === "scroll"
}

function observeLayoutBar(layoutBar: HTMLElement, scope: HTMLElement): void {
	if (!("ResizeObserver" in window)) {
		return
	}

	const observer = new ResizeObserver(([entry]) => {
		if (!entry) {
			return
		}
		const blockSize =
			entry.borderBoxSize[0]?.blockSize ?? layoutBar.offsetHeight
		scope.style.setProperty("--photo-layout-bar-height", `${blockSize}px`)
	})

	observer.observe(layoutBar, {box: "border-box"})
	document.addEventListener("astro:before-swap", () => observer.disconnect(), {
		once: true,
	})
}

function updatePhotoLinkId(link: HTMLAnchorElement, active: boolean): void {
	const photoId = link.dataset.photoId
	if (active && photoId) {
		link.id = `photo-${photoId}`
		return
	}
	link.removeAttribute("id")
}

function applyPhotoLayout(
	browser: HTMLElement,
	buttons: NodeListOf<HTMLButtonElement>,
	layout: PhotoLayout,
): HTMLElement | null {
	let activeView: HTMLElement | null = null

	for (const view of browser.querySelectorAll<HTMLElement>(
		"[data-photo-view]",
	)) {
		const active = view.dataset.photoView === layout
		if (active) {
			activeView = view
		}

		view.hidden = !active

		for (const link of view.querySelectorAll<HTMLAnchorElement>(
			"[data-photo-id]",
		)) {
			updatePhotoLinkId(link, active)
		}
	}

	browser.dataset.photoLayout = layout

	for (const button of buttons) {
		const active = button.dataset.photoLayoutOption === layout
		button.ariaPressed = String(active)
		button.disabled = active
	}

	return activeView
}

function selectPhotoLayout(
	layoutBar: HTMLElement,
	browser: HTMLElement,
	buttons: NodeListOf<HTMLButtonElement>,
	layout: PhotoLayout,
): void {
	const shouldScroll = layoutBar.getBoundingClientRect().top <= 0
	const activeView = applyPhotoLayout(browser, buttons, layout)
	try {
		localStorage.setItem("photo-layout", layout)
	} catch {
		// Keep the layout for this page when storage is unavailable.
	}
	if (shouldScroll) {
		activeView?.scrollIntoView({block: "start"})
	}
}

function bindLayoutButton(
	button: HTMLButtonElement,
	layoutBar: HTMLElement,
	browser: HTMLElement,
	buttons: NodeListOf<HTMLButtonElement>,
): void {
	button.addEventListener("click", () => {
		const layout = button.dataset.photoLayoutOption
		if (isPhotoLayout(layout)) {
			selectPhotoLayout(layoutBar, browser, buttons, layout)
		}
	})
}

function photoLayoutElements(controls: HTMLElement): {
	layoutBar: HTMLElement
	scope: HTMLElement
	browser: HTMLElement
} | null {
	const layoutBar = controls.closest<HTMLElement>("[data-photo-layout-bar]")
	const scope = layoutBar?.parentElement
	const browser = scope?.querySelector<HTMLElement>("[data-photo-browser]")
	return browser && layoutBar && scope ? {layoutBar, scope, browser} : null
}

function initializePhotoLayoutControls(controls: HTMLElement): void {
	if (controls.dataset.photoLayoutControlsReady === "true") {
		return
	}

	const elements = photoLayoutElements(controls)
	if (!elements) {
		return
	}

	const {layoutBar, scope, browser} = elements

	controls.dataset.photoLayoutControlsReady = "true"
	const buttons = controls.querySelectorAll<HTMLButtonElement>(
		"[data-photo-layout-option]",
	)

	observeLayoutBar(layoutBar, scope)

	const initialLayout = browser.dataset.photoLayout
	applyPhotoLayout(
		browser,
		buttons,
		isPhotoLayout(initialLayout) ? initialLayout : "grid",
	)

	for (const button of buttons) {
		bindLayoutButton(button, layoutBar, browser, buttons)
	}
}

function initializePhotoLayouts(): void {
	for (const controls of document.querySelectorAll<HTMLElement>(
		"[data-photo-layout-controls]",
	)) {
		initializePhotoLayoutControls(controls)
	}
}

export function registerPhotoLayouts(): void {
	document.addEventListener("astro:page-load", initializePhotoLayouts)
}
