let registered = false

function ignoresShortcut(event: KeyboardEvent): boolean {
	return (
		event.repeat ||
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

export function registerShortcuts(): void {
	if (registered) {
		return
	}
	registered = true
	document.addEventListener(
		"keydown",
		(event) => {
			const dialog =
				document.querySelector<HTMLDialogElement>("[data-shortcuts]")
			if (dialog?.open) {
				// Native Escape closes the dialog; viewer shortcuts stay inactive.
				event.stopImmediatePropagation()
				return
			}
			if (event.key !== "?" || ignoresShortcut(event)) {
				return
			}
			event.preventDefault()
			event.stopImmediatePropagation()
			dialog?.showModal()
		},
		{capture: true},
	)
	document.addEventListener("astro:before-swap", () => {
		document.querySelector<HTMLDialogElement>("[data-shortcuts]")?.close()
	})
}
