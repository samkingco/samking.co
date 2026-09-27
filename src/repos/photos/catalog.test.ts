import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
import test, {type TestContext} from "node:test"
import {eq} from "drizzle-orm"
import {createRefraktRecords} from "../../atproto/refrakt.ts"
import {readRefraktCatalog, readWebsiteCatalog} from "./catalog.ts"
import {readCollections, saveCollectionDescription} from "./collections.ts"
import {
	catalog,
	collectionPhotos,
	collections,
	photoDerivatives,
	photoExports,
	photos,
} from "./database-schema.ts"
import {bindDocument, checkDocument, openPhotoDatabase} from "./database.ts"
import {saveEquipmentAlias} from "./equipment.ts"

const date = "2025-01-01T00:00:00.000Z"
const website = {
	allPhotosCollectionId: "all",
	setsCollectionId: "sets",
	exportProfile: "website",
}
const refrakt = {
	rootCollectionId: "root",
	profileCollectionId: "all",
	albumsCollectionId: "sets",
	exportProfile: "refrakt",
}
const metadata = {
	title: null,
	headline: null,
	caption: "A bird",
	alt: "A crow on a branch",
	creator: null,
	creatorUrl: null,
	credit: null,
	copyright: null,
	license: null,
	usageTerms: null,
	attributionUrl: null,
	capturedAt: "2025-01-01T12:00:00",
	cameraMake: "FUJIFILM",
	cameraModel: "X-T5",
	lensMake: "FUJIFILM",
	lensModel: "XF 35",
	focalLength: "35 mm",
	focalLength35mm: "53 mm",
	aperture: "f/2",
	shutter: "1/250 s",
	iso: 400,
	flash: false,
	width: 1200,
	height: 800,
	tags: [],
	tagEdges: [],
}

function fixture(t: TestContext) {
	const database = openPhotoDatabase(":memory:")
	t.after(() => database.$client.close())
	database.$client.exec(
		readFileSync(
			new URL(
				"../../../drizzle/photos/20260925205129_massive_silver_samurai/migration.sql",
				import.meta.url,
			),
			"utf8",
		),
	)
	database
		.insert(collections)
		.values(
			[
				["root", "", "group"],
				["all", "root", "album"],
				["sets", "root", "group"],
				["album", "sets", "album"],
				["other", "", "album"],
			].map(([id, parentId, kind], index) => ({
				id,
				parentId,
				kind,
				name: id,
				position: index + 1,
				sortOrder: "manual",
				reversed: false,
				createdAt: date,
				updatedAt: date,
			})),
		)
		.run()
	for (const [index, id] of ["a", "b", "outside"].entries()) {
		database
			.insert(photos)
			.values({
				id,
				captureOneVariantId: id,
				captureOneVariantName: id,
				status: "active",
				createdAt: date,
				updatedAt: date,
				metadataJson: JSON.stringify(metadata),
			})
			.run()
		for (const profile of ["website", "refrakt"]) {
			const selectedExport = database
				.insert(photoExports)
				.values({
					photoId: id,
					captureOneOutputId: `${id}-${profile}`,
					profile,
					sourcePath: `/exports/${id}.jpg`,
					filename: `${id}.jpg`,
					sha256: (profile === "website" ? "a" : "b").repeat(64),
					byteSize: 1234,
					mimeType: "image/jpeg",
					width: 1200,
					height: 800,
					metadataJson: JSON.stringify(metadata),
					rawMetadataJson: "{}",
					current: true,
					createdAt: date,
				})
				.returning()
				.get()
			database
				.insert(photoDerivatives)
				.values(
					(["source", "thumb", "detail", "og"] as const).map((kind) => ({
						exportId: selectedExport.id,
						kind,
						path: `/objects/${id}/${profile}/${kind}`,
						r2Key: `photos/${id}/${profile}/${kind}`,
						sha256: "c".repeat(64),
						byteSize: 100,
						mimeType: "image/jpeg",
						width: 100,
						height: 100,
						uploadedAt: date,
						createdAt: date,
					})),
				)
				.run()
		}
		database
			.insert(collectionPhotos)
			.values({
				collectionId: id === "outside" ? "other" : "all",
				photoId: id,
				position: index + 1,
			})
			.run()
	}
	database
		.insert(collectionPhotos)
		.values([
			{collectionId: "album", photoId: "a", position: 1},
			{collectionId: "album", photoId: "b", position: 2},
			{collectionId: "other", photoId: "a", position: 4},
		])
		.run()
	return database
}

test("catalog reads preserve membership order and use edits in both destinations", async (t) => {
	const db = fixture(t)
	saveCollectionDescription(db, "album", "Birds near home")
	saveEquipmentAlias(db, {
		kind: "camera",
		sourceName: "FUJIFILM X-T5",
		displayName: "X-T5",
		focalLengthDisplay: "35mm",
	})
	const web = readWebsiteCatalog(db, website, false)
	assert.deepEqual(
		web.photos.map((photo) => photo.id),
		["b", "a"],
	)
	assert.deepEqual(
		web.albums.map(({id, description, photoIds}) => ({
			id,
			description,
			photoIds,
		})),
		[{id: "album", description: "Birds near home", photoIds: ["a", "b"]}],
	)
	const a = web.photos[1]!
	assert.deepEqual(
		a.memberships.map(({collection, position}) => [collection.id, position]),
		[
			["album", 1],
			["all", 1],
			["other", 4],
		],
	)
	assert.equal(a.camera.name, "X-T5")
	assert.equal(a.displayFocalLength, "53 mm")
	assert.equal(a.metadata.cameraMake, "FUJIFILM")
	assert.equal(a.selectedExport.sha256, "a".repeat(64))
	const selected = readRefraktCatalog(db, refrakt)
	assert.deepEqual(
		selected.photos.map((photo) => photo.id),
		["a", "b"],
	)
	assert.deepEqual(selected.profilePhotoIds, ["a", "b"])
	assert.equal(selected.photos[0]?.selectedExport.sha256, "b".repeat(64))
	const result = await createRefraktRecords({
		did: "did:plc:653egim2jcy2f4j4abtunvhj",
		catalog: selected,
	})
	const photo = result.find((row) => row.collection === "app.refrakt.photo")!
	assert.deepEqual(
		(photo.record as {exif: {model: string; make?: string}}).exif.model,
		"X-T5",
	)
	assert.equal((photo.record as {exif: {make?: string}}).exif.make, undefined)
	assert.equal(
		readCollections(db).find((row) => row.id === "all")?.description,
		"",
	)
})

test("website availability and Refrakt completeness are distinct", (t) => {
	const db = fixture(t)
	db.update(photoDerivatives)
		.set({uploadedAt: null})
		.where(eq(photoDerivatives.r2Key, "photos/b/website/detail"))
		.run()
	assert.deepEqual(
		readWebsiteCatalog(db, website, false).photos.map(({id}) => id),
		["a"],
	)
	assert.deepEqual(
		readWebsiteCatalog(db, website, true).photos.map(({id}) => id),
		["b", "a"],
	)
	assert.deepEqual(
		readRefraktCatalog(db, refrakt).photos.map(({id}) => id),
		["a", "b"],
	)
	db.update(photos)
		.set({metadataJson: "invalid"})
		.where(eq(photos.id, "b"))
		.run()
	assert.deepEqual(
		readWebsiteCatalog(db, website, false).photos.map(({id}) => id),
		["a"],
	)
	assert.throws(() => readWebsiteCatalog(db, website, true), SyntaxError)
	db.update(photos)
		.set({metadataJson: JSON.stringify(metadata), status: "deleted"})
		.where(eq(photos.id, "b"))
		.run()
	assert.throws(() => readRefraktCatalog(db, refrakt))
	assert.deepEqual(readWebsiteCatalog(db, website, true).albums[0]?.photoIds, [
		"a",
	])
	assert.throws(() =>
		readRefraktCatalog(db, {...refrakt, rootCollectionId: "missing"}),
	)
	assert.deepEqual(
		readWebsiteCatalog(
			db,
			{
				...website,
				allPhotosCollectionId: "missing",
				setsCollectionId: "missing",
			},
			false,
		),
		{photos: [], albums: []},
	)
})

test("document checks do not bind the database or overwrite another catalog", (t) => {
	const db = fixture(t)
	checkDocument(db, "one")
	assert.deepEqual(db.select().from(catalog).all(), [])
	bindDocument(db, "one")
	assert.throws(() => bindDocument(db, "two"))
	assert.equal(db.select().from(catalog).get()?.documentId, "one")
})

test("root selection includes nested members and excludes photos outside the root", (t) => {
	const db = fixture(t)
	db.insert(collections)
		.values({
			id: "nested",
			parentId: "album",
			name: "nested",
			kind: "album",
			position: 1,
			sortOrder: "manual",
			reversed: false,
			createdAt: date,
			updatedAt: date,
		})
		.run()
	// Move one existing member into the nested album so it can only be found
	// by following the collection hierarchy.
	db.delete(collectionPhotos).where(eq(collectionPhotos.photoId, "b")).run()
	db.insert(collectionPhotos)
		.values({collectionId: "nested", photoId: "b", position: 1})
		.run()
	const selected = readRefraktCatalog(db, refrakt)
	assert.deepEqual(selected.photos.map((photo) => photo.id).sort(), ["a", "b"])
	assert.deepEqual(
		selected.photos
			.find((photo) => photo.id === "b")
			?.memberships.map(({collection, position}) => [collection.id, position]),
		[["nested", 1]],
	)
})
