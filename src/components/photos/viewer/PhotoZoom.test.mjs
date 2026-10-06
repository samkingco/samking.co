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
	animations = []

	setPointerCapture(id) {
		this.capture = id
	}
	hasPointerCapture(id) {
		return this.capture === id
	}
	releasePointerCapture() {
		this.capture = undefined
	}

	querySelector(selector) {
		return this.children.get(selector) ?? null
	}
	closest() {
		return null
	}
	getBoundingClientRect() {
		const scale = Number(
			this.style.transform?.match(/scale\(([^)]+)\)/)?.[1] ?? 1,
		)
		const translation = this.style.transform?.match(
			/translate\(([^p]+)px, ([^p]+)px\)/,
		)
		const width = (this.layoutWidth ?? this.clientWidth) * scale
		const height = (this.layoutHeight ?? this.clientHeight) * scale
		const layer = this.layer?.getBoundingClientRect() ?? {
			left: 0,
			top: 0,
			width: 1000,
			height: 800,
		}
		const left =
			layer.left + (layer.width - width) / 2 + Number(translation?.[1] ?? 0)
		const top =
			layer.top + (layer.height - height) / 2 + Number(translation?.[2] ?? 0)
		return {left, top, right: left + width, bottom: top + height, width, height}
	}
	animate() {
		const animation = {
			cancel() {
				this.oncancel?.()
			},
		}
		this.animations.push(animation)
		return animation
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
globalThis.getComputedStyle = (element) => ({
	width: `${element.layoutWidth ?? element.clientWidth}px`,
	height: `${element.layoutHeight ?? element.clientHeight}px`,
})

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
	for (const [name, photo] of [
		["detail", image],
		["original", originalImage],
	]) {
		const layer = frame.querySelector(`[data-photo-image-layer="${name}"]`)
		photo.layer = layer
		layer.getBoundingClientRect = () => ({
			left: (parseFloat(layer.style.left) || 0) - frame.scrollLeft,
			top: (parseFloat(layer.style.top) || 0) - frame.scrollTop,
			width: parseFloat(layer.style.width) || frame.clientWidth,
			height: parseFloat(layer.style.height) || frame.clientHeight,
		})
	}
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

function scaleOf(image) {
	return (
		image.getBoundingClientRect().width /
		(image.layoutWidth ?? image.clientWidth)
	)
}

test("wheel pinch settles both layers, with and without reduced motion", (t) => {
	t.mock.timers.enable({apis: ["setTimeout"]})
	for (const reduced of [false, true]) {
		t.mock.method(window, "matchMedia", () => ({matches: reduced}))
		const {image, originalImage, detail, zoom, wheel} = createViewer()
		assert.equal(wheel(-100, {ctrlKey: false}), false)
		assert.equal(scaleOf(image), 1)
		for (const [delta, bound] of [
			[-1000, 4],
			[1000, 1],
		]) {
			assert.equal(wheel(delta), true)
			assert.ok(bound === 4 ? scaleOf(image) > 4 : scaleOf(image) < 1)
			assert.equal(detail.dataset.photoZoomed, "true")
			assert.deepEqual(
				originalImage.getBoundingClientRect(),
				image.getBoundingClientRect(),
			)
			t.mock.timers.runAll()
			assert.equal(scaleOf(image), bound)
			assert.equal(detail.dataset.photoZoomed, String(bound > 1))
			for (const layer of [image, originalImage]) {
				assert.equal(layer.animations.length > 0, !reduced)
			}
		}
		zoom.dispose()
	}
})

test("Safari and touch pinch handlers do not double-handle input and settle on release", () => {
	const {frame, image, zoom, wheel} = createViewer()
	const touches = (distance) => [
		{identifier: 1, clientX: 500 - distance / 2, clientY: 400},
		{identifier: 2, clientX: 500 + distance / 2, clientY: 400},
	]
	for (const touch of [false, true]) {
		for (const [scale, bound] of [
			[10, 4],
			[0.1, 1],
		]) {
			zoom.fit()
			if (touch) {
				dispatch(frame, "touchstart", {touches: touches(100)})
				assert.equal(dispatch(frame, "gesturestart", {scale: 1}), false)
				dispatch(frame, "gesturechange", {scale: 2})
				assert.equal(scaleOf(image), 1)
				assert.equal(
					dispatch(frame, "touchmove", {touches: touches(100 * scale)}),
					true,
				)
			} else {
				assert.equal(dispatch(frame, "gesturestart", {scale: 1}), true)
				for (const step of [2, 3, 2]) {
					dispatch(frame, "gesturechange", {scale: step})
					assert.ok(Math.abs(scaleOf(image) - step) < 1e-8)
				}
				assert.equal(dispatch(frame, "gesturechange", {scale}), true)
				const before = scaleOf(image)
				wheel(-100)
				assert.equal(scaleOf(image), before)
			}
			assert.ok(bound === 4 ? scaleOf(image) > 4 : scaleOf(image) < 1)
			dispatch(
				frame,
				touch ? (bound === 4 ? "touchend" : "touchcancel") : "gestureend",
			)
			assert.equal(scaleOf(image), bound)
		}
	}
	zoom.dispose()
})

test("rounded programmatic scroll does not accumulate cursor-anchor drift", () => {
	const {frame, image, zoom, wheel} = createViewer()
	image.layoutWidth = 840.375
	image.layoutHeight = 560.125
	image.clientWidth = 840
	image.clientHeight = 560
	const presentation = frame.querySelector("[data-photo-presentation]")
	for (const [position, extent, dimension, fallback] of [
		["scrollLeft", "scrollWidth", "width", 1000],
		["scrollTop", "scrollHeight", "height", 800],
	]) {
		let value = 0
		Object.defineProperty(frame, position, {
			get: () => value,
			set: (next) => {
				value = Math.round(next)
			},
		})
		Object.defineProperty(frame, extent, {
			get: () =>
				Math.round(parseFloat(presentation.style[dimension]) || fallback),
		})
	}
	zoom.fit()
	const before = image.getBoundingClientRect()
	const anchorX = (600 - before.left) / before.width
	const anchorY = (400 - before.top) / before.height
	for (let i = 0; i < 100; i++) {
		wheel(-0.2)
		dispatch(frame, "scroll")
	}
	const after = image.getBoundingClientRect()
	assert.ok(Math.abs(after.left + after.width * anchorX - 600) < 1e-8)
	assert.ok(Math.abs(after.top + after.height * anchorY - 400) < 1e-8)
	zoom.dispose()
})

test("crossing fit during a pinch preserves pan until release", (t) => {
	t.mock.timers.enable({apis: ["setTimeout"]})
	const {image, zoom, wheel} = createViewer()
	image.clientWidth = 840
	image.clientHeight = 560
	const panX = () => {
		const rect = image.getBoundingClientRect()
		return rect.left + rect.width / 2 - 500
	}
	zoom.actual()
	wheel(Math.log(scaleOf(image) / 1.01) * 100, {clientX: 950, clientY: 700})
	const before = panX()
	assert.ok(before > 70)

	wheel(Math.log(1.01 / 0.999) * 100, {clientX: 950, clientY: 700})
	assert.ok(scaleOf(image) < 1)
	assert.ok(Math.abs(panX() - before) < 1)

	t.mock.timers.runAll()
	assert.equal(scaleOf(image), 1)
	assert.equal(panX(), 0)
	zoom.dispose()
})

test("native pan during elastic zoom remains stable on the next pinch", () => {
	for (const upper of [true, false]) {
		const {frame, image, zoom, wheel} = createViewer()
		if (upper) {
			zoom.actual()
		}
		const pointer = {clientX: 500, clientY: 400}
		const presentation = frame.querySelector("[data-photo-presentation]")
		wheel(0, pointer)
		const layout = {...presentation.style}
		const scroll = [frame.scrollLeft, frame.scrollTop]
		wheel(upper ? -20 : 20, pointer)
		assert.deepEqual(presentation.style, layout)
		assert.deepEqual([frame.scrollLeft, frame.scrollTop], scroll)
		frame.scrollLeft += 40
		dispatch(frame, "scroll")
		const before = image.getBoundingClientRect()
		wheel(0, pointer)
		const after = image.getBoundingClientRect()
		assert.ok(Math.abs(after.left - before.left) < 1e-8)
		assert.ok(Math.abs(after.top - before.top) < 1e-8)
		zoom.dispose()
	}
})

test("pinch and mouse drag resume the visible spring without a snap", (t) => {
	t.mock.timers.enable({apis: ["setTimeout"]})
	t.mock.method(window, "matchMedia", () => ({matches: false}))
	for (const [input, visibleScale] of [
		["pinch", 4.5],
		["pinch", 0.85],
		["drag", 4.5],
	]) {
		const {frame, image, zoom, wheel} = createViewer()
		if (visibleScale > 1) {
			zoom.actual()
		}
		wheel(visibleScale > 1 ? -20 : 20)
		t.mock.timers.runAll()
		assert.ok(image.animations.length > 0)
		const width = image.clientWidth * visibleScale
		const height = image.clientHeight * visibleScale
		const rect = t.mock.method(image, "getBoundingClientRect", () => ({
			left: (1000 - width) / 2,
			top: (800 - height) / 2,
			width,
			height,
		}))
		const pointer = {
			pointerType: "mouse",
			pointerId: 1,
			clientX: 500,
			clientY: 400,
		}
		if (input === "pinch") {
			wheel(visibleScale > 1 ? -0.01 : 0.01, pointer)
		} else {
			dispatch(frame, "pointerdown", pointer)
		}
		rect.mock.restore()
		assert.ok(Math.abs(scaleOf(image) - visibleScale) < 0.001)
		if (input === "drag") {
			const before = image.getBoundingClientRect().left
			dispatch(frame, "pointermove", {...pointer, clientX: 501})
			assert.equal(scaleOf(image), visibleScale)
			assert.ok(
				Math.abs(image.getBoundingClientRect().left - before - 1) < 1e-8,
			)
			dispatch(window, "pointerup", pointer)
			assert.equal(scaleOf(image), 4)
		}
		zoom.dispose()
	}
})

test("buttons override elastic zoom and disposal cancels pending settling", (t) => {
	t.mock.timers.enable({apis: ["setTimeout"]})
	const {frame, detail, image, zoom, wheel} = createViewer()
	for (const [delta, button, bound] of [
		[-1000, "fit", 1],
		[1000, "actual", 4],
	]) {
		wheel(delta)
		zoom[button]()
		assert.equal(scaleOf(image), bound)
		assert.equal(
			detail.querySelector(`[data-photo-${button}]`).ariaPressed,
			"true",
		)
		t.mock.timers.runAll()
		assert.equal(scaleOf(image), bound)
	}
	wheel(-10)
	const before = image.getBoundingClientRect()
	zoom.dispose()
	t.mock.timers.runAll()
	assert.equal(wheel(-100), false)
	assert.equal(dispatch(frame, "gesturestart", {scale: 1}), false)
	assert.deepEqual(image.getBoundingClientRect(), before)
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
