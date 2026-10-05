export function advancePhotoScroll(
	position: number,
	velocity: number,
	target: number,
	seconds: number,
): {position: number; velocity: number} {
	const frequency = 24
	const offset = position - target
	const coefficient = velocity + frequency * offset
	const decay = Math.exp(-frequency * seconds)
	return {
		position: target + (offset + coefficient * seconds) * decay,
		velocity: (velocity - frequency * coefficient * seconds) * decay,
	}
}

/** Retarget one critically damped spring; repeated keys keep its velocity. */
export function createPhotoScrollSpring(
	scroll: HTMLElement,
	settled: () => void,
) {
	let frame = 0
	let velocity = 0
	let lastTime = 0
	let position = scroll.scrollTop
	let lastWritten = position
	let target: HTMLElement | null = null

	function cancel(): void {
		cancelAnimationFrame(frame)
		frame = 0
		velocity = 0
		target = null
		scroll.classList.add("snap-y", "snap-mandatory")
	}

	function tick(time: number): void {
		if (!target) {
			return
		}
		const destination = target.offsetTop
		position += scroll.scrollTop - lastWritten
		const next = advancePhotoScroll(
			position,
			velocity,
			destination,
			Math.min(32, time - lastTime) / 1000,
		)
		lastTime = time
		velocity = next.velocity
		position = next.position
		scroll.scrollTop = position
		lastWritten = scroll.scrollTop
		if (Math.abs(position - destination) < 0.5 && Math.abs(velocity) < 5) {
			scroll.scrollTop = destination
			cancel()
			settled()
			return
		}
		frame = requestAnimationFrame(tick)
	}

	return {
		get running() {
			return frame !== 0
		},
		to(element: HTMLElement): void {
			if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
				cancel()
				scroll.scrollTop = element.offsetTop
				settled()
				return
			}
			target = element
			scroll.classList.remove("snap-y", "snap-mandatory")
			if (!frame) {
				position = scroll.scrollTop
				lastWritten = position
				lastTime = performance.now()
				frame = requestAnimationFrame(tick)
			}
		},
		cancel,
	}
}
