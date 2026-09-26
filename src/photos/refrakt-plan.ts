import {encode} from "@atcute/cbor"
import {
	toString as cidToString,
	CODEC_DCBOR,
	create as createCid,
} from "@atcute/cid"
import * as lex from "@atcute/lexicons/validations"
import {
	generateNKeysBetween,
	indexCharacterSet,
} from "fractional-indexing-jittered"

export type RefraktCollection =
	| "app.refrakt.photo"
	| "app.refrakt.album"
	| "app.refrakt.album.item"
	| "app.refrakt.profile.item"

export const REFRAKT_COLLECTIONS: readonly RefraktCollection[] = [
	"app.refrakt.photo",
	"app.refrakt.album",
	"app.refrakt.album.item",
	"app.refrakt.profile.item",
]

const PHOTO_COLLECTION = REFRAKT_COLLECTIONS[0]
const ALBUM_COLLECTION = REFRAKT_COLLECTIONS[1]
const ALBUM_ITEM_COLLECTION = REFRAKT_COLLECTIONS[2]
const PROFILE_ITEM_COLLECTION = REFRAKT_COLLECTIONS[3]
const TID_ALPHABET = "234567abcdefghijklmnopqrstuvwxyz"
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

type Rational = {numerator: number; denominator: number}

type CatalogPhoto = {
	id: string
	name: string
	filename: string
	createdAt: string
	capturedAt: string | null
	title: string | null
	headline: string | null
	caption: string | null
	alt: string | null
	cameraMake: string | null
	cameraModel: string | null
	lensMake: string | null
	lensModel: string | null
	focalLength: string | null
	focalLength35mm: string | null
	aperture: string | null
	shutter: string | null
	iso: number | null
	flash: boolean | null
	width: number
	height: number
	source: {
		$type: "blob"
		ref: {$link: string}
		mimeType: string
		size: number
	}
}

type CatalogAlbum = {
	id: string
	title: string
	description: string
	createdAt: string
	photoIds: string[]
}

export type RefraktCatalogProjection = {
	photos: CatalogPhoto[]
	profilePhotoIds: string[]
	albums: CatalogAlbum[]
}

export type RefraktRemoteRecord = {
	uri: string
	cid: string
	value: unknown
}

export type RefraktPlannedRecord = {
	collection: RefraktCollection
	rkey: string
	uri: string
	cid: string
	label: string
	record: unknown
}

export type RefraktPlan = {
	creates: RefraktPlannedRecord[]
	updates: RefraktPlannedRecord[]
	unchanged: RefraktPlannedRecord[]
	unmatched: RefraktRemoteRecord[]
	warnings: string[]
}

export async function createRefraktPlan(input: {
	did: string
	catalog: RefraktCatalogProjection
	remote: RefraktRemoteRecord[]
}): Promise<RefraktPlan> {
	const remoteByUri = new Map(
		input.remote.map((record) => [record.uri, record]),
	)
	const warnings: string[] = []
	const photos = await buildPhotos(input.did, input.catalog.photos, warnings)
	const photoById = new Map(photos.map((photo) => [photo.sourceId, photo]))
	const albums = await buildAlbums(input.did, input.catalog.albums)
	const albumById = new Map(albums.map((album) => [album.sourceId, album]))
	const desired: RefraktPlannedRecord[] = [
		...photos.map(({sourceId: _, ...record}) => record),
		...albums.map(({sourceId: _, ...record}) => record),
		...(await buildProfileItems(
			input.did,
			input.catalog.profilePhotoIds,
			photoById,
			remoteByUri,
		)),
	]

	for (const album of input.catalog.albums) {
		const plannedAlbum = albumById.get(album.id)
		if (!plannedAlbum) {
			continue
		}
		desired.push(
			...(await buildAlbumItems({
				did: input.did,
				album,
				plannedAlbum,
				photoById,
				remoteByUri,
			})),
		)
	}

	assertUniqueUris(desired)
	const desiredUris = new Set(desired.map((record) => record.uri))
	const creates: RefraktPlannedRecord[] = []
	const updates: RefraktPlannedRecord[] = []
	const unchanged: RefraktPlannedRecord[] = []
	for (const record of desired) {
		const remote = remoteByUri.get(record.uri)
		if (!remote) {
			creates.push(record)
		} else if (remote.cid === record.cid) {
			unchanged.push(record)
		} else {
			updates.push(record)
		}
	}

	return {
		creates,
		updates,
		unchanged,
		unmatched: input.remote.filter((record) => !desiredUris.has(record.uri)),
		warnings,
	}
}

type SourceRecord = RefraktPlannedRecord & {sourceId: string}

async function buildPhotos(
	did: string,
	photos: CatalogPhoto[],
	warnings: string[],
): Promise<SourceRecord[]> {
	return Promise.all(photos.map((photo) => buildPhoto(did, photo, warnings)))
}

async function buildPhoto(
	did: string,
	photo: CatalogPhoto,
	warnings: string[],
): Promise<SourceRecord> {
	const createdAt = recordDate(photo.capturedAt, photo.createdAt)
	const rkey = sourceTid(createdAt, photo.id)
	const alt = firstText(photo.alt, photo.caption) ?? ""
	if (!alt) {
		warnings.push(`${photoLabel(photo)}: no alt text or description`)
	}
	const caption = firstText(photo.caption, photo.headline, photo.title)
	const record = lex.parse(photoSchema, {
		$type: PHOTO_COLLECTION,
		createdAt,
		source: photo.source,
		alt,
		...(caption ? {caption} : {}),
		width: photo.width,
		height: photo.height,
		exif: photoExif(photo, createdAt),
	})
	return plannedSourceRecord({
		did,
		collection: PHOTO_COLLECTION,
		rkey,
		label: photoLabel(photo),
		record,
		sourceId: photo.id,
	})
}

async function buildAlbums(
	did: string,
	albums: CatalogAlbum[],
): Promise<SourceRecord[]> {
	return Promise.all(
		albums.map(async (album) => {
			const createdAt = recordDate(null, album.createdAt)
			const record = lex.parse(albumSchema, {
				$type: ALBUM_COLLECTION,
				createdAt,
				title: album.title,
				...(album.description ? {description: album.description} : {}),
			})
			return plannedSourceRecord({
				did,
				collection: ALBUM_COLLECTION,
				rkey: sourceTid(createdAt, album.id),
				label: album.title,
				record,
				sourceId: album.id,
			})
		}),
	)
}

async function buildProfileItems(
	did: string,
	photoIds: string[],
	photoById: Map<string, SourceRecord>,
	remoteByUri: Map<string, RefraktRemoteRecord>,
): Promise<RefraktPlannedRecord[]> {
	const inputs = photoIds.flatMap((photoId) => {
		const photo = photoById.get(photoId)
		if (!photo) {
			return []
		}
		const createdAt = recordCreatedAt(photo.record)
		const rkey = sourceTid(createdAt, `profile:${photoId}`)
		return [
			{photo, createdAt, rkey, uri: atUri(did, PROFILE_ITEM_COLLECTION, rkey)},
		]
	})
	const orders = assignOrders(
		inputs.map((input) => input.uri),
		remoteByUri,
	)
	return Promise.all(
		inputs.map(async (input, index) => {
			const record = lex.parse(profileItemSchema, {
				$type: PROFILE_ITEM_COLLECTION,
				createdAt: input.createdAt,
				subject: {uri: input.photo.uri, cid: input.photo.cid},
				order: orders[index],
			})
			return plannedRecord({
				did,
				collection: PROFILE_ITEM_COLLECTION,
				rkey: input.rkey,
				label: input.photo.label,
				record,
			})
		}),
	)
}

async function buildAlbumItems(context: {
	did: string
	album: CatalogAlbum
	plannedAlbum: SourceRecord
	photoById: Map<string, SourceRecord>
	remoteByUri: Map<string, RefraktRemoteRecord>
}): Promise<RefraktPlannedRecord[]> {
	const {did, album, plannedAlbum, photoById, remoteByUri} = context
	const inputs = album.photoIds.flatMap((photoId) => {
		const photo = photoById.get(photoId)
		if (!photo) {
			return []
		}
		const createdAt = recordCreatedAt(photo.record)
		const rkey = sourceTid(createdAt, `${album.id}:${photoId}`)
		return [
			{photo, createdAt, rkey, uri: atUri(did, ALBUM_ITEM_COLLECTION, rkey)},
		]
	})
	const orders = assignOrders(
		inputs.map((item) => item.uri),
		remoteByUri,
	)
	return Promise.all(
		inputs.map(async (item, index) => {
			const record = lex.parse(albumItemSchema, {
				$type: ALBUM_ITEM_COLLECTION,
				createdAt: item.createdAt,
				destination: plannedAlbum.uri,
				subject: {uri: item.photo.uri, cid: item.photo.cid},
				order: orders[index],
			})
			return plannedRecord({
				did,
				collection: ALBUM_ITEM_COLLECTION,
				rkey: item.rkey,
				label: `${album.title} → ${item.photo.label}`,
				record,
			})
		}),
	)
}

async function plannedSourceRecord(input: {
	did: string
	collection: RefraktPlannedRecord["collection"]
	rkey: string
	label: string
	record: unknown
	sourceId: string
}): Promise<SourceRecord> {
	return {...(await plannedRecord(input)), sourceId: input.sourceId}
}

async function plannedRecord(input: {
	did: string
	collection: RefraktPlannedRecord["collection"]
	rkey: string
	label: string
	record: unknown
}): Promise<RefraktPlannedRecord> {
	return {
		collection: input.collection,
		rkey: input.rkey,
		uri: atUri(input.did, input.collection, input.rkey),
		cid: cidToString(await createCid(CODEC_DCBOR, encode(input.record))),
		label: input.label,
		record: input.record,
	}
}

function assignOrders(
	desiredUris: string[],
	remoteByUri: Map<string, RefraktRemoteRecord>,
): string[] {
	const existing = desiredUris.map((uri) => remoteOrder(remoteByUri.get(uri)))
	const kept = longestIncreasingIndexes(existing)
	const result = [...existing]
	let start = 0
	while (start < desiredUris.length) {
		if (kept.has(start)) {
			start += 1
			continue
		}
		let end = start
		while (end < desiredUris.length && !kept.has(end)) {
			end += 1
		}
		const generated = generateNKeysBetween(
			previousKeptOrder(result, kept, start),
			nextKeptOrder(result, kept, end),
			end - start,
			orderCharset,
		)
		for (let index = start; index < end; index += 1) {
			result[index] = generated[index - start]
		}
		start = end
	}
	return result.map((order) => {
		if (!order) {
			throw new Error("Unable to assign fractional order")
		}
		return order
	})
}

// Photo collections stay small; the quadratic form keeps the stable-order rule obvious.
function longestIncreasingIndexes(values: Array<string | null>): Set<number> {
	const lengths: number[] = values.map((value) => (value === null ? 0 : 1))
	const previous = values.map(() => -1)
	let best = -1
	for (let right = 0; right < values.length; right += 1) {
		if (values[right] === null) {
			continue
		}
		const left = longestPreviousIndex(values, lengths, right)
		if (left !== -1) {
			lengths[right] = lengths[left] + 1
			previous[right] = left
		}
		if (best === -1 || lengths[right] > lengths[best]) {
			best = right
		}
	}
	const indexes = new Set<number>()
	while (best !== -1) {
		indexes.add(best)
		best = previous[best]
	}
	return indexes
}

function longestPreviousIndex(
	values: Array<string | null>,
	lengths: number[],
	right: number,
): number {
	const rightValue = values[right]
	let best = -1
	for (let left = 0; left < right; left += 1) {
		const leftValue = values[left]
		if (
			leftValue !== null &&
			rightValue !== null &&
			leftValue < rightValue &&
			(best === -1 || lengths[left] > lengths[best])
		) {
			best = left
		}
	}
	return best
}

function previousKeptOrder(
	orders: Array<string | null>,
	kept: Set<number>,
	start: number,
): string | null {
	for (let index = start - 1; index >= 0; index -= 1) {
		if (kept.has(index)) {
			return orders[index]
		}
	}
	return null
}

function nextKeptOrder(
	orders: Array<string | null>,
	kept: Set<number>,
	start: number,
): string | null {
	for (let index = start; index < orders.length; index += 1) {
		if (kept.has(index)) {
			return orders[index]
		}
	}
	return null
}

function remoteOrder(record: RefraktRemoteRecord | undefined): string | null {
	if (!record || !record.value || typeof record.value !== "object") {
		return null
	}
	if (!("order" in record.value) || typeof record.value.order !== "string") {
		return null
	}
	return record.value.order
}

function photoExif(photo: CatalogPhoto, capturedAt: string): object {
	const exif: Record<string, unknown> = {capturedAt}
	setValue(exif, "make", photo.cameraMake)
	setValue(exif, "model", photo.cameraModel)
	setValue(exif, "lensMake", photo.lensMake)
	setValue(exif, "lensModel", photo.lensModel)
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
	const title = firstText(photo.title, photo.headline)
	return title ? `${photo.filename} — ${title}` : photo.filename
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
	return `${s32(microseconds).padStart(11, "2")}${s32(clock).padStart(2, "2")}`
}

function stableHash(value: string): number {
	let hash = 2_166_136_261
	for (const byte of new TextEncoder().encode(value)) {
		hash ^= byte
		hash = Math.imul(hash, 16_777_619)
	}
	return hash >>> 0
}

function s32(value: number): string {
	if (value === 0) {
		return "2"
	}
	let encoded = ""
	let remaining = value
	while (remaining > 0) {
		encoded = TID_ALPHABET[remaining % 32] + encoded
		remaining = Math.floor(remaining / 32)
	}
	return encoded
}

function recordDate(capturedAt: string | null, fallback: string): string {
	const date = new Date(capturedAt ? `${capturedAt}Z` : fallback)
	if (Number.isNaN(date.valueOf())) {
		throw new Error("Invalid catalog date")
	}
	return date.toISOString()
}

function recordCreatedAt(record: unknown): string {
	if (
		!record ||
		typeof record !== "object" ||
		!("createdAt" in record) ||
		typeof record.createdAt !== "string"
	) {
		throw new Error("Photo record is missing createdAt")
	}
	return record.createdAt
}

function atUri(did: string, collection: string, rkey: string): string {
	return `at://${did}/${collection}/${rkey}`
}

function assertUniqueUris(records: RefraktPlannedRecord[]): void {
	const seen = new Set<string>()
	for (const record of records) {
		if (seen.has(record.uri)) {
			throw new Error(`Deterministic record URI collision: ${record.uri}`)
		}
		seen.add(record.uri)
	}
}
