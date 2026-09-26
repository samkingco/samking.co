import type {PhotoEntry} from "./schema.ts"

const shortDateFormatter = new Intl.DateTimeFormat("en-GB", {
	day: "numeric",
	month: "short",
	year: "numeric",
	timeZone: "UTC",
})

const monthFormatter = new Intl.DateTimeFormat("en-GB", {
	month: "long",
	timeZone: "UTC",
})

export function photoTitle(photo: PhotoEntry): string {
	return photo.metadata.title ?? photo.metadata.headline ?? "Untitled"
}

export function capturedDate(capturedAt: string | null): string | null {
	return capturedAt?.slice(0, 10) ?? null
}

export function newestCaptureFirst(
	left: PhotoEntry,
	right: PhotoEntry,
): number {
	const leftTimestamp = left.metadata.capturedAt
	const rightTimestamp = right.metadata.capturedAt

	if (!leftTimestamp) {
		return rightTimestamp ? 1 : 0
	}
	if (!rightTimestamp) {
		return -1
	}

	return leftTimestamp > rightTimestamp
		? -1
		: leftTimestamp < rightTimestamp
			? 1
			: 0
}

export function formatPhotoDate(capturedAt: string | null): string {
	const value = capturedDate(capturedAt)
	if (!value) {
		return "—"
	}

	const date = new Date(`${value}T00:00:00Z`)
	return Number.isNaN(date.valueOf()) ? value : shortDateFormatter.format(date)
}

export function capturedDateParts(capturedAt: string | null): {
	year: string
	month: string
	day: string
	dayLabel: string
	monthLabel: string
} | null {
	const value = capturedDate(capturedAt)
	if (!value) {
		return null
	}

	const [year, month, day] = value.split("-")
	if (!year || !month || !day) {
		return null
	}

	return {
		year,
		month,
		day,
		dayLabel: String(Number(day)),
		monthLabel: monthFormatter.format(
			new Date(Date.UTC(Number(year), Number(month) - 1, 1)),
		),
	}
}

export function formatFocalLength(value: string | null): string | null {
	return value ? `${value.replace(/\s*mm$/i, "")}mm` : null
}

export function formatAperture(value: string | null): string | null {
	return value ? `f/${value.replace(/^f\//i, "")}` : null
}

export function formatShutter(value: string | null): string | null {
	return value ? `${value.replace(/\s*s$/i, "")}s` : null
}

export function photoExposure(photo: PhotoEntry): string[] {
	return [
		formatFocalLength(photo.displayFocalLength),
		formatAperture(photo.metadata.aperture),
		formatShutter(photo.metadata.shutter),
		photo.metadata.iso === null ? null : `${photo.metadata.iso} ISO`,
	].filter((value): value is string => value !== null)
}

export function exposureSortValue(value: string | null): string {
	const match = value?.match(/(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?))?/)
	if (!match) {
		return ""
	}
	return String(Number(match[1]) / Number(match[2] ?? 1))
}
