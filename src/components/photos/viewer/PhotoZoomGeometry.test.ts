import assert from "node:assert/strict"
import {test} from "node:test"
import {
	actualScale,
	panBounds,
	pinchPan,
	resumeZoom,
	zoomScales,
	zoomTransform,
} from "./PhotoZoomGeometry.ts"

const close = (actual: number, expected: number) =>
	assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`)

const viewport = {left: 10.5, top: 20.25, width: 1000, height: 800}
const fit = {width: 840.25, height: 560.5}
const pointer = {x: 650.5, y: 450.25}

test("geometry preserves physical image size and fractional cursor anchoring", () => {
	for (const pixelRatio of [0.67, 1, 1.25, 1.5, 2]) {
		const size = {
			width: fit.width / pixelRatio,
			height: fit.height / pixelRatio,
		}
		const maximum = actualScale({width: 4000, height: 2668}, size, pixelRatio)
		close(maximum * size.width * pixelRatio, 4000)
	}
	assert.equal(actualScale({width: 400, height: 300}, fit, 1), 1)
	const pan = pinchPan(
		{scale: 1, panX: 0.25, panY: -0.5, center: pointer},
		{scale: 2, center: {x: pointer.x + 3, y: pointer.y - 2}},
		viewport,
	)
	assert.deepEqual(pan, {panX: -136.5, panY: -33})
	// A fractional layer offset is compensated, not fed back into pan.
	const layer = {...viewport, left: 10.875, top: 20.125}
	assert.deepEqual(zoomTransform({...pan, scale: 2}, viewport, layer), {
		x: -136.875,
		y: -32.875,
		scale: 2,
	})
	assert.deepEqual(panBounds(fit, viewport, 1, false), {x: 0, y: 0})
	assert.ok(panBounds(fit, viewport, 1, true).x > 0)
})

test("resistance increases outside both limits and remains finite for extreme input", () => {
	for (const [maximum, bound, direction] of [
		[1, 1, -1],
		[1, 1, 1],
		[4, 1, -1],
		[4, 4, 1],
	]) {
		let previous = bound
		let previousStep = Infinity
		for (const amount of [0.1, 0.2, 0.3]) {
			const {scale, elasticScale} = zoomScales(
				Math.log(bound) + direction * amount,
				maximum,
			)
			close(scale, bound)
			const step = direction * (elasticScale - previous)
			assert.ok(step > 0 && step < previousStep)
			previous = elasticScale
			previousStep = step
		}
		const extreme = zoomScales(direction * 1e6, maximum)
		assert.ok(Number.isFinite(extreme.elasticScale) && extreme.elasticScale > 0)
	}
})

test("resuming an animation preserves visible scale and position, including elastic stretch", () => {
	for (const visibleScale of [0.85, 1.5, 4.5]) {
		const width = fit.width * visibleScale
		const height = fit.height * visibleScale
		// The visible image is offset from the viewport center by (13.125, -8.75).
		const image = {
			left: 523.625 - width / 2,
			top: 411.5 - height / 2,
			width,
			height,
		}
		const resumed = resumeZoom(image, viewport, pointer, {
			fitWidth: fit.width,
			maximum: 4,
		})
		const {elasticScale} = zoomScales(resumed.logScale, 4)
		const result = zoomTransform(resumed, viewport, viewport, {
			center: pointer,
			ratio: elasticScale / resumed.scale,
		})
		close(result.scale, visibleScale)
		close(result.x, 13.125)
		close(result.y, -8.75)
	}
})
