import assert from "node:assert/strict"
import test from "node:test"
import {
	createRefraktPlan,
	type RefraktCatalogProjection,
	type RefraktRemoteRecord,
} from "./refrakt-plan.ts"

const DID = "did:plc:653egim2jcy2f4j4abtunvhj"
const BLOB_A = "bafkreihsgnec2334oy4iz2cverbvzqva5owy56rzdzxeijao63xwh6747m"
const BLOB_B = "bafkreibguvmlhk4rjaqvcozrh3n3nwap53yaobjmyhrmbthnxw5uvja5o4"

function photo(
	id: string,
	capturedAt: string,
	blob = BLOB_A,
): RefraktCatalogProjection["photos"][number] {
	return {
		id,
		name: id,
		filename: `${id}.jpg`,
		createdAt: `${capturedAt}Z`,
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
		width: 1200,
		height: 800,
		source: {
			$type: "blob",
			ref: {$link: blob},
			mimeType: "image/jpeg",
			size: 1234,
		},
	}
}

function catalog(
	profilePhotoIds = ["aaaaaaaaaaaa", "bbbbbbbbbbbb", "cccccccccccc"],
): RefraktCatalogProjection {
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

function asRemote(plan: Awaited<ReturnType<typeof createRefraktPlan>>) {
	return plan.creates.map((record): RefraktRemoteRecord => ({
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

test("only changes fractional order for the moved profile item", async () => {
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

	assert.equal(moved.updates.length, 1)
	assert.equal(moved.updates[0]?.collection, "app.refrakt.profile.item")
	assert.equal(moved.unchanged.length, 5)
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
		(record) =>
			record.collection === "app.refrakt.photo" &&
			record.label === "aaaaaaaaaaaa.jpg — aaaaaaaaaaaa",
	)
	const updatedPhoto = changed.updates.find(
		(record) =>
			record.collection === "app.refrakt.photo" &&
			record.label === "aaaaaaaaaaaa.jpg — aaaaaaaaaaaa",
	)

	assert.equal(updatedPhoto?.uri, originalPhoto?.uri)
	assert.ok(
		changed.updates.some(
			(record) =>
				record.collection === "app.refrakt.profile.item" &&
				record.label === "aaaaaaaaaaaa.jpg — aaaaaaaaaaaa",
		),
	)
})

test("reports unmatched remote records without deleting them", async () => {
	const unknown: RefraktRemoteRecord = {
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
