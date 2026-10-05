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
	browser: HTMLElement
} {
	const layoutBar = controls.closest<HTMLElement>("[data-photo-layout-bar]")
	const viewId = controls
		.querySelector("[aria-controls]")
		?.getAttribute("aria-controls")
	const browser = viewId
		? document
				.getElementById(viewId)
				?.closest<HTMLElement>("[data-photo-browser]")
		: null
	if (!layoutBar || !browser) {
		throw new Error(
			"Photo layout controls require a layout bar and an aria-controls target in the photo browser",
		)
	}
	return {layoutBar, browser}
}

function initializePhotoLayoutControls(controls: HTMLElement): void {
	if (controls.dataset.photoLayoutControlsReady === "true") {
		return
	}

	const {layoutBar, browser} = photoLayoutElements(controls)

	controls.dataset.photoLayoutControlsReady = "true"
	const buttons = controls.querySelectorAll<HTMLButtonElement>(
		"[data-photo-layout-option]",
	)

	observeLayoutBar(layoutBar, browser)

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
