import {navigate} from "astro:transitions/client"
import {photoReturnPath} from "../PhotoNavigation.client.ts"

interface ScreensaverPhoto {
	id: string
	src: string
	ratio: number
	alt: string
}

// Each photo fades in for 3s (set in CSS), then holds for 8s.
const photoTime = 11000
const idleTime = 3000

let registered = false
let disposeScreensaver: (() => void) | undefined

function shuffle<T>(items: T[]): T[] {
	return items
		.map((item) => ({item, order: Math.random()}))
		.sort((left, right) => left.order - right.order)
		.map(({item}) => item)
}

function wait(duration: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, duration))
}

async function load(
	frame: HTMLAnchorElement,
	photo: ScreensaverPhoto,
): Promise<boolean> {
	const image = frame.querySelector("img")
	if (!image) {
		return false
	}
	frame.href = `/photos/${photo.id}/`
	frame.style.setProperty("--photo-ratio", String(photo.ratio))
	image.alt = photo.alt
	image.src = photo.src
	return image.decode().then(
		() => true,
		() => false,
	)
}

async function play(
	frames: HTMLAnchorElement[],
	photos: ScreensaverPhoto[],
	signal: AbortSignal,
): Promise<void> {
	let [visible, hidden] = frames
	for (let index = 0; !signal.aborted; index = (index + 1) % photos.length) {
		if (await load(hidden, photos[index])) {
			visible.removeAttribute("data-active")
			hidden.setAttribute("data-active", "")
			;[visible, hidden] = [hidden, visible]
		}
		await wait(photoTime)
	}
}

function hideControlsWhenIdle(root: HTMLElement, signal: AbortSignal): void {
	let timer: ReturnType<typeof setTimeout> | undefined
	let pointer = ""
	const wake = () => {
		root.removeAttribute("data-idle")
		clearTimeout(timer)
		timer = setTimeout(() => root.setAttribute("data-idle", ""), idleTime)
	}
	document.addEventListener(
		"pointermove",
		(event) => {
			// A photo appearing under a still cursor can count as a move.
			const position = `${event.clientX},${event.clientY}`
			if (position !== pointer) {
				pointer = position
				wake()
			}
		},
		{signal},
	)
	document.addEventListener("pointerdown", wake, {signal})
	document.addEventListener("keydown", wake, {signal})
	wake()
}

function keepScreenAwake(signal: AbortSignal): void {
	const request = async () => {
		const lock = await navigator.wakeLock
			?.request("screen")
			.catch(() => undefined)
		if (signal.aborted) {
			void lock?.release()
		} else {
			signal.addEventListener("abort", () => void lock?.release())
		}
	}
	// Browsers release the lock whenever the page is hidden.
	document.addEventListener("visibilitychange", request, {signal})
	void request()
}

function close(): void {
	if (photoReturnPath(history.state)) {
		history.back()
	} else {
		void navigate("/photos/")
	}
}

function initializeScreensaver(): void {
	disposeScreensaver?.()
	const root = document.querySelector<HTMLElement>("[data-screensaver]")
	if (!root) {
		return
	}
	const controller = new AbortController()
	const {signal} = controller
	const photos: ScreensaverPhoto[] = shuffle(
		JSON.parse(root.dataset.screensaverPhotos ?? "[]"),
	)
	const frames = [
		...root.querySelectorAll<HTMLAnchorElement>("[data-screensaver-photo]"),
	]
	root
		.querySelector("[data-screensaver-close]")
		?.addEventListener("click", close, {signal})
	document.addEventListener(
		"keydown",
		(event) => {
			if (event.key === "Escape") {
				close()
			}
		},
		{signal},
	)
	hideControlsWhenIdle(root, signal)
	keepScreenAwake(signal)
	if (photos.length > 0) {
		void play(frames, photos, signal)
	}
	disposeScreensaver = () => controller.abort()
}

export function registerScreensaver(): void {
	if (registered) {
		return
	}
	registered = true
	document.addEventListener("astro:page-load", initializeScreensaver)
	document.addEventListener("astro:before-swap", () => {
		disposeScreensaver?.()
		disposeScreensaver = undefined
	})
}
