import assert from "node:assert/strict"
import test from "node:test"
import {fromString} from "@atcute/cid"
import type {CatalogPhoto} from "../repos/photos/catalog.ts"
import {compareRecords, type RemoteRecord} from "./records.ts"
import {createRefraktRecords} from "./refrakt.ts"

const DID = "did:plc:653egim2jcy2f4j4abtunvhj"
const BLOB_A = "bafkreihsgnec2334oy4iz2cverbvzqva5owy56rzdzxeijao63xwh6747m"
const BLOB_B = "bafkreibguvmlhk4rjaqvcozrh3n3nwap53yaobjmyhrmbthnxw5uvja5o4"

function photo(id: string, capturedAt: string, blob = BLOB_A): CatalogPhoto {
	return {
		id,
		name: id,
		camera: {make: null, model: null, name: null, focalLengthDisplay: "native"},
		lens: {make: null, model: null, name: null, focalLengthDisplay: "native"},
		displayFocalLength: null,
		memberships: [],
		derivatives: [],
		createdAt: `${capturedAt}Z`,
		metadata: {
			capturedAt,
			title: id,
			headline: null,
			caption: null,
			alt: null,
			cameraMake: null,
			cameraModel: null,
			lensMake: null,
			lensModel: null,
			focalLength: null,
			focalLength35mm: null,
			aperture: null,
			shutter: null,
			iso: null,
			flash: null,
			creator: null,
			creatorUrl: null,
			credit: null,
			copyright: null,
			license: null,
			usageTerms: null,
			attributionUrl: null,
			dominantColor: null,
			palette: [],
			tags: [],
			tagEdges: [],
			width: 1200,
			height: 800,
		},
		selectedExport: {
			id: 1,
			photoId: id,
			profile: "website",
			filename: `${id}.jpg`,
			width: 1200,
			height: 800,
			sha256: fromString(blob).digest.contents.toHex(),
			mimeType: "image/jpeg",
			byteSize: 1234,
		},
	}
}

function catalog(
	profilePhotoIds = ["aaaaaaaaaaaa", "bbbbbbbbbbbb", "cccccccccccc"],
): Parameters<typeof createRefraktRecords>[0]["catalog"] {
	return {
		photos: [
			photo("aaaaaaaaaaaa", "2025-01-01T10:00:00"),
			photo("bbbbbbbbbbbb", "2025-01-01T10:00:01"),
			photo("cccccccccccc", "2025-01-01T10:00:02"),
		],
		profilePhotoIds,
		albums: [],
	}
}

async function createRefraktPlan(
	input: Parameters<typeof createRefraktRecords>[0] & {remote: RemoteRecord[]},
) {
	const records = await createRefraktRecords({
		did: input.did,
		catalog: input.catalog,
	})
	return compareRecords(records, input.remote)
}

function asRemote(plan: Awaited<ReturnType<typeof createRefraktPlan>>) {
	return plan.creates.map((record): RemoteRecord => ({
		uri: record.uri,
		cid: record.cid,
		value: record.record,
	}))
}

test("creates deterministic photo and profile records", async () => {
	const first = await createRefraktPlan({
		did: DID,
		catalog: catalog(),
		remote: [],
	})
	const second = await createRefraktPlan({
		did: DID,
		catalog: catalog(),
		remote: [],
	})

	assert.equal(first.creates.length, 6)
	assert.deepEqual(
		first.creates.map(({uri, cid}) => ({uri, cid})),
		second.creates.map(({uri, cid}) => ({uri, cid})),
	)
	assert.ok(
		first.creates.every((record) => /\/[234567a-z]{13}$/.test(record.uri)),
	)
})

test("profile order comes from the catalog and keeps record identities", async () => {
	const initial = await createRefraktPlan({
		did: DID,
		catalog: catalog(),
		remote: [],
	})
	const moved = await createRefraktPlan({
		did: DID,
		catalog: catalog(["cccccccccccc", "aaaaaaaaaaaa", "bbbbbbbbbbbb"]),
		remote: asRemote(initial),
	})

	assert.equal(moved.creates.length, 0)
	const photoUris = initial.creates
		.filter((record) => record.collection === "app.refrakt.photo")
		.map((record) => record.uri)
	const profile = [...moved.updates, ...moved.unchanged]
		.filter((record) => record.collection === "app.refrakt.profile.item")
		.map((record) => record.record as {order: string; subject: {uri: string}})
		.sort((a, b) => (a.order < b.order ? -1 : 1))
	assert.deepEqual(
		profile.map((record) => record.subject.uri),
		[photoUris[2], photoUris[0], photoUris[1]],
	)
	assert.ok(
		moved.unchanged.every(
			(record) => record.collection === "app.refrakt.photo",
		),
	)
})

test("updates the photo and strong reference without changing the rkey", async () => {
	const initial = await createRefraktPlan({
		did: DID,
		catalog: catalog(),
		remote: [],
	})
	const changedCatalog = catalog()
	changedCatalog.photos[0] = photo(
		"aaaaaaaaaaaa",
		"2025-01-01T10:00:00",
		BLOB_B,
	)
	const changed = await createRefraktPlan({
		did: DID,
		catalog: changedCatalog,
		remote: asRemote(initial),
	})
	const originalPhoto = initial.creates.find(
		(record) => record.collection === "app.refrakt.photo",
	)
	const updatedPhoto = changed.updates.find(
		(record) => record.collection === "app.refrakt.photo",
	)

	assert.ok(originalPhoto)
	assert.ok(updatedPhoto)
	assert.equal(updatedPhoto?.uri, originalPhoto?.uri)
	assert.notEqual(updatedPhoto.cid, originalPhoto.cid)
	const updatedReference = changed.updates.find(
		(record) => record.collection === "app.refrakt.profile.item",
	)
	assert.ok(updatedReference)
	assert.deepEqual((updatedReference.record as {subject: unknown}).subject, {
		uri: updatedPhoto.uri,
		cid: updatedPhoto.cid,
	})
})

test("reports unmatched remote records without deleting them", async () => {
	const unknown: RemoteRecord = {
		uri: `at://${DID}/app.refrakt.photo/3munknown0001`,
		cid: BLOB_A,
		value: {$type: "app.refrakt.photo"},
	}
	const plan = await createRefraktPlan({
		did: DID,
		catalog: catalog(),
		remote: [unknown],
	})

	assert.deepEqual(plan.unmatched, [unknown])
	assert.equal(plan.creates.length, 6)
})

test("album items follow catalog membership order and reference their album", async () => {
	const source = catalog()
	source.albums.push({
		id: "album",
		parentId: "sets",
		name: "Birds",
		kind: "album",
		description: "",
		position: 1,
		sortOrder: "by manual",
		reversed: false,
		createdAt: "2025-01-01T00:00:00.000Z",
		updatedAt: "2025-01-01T00:00:00.000Z",
		photoIds: ["bbbbbbbbbbbb", "aaaaaaaaaaaa"],
	})
	const records = await createRefraktRecords({did: DID, catalog: source})
	const photos = records.filter((row) => row.collection === "app.refrakt.photo")
	const album = records.find((row) => row.collection === "app.refrakt.album")!
	const items = records
		.filter((row) => row.collection === "app.refrakt.album.item")
		.map(
			(row) =>
				row.record as {
					order: string
					destination: string
					subject: {uri: string}
				},
		)
		.sort((a, b) => (a.order < b.order ? -1 : 1))
	assert.deepEqual(
		items.map((row) => row.subject.uri),
		[photos[1]!.uri, photos[0]!.uri],
	)
	assert.deepEqual(
		items.map((row) => row.destination),
		[album.uri, album.uri],
	)
	const remote = records.map((row): RemoteRecord => ({
		uri: row.uri,
		cid: row.cid,
		value: row.record,
	}))
	const repeated = compareRecords(
		await createRefraktRecords({did: DID, catalog: source}),
		remote,
	)
	assert.equal(repeated.creates.length, 0)
	assert.equal(repeated.updates.length, 0)
	assert.equal(repeated.unchanged.length, 9)
})
