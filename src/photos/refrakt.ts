import {Buffer} from "node:buffer"
import {toString as cidToString, CODEC_RAW, fromDigest} from "@atcute/cid"
import {and, asc, eq, inArray, isNotNull, isNull} from "drizzle-orm"
import * as v from "valibot"
import {siteConfig} from "../site.config.ts"
import {
	collections as catalogCollections,
	equipmentAliases as catalogEquipmentAliases,
	photos as catalogPhotos,
	collectionPhotos,
	photoExports,
} from "./database-schema.ts"
import {
	openReadonlyPhotoDatabase,
	PHOTO_DATABASE_PATH,
	type PhotoDatabase,
} from "./database.ts"
import {
	createRefraktPlan,
	REFRAKT_COLLECTIONS,
	type RefraktCatalogProjection,
	type RefraktCollection,
	type RefraktPlan,
	type RefraktRemoteRecord,
} from "./refrakt-plan.ts"
import {NormalizedMetadataSchema} from "./schema.ts"

const RemoteResponseSchema = v.object({
	cursor: v.optional(v.string()),
	records: v.array(
		v.object({
			uri: v.string(),
			cid: v.string(),
			value: v.unknown(),
		}),
	),
})

const DidDocumentSchema = v.object({
	service: v.array(
		v.object({
			type: v.string(),
			serviceEndpoint: v.string(),
		}),
	),
})

type EquipmentAlias = {
	displayName: string
	focalLengthDisplay: "native" | "35mm"
}

const REFRAKT_EXPORT_PROFILE = "refrakt"

export async function planRefrakt(options: {json: boolean}): Promise<void> {
	const progress = options.json ? console.error : console.log

	const {did, refrakt} = siteConfig.atproto
	progress("Reading the local Refrakt catalog...")

	const database = openReadonlyPhotoDatabase(PHOTO_DATABASE_PATH)
	let catalog: RefraktCatalogProjection
	try {
		catalog = readRefraktCatalog(database, refrakt)
	} finally {
		database.$client.close()
	}
	progress(
		`Read ${catalog.photos.length} photos and ${catalog.albums.length} albums. Reading remote records...`,
	)

	const {endpoint, records: remote} = await readPds(did)
	progress(`Read ${remote.length} remote records. Creating the plan...`)

	const plan = await createRefraktPlan({did, catalog, remote})
	if (options.json) {
		console.log(
			JSON.stringify(
				{
					did,
					root: refrakt.rootCollectionId,
					profile: REFRAKT_EXPORT_PROFILE,
					endpoint,
					plan,
				},
				null,
				2,
			),
		)
		return
	}

	printPlan({
		did,
		root: refrakt.rootCollectionId,
		endpoint,
		catalog,
		remote,
		plan,
	})
}

function readRefraktCatalog(
	database: PhotoDatabase,
	config: typeof siteConfig.atproto.refrakt,
): RefraktCatalogProjection {
	const rootId = config.rootCollectionId
	const profile = config.exportProfile
	const aliases = equipmentAliases(database)
	const collections = readCollections(database)
	const root = collections.find(({id}) => id === rootId)
	if (!root) {
		throw new Error(
			`Capture One root ${rootId} is not ingested. Add it with "pnpm photos roots" and sync.`,
		)
	}

	const descendantIds = descendantCollectionIds(collections, rootId)
	const members = database
		.select({
			collectionId: collectionPhotos.collectionId,
			photoId: collectionPhotos.photoId,
			position: collectionPhotos.position,
		})
		.from(collectionPhotos)
		.orderBy(asc(collectionPhotos.collectionId), asc(collectionPhotos.position))
		.all()
	const rootMembers = members.filter(({collectionId}) =>
		descendantIds.has(collectionId),
	)
	const desiredPhotoIds = new Set(rootMembers.map(({photoId}) => photoId))
	const desiredIds = [...desiredPhotoIds]
	const {photos, availablePhotoIds} = readCatalogPhotos(
		database,
		desiredIds,
		aliases,
		profile,
	)

	const missing = [...desiredPhotoIds].filter(
		(id) => !availablePhotoIds.has(id),
	)
	if (missing.length > 0) {
		throw new Error(
			`${missing.length} photos below root ${rootId} have no usable ${profile} export.`,
		)
	}

	const profilePhotoIds = memberPhotoIds(config.profileCollectionId, members)
	const albums = collections
		.filter(
			(collection) =>
				collection.parentId === config.albumsCollectionId &&
				collection.kind.toLowerCase() === "album",
		)
		.sort((left, right) => left.position - right.position)
		.map((collection) => ({
			id: collection.id,
			title: collection.name,
			description: collection.description,
			createdAt: collection.createdAt,
			photoIds: memberPhotoIds(collection.id, members),
		}))

	return {photos, profilePhotoIds, albums}
}

function readCatalogPhotos(
	database: PhotoDatabase,
	desiredIds: string[],
	aliases: ReturnType<typeof equipmentAliases>,
	profile: string,
): {
	photos: RefraktCatalogProjection["photos"]
	availablePhotoIds: Set<string>
} {
	const photoRows =
		desiredIds.length === 0
			? []
			: database
					.select({
						id: catalogPhotos.id,
						name: catalogPhotos.captureOneVariantName,
						createdAt: catalogPhotos.createdAt,
						metadataJson: catalogPhotos.metadataJson,
					})
					.from(catalogPhotos)
					.where(
						and(
							inArray(catalogPhotos.id, desiredIds),
							eq(catalogPhotos.status, "active"),
							isNotNull(catalogPhotos.metadataJson),
						),
					)
					.orderBy(asc(catalogPhotos.createdAt))
					.all()

	const selectedExports = readPreferredRefraktExports(
		database,
		desiredIds,
		profile,
	)

	const availablePhotoIds = new Set<string>()
	const photos: RefraktCatalogProjection["photos"] = []

	for (const row of photoRows) {
		const selectedExport = selectedExports.get(row.id)
		if (!selectedExport || !row.metadataJson) {
			continue
		}

		availablePhotoIds.add(row.id)
		const metadata = v.parse(
			NormalizedMetadataSchema,
			JSON.parse(row.metadataJson),
		)
		const camera = effectiveEquipment(
			aliases.camera,
			metadata.cameraMake,
			metadata.cameraModel,
		)
		const lens = effectiveEquipment(
			aliases.lens,
			metadata.lensMake,
			metadata.lensModel,
		)
		photos.push({
			id: row.id,
			name: row.name,
			filename: selectedExport.filename,
			createdAt: row.createdAt,
			capturedAt: metadata.capturedAt,
			title: metadata.title,
			headline: metadata.headline,
			caption: metadata.caption,
			alt: metadata.alt,
			cameraMake: camera.make,
			cameraModel: camera.model,
			lensMake: lens.make,
			lensModel: lens.model,
			focalLength: metadata.focalLength,
			focalLength35mm: metadata.focalLength35mm,
			aperture: metadata.aperture,
			shutter: metadata.shutter,
			iso: metadata.iso,
			flash: metadata.flash,
			width: selectedExport.width,
			height: selectedExport.height,
			source: {
				$type: "blob",
				ref: {$link: blobCid(selectedExport.sha256)},
				mimeType: selectedExport.mimeType,
				size: selectedExport.byteSize,
			},
		})
	}
	return {photos, availablePhotoIds}
}

function readPreferredRefraktExports(
	database: PhotoDatabase,
	photoIds: string[],
	profile: string,
) {
	const rows =
		photoIds.length === 0
			? []
			: database
					.select({
						id: photoExports.id,
						photoId: photoExports.photoId,
						filename: photoExports.filename,
						sha256: photoExports.sha256,
						byteSize: photoExports.byteSize,
						mimeType: photoExports.mimeType,
						width: photoExports.width,
						height: photoExports.height,
					})
					.from(photoExports)
					.where(
						and(
							inArray(photoExports.photoId, photoIds),
							eq(photoExports.current, true),
							isNull(photoExports.deletedAt),
							eq(photoExports.profile, profile),
						),
					)
					.all()
	return new Map(rows.map((row) => [row.photoId, row]))
}

type CatalogCollection = {
	id: string
	parentId: string
	name: string
	kind: string
	position: number
	createdAt: string
	description: string
}

type CatalogMember = {
	collectionId: string
	photoId: string
	position: number
}

function readCollections(database: PhotoDatabase): CatalogCollection[] {
	return database
		.select({
			id: catalogCollections.id,
			parentId: catalogCollections.parentId,
			name: catalogCollections.name,
			kind: catalogCollections.kind,
			position: catalogCollections.position,
			description: catalogCollections.description,
			createdAt: catalogCollections.createdAt,
		})
		.from(catalogCollections)
		.orderBy(asc(catalogCollections.parentId), asc(catalogCollections.position))
		.all()
}

function descendantCollectionIds(
	collections: CatalogCollection[],
	rootId: string,
): Set<string> {
	const ids = new Set([rootId])
	let changed = true
	while (changed) {
		changed = false
		for (const collection of collections.filter(
			({parentId, id}) => ids.has(parentId) && !ids.has(id),
		)) {
			ids.add(collection.id)
			changed = true
		}
	}
	return ids
}

function memberPhotoIds(
	collectionId: string,
	members: CatalogMember[],
): string[] {
	return members
		.filter((member) => member.collectionId === collectionId)
		.sort((left, right) => left.position - right.position)
		.map(({photoId}) => photoId)
}

function equipmentAliases(database: PhotoDatabase): {
	camera: Map<string, EquipmentAlias>
	lens: Map<string, EquipmentAlias>
} {
	const camera = new Map<string, EquipmentAlias>()
	const lens = new Map<string, EquipmentAlias>()
	for (const row of database.select().from(catalogEquipmentAliases).all()) {
		const target = row.kind === "camera" ? camera : lens
		target.set(row.sourceName, {
			displayName: row.displayName,
			focalLengthDisplay: row.focalLengthDisplay,
		})
	}
	return {camera, lens}
}

function effectiveEquipment(
	aliases: Map<string, EquipmentAlias>,
	make: string | null,
	model: string | null,
): {make: string | null; model: string | null} {
	const sourceName = `${make ?? ""} ${model ?? ""}`.trim()
	const alias = aliases.get(sourceName)
	return alias ? {make: null, model: alias.displayName} : {make, model}
}

async function readPds(did: string): Promise<{
	endpoint: string
	records: RefraktRemoteRecord[]
}> {
	const signal = AbortSignal.timeout(10_000)
	const didResponse = await fetch(
		`https://plc.directory/${encodeURIComponent(did)}`,
		{signal},
	)
	if (!didResponse.ok) {
		throw new Error(`Unable to resolve ${did}: ${didResponse.status}`)
	}
	const document = v.parse(DidDocumentSchema, await didResponse.json())
	const endpoint = pdsEndpoint(document)
	const records = await Promise.all(
		REFRAKT_COLLECTIONS.map((collection) =>
			readPdsCollection(endpoint, did, collection, signal),
		),
	)
	return {endpoint, records: records.flat()}
}

async function readPdsCollection(
	endpoint: string,
	did: string,
	collection: RefraktCollection,
	signal: AbortSignal,
): Promise<RefraktRemoteRecord[]> {
	const records: RefraktRemoteRecord[] = []
	let cursor: string | undefined
	do {
		const url = new URL("/xrpc/com.atproto.repo.listRecords", endpoint)
		url.searchParams.set("repo", did)
		url.searchParams.set("collection", collection)
		url.searchParams.set("limit", "100")
		if (cursor) {
			url.searchParams.set("cursor", cursor)
		}
		const response = await fetch(url, {signal})
		if (!response.ok) {
			throw new Error(`Unable to read ${collection}: ${response.status}`)
		}
		const page = v.parse(RemoteResponseSchema, await response.json())
		records.push(...page.records)
		cursor = page.cursor
	} while (cursor)
	return records
}

function pdsEndpoint(
	document: v.InferOutput<typeof DidDocumentSchema>,
): string {
	const service = document.service.find(
		(candidate) => candidate.type === "AtprotoPersonalDataServer",
	)
	if (!service) {
		throw new Error("DID document has no ATProto PDS")
	}
	return service.serviceEndpoint
}

function printPlan(input: {
	did: string
	root: string
	endpoint: string
	catalog: RefraktCatalogProjection
	remote: RefraktRemoteRecord[]
	plan: RefraktPlan
}): void {
	const {did, root, endpoint, catalog, remote, plan} = input
	console.log("Refrakt plan")
	console.log(`  DID: ${did}`)
	console.log(`  Root: ${root}`)
	console.log(`  PDS: ${endpoint}`)
	console.log(
		`  Catalog: ${catalog.photos.length} photos, ${catalog.albums.length} albums`,
	)
	console.log(`  Remote: ${remote.length} records`)
	printRecords("CREATE", plan.creates)
	printRecords("UPDATE", plan.updates)
	if (plan.unmatched.length > 0) {
		console.log("\nUNMATCHED REMOTE RECORDS (never deleted by plan mode)")
		for (const record of plan.unmatched) {
			console.log(`  ${record.uri}`)
		}
	}
	if (plan.warnings.length > 0) {
		console.log("\nWARNINGS")
		for (const warning of plan.warnings) {
			console.log(`  ${warning}`)
		}
	}
	console.log("\nSummary")
	console.log(`  Creates: ${plan.creates.length}`)
	console.log(`  Updates: ${plan.updates.length}`)
	console.log(`  Unchanged: ${plan.unchanged.length}`)
	console.log(`  Unmatched remote: ${plan.unmatched.length}`)
	console.log(`  Warnings: ${plan.warnings.length}`)
	console.log("\nPlan mode only. No records or blobs were written.")
}

function printRecords(heading: string, records: RefraktPlan["creates"]): void {
	if (records.length === 0) {
		return
	}
	console.log(`\n${heading}`)
	for (const record of records) {
		console.log(`  ${record.collection}/${record.rkey}`)
		console.log(`    ${record.label}`)
	}
}

function blobCid(sha256: string): string {
	if (!/^[0-9a-f]{64}$/i.test(sha256)) {
		throw new Error("Invalid source SHA-256")
	}
	return cidToString(fromDigest(CODEC_RAW, Buffer.from(sha256, "hex")))
}
