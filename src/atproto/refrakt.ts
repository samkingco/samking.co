import {toString as cidToString, CODEC_RAW, fromDigest} from "@atcute/cid"
import * as lex from "@atcute/lexicons/validations"
import {create as createTid} from "@atcute/tid"
import {
	generateNKeysBetween,
	indexCharacterSet,
} from "fractional-indexing-jittered"
import type {CatalogAlbum, CatalogPhoto} from "../repos/photos/catalog.ts"
import {createPlannedRecord, type PlannedRecord} from "./records.ts"

export const REFRAKT_COLLECTIONS = [
	"app.refrakt.photo",
	"app.refrakt.album",
	"app.refrakt.album.item",
	"app.refrakt.profile.item",
] as const

const PHOTO_COLLECTION = REFRAKT_COLLECTIONS[0]
const ALBUM_COLLECTION = REFRAKT_COLLECTIONS[1]
const ALBUM_ITEM_COLLECTION = REFRAKT_COLLECTIONS[2]
const PROFILE_ITEM_COLLECTION = REFRAKT_COLLECTIONS[3]

const orderCharset = indexCharacterSet({
	chars: "0123456789abcdefghijklmnopqrstuvwxyz",
	firstPositive: "a",
	mostPositive: "z",
	mostNegative: "0",
})

const rationalSchema = lex.object({
	$type: lex.optional(lex.literal("app.refrakt.defs#rational")),
	numerator: lex.integer(),
	denominator: lex.integer(),
})

const strongRefSchema = lex.object({
	$type: lex.optional(lex.literal("com.atproto.repo.strongRef")),
	uri: lex.resourceUriString(),
	cid: lex.cidString(),
})

const photoSchema = lex.record(
	lex.tidString(),
	lex.object({
		$type: lex.literal(PHOTO_COLLECTION),
		createdAt: lex.datetimeString(),
		source: lex.blob(),
		alt: lex.constrain(lex.string(), [
			lex.stringLength(0, 20_000),
			lex.stringGraphemes(0, 2000),
		]),
		caption: lex.optional(
			lex.constrain(lex.string(), [
				lex.stringLength(0, 5000),
				lex.stringGraphemes(0, 500),
			]),
		),
		width: lex.constrain(lex.integer(), [lex.integerRange(1)]),
		height: lex.constrain(lex.integer(), [lex.integerRange(1)]),
		exif: lex.optional(
			lex.object({
				$type: lex.optional(lex.literal("app.refrakt.photo#exif")),
				capturedAt: lex.optional(lex.datetimeString()),
				make: lex.optional(
					lex.constrain(lex.string(), [lex.stringLength(0, 300)]),
				),
				model: lex.optional(
					lex.constrain(lex.string(), [lex.stringLength(0, 300)]),
				),
				lensMake: lex.optional(
					lex.constrain(lex.string(), [lex.stringLength(0, 300)]),
				),
				lensModel: lex.optional(
					lex.constrain(lex.string(), [lex.stringLength(0, 300)]),
				),
				focalLength: lex.optional(rationalSchema),
				focalLength35mm: lex.optional(rationalSchema),
				aperture: lex.optional(rationalSchema),
				shutterSpeed: lex.optional(rationalSchema),
				iso: lex.optional(lex.integer()),
				flash: lex.optional(lex.boolean()),
			}),
		),
	}),
)

const albumSchema = lex.record(
	lex.tidString(),
	lex.object({
		$type: lex.literal(ALBUM_COLLECTION),
		createdAt: lex.datetimeString(),
		title: lex.constrain(lex.string(), [
			lex.stringLength(1, 1000),
			lex.stringGraphemes(1, 100),
		]),
		description: lex.optional(
			lex.constrain(lex.string(), [
				lex.stringLength(0, 5000),
				lex.stringGraphemes(0, 500),
			]),
		),
	}),
)

const albumItemSchema = lex.record(
	lex.tidString(),
	lex.object({
		$type: lex.literal(ALBUM_ITEM_COLLECTION),
		createdAt: lex.datetimeString(),
		subject: strongRefSchema,
		destination: lex.resourceUriString(),
		order: lex.constrain(lex.string(), [lex.stringLength(0, 64)]),
	}),
)

const profileItemSchema = lex.record(
	lex.tidString(),
	lex.object({
		$type: lex.literal(PROFILE_ITEM_COLLECTION),
		createdAt: lex.datetimeString(),
		subject: strongRefSchema,
		order: lex.constrain(lex.string(), [lex.stringLength(0, 64)]),
	}),
)

type Rational = lex.InferOutput<typeof rationalSchema>

export async function createRefraktRecords(input: {
	did: string
	catalog: {
		photos: CatalogPhoto[]
		albums: CatalogAlbum[]
		profilePhotoIds: string[]
	}
}): Promise<PlannedRecord[]> {
	const {did, catalog} = input
	const photos = new Map(
		await Promise.all(
			catalog.photos.map(
				async (photo) => [photo.id, await buildPhoto(did, photo)] as const,
			),
		),
	)
	const albums = new Map(
		await Promise.all(
			catalog.albums.map(
				async (album) => [album.id, await buildAlbum(did, album)] as const,
			),
		),
	)
	const records: PlannedRecord[] = [...photos.values(), ...albums.values()]
	const profileIds = catalog.profilePhotoIds.filter((id) => photos.has(id))
	const profileOrders = generateNKeysBetween(
		null,
		null,
		profileIds.length,
		orderCharset,
	)
	for (const [index, id] of profileIds.entries()) {
		const photo = photos.get(id)!
		const createdAt = photo.record.createdAt
		records.push(
			await createPlannedRecord({
				did,
				collection: PROFILE_ITEM_COLLECTION,
				rkey: sourceTid(createdAt, `profile:${id}`),
				label: photo.label,
				record: lex.parse(profileItemSchema, {
					$type: PROFILE_ITEM_COLLECTION,
					createdAt,
					subject: {uri: photo.uri, cid: photo.cid},
					order: profileOrders[index],
				}),
			}),
		)
	}
	for (const album of catalog.albums) {
		const ids = album.photoIds.filter((id) => photos.has(id))
		const orders = generateNKeysBetween(null, null, ids.length, orderCharset)
		for (const [index, id] of ids.entries()) {
			const photo = photos.get(id)!
			const createdAt = photo.record.createdAt
			records.push(
				await createPlannedRecord({
					did,
					collection: ALBUM_ITEM_COLLECTION,
					rkey: sourceTid(createdAt, `${album.id}:${id}`),
					label: `${album.name} → ${photo.label}`,
					record: lex.parse(albumItemSchema, {
						$type: ALBUM_ITEM_COLLECTION,
						createdAt,
						destination: albums.get(album.id)!.uri,
						subject: {uri: photo.uri, cid: photo.cid},
						order: orders[index],
					}),
				}),
			)
		}
	}
	return records
}

async function buildPhoto(did: string, photo: CatalogPhoto) {
	const {metadata, selectedExport} = photo
	const createdAt = recordDate(metadata.capturedAt, photo.createdAt)
	const rkey = sourceTid(createdAt, photo.id)
	const alt = firstText(metadata.alt, metadata.caption) ?? ""
	const caption = firstText(metadata.caption, metadata.headline, metadata.title)
	const record = lex.parse(photoSchema, {
		$type: PHOTO_COLLECTION,
		createdAt,
		source: {
			$type: "blob",
			ref: {$link: blobCid(selectedExport.sha256)},
			mimeType: selectedExport.mimeType,
			size: selectedExport.byteSize,
		},
		alt,
		...(caption ? {caption} : {}),
		width: selectedExport.width,
		height: selectedExport.height,
		exif: photoExif(photo, createdAt),
	})
	return createPlannedRecord({
		did,
		collection: PHOTO_COLLECTION,
		rkey,
		label: photoLabel(photo),
		record,
	})
}

async function buildAlbum(did: string, album: CatalogAlbum) {
	const createdAt = recordDate(null, album.createdAt)
	return createPlannedRecord({
		did,
		collection: ALBUM_COLLECTION,
		rkey: sourceTid(createdAt, album.id),
		label: album.name,
		record: lex.parse(albumSchema, {
			$type: ALBUM_COLLECTION,
			createdAt,
			title: album.name,
			...(album.description ? {description: album.description} : {}),
		}),
	})
}

function photoExif(
	{metadata: photo, camera, lens}: CatalogPhoto,
	capturedAt: string,
): object {
	const exif: Record<string, unknown> = {capturedAt}
	setValue(exif, "make", camera.make)
	setValue(exif, "model", camera.model)
	setValue(exif, "lensMake", lens.make)
	setValue(exif, "lensModel", lens.model)
	setValue(exif, "focalLength", rational(photo.focalLength, /\s*mm$/i, false))
	setValue(
		exif,
		"focalLength35mm",
		rational(photo.focalLength35mm, /\s*mm$/i, false),
	)
	setValue(exif, "aperture", rational(photo.aperture, /^f\//i, false))
	setValue(exif, "shutterSpeed", rational(photo.shutter, /\s*s$/i, true))
	setValue(exif, "iso", photo.iso)
	setValue(exif, "flash", photo.flash)
	return exif
}

function setValue(
	target: Record<string, unknown>,
	key: string,
	value: unknown,
): void {
	if (value !== null && value !== undefined) {
		target[key] = value
	}
}

function photoLabel(photo: CatalogPhoto): string {
	const title = firstText(photo.metadata.title, photo.metadata.headline)
	const {filename} = photo.selectedExport
	return title ? `${filename} — ${title}` : filename
}

function firstText(
	...values: Array<string | null | undefined>
): string | undefined {
	return values.find((value) => Boolean(value)) ?? undefined
}

function rational(
	value: string | null,
	decoration: RegExp,
	allowFraction: boolean,
): Rational | undefined {
	if (!value) {
		return undefined
	}
	const raw = value.replace(decoration, "").trim()
	const fraction = allowFraction ? /^(\d+)\/(\d+)$/.exec(raw) : null
	if (fraction) {
		return {numerator: Number(fraction[1]), denominator: Number(fraction[2])}
	}
	if (!/^\d+(?:\.\d+)?$/.test(raw)) {
		return undefined
	}
	const [integer, decimals = ""] = raw.split(".")
	const denominator = 10 ** decimals.length
	const numerator = Number(integer) * denominator + Number(decimals || 0)
	const divisor = greatestCommonDivisor(numerator, denominator)
	return {numerator: numerator / divisor, denominator: denominator / divisor}
}

function greatestCommonDivisor(left: number, right: number): number {
	let a = left
	let b = right
	while (b !== 0) {
		;[a, b] = [b, a % b]
	}
	return a
}

function sourceTid(date: string, sourceId: string): string {
	const hash = stableHash(sourceId)
	const microseconds = new Date(date).getTime() * 1000 + (hash % 1_000_000)
	const clock = Math.floor(hash / 1_000_000) % 32
	return createTid(microseconds, clock)
}

function stableHash(value: string): number {
	let hash = 2_166_136_261
	for (const byte of new TextEncoder().encode(value)) {
		hash ^= byte
		hash = Math.imul(hash, 16_777_619)
	}
	return hash >>> 0
}

function recordDate(capturedAt: string | null, fallback: string): string {
	const date = new Date(capturedAt ? `${capturedAt}Z` : fallback)
	if (Number.isNaN(date.valueOf())) {
		throw new Error("Invalid catalog date")
	}
	return date.toISOString()
}

function blobCid(sha256: string): string {
	if (!/^[0-9a-f]{64}$/i.test(sha256)) {
		throw new Error("Invalid source SHA-256")
	}
	return cidToString(fromDigest(CODEC_RAW, Uint8Array.fromHex(sha256)))
}
