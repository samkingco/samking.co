import {existsSync} from "node:fs"
import {resolve} from "node:path"
import type {Loader, LoaderContext} from "astro/loaders"
import {and, asc, desc, eq, inArray, isNotNull, isNull} from "drizzle-orm"
import * as v from "valibot"
import {siteConfig} from "../site.config.ts"
import {
	collectionPhotos,
	collections,
	equipmentAliases,
	photoDerivatives,
	photoExports,
	photos,
} from "./database-schema.ts"
import {
	openReadonlyPhotoDatabase,
	PHOTO_DATABASE_PATH,
	type PhotoDatabase,
} from "./database.ts"
import {PHOTO_CDN_URL} from "./r2.ts"
import {
	type NormalizedMetadata,
	NormalizedMetadataSchema,
	type PhotoEntry,
	PhotoEntrySchema,
	type PhotoSetEntry,
	PhotoSetEntrySchema,
} from "./schema.ts"
import {photoSlug} from "./slug.ts"

const DATABASE_PATH = resolve(PHOTO_DATABASE_PATH)

export function photosLoader(): Loader {
	return sqliteLoader("photos-sqlite", loadPhotos)
}

export function photoSetsLoader(): Loader {
	return sqliteLoader("photo-sets-sqlite", loadSets)
}

function sqliteLoader(
	name: string,
	load: (context: LoaderContext) => Promise<void>,
): Loader {
	return {
		name,
		async load(context) {
			await load(context)
			const reload = async (changedPath: string) => {
				if (resolve(changedPath) !== DATABASE_PATH) {
					return
				}
				context.logger.info("Reloading photos from SQLite")
				await load(context)
			}
			context.watcher?.add(DATABASE_PATH)
			context.watcher?.on("add", reload)
			context.watcher?.on("change", reload)
		},
	}
}

async function loadPhotos(context: LoaderContext): Promise<void> {
	const database = openCatalog(context)
	if (!database) {
		return
	}

	const local = Boolean(context.watcher)
	const mediaRoot = local ? "/cdn" : PHOTO_CDN_URL

	try {
		const rows = readPhotoRows(database)
		const selectedExports = readPreferredExports(
			database,
			rows.map(({id}) => id),
		)
		const derivatives = readDerivatives(
			database,
			[...selectedExports.values()].map(({id}) => id),
			local,
		)
		const aliases = readEquipmentAliases(database)

		const entries = rows
			.map((row) =>
				photoEntry({
					row,
					selectedExports,
					derivatives,
					aliases,
					mediaRoot,
				}),
			)
			.filter((entry): entry is PhotoEntry => entry !== null)

		context.store.clear()

		for (const data of entries) {
			context.store.set({
				id: data.id,
				data,
				digest: context.generateDigest(data),
			})
		}
	} finally {
		database.$client.close()
	}
}

function readPhotoRows(database: PhotoDatabase) {
	return database
		.select({
			id: photos.id,
			name: photos.captureOneVariantName,
			position: collectionPhotos.position,
			metadataJson: photos.metadataJson,
		})
		.from(collectionPhotos)
		.innerJoin(photos, eq(photos.id, collectionPhotos.photoId))
		.where(
			and(
				eq(
					collectionPhotos.collectionId,
					siteConfig.photos.allPhotosCollectionId,
				),
				eq(photos.status, "active"),
				isNotNull(photos.metadataJson),
			),
		)
		.orderBy(desc(collectionPhotos.position))
		.all()
}

function readPreferredExports(database: PhotoDatabase, photoIds: string[]) {
	const rows =
		photoIds.length === 0
			? []
			: database
					.select({
						id: photoExports.id,
						photoId: photoExports.photoId,
						profile: photoExports.profile,
						sha256: photoExports.sha256,
					})
					.from(photoExports)
					.where(
						and(
							inArray(photoExports.photoId, photoIds),
							eq(photoExports.current, true),
							isNull(photoExports.deletedAt),
							eq(photoExports.profile, siteConfig.photos.exportProfile),
						),
					)
					.all()

	const selected = new Map<string, (typeof rows)[number]>()

	for (const row of rows) {
		const current = selected.get(row.photoId)
		if (!current || row.profile === "website") {
			selected.set(row.photoId, row)
		}
	}

	return selected
}

function readDerivatives(
	database: PhotoDatabase,
	exportIds: number[],
	local: boolean,
) {
	const rows =
		exportIds.length === 0
			? []
			: database
					.select({
						exportId: photoDerivatives.exportId,
						kind: photoDerivatives.kind,
						r2Key: photoDerivatives.r2Key,
					})
					.from(photoDerivatives)
					.where(
						and(
							inArray(photoDerivatives.exportId, exportIds),
							isNull(photoDerivatives.deletedAt),
							local ? undefined : isNotNull(photoDerivatives.uploadedAt),
						),
					)
					.all()

	return Map.groupBy(rows, ({exportId}) => exportId)
}

function readEquipmentAliases(database: PhotoDatabase) {
	return new Map(
		database
			.select()
			.from(equipmentAliases)
			.all()
			.map((alias) => [`${alias.kind}:${alias.sourceName}`, alias]),
	)
}

type PhotoEntryInput = {
	row: ReturnType<typeof readPhotoRows>[number]
	selectedExports: ReturnType<typeof readPreferredExports>
	derivatives: ReturnType<typeof readDerivatives>
	aliases: ReturnType<typeof readEquipmentAliases>
	mediaRoot: string
}

function photoEntry(input: PhotoEntryInput): PhotoEntry | null {
	const {row, selectedExports, derivatives, aliases, mediaRoot} = input

	const selectedExport = selectedExports.get(row.id)
	if (!selectedExport || !row.metadataJson) {
		return null
	}

	const keys = derivativeKeys(derivatives.get(selectedExport.id))
	if (!keys) {
		return null
	}

	const metadata = v.parse(
		NormalizedMetadataSchema,
		JSON.parse(row.metadataJson),
	)
	const cameraSource = equipmentSource(
		metadata.cameraMake,
		metadata.cameraModel,
	)
	const lensSource = equipmentSource(metadata.lensMake, metadata.lensModel)
	const cameraAlias = aliases.get(`camera:${cameraSource}`)
	const lensAlias = aliases.get(`lens:${lensSource}`)

	return v.parse(PhotoEntrySchema, {
		id: row.id,
		name: row.name,
		sha256: selectedExport.sha256,
		position: row.position,
		sourceUrl: `${mediaRoot}/${keys.source}`,
		thumbUrl: `${mediaRoot}/${keys.thumb}`,
		detailUrl: `${mediaRoot}/${keys.detail}`,
		ogUrl: `${mediaRoot}/${keys.og}`,
		cameraName: equipmentName(cameraAlias, cameraSource),
		lensName: equipmentName(lensAlias, lensSource),
		displayFocalLength: displayFocalLength(
			metadata,
			cameraAlias ? cameraAlias.focalLengthDisplay : "native",
			metadata.focalLength35mm,
		),
		metadata,
	})
}

function derivativeKeys(
	rows:
		| Array<{
				kind: typeof photoDerivatives.$inferSelect.kind
				r2Key: string
		  }>
		| undefined,
): {source: string; thumb: string; detail: string; og: string} | null {
	const keys = new Map((rows ?? []).map(({kind, r2Key}) => [kind, r2Key]))
	const source = keys.get("source")
	const thumb = keys.get("thumb")
	const detail = keys.get("detail")
	const og = keys.get("og")
	return source && thumb && detail && og ? {source, thumb, detail, og} : null
}

function equipmentName(
	alias: typeof equipmentAliases.$inferSelect | undefined,
	source: string,
): string | null {
	return alias ? alias.displayName : source || null
}

function equipmentSource(make: string | null, model: string | null): string {
	return `${make ?? ""} ${model ?? ""}`.trim()
}

async function loadSets(context: LoaderContext): Promise<void> {
	const database = openCatalog(context)
	if (!database) {
		return
	}

	const local = Boolean(context.watcher)
	try {
		const sets = database
			.select({
				id: collections.id,
				name: collections.name,
				description: collections.description,
				position: collections.position,
			})
			.from(collections)
			.where(
				and(
					eq(collections.parentId, siteConfig.photos.setsCollectionId),
					eq(collections.kind, "album"),
				),
			)
			.orderBy(asc(collections.position))
			.all()

		const setIds = sets.map(({id}) => id)
		const members =
			setIds.length === 0
				? []
				: database
						.select({
							collectionId: collectionPhotos.collectionId,
							photoId: collectionPhotos.photoId,
							position: collectionPhotos.position,
						})
						.from(collectionPhotos)
						.innerJoin(photos, eq(photos.id, collectionPhotos.photoId))
						.where(
							and(
								inArray(collectionPhotos.collectionId, setIds),
								eq(photos.status, "active"),
							),
						)
						.orderBy(
							asc(collectionPhotos.collectionId),
							asc(collectionPhotos.position),
						)
						.all()

		const photoIds = [...new Set(members.map(({photoId}) => photoId))]
		const exportRows =
			photoIds.length === 0
				? []
				: database
						.select({id: photoExports.id, photoId: photoExports.photoId})
						.from(photoExports)
						.where(
							and(
								inArray(photoExports.photoId, photoIds),
								eq(photoExports.current, true),
								isNull(photoExports.deletedAt),
								eq(photoExports.profile, siteConfig.photos.exportProfile),
							),
						)
						.all()

		const exportIds = exportRows.map(({id}) => id)
		const derivativeRows =
			exportIds.length === 0
				? []
				: database
						.select({
							exportId: photoDerivatives.exportId,
							kind: photoDerivatives.kind,
						})
						.from(photoDerivatives)
						.where(
							and(
								inArray(photoDerivatives.exportId, exportIds),
								isNull(photoDerivatives.deletedAt),
								local ? undefined : isNotNull(photoDerivatives.uploadedAt),
							),
						)
						.all()

		const requiredDerivativeCount = siteConfig.photos.r2Derivatives.length
		const completeExportIds = new Set(
			[...Map.groupBy(derivativeRows, ({exportId}) => exportId)]
				.filter(
					([, rows]) =>
						new Set(rows.map(({kind}) => kind)).size ===
						requiredDerivativeCount,
				)
				.map(([exportId]) => exportId),
		)

		const availablePhotoIds = new Set(
			exportRows
				.filter(({id}) => completeExportIds.has(id))
				.map(({photoId}) => photoId),
		)

		context.store.clear()

		for (const row of sets) {
			const setPhotoIds = members
				.filter(
					(member) =>
						member.collectionId === row.id &&
						availablePhotoIds.has(member.photoId),
				)
				.map(({photoId}) => photoId)

			const data: PhotoSetEntry = v.parse(PhotoSetEntrySchema, {
				id: row.id,
				slug: photoSlug(row.name),
				title: row.name,
				description: row.description,
				position: row.position,
				photoIds: setPhotoIds,
			})

			context.store.set({
				id: row.id,
				data,
				digest: context.generateDigest(data),
			})
		}
	} finally {
		database.$client.close()
	}
}

function openCatalog(context: LoaderContext): PhotoDatabase | null {
	if (existsSync(DATABASE_PATH)) {
		return openReadonlyPhotoDatabase(DATABASE_PATH)
	}

	context.store.clear()

	if (context.watcher) {
		return null
	}

	throw new Error("Photo database is missing. Run pnpm photos sync first.")
}

function displayFocalLength(
	metadata: NormalizedMetadata,
	mode: "native" | "35mm",
	fallback35mm: string | null,
): string | null {
	return mode === "native"
		? metadata.focalLength
		: (metadata.focalLength35mm ?? fallback35mm ?? metadata.focalLength)
}
