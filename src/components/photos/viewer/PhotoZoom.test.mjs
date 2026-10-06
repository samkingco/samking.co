import assert from "node:assert/strict"
import {test} from "node:test"

// Minimal DOM for exercising the public viewer setup and its event listeners.
class Element extends EventTarget {
	style = {}
	dataset = {}
	classList = {add() {}}
	clientWidth = 1000
	clientHeight = 800
	scrollLeft = 0
	scrollTop = 0
	children = new Map()

	querySelector(selector) {
		return this.children.get(selector) ?? null
	}
	closest() {
		return null
	}
	getBoundingClientRect() {
		return {left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800}
	}
	setAttribute() {}
	append() {}
	remove() {}
}

globalThis.HTMLElement = Element
globalThis.HTMLImageElement = class extends Element {
	getAttribute(name) {
		return this[name] ?? null
	}
	removeAttribute(name) {
		delete this[name]
	}
}
globalThis.HTMLButtonElement = class extends Element {}
globalThis.ResizeObserver = class {
	observe() {}
	disconnect() {}
}
globalThis.window = Object.assign(new EventTarget(), {
	devicePixelRatio: 1,
	matchMedia: () => Object.assign(new EventTarget(), {matches: true}),
})
globalThis.document = {createElement: () => new Element()}
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0)

const {initializePhotoZoom} = await import("./PhotoZoom.client.ts")

function dispatch(target, type, properties = {}) {
	const event = Object.assign(new Event(type, {cancelable: true}), {
		clientX: 600,
		clientY: 400,
		...properties,
	})
	target.dispatchEvent(event)
	return event.defaultPrevented
}

function createViewer() {
	const frame = new Element()
	const detail = new Element()
	const image = new HTMLImageElement()
	const originalImage = new HTMLImageElement()
	image.dataset = {photoWidth: "4000", photoHeight: "3200"}
	frame.children = new Map([
		["[data-photo-presentation]", new Element()],
		['[data-photo-image-layer="detail"]', new Element()],
		['[data-photo-image-layer="original"]', new Element()],
		["[data-photo-image]", image],
		["[data-photo-original]", originalImage],
	])
	detail.children = new Map([
		["[data-photo-actual]", new HTMLButtonElement()],
		["[data-photo-fit]", new HTMLButtonElement()],
	])
	const zoom = initializePhotoZoom(frame, detail)
	const wheel = (deltaY, properties = {}) =>
		dispatch(frame, "wheel", {
			ctrlKey: true,
			deltaMode: 0,
			deltaY,
			...properties,
		})
	return {frame, detail, image, originalImage, zoom, wheel}
}

test("trackpad pinch zooms the image, preserves scrolling, and removes listeners", () => {
	const {frame, detail, image, zoom, wheel} = createViewer()
	assert.equal(wheel(-100, {ctrlKey: false}), false)
	assert.equal(image.style.transform, "scale(1)")

	assert.equal(wheel(-Math.log(2) * 100), true)
	assert.equal(image.style.transform, "scale(2)")
	// The point 100px right of the center stays under the cursor.
	assert.equal(frame.scrollLeft, 680)

	wheel(-10000)
	assert.equal(image.style.transform, "scale(4)")
	wheel(10000)
	assert.equal(image.style.transform, "scale(1)")
	assert.equal(detail.dataset.photoZoomed, "false")

	assert.equal(dispatch(frame, "gesturestart", {scale: 1}), true)
	assert.equal(dispatch(frame, "gesturechange", {scale: 2}), true)
	assert.equal(image.style.transform, "scale(2)")
	wheel(-100)
	assert.equal(image.style.transform, "scale(2)")
	dispatch(frame, "gesturechange", {scale: 10})
	assert.equal(image.style.transform, "scale(4)")
	dispatch(frame, "gesturechange", {scale: 5})
	assert.equal(image.style.transform, "scale(2)")
	assert.equal(dispatch(frame, "gestureend", {scale: 5}), true)
	wheel(Math.log(2) * 100)
	assert.equal(image.style.transform, "scale(1)")

	// Safari touchscreen pinch must not also activate trackpad handling.
	dispatch(frame, "touchstart", {
		touches: [
			{identifier: 1, clientX: 400, clientY: 400},
			{identifier: 2, clientX: 600, clientY: 400},
		],
	})
	assert.equal(dispatch(frame, "gesturestart", {scale: 1}), false)
	dispatch(frame, "gesturechange", {scale: 2})
	assert.equal(image.style.transform, "scale(1)")
	dispatch(frame, "touchmove", {
		touches: [
			{identifier: 1, clientX: 300, clientY: 400},
			{identifier: 2, clientX: 700, clientY: 400},
		],
	})
	assert.equal(image.style.transform, "scale(2)")
	dispatch(frame, "touchend")

	zoom.dispose()
	assert.equal(wheel(-100), false)
	assert.equal(dispatch(frame, "gesturestart", {scale: 1}), false)
	assert.equal(image.style.transform, "scale(2)")
})

test("the source image stays hidden until decoded and the next animation frame", async (t) => {
	const frames = []
	t.mock.method(globalThis, "requestAnimationFrame", (callback) =>
		frames.push(callback),
	)
	const {originalImage, zoom, wheel} = createViewer()
	t.after(() => zoom.dispose())
	const decoding = Promise.withResolvers()
	originalImage.dataset.photoSource = "/source.jpg"
	originalImage.decode = t.mock.fn(() => decoding.promise)
	// Even an already downloaded image must pass through decode().
	originalImage.complete = true
	originalImage.naturalWidth = 4000

	wheel(-1)
	wheel(-1)
	assert.equal(originalImage.src, "/source.jpg")
	assert.equal(originalImage.decode.mock.callCount(), 1)
	assert.notEqual(originalImage.style.opacity, "1")
	assert.equal(frames.length, 0)

	decoding.resolve()
	await Promise.resolve()
	wheel(-1)
	assert.notEqual(originalImage.style.opacity, "1")
	assert.equal(originalImage.decode.mock.callCount(), 1)
	assert.equal(frames.length, 1)
	frames.shift()()
	assert.equal(originalImage.style.opacity, "1")
	wheel(-1)
	assert.equal(originalImage.decode.mock.callCount(), 1)
})

test("failed decoding keeps the detail image visible and permits a retry", async (t) => {
	const frames = []
	t.mock.method(globalThis, "requestAnimationFrame", (callback) =>
		frames.push(callback),
	)
	const {originalImage, zoom, wheel} = createViewer()
	t.after(() => zoom.dispose())
	originalImage.dataset.photoSource = "/source.jpg"
	originalImage.decode = async () => {
		throw new Error("Decode failed")
	}

	wheel(-1)
	await Promise.resolve()
	assert.notEqual(originalImage.style.opacity, "1")
	assert.equal(originalImage.getAttribute("src"), null)
	assert.equal(frames.length, 0)

	originalImage.decode = async () => {}
	wheel(-1)
	await Promise.resolve()
	assert.equal(originalImage.src, "/source.jpg")
	frames.shift()()
	assert.equal(originalImage.style.opacity, "1")
})

test("leaving a photo prevents a pending source image from being shown", async (t) => {
	const frames = []
	t.mock.method(globalThis, "requestAnimationFrame", (callback) =>
		frames.push(callback),
	)
	const {originalImage, zoom, wheel} = createViewer()
	const decoding = Promise.withResolvers()
	originalImage.dataset.photoSource = "/source.jpg"
	originalImage.decode = () => decoding.promise

	wheel(-1)
	zoom.dispose()
	decoding.resolve()
	await Promise.resolve()
	frames.shift()()
	assert.notEqual(originalImage.style.opacity, "1")
})
