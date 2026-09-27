import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {mkdir, mkdtemp, readFile, realpath, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {DatabaseSync} from "node:sqlite"
import test from "node:test"
import {fileURLToPath, pathToFileURL} from "node:url"
import {eq, isNull} from "drizzle-orm"
import {migrate} from "drizzle-orm/node-sqlite/migrator"
import sharp from "sharp"
import {
	collectionPhotos,
	collectionRoots,
	collections,
	photoDerivatives,
	photoExports,
	photos,
} from "./database-schema.ts"
import {openPhotoDatabase} from "./database.ts"

const cli = fileURLToPath(new URL("../../cli/index.ts", import.meta.url))
const configUrl = new URL("../../site.config.ts", import.meta.url).href

function run(cwd: string, command = "sync", remote = "") {
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !key.startsWith("R2_")),
	)
	const preload = `
		import {siteConfig} from ${JSON.stringify(configUrl)};
		siteConfig.photos.captureOneCatalogPath = ${JSON.stringify(join(cwd, "Fixture.cocatalog"))};
		siteConfig.photos.exportProfile = "website";
		globalThis.fetch = async () => { throw new Error("Unexpected network request") };
		${remote}
	`
	const result = spawnSync(
		process.execPath,
		[
			"--import",
			`data:text/javascript,${encodeURIComponent(preload)}`,
			cli,
			"photos",
			command,
		],
		{
			cwd,
			env: {...env, PHOTO_DATABASE_PATH: join(cwd, "photos/catalog.sqlite")},
			encoding: "utf8",
			timeout: 20_000,
		},
	)
	assert.equal(result.status, 0, result.stderr + result.stdout)
}

async function image(path: string, caption: string, camera = false) {
	await sharp({
		create: {width: 96, height: 64, channels: 3, background: "#889988"},
	})
		.withExif({
			IFD0: {
				ImageDescription: caption,
				...(camera ? {Make: "FUJIFILM", Model: "X-T5"} : {}),
			},
		})
		.jpeg()
		.toFile(path)
}

test("Capture One sync uses source metadata, keeps fixed outputs, and can be repeated", async (t) => {
	const cwd = await realpath(await mkdtemp(join(tmpdir(), "photo-sync-")))
	t.after(() => rm(cwd, {recursive: true, force: true}))
	const c1 = join(cwd, "Fixture.cocatalog")
	await mkdir(c1)
	await mkdir(join(cwd, "photos/exports/website"), {recursive: true})
	await mkdir(join(cwd, "photos/exports/refrakt"), {recursive: true})
	const website = join(cwd, "photos/exports/website/bird.jpg")
	const refrakt = join(cwd, "photos/exports/refrakt/bird.jpg")
	await image(website, "Source caption", true)
	await image(refrakt, "Different Refrakt caption", true)
	using captureOne = new DatabaseSync(join(c1, "Fixture.cocatalogdb"))
	captureOne.exec(`
		CREATE TABLE ZVERSIONINFO (Z_PK INTEGER, ZVERSION INTEGER, ZFORMAT TEXT);
		INSERT INTO ZVERSIONINFO VALUES (1, 160800, 'Capture One');
		CREATE TABLE ZENTITIES (Z_ENT INTEGER, ZNAME TEXT);
		INSERT INTO ZENTITIES VALUES (1, 'VirtualFolderCollection'), (2, 'ProjectCollection'), (3, 'AlbumCollection');
		CREATE TABLE ZDOCUMENTCONTENT (Z_PK INTEGER, ZROOTCOLLECTION INTEGER);
		INSERT INTO ZDOCUMENTCONTENT VALUES (1, 0);
		CREATE TABLE ZCOLLECTION (Z_PK INTEGER, ZPARENT INTEGER, ZNAME TEXT, ZSORTORDER TEXT, ZCOLLECTIONINDEX REAL, Z_ENT INTEGER);
		INSERT INTO ZCOLLECTION VALUES (1,0,'Projects','-',1,1), (2,1,'Website','-',1,2), (3,2,'All','-',1,3);
		CREATE TABLE ZVARIANTINCOLLECTION (Z_PK INTEGER, ZCOLLECTION INTEGER, ZVARIANT INTEGER);
		INSERT INTO ZVARIANTINCOLLECTION VALUES (1,3,10);
		CREATE TABLE ZVARIANT (Z_PK INTEGER, ZIMAGE INTEGER);
		INSERT INTO ZVARIANT VALUES (10,100);
		CREATE TABLE ZIMAGE (Z_PK INTEGER, ZDISPLAYNAME TEXT, ZIMAGEFILENAME TEXT, ZEXP_DATE REAL);
		INSERT INTO ZIMAGE VALUES (100,'Bird','bird.jpg',1000);
		CREATE TABLE ZIMAGEINCOLLECTIONPROPERTIES (Z_PK INTEGER, ZCOLLECTION INTEGER, ZIMAGE INTEGER, ZMANUALSORTINDEX REAL);
		INSERT INTO ZIMAGEINCOLLECTIONPROPERTIES VALUES (1,3,100,1);
		CREATE TABLE ZPROCESSHISTORY (Z_PK INTEGER, ZVARIANT INTEGER, ZDATE REAL, ZURL TEXT);
	`)
	captureOne
		.prepare("INSERT INTO ZPROCESSHISTORY VALUES (?,10,1000,?)")
		.run(1, pathToFileURL(website).href)
	captureOne
		.prepare("INSERT INTO ZPROCESSHISTORY VALUES (?,10,1001,?)")
		.run(2, pathToFileURL(refrakt).href)
	const db = openPhotoDatabase(join(cwd, "photos/catalog.sqlite"))
	using _ = db.$client
	migrate(db, {
		migrationsFolder: fileURLToPath(
			new URL("../../../drizzle/photos", import.meta.url),
		),
	})
	const date = "2025-01-01T00:00:00.000Z"
	db.insert(collections)
		.values({
			id: "2",
			parentId: "1",
			name: "Website",
			kind: "project",
			position: 1,
			sortOrder: "by manual",
			reversed: false,
			description: "Keep this description",
			createdAt: date,
			updatedAt: date,
		})
		.run()
	db.insert(collectionRoots).values({collectionId: "2", addedAt: date}).run()

	db.insert(photos)
		.values({
			id: "existing-photo",
			captureOneVariantId: "10",
			captureOneVariantName: "Bird",
			status: "active",
			createdAt: date,
			updatedAt: date,
			altText: "Human description",
			altTextStatus: "edited",
			altTextInputHash: "human-input",
		})
		.run()

	run(cwd)
	const initial = db.select().from(photos).get()!
	assert.equal(initial.id, "existing-photo")
	assert.equal(JSON.parse(initial.metadataJson!).caption, "Source caption")
	assert.equal(JSON.parse(initial.metadataJson!).cameraModel, "X-T5")
	const outputs = db
		.select()
		.from(photoDerivatives)
		.where(isNull(photoDerivatives.deletedAt))
		.all()
	assert.deepEqual(outputs.map(({kind}) => kind).sort(), [
		"detail",
		"og",
		"source",
		"thumb",
	])
	const source = outputs.find(({kind}) => kind === "source")!
	assert.equal(initial.metadataSourceId, source.id)
	assert.ok(source.r2Key.endsWith("/source.jpg"))
	assert.deepEqual(await readFile(source.path), await readFile(website))
	assert.equal(
		outputs.every(({uploadedAt}) => uploadedAt === null),
		true,
	)
	assert.equal(
		db.select().from(collections).where(eq(collections.id, "2")).get()
			?.description,
		"Keep this description",
	)

	// Missing generated files are recreated at the same keys, not duplicated.
	const thumb = outputs.find(({kind}) => kind === "thumb")!
	await rm(thumb.path)
	run(cwd)
	assert.ok((await readFile(thumb.path)).length > 0)
	assert.equal(db.select().from(photoExports).all().length, 2)
	assert.equal(db.select().from(photoDerivatives).all().length, 4)
	assert.deepEqual(db.select().from(collectionPhotos).all(), [
		{collectionId: "3", photoId: initial.id, position: 1},
	])
	const repeated = db.select().from(photos).get()!
	assert.equal(repeated.id, initial.id)
	assert.equal(repeated.altText, initial.altText)
	assert.equal(repeated.altTextStatus, initial.altTextStatus)
	assert.equal(repeated.altTextInputHash, initial.altTextInputHash)

	assert.deepEqual(
		db
			.select()
			.from(photoDerivatives)
			.all()
			.map(({r2Key}) => r2Key)
			.sort(),
		outputs.map(({r2Key}) => r2Key).sort(),
	)

	await image(website, "Changed source caption")
	run(cwd)
	const changed = db.select().from(photos).get()!
	assert.equal(changed.id, initial.id)
	assert.equal(changed.altText, "Human description")
	assert.equal(changed.altTextStatus, "edited")
	assert.equal(changed.altTextInputHash, "human-input")
	const updated = JSON.parse(changed.metadataJson!)
	assert.equal(updated.caption, "Changed source caption")
	assert.equal(updated.cameraMake, null)
	assert.equal(updated.cameraModel, null)
	assert.equal(
		db.select().from(photoExports).where(isNull(photoExports.deletedAt)).all()
			.length,
		2,
	)
	assert.equal(
		db
			.select()
			.from(photoDerivatives)
			.where(isNull(photoDerivatives.deletedAt))
			.all().length,
		4,
	)

	const sourceNow = db
		.select()
		.from(photoDerivatives)
		.all()
		.find(({kind, deletedAt}) => kind === "source" && deletedAt === null)!
	assert.notEqual(sourceNow.id, source.id)
	assert.equal(db.select().from(photos).get()!.metadataSourceId, sourceNow.id)
	const sourceBytes = await readFile(sourceNow.path)
	assert.deepEqual(sourceBytes, await readFile(website))
	run(cwd, "regenerate-og")
	assert.deepEqual(await readFile(sourceNow.path), sourceBytes)
	assert.equal(
		db
			.select()
			.from(photoDerivatives)
			.where(isNull(photoDerivatives.deletedAt))
			.all().length,
		4,
	)
	const remote = (expectedChecks: number, failSecondCheck = false) => `
		import assert from "node:assert/strict";
		import {readFile} from "node:fs/promises";
		import {createHash} from "node:crypto";
		import {S3Client, HeadObjectCommand, PutObjectCommand} from ${JSON.stringify(import.meta.resolve("@aws-sdk/client-s3"))};
		Object.assign(process.env, {
			R2_ENDPOINT: "https://r2.test", R2_ACCESS_KEY_ID: "test",
			R2_SECRET_ACCESS_KEY: "test", R2_BUCKET: "photos", R2_BACKUP_BUCKET: "backups"
		});
		let checks = 0;
		S3Client.prototype.send = async (command) => {
			if (command instanceof HeadObjectCommand) {
				checks++;
				if (${failSecondCheck} && checks === 2) throw Object.assign(new Error("R2 unavailable"), {code: "ECONNRESET"});
				const bytes = await readFile(command.input.Key.replace("photos/", "photos/objects/"));
				return {
					Metadata: {sha256: createHash("sha256").update(bytes).digest("hex")},
					ContentLength: bytes.length,
					ContentType: command.input.Key.endsWith(".webp") ? "image/webp" : "image/jpeg"
				};
			}
			assert.ok(command instanceof PutObjectCommand);
			assert.equal(command.input.Bucket, "backups", "Matching images must not be uploaded");
			await Array.fromAsync(command.input.Body);
			return {};
		};
		process.on("exit", () => assert.equal(checks, ${expectedChecks}));
	`
	run(cwd, "sync", remote(2, true))
	assert.equal(
		db
			.select()
			.from(photoDerivatives)
			.all()
			.filter(({uploadedAt}) => uploadedAt !== null).length,
		1,
	)
	run(cwd, "sync", remote(3))
	assert.ok(
		db
			.select()
			.from(photoDerivatives)
			.where(isNull(photoDerivatives.deletedAt))
			.all()
			.every(({uploadedAt}) => uploadedAt !== null),
	)
})
