type PhotoSortKey =
	| "position"
	| "title"
	| "camera"
	| "lens"
	| "date"
	| "focal"
	| "aperture"
	| "shutter"
	| "iso"

type SortDirection = "ascending" | "descending"

const photoSortKeys: readonly PhotoSortKey[] = [
	"position",
	"title",
	"camera",
	"lens",
	"date",
	"focal",
	"aperture",
	"shutter",
	"iso",
]

const sortDataKeys: Record<PhotoSortKey, string> = {
	position: "photoSortPosition",
	title: "photoSortTitle",
	camera: "photoSortCamera",
	lens: "photoSortLens",
	date: "photoSortDate",
	focal: "photoSortFocal",
	aperture: "photoSortAperture",
	shutter: "photoSortShutter",
	iso: "photoSortIso",
}

const numericSortKeys = new Set<PhotoSortKey>([
	"position",
	"focal",
	"aperture",
	"shutter",
	"iso",
])

const collator = new Intl.Collator("en", {
	numeric: true,
	sensitivity: "base",
})

function isPhotoSortKey(
	value: string | null | undefined,
): value is PhotoSortKey {
	return photoSortKeys.some((key) => key === value)
}

function isSortDirection(
	value: string | null | undefined,
): value is SortDirection {
	return value === "ascending" || value === "descending"
}

function sortValue(item: HTMLElement, key: PhotoSortKey): string {
	return item.dataset[sortDataKeys[key]] ?? ""
}

function photoRows(collection: HTMLElement): HTMLElement[] {
	return [...collection.querySelectorAll<HTMLElement>(":scope > [role=row]")]
}

function updateRowIndexes(collection: HTMLElement): void {
	for (const [index, row] of photoRows(collection).entries()) {
		row.setAttribute("aria-rowindex", String(index + 1))
	}
}

function compareRows(
	left: HTMLElement,
	right: HTMLElement,
	key: PhotoSortKey,
	direction: SortDirection,
): number {
	const leftValue = sortValue(left, key)
	const rightValue = sortValue(right, key)

	if (!leftValue && rightValue) {
		return 1
	}

	if (leftValue && !rightValue) {
		return -1
	}

	const comparison = numericSortKeys.has(key)
		? Number(leftValue) - Number(rightValue)
		: collator.compare(leftValue, rightValue)

	return direction === "ascending" ? comparison : -comparison
}

function updateSortControls(
	buttons: NodeListOf<HTMLButtonElement>,
	key: PhotoSortKey,
	direction: SortDirection,
): void {
	for (const button of buttons) {
		const selected = button.dataset.photoSort === key
		const indicator = button.querySelector<HTMLElement>(
			"[data-photo-sort-indicator]",
		)

		button.ariaPressed = String(selected)

		if (indicator) {
			indicator.textContent = selected
				? direction === "ascending"
					? "↑"
					: "↓"
				: ""
		}
	}
}

function updatePhotoLinks(
	collection: HTMLElement,
	key: PhotoSortKey,
	direction: SortDirection,
): void {
	for (const link of collection.querySelectorAll<HTMLAnchorElement>(
		"[data-photo-id]",
	)) {
		const href = new URL(link.href)
		href.searchParams.set("sort", key)
		href.searchParams.set("direction", direction)
		link.href = `${href.pathname}${href.search}${href.hash}`
	}
}

function updatePageUrl(key: PhotoSortKey, direction: SortDirection): void {
	const url = new URL(window.location.href)
	url.searchParams.set("sort", key)
	url.searchParams.set("direction", direction)
	window.history.replaceState(window.history.state, "", url)
}

function initializePhotoSorting(
	indexView: HTMLElement,
	collection: HTMLElement,
): void {
	const sortButtons =
		indexView.querySelectorAll<HTMLButtonElement>("[data-photo-sort]")
	let activeSort: PhotoSortKey | null = null
	let direction: SortDirection = "ascending"

	const applySort = (
		key: PhotoSortKey,
		nextDirection: SortDirection,
		updateUrl = false,
	) => {
		const rows = photoRows(collection)
		rows.sort((left, right) => compareRows(left, right, key, nextDirection))
		collection.append(...rows)

		activeSort = key
		direction = nextDirection

		updateRowIndexes(collection)
		updateSortControls(sortButtons, key, direction)
		updatePhotoLinks(collection, key, direction)

		if (updateUrl) {
			updatePageUrl(key, direction)
		}
	}

	const search = new URLSearchParams(window.location.search)
	const initialSort = search.get("sort")
	const initialDirection = search.get("direction")

	if (isPhotoSortKey(initialSort) && isSortDirection(initialDirection)) {
		applySort(initialSort, initialDirection)
	}

	for (const button of sortButtons) {
		button.addEventListener("click", () => {
			const key = button.dataset.photoSort
			if (!isPhotoSortKey(key)) {
				return
			}

			let nextDirection: SortDirection =
				activeSort === key && direction === "ascending"
					? "descending"
					: "ascending"

			if (activeSort !== key && (key === "position" || key === "date")) {
				nextDirection = "descending"
			}

			applySort(key, nextDirection, true)
		})
	}
}

function targetGridRow(
	key: string,
	row: HTMLElement,
	collection: HTMLElement,
): Element | null | undefined {
	switch (key) {
		case "ArrowDown":
			return row.nextElementSibling
		case "ArrowUp":
			return row.previousElementSibling
		case "Home":
			return collection.firstElementChild
		case "End":
			return collection.lastElementChild
		default:
			return undefined
	}
}

function initializeGridKeyboardNavigation(collection: HTMLElement): void {
	let activeGridCell =
		collection.querySelector<HTMLAnchorElement>("[role=gridcell]")

	const setActiveGridCell = (cell: HTMLAnchorElement, focus = false) => {
		if (activeGridCell && activeGridCell !== cell) {
			activeGridCell.tabIndex = -1
		}

		activeGridCell = cell
		cell.tabIndex = 0

		if (focus) {
			cell.focus({preventScroll: true})
			cell.scrollIntoView({block: "nearest", inline: "nearest"})
		}
	}

	collection.addEventListener("focusin", (event) => {
		if (!(event.target instanceof Element)) {
			return
		}

		const cell = event.target.closest<HTMLAnchorElement>("[role=gridcell]")
		if (cell) {
			setActiveGridCell(cell)
		}
	})

	collection.addEventListener("keydown", (event) => {
		if (!(event.target instanceof Element)) {
			return
		}

		const cell = event.target.closest<HTMLAnchorElement>("[role=gridcell]")
		const row = cell?.closest<HTMLElement>("[role=row]")
		if (!cell || !row) {
			return
		}

		const targetRow = targetGridRow(event.key, row, collection)
		if (targetRow === undefined) {
			return
		}

		event.preventDefault()

		const targetCell =
			targetRow?.querySelector<HTMLAnchorElement>("[role=gridcell]")
		if (targetCell) {
			setActiveGridCell(targetCell, true)
		}
	})
}

function synchronizeHorizontalScroll(
	headerViewport: HTMLElement,
	indexViewport: HTMLElement,
): void {
	headerViewport.addEventListener("scroll", () => {
		if (indexViewport.scrollLeft !== headerViewport.scrollLeft) {
			indexViewport.scrollLeft = headerViewport.scrollLeft
		}
	})

	indexViewport.addEventListener("scroll", () => {
		if (headerViewport.scrollLeft !== indexViewport.scrollLeft) {
			headerViewport.scrollLeft = indexViewport.scrollLeft
		}
	})
}

function initializePhotoIndex(indexView: HTMLElement): void {
	if (indexView.dataset.photoIndexReady === "true") {
		return
	}

	const collection = indexView.querySelector<HTMLElement>(
		"[data-photo-index-collection]",
	)
	const headerViewport = indexView.querySelector<HTMLElement>(
		"[data-photo-index-header-viewport]",
	)
	const indexViewport = indexView.querySelector<HTMLElement>(
		"[data-photo-index-viewport]",
	)

	if (!collection || !headerViewport || !indexViewport) {
		return
	}

	indexView.dataset.photoIndexReady = "true"

	synchronizeHorizontalScroll(headerViewport, indexViewport)
	initializeGridKeyboardNavigation(collection)
	initializePhotoSorting(indexView, collection)
}

function initializePhotoIndexes(): void {
	for (const index of document.querySelectorAll<HTMLElement>(
		"[data-photo-index]",
	)) {
		initializePhotoIndex(index)
	}
}

export function registerPhotoIndexes(): void {
	document.addEventListener("astro:page-load", initializePhotoIndexes)
}
