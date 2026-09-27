import {readFile, realpath, rm, stat} from "node:fs/promises"
import {basename, dirname, isAbsolute, relative, resolve, sep} from "node:path"
import type {S3Client} from "@aws-sdk/client-s3"
import {and, eq, inArray, isNull, sql} from "drizzle-orm"
import {
	PHOTO_DERIVATIVE_KINDS,
	PHOTO_DERIVATIVES,
} from "../../processing/derivatives.ts"
import {
	type PreparedDerivative,
	type PreparedPhoto,
	preparePhoto,
	preparePhotoOpenGraph,
} from "../../processing/photos.ts"
import {siteConfig} from "../../site.config.ts"
import {backupPhotoDatabase} from "./backup.ts"
import {
	type CaptureOneSnapshot,
	type CaptureOneVariant,
	readCaptureOneSnapshot,
} from "./capture-one.ts"
import {
	catalog,
	collectionPhotos,
	collections,
	photoDerivatives,
	photoExports,
	photos,
} from "./database-schema.ts"
import {
	bindDocument,
	openPhotoDatabase,
	type PhotoDatabase,
	photoIdForVariant,
} from "./database.ts"
import {hashFile} from "./file-hash.ts"
import {
	createR2Client,
	loadR2Config,
	type R2Config,
	uploadR2File,
} from "./r2.ts"
import {configuredRootIds} from "./roots.ts"

const EXPORT_ROOT = resolve("photos/exports")
const OBJECT_ROOT = resolve("photos/objects")

type ExportCandidate = {
	eventId: string
	path: string
	profile: string
	modified: number
}

type CurrentExport = Pick<
	typeof photoExports.$inferSelect,
	"id" | "photoId" | "profile" | "sha256"
> & {
	derivatives: Pick<
		typeof photoDerivatives.$inferSelect,
		"kind" | "path" | "r2Key"
	>[]
}

function optionalR2Config(): R2Config | null {
	const settings = [
		process.env.R2_ENDPOINT,
		process.env.R2_ACCESS_KEY_ID,
		process.env.R2_SECRET_ACCESS_KEY,
		process.env.R2_BUCKET,
		process.env.R2_BACKUP_BUCKET,
	]
	return settings.some(Boolean) ? loadR2Config() : null
}

export async function syncPhotos(
	progress: (message: string) => void = () => {},
) {
	const database = openPhotoDatabase()
	using _ = database.$client
	progress("Reading Capture One")
	const snapshot = await readCaptureOneSnapshot(configuredRootIds(database))
	progress(
		`${snapshot.variants.length} photos, ${snapshot.collections.length} collections`,
	)
	bindDocument(database, snapshot.documentId)
	const photoIds = new Map(
		database
			.select({id: photos.id, variantId: photos.captureOneVariantId})
			.from(photos)
			.all()
			.map(({id, variantId}) => [variantId, id]),
	)
	const currentExports = readCurrentExports(database)
	for (const [index, variant] of snapshot.variants.entries()) {
		progress(`${index + 1}/${snapshot.variants.length} ${variant.name}`)
		const photoId = photoIds.get(variant.id) ?? photoIdForVariant(variant.id)
		upsertPhoto(database, photoId, variant)
		photoIds.set(variant.id, photoId)
		const profiles =
			currentExports.get(photoId) ?? new Map<string, CurrentExport>()
		currentExports.set(photoId, profiles)
		await syncVariant(database, photoId, variant, profiles)
	}
	persistCollections(database, snapshot, photoIds)
	markMissingPhotos(database, new Set(snapshot.variants.map(({id}) => id)))
	await discardSupersededPendingFiles(database)
	for (const source of readMetadataSources(database)) {
		const {normalized} = await preparePhoto(source.path)
		database
			.update(photos)
			.set({
				metadataJson: JSON.stringify(normalized),
				updatedAt: new Date().toISOString(),
			})
			.where(eq(photos.id, source.photoId))
			.run()
	}
	return snapshot.variants.length
}

export async function regenerateOpenGraphImages(
	progress: (message: string) => void = () => {},
) {
	const database = openPhotoDatabase()
	using _ = database.$client
	const rows = readSourceImages(database)
	for (const [index, row] of rows.entries()) {
		progress(`${index + 1}/${rows.length} ${row.photoId}`)
		const generated = await preparePhotoOpenGraph(
			await readFile(row.path),
			resolve(dirname(row.path), PHOTO_DERIVATIVES.og.filename),
		)
		upsertDerivative(database, row.id, generated)
	}
	return rows.length
}

export async function uploadPhotos(
	progress: (message: string) => void,
	{backupCatalog}: {backupCatalog: boolean},
): Promise<boolean> {
	const config = optionalR2Config()
	if (!config) {
		return false
	}
	const database = openPhotoDatabase()
	using _ = database.$client
	const client = createR2Client(config)
	try {
		await uploadPendingFiles(database, client, config, progress)
		if (backupCatalog) {
			progress("Uploading catalog backup")
			await backupPhotoDatabase(database, client, config)
		}
	} finally {
		client.destroy()
	}
	return true
}

function readMetadataSources(database: PhotoDatabase) {
	return database
		.select({photoId: photos.id, path: photoDerivatives.path})
		.from(photos)
		.innerJoin(
			photoDerivatives,
			eq(photoDerivatives.id, photos.metadataSourceId),
		)
		.where(and(eq(photos.status, "active"), isNull(photoDerivatives.deletedAt)))
		.all()
}

function readSourceImages(database: PhotoDatabase) {
	return database
		.select({
			id: photoExports.id,
			photoId: photoExports.photoId,
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
				isNull(photoDerivatives.deletedAt),
				eq(photoExports.profile, siteConfig.photos.exportProfile),
			),
		)
		.all()
}

function readCurrentExports(
	database: PhotoDatabase,
): Map<string, Map<string, CurrentExport>> {
	const derivatives = Map.groupBy(
		database
			.select({
				exportId: photoDerivatives.exportId,
				kind: photoDerivatives.kind,
				path: photoDerivatives.path,
				r2Key: photoDerivatives.r2Key,
			})
			.from(photoDerivatives)
			.innerJoin(photoExports, eq(photoExports.id, photoDerivatives.exportId))
			.where(
				and(eq(photoExports.current, true), isNull(photoDerivatives.deletedAt)),
			)
			.all(),
		(row) => row.exportId,
	)
	const exports = Map.groupBy(
		database
			.select({
				id: photoExports.id,
				photoId: photoExports.photoId,
				profile: photoExports.profile,
				sha256: photoExports.sha256,
			})
			.from(photoExports)
			.where(eq(photoExports.current, true))
			.all(),
		(row) => row.photoId,
	)
	return new Map(
		[...exports].map(([photoId, rows]) => [
			photoId,
			new Map(
				rows.map((row) => [
					row.profile,
					{...row, derivatives: derivatives.get(row.id) ?? []},
				]),
			),
		]),
	)
}

async function syncVariant(
	database: PhotoDatabase,
	photoId: string,
	variant: CaptureOneVariant,
	profiles: Map<string, CurrentExport>,
): Promise<void> {
	const candidates = await exportCandidates(variant)
	if (candidates.length === 0) {
		if (profiles.size === 0) {
			throw new Error("has no current JPEG export in photos/exports")
		}

		return
	}
	for (const candidate of candidates) {
		const current = await syncExport(
			database,
			photoId,
			candidate,
			profiles.get(candidate.profile),
		)
		if (current) {
			profiles.set(candidate.profile, current)
		}
	}
}

async function syncExport(
	database: PhotoDatabase,
	photoId: string,
	candidate: ExportCandidate,
	current: CurrentExport | undefined,
): Promise<CurrentExport | undefined> {
	const website = candidate.profile === siteConfig.photos.exportProfile
	if (
		!website &&
		candidate.profile !== siteConfig.atproto.refrakt.exportProfile
	) {
		return
	}
	const sha256 = await hashFile(candidate.path)
	if (current?.sha256 === sha256 && (await storedFilesExist(current))) {
		database
			.update(photoExports)
			.set({
				captureOneOutputId: candidate.eventId,
				sourcePath: candidate.path,
				filename: basename(candidate.path),
			})
			.where(eq(photoExports.id, current.id))
			.run()
		return current
	}

	const prepared = await preparePhoto(
		candidate.path,
		website ? resolve(OBJECT_ROOT, photoId, sha256) : undefined,
	)
	return stageExport(database, photoId, candidate, prepared)
}

async function exportCandidates(
	variant: CaptureOneVariant,
): Promise<ExportCandidate[]> {
	const candidates = (
		await Promise.all(
			variant.outputs.map(async (output): Promise<ExportCandidate | null> => {
				if (!output.path) {
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
	const now = new Date().toISOString()
	const saved = database
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
			setWhere: eq(photos.captureOneVariantId, variant.id),
		})
		.returning({id: photos.id})
		.get()
	if (!saved) {
		throw new Error(`Photo ID collision for ${photoId}`)
	}
}

function stageExport(
	database: PhotoDatabase,
	photoId: string,
	candidate: ExportCandidate,
	prepared: PreparedPhoto,
): CurrentExport {
	const now = new Date().toISOString()
	return database.transaction(() => {
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
			.returning({
				id: photoExports.id,
				photoId: photoExports.photoId,
				profile: photoExports.profile,
				sha256: photoExports.sha256,
			})
			.get()
		const exportId = exportRow.id
		const derivatives = []
		for (const derivative of prepared.derivatives) {
			const saved = upsertDerivative(database, exportId, derivative)
			derivatives.push(saved)
			if (
				candidate.profile === siteConfig.photos.exportProfile &&
				derivative.kind === "source"
			) {
				database
					.update(photos)
					.set({metadataSourceId: saved.id})
					.where(eq(photos.id, photoId))
					.run()
			}
		}
		return {...exportRow, derivatives}
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

function upsertDerivative(
	database: PhotoDatabase,
	exportId: number,
	derivative: PreparedDerivative,
) {
	const r2Key = `photos/${relative(OBJECT_ROOT, derivative.path).split(sep).join("/")}`
	return database
		.insert(photoDerivatives)
		.values({
			...derivative,
			exportId,
			r2Key,
			createdAt: new Date().toISOString(),
		})
		.onConflictDoUpdate({
			target: photoDerivatives.r2Key,
			set: {
				...derivative,
				uploadedAt: null,
				deletedAt: null,
			},
		})
		.returning({
			id: photoDerivatives.id,
			kind: photoDerivatives.kind,
			path: photoDerivatives.path,
			r2Key: photoDerivatives.r2Key,
		})
		.get()
}

function persistCollections(
	database: PhotoDatabase,
	snapshot: CaptureOneSnapshot,
	photoIds: Map<string, string>,
): void {
	const now = new Date().toISOString()
	const activeIds = new Set(snapshot.collections.map(({id}) => id))
	database.transaction(() => {
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
			persistCollectionMembers(
				database,
				collection.id,
				collection.members,
				photoIds,
			)
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
	photoIds: Map<string, string>,
): void {
	for (const member of members) {
		const photoId = photoIds.get(member.variantId)
		if (photoId) {
			database
				.insert(collectionPhotos)
				.values({collectionId, photoId, position: member.index})
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

async function storedFilesExist(exportRow: CurrentExport): Promise<boolean> {
	if (exportRow.profile !== siteConfig.photos.exportProfile) {
		return true
	}
	const rows = exportRow.derivatives
	if (rows.length !== PHOTO_DERIVATIVE_KINDS.length) {
		return false
	}
	for (const row of rows) {
		const filename = PHOTO_DERIVATIVES[row.kind].filename
		const key = `${exportRow.photoId}/${exportRow.sha256}/${filename}`
		if (
			row.path !== resolve(OBJECT_ROOT, key) ||
			row.r2Key !== `photos/${key}`
		) {
			return false
		}
		const file = await stat(row.path).catch(() => null)
		if (!file?.isFile()) {
			return false
		}
	}
	return true
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

async function uploadPendingFiles(
	database: PhotoDatabase,
	client: S3Client,
	config: R2Config,
	progress: (message: string) => void,
): Promise<void> {
	progress("Checking pending files in R2")
	const rows = database
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
	let uploaded = 0
	let reused = 0
	for (const [index, row] of rows.entries()) {
		progress(`${index + 1}/${rows.length} ${row.r2Key}`)
		const result = await uploadR2File({
			client,
			config,
			path: row.path,
			key: row.r2Key,
			byteSize: row.byteSize,
			mimeType: row.mimeType,
			sha256: row.sha256,
		})
		if (result === "uploaded") {
			uploaded++
		} else {
			reused++
		}
		database
			.update(photoDerivatives)
			.set({uploadedAt: new Date().toISOString()})
			.where(eq(photoDerivatives.id, row.id))
			.run()
	}
	progress(`Uploaded ${uploaded} files; reused ${reused} files in R2`)
}
