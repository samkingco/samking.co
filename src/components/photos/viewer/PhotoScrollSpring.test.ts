import assert from "node:assert/strict"
import {test} from "node:test"
import {
	advancePhotoScroll,
	createPhotoScrollSpring,
} from "./PhotoScrollSpring.ts"

test("photo scroll converges without overshoot and retains velocity when retargeted", () => {
	let state = {position: 0, velocity: 0}
	for (let frame = 0; frame < 12; frame += 1) {
		state = advancePhotoScroll(state.position, state.velocity, 800, 1 / 60)
		assert.ok(state.position >= 0 && state.position < 800)
	}
	const moving = state
	state = advancePhotoScroll(state.position, state.velocity, 2400, 1 / 60)
	assert.ok(
		state.position > moving.position,
		"a new target must not reset position",
	)
	assert.ok(
		state.velocity > moving.velocity,
		"a new forward target must not reset velocity",
	)
	for (let frame = 0; frame < 90; frame += 1) {
		state = advancePhotoScroll(state.position, state.velocity, 2400, 1 / 60)
		assert.ok(state.position <= 2400)
	}
	assert.ok(Math.abs(state.position - 2400) < 0.01)
	assert.ok(Math.abs(state.velocity) < 0.01)
	for (let frame = 0; frame < 90; frame += 1) {
		state = advancePhotoScroll(state.position, state.velocity, 0, 1 / 60)
	}
	assert.ok(Math.abs(state.position) < 0.01)
})

test("repeated input uses one animation and reduced motion skips it", () => {
	const frames = new Map<number, FrameRequestCallback>()
	let id = 0
	let reduced = false
	let settled = 0
	let top = 0
	const classes = new Set(["snap-y", "snap-mandatory"])
	const scroll = {
		get scrollTop() {
			return top
		},
		set scrollTop(value: number) {
			top = Math.round(value)
		},
		classList: {
			add: (...values: string[]) =>
				values.forEach((value) => classes.add(value)),
			remove: (...values: string[]) =>
				values.forEach((value) => classes.delete(value)),
		},
	} as unknown as HTMLElement
	const globals = {
		requestAnimationFrame: (callback: FrameRequestCallback) => {
			frames.set(++id, callback)
			return id
		},
		cancelAnimationFrame: (frame: number) => frames.delete(frame),
		window: {matchMedia: () => ({matches: reduced})},
	}
	const previous = Object.keys(globals).map(
		(name) =>
			[name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
	)
	for (const [name, value] of Object.entries(globals)) {
		Object.defineProperty(globalThis, name, {configurable: true, value})
	}
	try {
		const spring = createPhotoScrollSpring(scroll, () => {
			settled += 1
		})
		spring.to({offsetTop: 800} as HTMLElement)
		spring.to({offsetTop: 1600} as HTMLElement)
		spring.to({offsetTop: 2400} as HTMLElement)
		assert.equal(frames.size, 1)
		assert.equal(scroll.scrollTop, 0, "retargeting does not jump")
		let time = performance.now()
		for (let count = 0; count < 120 && frames.size; count += 1) {
			time += 1000 / 60
			const [frame, callback] = frames.entries().next().value!
			frames.delete(frame)
			callback(time)
		}
		assert.equal(
			spring.running,
			false,
			"rounded scroll positions must still settle",
		)
		assert.equal(scroll.scrollTop, 2400)
		assert.equal(settled, 1)
		assert.ok(classes.has("snap-mandatory"))
		reduced = true
		spring.to({offsetTop: 800} as HTMLElement)
		assert.equal(scroll.scrollTop, 800)
		assert.equal(frames.size, 0)
		assert.equal(settled, 2)
	} finally {
		previous.forEach(([name, descriptor]) => {
			if (descriptor) {
				Object.defineProperty(globalThis, name, descriptor)
			} else {
				Reflect.deleteProperty(globalThis, name)
			}
		})
	}
})
