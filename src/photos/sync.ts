import {realpath, rm, stat} from "node:fs/promises"
import {basename, isAbsolute, relative, resolve, sep} from "node:path"
import type {S3Client} from "@aws-sdk/client-s3"
import {and, eq, inArray, isNull, sql} from "drizzle-orm"
import * as v from "valibot"
import {siteConfig} from "../site.config.ts"
import {backupPhotoDatabase} from "./backup.ts"
import {readCaptureOneSnapshot} from "./capture-one.ts"
import {
	catalog,
	collectionPhotos,
	collections,
	photoDerivatives,
	photoExports,
	photos,
} from "./database-schema.ts"
import {
	openPhotoDatabase,
	type PhotoDatabase,
	photoIdForVariant,
	withTransaction,
} from "./database.ts"
import {type PlannedDerivative, websiteDerivativePlan} from "./delivery.ts"
import {hashFile} from "./file-hash.ts"
import {
	type PreparedDerivative,
	type PreparedPhoto,
	preparePhoto,
	preparePhotoOpenGraph,
} from "./media.ts"
import {createR2Client, loadR2Config, uploadR2File} from "./r2.ts"
import {configuredRootIds} from "./roots.ts"
import {
	type CaptureOneSnapshot,
	type CaptureOneVariant,
	type NormalizedMetadata,
	NormalizedMetadataSchema,
	type PhotoDerivativeKind,
	type R2Config,
} from "./schema.ts"

const EXPORT_ROOT = resolve("photos/exports")
const OBJECT_ROOT = resolve("photos/objects")

type RegenerateRow = {
	id: number
	photoId: string
	sha256: string
	path: string
}

type ExportCandidate = {
	eventId: string
	path: string
	profile: string
	modified: number
}

type SyncState = {
	database: PhotoDatabase
	r2: S3Client | null
	config: R2Config | null
	offline: boolean
	failures: string[]
	newPhotos: number
	changedExports: number
	unchangedExports: number
}

function optionalR2Config(): R2Config | null {
	return [
		process.env.R2_ENDPOINT,
		process.env.R2_ACCESS_KEY_ID,
		process.env.R2_SECRET_ACCESS_KEY,
		process.env.R2_BUCKET,
		process.env.R2_BACKUP_BUCKET,
	].every(Boolean)
		? loadR2Config()
		: null
}

function elapsed(startedAt: number): string {
	return `${((Date.now() - startedAt) / 1000).toFixed(1)}s`
}

export async function syncPhotos(): Promise<void> {
	const rootIds = configuredRootIds()
	const captureOneStartedAt = Date.now()

	console.log("Reading configured roots from Capture One...")
	const snapshot = await readCaptureOneSnapshot(rootIds)
	console.log(
		`Capture One returned ${snapshot.variants.length} photos and ${snapshot.collections.length} collections in ${elapsed(captureOneStartedAt)}.`,
	)

	const database = openPhotoDatabase()
	const config = optionalR2Config()
	const state: SyncState = {
		database,
		r2: config ? createR2Client(config) : null,
		config,
		offline: false,
		failures: [],
		newPhotos: 0,
		changedExports: 0,
		unchangedExports: 0,
	}

	try {
		await updateLocalCatalog(state, snapshot)
		await uploadAndBackup(state)
	} finally {
		state.database.$client.close()
		state.r2?.destroy()
	}

	console.log(
		`Synced ${snapshot.variants.length} photos: ${state.newPhotos} new, ${state.changedExports} changed exports, ${state.unchangedExports} unchanged exports.`,
	)

	for (const failure of state.failures) {
		console.warn(`  ${failure}`)
	}
}

async function updateLocalCatalog(
	state: SyncState,
	snapshot: CaptureOneSnapshot,
): Promise<void> {
	const startedAt = Date.now()
	console.log(`Processing ${snapshot.variants.length} photos...`)
	bindDocument(state.database, snapshot.documentId)
	await syncVariants(state, snapshot.variants)
	persistCollections(state.database, snapshot)
	markMissingPhotos(
		state.database,
		new Set(snapshot.variants.map(({id}) => id)),
	)
	await discardSupersededPendingFiles(state.database)
	console.log(`Processed local catalog in ${elapsed(startedAt)}.`)
}

async function uploadAndBackup(state: SyncState): Promise<void> {
	if (!state.r2 || !state.config) {
		await uploadPendingFiles(state)
		return
	}

	const startedAt = Date.now()
	const uploaded = await uploadPendingFiles(state)
	if (state.offline) {
		console.log(
			`Uploaded ${uploaded} files before pausing in ${elapsed(startedAt)}.`,
		)
		return
	}

	console.log("Backing up the photo catalog...")
	await backupPhotoDatabase(state.database, state.r2, state.config)
	console.log(
		`Uploaded ${uploaded} files and backed up the catalog in ${elapsed(startedAt)}.`,
	)
}
export async function regenerateOpenGraphImages(): Promise<void> {
	const database = openPhotoDatabase()
	const config = optionalR2Config()
	const state: SyncState = {
		database,
		r2: config ? createR2Client(config) : null,
		config,
		offline: false,
		failures: [],
		newPhotos: 0,
		changedExports: 0,
		unchangedExports: 0,
	}

	try {
		const rows = database
			.select({
				id: photoExports.id,
				photoId: photoExports.photoId,
				sha256: photoExports.sha256,
				path: photoDerivatives.path,
			})
			.from(photoExports)
			.innerJoin(
				photoDerivatives,
				and(
					eq(photoDerivatives.exportId, photoExports.id),
					eq(photoDerivatives.kind, "source"),
				),
			)
			.where(
				and(
					eq(photoExports.current, true),
					isNull(photoExports.deletedAt),
					eq(photoExports.profile, siteConfig.photos.exportProfile),
				),
			)
			.all()

		console.log(`Regenerating ${rows.length} Open Graph images...`)
		for (const [index, row] of rows.entries()) {
			console.log(`  ${index + 1}/${rows.length} ${row.photoId}`)
			await regenerateOpenGraphImage(database, row)
		}
		console.log(`Regenerated ${rows.length} Open Graph images.`)
		await uploadPendingFiles(state)
	} finally {
		database.$client.close()
		state.r2?.destroy()
	}
}

async function regenerateOpenGraphImage(
	database: PhotoDatabase,
	row: RegenerateRow,
): Promise<void> {
	const plan = websiteDerivativePlan(row.photoId, row.sha256).find(
		({kind}) => kind === "og",
	)
	if (!plan) {
		throw new Error("Website delivery has no Open Graph derivative")
	}
	const path = resolve(OBJECT_ROOT, plan.objectKey)
	const generated = await preparePhotoOpenGraph(row.path, path)
	upsertDerivative({
		database,
		exportId: row.id,
		kind: "og",
		derivative: {...generated, r2Key: plan.r2Key},
		now: new Date().toISOString(),
	})
}

async function syncVariants(
	state: SyncState,
	variants: CaptureOneVariant[],
): Promise<void> {
	for (const [index, variant] of variants.entries()) {
		console.log(`  ${index + 1}/${variants.length} ${variant.name}`)
		try {
			await syncVariant(state, variant)
		} catch (error) {
			state.failures.push(
				`${variant.name}: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}
}

async function syncVariant(
	state: SyncState,
	variant: CaptureOneVariant,
): Promise<void> {
	const existing = state.database
		.select({id: photos.id})
		.from(photos)
		.where(eq(photos.captureOneVariantId, variant.id))
		.get()

	const photoId = existing?.id ?? photoIdForVariant(variant.id)
	if (!existing) {
		state.newPhotos += 1
	}

	upsertPhoto(state.database, photoId, variant)

	const candidates = await exportCandidates(variant)
	if (candidates.length === 0) {
		const current = state.database
			.select({id: photoExports.id})
			.from(photoExports)
			.where(
				and(eq(photoExports.photoId, photoId), eq(photoExports.current, true)),
			)
			.get()

		if (!current) {
			throw new Error("has no current JPEG export in photos/exports")
		}

		return
	}
	for (const candidate of candidates) {
		await syncExport(state, photoId, candidate)
	}
}

async function syncExport(
	state: SyncState,
	photoId: string,
	candidate: ExportCandidate,
): Promise<void> {
	const sha256 = await hashFile(candidate.path)
	const website = candidate.profile === siteConfig.photos.exportProfile
	if (
		!website &&
		candidate.profile !== siteConfig.atproto.refrakt.exportProfile
	) {
		return
	}
	const plan = website ? websiteDerivativePlan(photoId, sha256) : []
	const current = state.database
		.select({id: photoExports.id})
		.from(photoExports)
		.where(
			and(
				eq(photoExports.photoId, photoId),
				eq(photoExports.profile, candidate.profile),
				eq(photoExports.sha256, sha256),
				eq(photoExports.current, true),
			),
		)
		.get()
	if (current && (await storedFilesExist(state.database, current.id, plan))) {
		state.database
			.update(photoExports)
			.set({
				captureOneOutputId: candidate.eventId,
				sourcePath: candidate.path,
				filename: basename(candidate.path),
			})
			.where(eq(photoExports.id, current.id))
			.run()
		state.unchangedExports += 1
		return
	}

	const outputPaths = new Map(
		plan.map(({kind, objectKey}) => [kind, resolve(OBJECT_ROOT, objectKey)]),
	)
	const prepared = await preparePhoto(candidate.path, outputPaths)
	stageExport({
		database: state.database,
		photoId,
		candidate,
		prepared,
		plan,
	})
	state.changedExports += 1
}

async function exportCandidates(
	variant: CaptureOneVariant,
): Promise<ExportCandidate[]> {
	const candidates = (
		await Promise.all(
			variant.outputs.map(async (output): Promise<ExportCandidate | null> => {
				if (!output.exists || !output.path) {
					return null
				}
				const configuredPath = resolve(output.path)
				if (relativeExportPath(configuredPath) === null) {
					return null
				}
				try {
					const path = await realpath(configuredPath)
					const fromRoot = relativeExportPath(path)
					if (fromRoot === null) {
						return null
					}
					const parts = fromRoot.split(sep)
					return {
						eventId: output.id,
						path,
						profile: parts[0] ?? "default",
						modified: (await stat(path)).mtimeMs,
					}
				} catch {
					return null
				}
			}),
		)
	).filter((candidate): candidate is ExportCandidate => candidate !== null)
	const newest = new Map<string, ExportCandidate>()
	for (const candidate of candidates) {
		const current = newest.get(candidate.profile)
		if (!current || candidate.modified > current.modified) {
			newest.set(candidate.profile, candidate)
		}
	}
	return [...newest.values()].sort((left, right) =>
		left.profile.localeCompare(right.profile),
	)
}

function relativeExportPath(path: string): string | null {
	const fromRoot = relative(EXPORT_ROOT, path)
	return fromRoot.startsWith("..") || isAbsolute(fromRoot) ? null : fromRoot
}

function upsertPhoto(
	database: PhotoDatabase,
	photoId: string,
	variant: CaptureOneVariant,
): void {
	const collision = database
		.select({captureOneVariantId: photos.captureOneVariantId})
		.from(photos)
		.where(eq(photos.id, photoId))
		.get()
	if (collision && collision.captureOneVariantId !== variant.id) {
		throw new Error(`Photo ID collision for ${photoId}`)
	}
	const now = new Date().toISOString()
	database
		.insert(photos)
		.values({
			id: photoId,
			captureOneVariantId: variant.id,
			captureOneVariantName: variant.name,
			status: "active",
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: photos.id,
			set: {
				captureOneVariantName: variant.name,
				status: "active",
				updatedAt: now,
			},
		})
		.run()
}

type StageExportInput = {
	database: PhotoDatabase
	photoId: string
	candidate: ExportCandidate
	prepared: PreparedPhoto
	plan: PlannedDerivative[]
}

function stageExport(input: StageExportInput): void {
	const {database, photoId, candidate, prepared, plan} = input
	const now = new Date().toISOString()
	withTransaction(database, () => {
		markOldProfileFiles(database, photoId, candidate.profile, now)
		const exportRow = database
			.insert(photoExports)
			.values({
				photoId,
				captureOneOutputId: candidate.eventId,
				profile: candidate.profile,
				sourcePath: candidate.path,
				filename: basename(candidate.path),
				sha256: prepared.source.sha256,
				byteSize: prepared.source.byteSize,
				mimeType: prepared.source.mimeType,
				width: prepared.source.width,
				height: prepared.source.height,
				metadataJson: JSON.stringify(prepared.normalized),
				rawMetadataJson: prepared.rawMetadata,
				current: true,
				createdAt: now,
			})
			.onConflictDoUpdate({
				target: [
					photoExports.photoId,
					photoExports.profile,
					photoExports.sha256,
				],
				set: {
					captureOneOutputId: candidate.eventId,
					sourcePath: candidate.path,
					filename: basename(candidate.path),
					metadataJson: JSON.stringify(prepared.normalized),
					rawMetadataJson: prepared.rawMetadata,
					current: true,
					deletedAt: null,
				},
			})
			.returning({id: photoExports.id})
			.get()
		const exportId = exportRow.id
		retireUnplannedDerivatives(
			database,
			exportId,
			new Set(plan.map(({kind}) => kind)),
			now,
		)
		for (const derivative of prepared.derivatives) {
			const delivery = plan.find(({kind}) => kind === derivative.kind)
			if (!delivery) {
				throw new Error(`No delivery for ${derivative.kind} derivative`)
			}
			upsertDerivative({
				database,
				exportId,
				kind: derivative.kind,
				derivative: {...derivative, r2Key: delivery.r2Key},
				now,
			})
		}
		updateCanonicalMetadata(database, photoId, prepared.normalized)
	})
}

function markOldProfileFiles(
	database: PhotoDatabase,
	photoId: string,
	profile: string,
	now: string,
): void {
	const currentExports = database
		.select({id: photoExports.id})
		.from(photoExports)
		.where(
			and(
				eq(photoExports.photoId, photoId),
				eq(photoExports.profile, profile),
				eq(photoExports.current, true),
			),
		)
	database
		.update(photoDerivatives)
		.set({
			deletedAt: sql`coalesce(${photoDerivatives.deletedAt}, ${now})`,
		})
		.where(inArray(photoDerivatives.exportId, currentExports))
		.run()
	database
		.update(photoExports)
		.set({
			current: false,
			deletedAt: sql`coalesce(${photoExports.deletedAt}, ${now})`,
		})
		.where(
			and(
				eq(photoExports.photoId, photoId),
				eq(photoExports.profile, profile),
				eq(photoExports.current, true),
			),
		)
		.run()
}

function retireUnplannedDerivatives(
	database: PhotoDatabase,
	exportId: number,
	kinds: Set<PhotoDerivativeKind>,
	now: string,
): void {
	for (const row of database
		.select({id: photoDerivatives.id, kind: photoDerivatives.kind})
		.from(photoDerivatives)
		.where(
			and(
				eq(photoDerivatives.exportId, exportId),
				isNull(photoDerivatives.deletedAt),
			),
		)
		.all()) {
		if (!kinds.has(row.kind)) {
			database
				.update(photoDerivatives)
				.set({deletedAt: now})
				.where(eq(photoDerivatives.id, row.id))
				.run()
		}
	}
}

function upsertDerivative(input: {
	database: PhotoDatabase
	exportId: number
	kind: PhotoDerivativeKind
	derivative: PreparedDerivative & {r2Key: string}
	now: string
}): void {
	const {database, exportId, kind, derivative, now} = input
	const existing = database
		.select({
			id: photoDerivatives.id,
			path: photoDerivatives.path,
			r2Key: photoDerivatives.r2Key,
		})
		.from(photoDerivatives)
		.where(
			and(
				eq(photoDerivatives.exportId, exportId),
				eq(photoDerivatives.kind, kind),
				isNull(photoDerivatives.deletedAt),
			),
		)
		.get()
	if (
		existing &&
		(existing.path !== derivative.path || existing.r2Key !== derivative.r2Key)
	) {
		database
			.update(photoDerivatives)
			.set({deletedAt: now})
			.where(eq(photoDerivatives.id, existing.id))
			.run()
	}
	database
		.insert(photoDerivatives)
		.values({
			exportId,
			kind,
			path: derivative.path,
			r2Key: derivative.r2Key,
			sha256: derivative.sha256,
			byteSize: derivative.byteSize,
			mimeType: derivative.mimeType,
			width: derivative.width,
			height: derivative.height,
			createdAt: now,
		})
		.onConflictDoUpdate({
			target: [photoDerivatives.exportId, photoDerivatives.kind],
			targetWhere: isNull(photoDerivatives.deletedAt),
			set: {
				path: derivative.path,
				r2Key: derivative.r2Key,
				sha256: derivative.sha256,
				byteSize: derivative.byteSize,
				mimeType: derivative.mimeType,
				width: derivative.width,
				height: derivative.height,
				uploadedAt: null,
				deletedAt: null,
			},
		})
		.run()
}

function updateCanonicalMetadata(
	database: PhotoDatabase,
	photoId: string,
	candidate: NormalizedMetadata,
): void {
	const metadataJson = database
		.select({metadataJson: photos.metadataJson})
		.from(photos)
		.where(eq(photos.id, photoId))
		.get()?.metadataJson
	const current = metadataJson
		? v.parse(NormalizedMetadataSchema, JSON.parse(metadataJson))
		: null
	if (!current || metadataScore(candidate) > metadataScore(current)) {
		database
			.update(photos)
			.set({
				metadataJson: JSON.stringify(candidate),
				updatedAt: new Date().toISOString(),
			})
			.where(eq(photos.id, photoId))
			.run()
	}
}

function metadataScore(metadata: NormalizedMetadata): number {
	return [
		metadata.capturedAt,
		metadata.cameraModel,
		metadata.lensModel,
		metadata.focalLength,
		metadata.aperture,
		metadata.shutter,
		metadata.iso,
		metadata.title,
		metadata.caption,
		metadata.alt,
	].filter((value) => value !== null && value !== "").length
}

function persistCollections(
	database: PhotoDatabase,
	snapshot: CaptureOneSnapshot,
): void {
	const now = new Date().toISOString()
	const activeIds = new Set(snapshot.collections.map(({id}) => id))
	withTransaction(database, () => {
		database.delete(collectionPhotos).run()
		for (const collection of snapshot.collections) {
			database
				.insert(collections)
				.values({
					id: collection.id,
					parentId: collection.parentId,
					name: collection.name,
					kind: collection.kind,
					position: collection.index,
					sortOrder: collection.sort,
					reversed: collection.reversed,
					createdAt: now,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: collections.id,
					set: {
						parentId: collection.parentId,
						name: collection.name,
						kind: collection.kind,
						position: collection.index,
						sortOrder: collection.sort,
						reversed: collection.reversed,
						updatedAt: now,
					},
				})
				.run()
			persistCollectionMembers(database, collection.id, collection.members)
		}
		pruneCollections(database, activeIds)
		database.update(catalog).set({syncedAt: now}).where(eq(catalog.id, 1)).run()
	})
}

function pruneCollections(
	database: PhotoDatabase,
	activeIds: Set<string>,
): void {
	for (const {id} of database
		.select({id: collections.id})
		.from(collections)
		.all()) {
		if (!activeIds.has(id)) {
			database.delete(collections).where(eq(collections.id, id)).run()
		}
	}
}

function persistCollectionMembers(
	database: PhotoDatabase,
	collectionId: string,
	members: CaptureOneSnapshot["collections"][number]["members"],
): void {
	for (const member of members) {
		const photo = database
			.select({id: photos.id})
			.from(photos)
			.where(eq(photos.captureOneVariantId, member.variantId))
			.get()
		if (photo) {
			database
				.insert(collectionPhotos)
				.values({collectionId, photoId: photo.id, position: member.index})
				.run()
		}
	}
}

function markMissingPhotos(
	database: PhotoDatabase,
	activeVariantIds: Set<string>,
): void {
	const now = new Date().toISOString()
	for (const row of database
		.select({id: photos.id, captureOneVariantId: photos.captureOneVariantId})
		.from(photos)
		.all()) {
		if (activeVariantIds.has(row.captureOneVariantId)) {
			continue
		}
		const photoId = row.id
		database
			.update(photos)
			.set({status: "deleted", updatedAt: now})
			.where(eq(photos.id, photoId))
			.run()
		database
			.update(photoExports)
			.set({
				current: false,
				deletedAt: sql`coalesce(${photoExports.deletedAt}, ${now})`,
			})
			.where(eq(photoExports.photoId, photoId))
			.run()
		const exportIds = database
			.select({id: photoExports.id})
			.from(photoExports)
			.where(eq(photoExports.photoId, photoId))
		database
			.update(photoDerivatives)
			.set({
				deletedAt: sql`coalesce(${photoDerivatives.deletedAt}, ${now})`,
			})
			.where(inArray(photoDerivatives.exportId, exportIds))
			.run()
	}
}

async function storedFilesExist(
	database: PhotoDatabase,
	exportId: number,
	plan: PlannedDerivative[],
): Promise<boolean> {
	const rows = database
		.select({
			kind: photoDerivatives.kind,
			path: photoDerivatives.path,
			r2Key: photoDerivatives.r2Key,
		})
		.from(photoDerivatives)
		.where(
			and(
				eq(photoDerivatives.exportId, exportId),
				isNull(photoDerivatives.deletedAt),
			),
		)
		.all()
	if (rows.length !== plan.length) {
		return false
	}
	return (
		await Promise.all(
			plan.map(async (expected) => {
				const row = rows.find(({kind}) => kind === expected.kind)
				if (
					!row ||
					row.path !== resolve(OBJECT_ROOT, expected.objectKey) ||
					row.r2Key !== expected.r2Key
				) {
					return false
				}
				try {
					return (await stat(row.path)).isFile()
				} catch {
					return false
				}
			}),
		)
	).every(Boolean)
}

async function discardSupersededPendingFiles(
	database: PhotoDatabase,
): Promise<void> {
	const oldExports = database
		.select({id: photoExports.id})
		.from(photoExports)
		.where(eq(photoExports.current, false))
	const rows = database
		.select({id: photoDerivatives.id, path: photoDerivatives.path})
		.from(photoDerivatives)
		.where(
			and(
				isNull(photoDerivatives.uploadedAt),
				inArray(photoDerivatives.exportId, oldExports),
			),
		)
		.all()
	for (const row of rows) {
		await rm(row.path, {force: true})
		database
			.delete(photoDerivatives)
			.where(eq(photoDerivatives.id, row.id))
			.run()
	}
}

async function uploadPendingFiles(state: SyncState): Promise<number> {
	const rows = state.database
		.select({
			id: photoDerivatives.id,
			path: photoDerivatives.path,
			r2Key: photoDerivatives.r2Key,
			byteSize: photoDerivatives.byteSize,
			mimeType: photoDerivatives.mimeType,
			sha256: photoDerivatives.sha256,
		})
		.from(photoDerivatives)
		.innerJoin(photoExports, eq(photoExports.id, photoDerivatives.exportId))
		.where(
			and(
				eq(photoExports.current, true),
				eq(photoExports.profile, siteConfig.photos.exportProfile),
				isNull(photoDerivatives.uploadedAt),
				isNull(photoDerivatives.deletedAt),
			),
		)
		.all()
	if (rows.length === 0) {
		return 0
	}
	if (!state.r2 || !state.config) {
		state.offline = true
		console.warn("R2 credentials are not loaded; files remain pending.")
		return 0
	}
	let uploaded = 0
	for (const [index, row] of rows.entries()) {
		console.log(`Uploading ${index + 1}/${rows.length}: ${row.r2Key}`)
		try {
			await uploadR2File({
				client: state.r2,
				config: state.config,
				path: row.path,
				key: row.r2Key,
				byteSize: row.byteSize,
				mimeType: row.mimeType,
				sha256: row.sha256,
			})
			state.database
				.update(photoDerivatives)
				.set({uploadedAt: new Date().toISOString()})
				.where(eq(photoDerivatives.id, row.id))
				.run()
			uploaded += 1
		} catch (error) {
			state.offline = true
			console.warn(
				`R2 upload paused: ${error instanceof Error ? error.message : String(error)}`,
			)
			return uploaded
		}
	}
	return uploaded
}

function bindDocument(database: PhotoDatabase, documentId: string): void {
	const row = database
		.select({documentId: catalog.documentId})
		.from(catalog)
		.where(eq(catalog.id, 1))
		.get()
	if (!row) {
		database
			.insert(catalog)
			.values({
				id: 1,
				documentId,
				syncedAt: new Date().toISOString(),
			})
			.run()
	} else if (row.documentId !== documentId) {
		throw new Error(
			"The photo catalog belongs to a different Capture One document",
		)
	}
}
