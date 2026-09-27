import {and, asc, eq, inArray, isNull} from "drizzle-orm"
import * as v from "valibot"
import {PHOTO_DERIVATIVE_KINDS} from "../../processing/derivatives.ts"
import {readCollections} from "./collections.ts"
import {
	collectionPhotos,
	collections,
	photoDerivatives,
	photoExports,
	photos,
} from "./database-schema.ts"
import type {PhotoDatabase} from "./database.ts"
import {readEquipmentAliases, resolveEquipment} from "./equipment.ts"
import {NormalizedMetadataSchema} from "./schema.ts"

/** Website selection and availability rules live here, not in the Astro loader. */
export function readWebsiteCatalog(
	database: PhotoDatabase,
	config: {
		allPhotosCollectionId: string
		setsCollectionId: string
		exportProfile: string
	},
	local: boolean,
) {
	const albums = readCollections(database).filter(
		(row) => row.parentId === config.setsCollectionId && row.kind === "album",
	)
	const ids = [config.allPhotosCollectionId, ...albums.map(({id}) => id)]
	const members = readMemberships(database, ids)
	const derivatives = Map.groupBy(
		readDerivatives(database, ids, config.exportProfile).filter(
			(row) => local || row.uploadedAt !== null,
		),
		(row) => row.exportId,
	)
	const rows = readPhotoRows(database, ids, config.exportProfile).filter(
		(row) => hasWebsiteMedia(derivatives.get(row.selectedExport.id) ?? []),
	)
	const available = new Set(rows.map(({id}) => id))
	const positions = new Map(
		members
			.filter((row) => row.collection.id === config.allPhotosCollectionId)
			.map((row) => [row.photoId, row.position]),
	)
	const aliases = readEquipmentAliases(database)
	const memberships = Map.groupBy(members, (row) => row.photoId)
	return {
		photos: rows
			.filter((row) => positions.has(row.id) && row.metadataJson)
			.map((row) => ({
				...assemblePhoto(
					row,
					memberships.get(row.id) ?? [],
					derivatives.get(row.selectedExport.id) ?? [],
					aliases,
				),
				position: positions.get(row.id)!,
			}))
			.sort((a, b) => b.position - a.position),
		albums: assembleAlbums(
			albums,
			members.filter((row) => available.has(row.photoId)),
		),
	}
}

/** Refrakt requires every photo below the root to have a usable export. */
export function readRefraktCatalog(
	database: PhotoDatabase,
	config: {
		rootCollectionId: string
		profileCollectionId: string
		albumsCollectionId: string
		exportProfile: string
	},
) {
	const allCollections = readCollections(database)
	if (!allCollections.some(({id}) => id === config.rootCollectionId)) {
		throw new Error(
			`Capture One root ${config.rootCollectionId} is not ingested. Add it with "pnpm content photos roots" and sync.`,
		)
	}
	const children = Map.groupBy(allCollections, (row) => row.parentId)
	const ids = new Set([config.rootCollectionId])
	for (const id of ids) {
		for (const child of children.get(id) ?? []) {
			ids.add(child.id)
		}
	}
	const rootIds = [...ids]
	const members = readMemberships(database, rootIds)
	const desiredIds = new Set(
		members
			.filter((row) => ids.has(row.collection.id))
			.map((row) => row.photoId),
	)
	const rows = readPhotoRows(database, rootIds, config.exportProfile).filter(
		(row) => row.metadataJson,
	)
	const available = new Set(rows.map(({id}) => id))
	const missing = [...desiredIds].filter((id) => !available.has(id))
	if (missing.length > 0) {
		throw new Error(
			`${missing.length} photos below root ${config.rootCollectionId} have no usable ${config.exportProfile} export.`,
		)
	}
	const memberships = Map.groupBy(members, (row) => row.photoId)
	const derivatives = Map.groupBy(
		readDerivatives(database, rootIds, config.exportProfile),
		(row) => row.exportId,
	)
	const aliases = readEquipmentAliases(database)
	const albums = allCollections.filter(
		(row) =>
			row.parentId === config.albumsCollectionId &&
			row.kind.toLowerCase() === "album",
	)
	// Configured profile/albums can be outside the root. Keep their full ordering;
	// the record converter excludes references to photos outside the root.
	const orderedMembers = readMemberships(database, [
		config.profileCollectionId,
		...albums.map(({id}) => id),
	])
	return {
		photos: rows.map((row) =>
			assemblePhoto(
				row,
				memberships.get(row.id) ?? [],
				derivatives.get(row.selectedExport.id) ?? [],
				aliases,
			),
		),
		profilePhotoIds: orderedMembers
			.filter((row) => row.collection.id === config.profileCollectionId)
			.map((row) => row.photoId),
		albums: assembleAlbums(albums, orderedMembers),
	}
}

function memberPhotoIds(database: PhotoDatabase, collectionIds: string[]) {
	return database
		.select({id: collectionPhotos.photoId})
		.from(collectionPhotos)
		.where(inArray(collectionPhotos.collectionId, collectionIds))
}

function readPhotoRows(
	database: PhotoDatabase,
	collectionIds: string[],
	profile: string,
) {
	return database
		.select({
			id: photos.id,
			name: photos.captureOneVariantName,
			createdAt: photos.createdAt,
			metadataJson: photos.metadataJson,
			selectedExport: {
				id: photoExports.id,
				photoId: photoExports.photoId,
				profile: photoExports.profile,
				sha256: photoExports.sha256,
				filename: photoExports.filename,
				byteSize: photoExports.byteSize,
				mimeType: photoExports.mimeType,
				width: photoExports.width,
				height: photoExports.height,
			},
		})
		.from(photos)
		.innerJoin(photoExports, eq(photoExports.photoId, photos.id))
		.where(
			and(
				inArray(photos.id, memberPhotoIds(database, collectionIds)),
				eq(photos.status, "active"),
				eq(photoExports.profile, profile),
				eq(photoExports.current, true),
				isNull(photoExports.deletedAt),
			),
		)
		.orderBy(asc(photos.createdAt))
		.all()
}

/** Include all memberships of the selected photos, not only the selection itself. */
function readMemberships(database: PhotoDatabase, collectionIds: string[]) {
	return database
		.select({
			photoId: collectionPhotos.photoId,
			position: collectionPhotos.position,
			collection: collections,
		})
		.from(collectionPhotos)
		.innerJoin(collections, eq(collections.id, collectionPhotos.collectionId))
		.where(
			inArray(
				collectionPhotos.photoId,
				memberPhotoIds(database, collectionIds),
			),
		)
		.orderBy(asc(collectionPhotos.collectionId), asc(collectionPhotos.position))
		.all()
}

function readDerivatives(
	database: PhotoDatabase,
	collectionIds: string[],
	profile: string,
) {
	return database
		.select({
			exportId: photoDerivatives.exportId,
			kind: photoDerivatives.kind,
			r2Key: photoDerivatives.r2Key,
			uploadedAt: photoDerivatives.uploadedAt,
		})
		.from(photoDerivatives)
		.innerJoin(photoExports, eq(photoExports.id, photoDerivatives.exportId))
		.where(
			and(
				inArray(photoExports.photoId, memberPhotoIds(database, collectionIds)),
				eq(photoExports.profile, profile),
				eq(photoExports.current, true),
				isNull(photoExports.deletedAt),
				isNull(photoDerivatives.deletedAt),
			),
		)
		.all()
}

function hasWebsiteMedia(
	derivatives: ReturnType<typeof readDerivatives>,
): boolean {
	const kinds = new Set(
		derivatives.filter((row) => row.r2Key !== "").map((row) => row.kind),
	)
	return PHOTO_DERIVATIVE_KINDS.every((kind) => kinds.has(kind))
}

function assemblePhoto(
	{metadataJson, ...row}: ReturnType<typeof readPhotoRows>[number],
	memberships: ReturnType<typeof readMemberships>,
	derivatives: ReturnType<typeof readDerivatives>,
	aliases: ReturnType<typeof readEquipmentAliases>,
) {
	const metadata = v.parse(NormalizedMetadataSchema, JSON.parse(metadataJson!))
	const camera = resolveEquipment(
		aliases,
		"camera",
		metadata.cameraMake,
		metadata.cameraModel,
	)
	const lens = resolveEquipment(
		aliases,
		"lens",
		metadata.lensMake,
		metadata.lensModel,
	)
	return {
		...row,
		metadata,
		camera,
		lens,
		displayFocalLength:
			camera.focalLengthDisplay === "35mm"
				? (metadata.focalLength35mm ?? metadata.focalLength)
				: metadata.focalLength,
		memberships: memberships.map(({collection, position}) => ({
			collection,
			position,
		})),
		derivatives,
	}
}

function assembleAlbums(
	albums: ReturnType<typeof readCollections>,
	members: ReturnType<typeof readMemberships>,
) {
	const byCollection = Map.groupBy(members, (row) => row.collection.id)
	return albums.map((album) => ({
		...album,
		photoIds: (byCollection.get(album.id) ?? []).map((row) => row.photoId),
	}))
}

export type CatalogPhoto = ReturnType<typeof assemblePhoto>
export type CatalogAlbum = ReturnType<typeof assembleAlbums>[number]
