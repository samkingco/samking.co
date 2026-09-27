import {homedir} from "node:os"
import {basename, join, resolve} from "node:path"
import {DatabaseSync} from "node:sqlite"
import {fileURLToPath} from "node:url"
import {and, asc, desc, eq, inArray} from "drizzle-orm"
import {drizzle} from "drizzle-orm/node-sqlite"
import * as v from "valibot"
import {siteConfig} from "../../site.config.ts"
import {
	captureOneCollections,
	variants as captureOneVariants,
	documentContent,
	entities,
	imageCollectionProperties,
	images,
	processHistory,
	variantCollections,
	versionInfo,
} from "./capture-one-schema.ts"
const OutputEventSchema = v.object({
	id: v.string(),
	path: v.string(),
})

const CaptureOneVariantSchema = v.object({
	id: v.string(),
	name: v.string(),
	outputs: v.array(OutputEventSchema),
})

export type CaptureOneVariant = v.InferOutput<typeof CaptureOneVariantSchema>

const CaptureOneCollectionMemberSchema = v.object({
	index: v.pipe(v.number(), v.integer(), v.minValue(1)),
	variantId: v.string(),
})

const CaptureOneCollectionSchema = v.object({
	index: v.pipe(v.number(), v.integer(), v.minValue(1)),
	id: v.string(),
	parentId: v.string(),
	name: v.string(),
	kind: v.string(),
	sort: v.string(),
	reversed: v.boolean(),
	members: v.array(CaptureOneCollectionMemberSchema),
})

export type CaptureOneCollection = v.InferOutput<
	typeof CaptureOneCollectionSchema
>

const CaptureOneSnapshotSchema = v.object({
	documentId: v.string(),
	variants: v.array(CaptureOneVariantSchema),
	collections: v.array(CaptureOneCollectionSchema),
})

export type CaptureOneSnapshot = v.InferOutput<typeof CaptureOneSnapshotSchema>

const SUPPORTED_CATALOG_VERSION = 160800

const COLLECTION_KINDS: Record<string, string> = {
	AlbumCollection: "album",
	ProjectCollection: "project",
	SmartCollection: "smart album",
	VirtualFolderCollection: "group",
}

const SORT_ORDERS: Record<string, string> = {
	"-": "by manual",
	date: "by date",
	filename: "by name",
}

type CaptureOneDatabase = ReturnType<typeof openCaptureOneDatabase>

type MemberRow = ReturnType<typeof readMembers>[number]

export async function readCaptureOneRoots(): Promise<CaptureOneSnapshot> {
	return readCaptureOne(null)
}

export async function readCaptureOneSnapshot(
	rootIds: string[],
): Promise<CaptureOneSnapshot> {
	if (rootIds.length === 0) {
		throw new Error(
			'Choose Capture One collections with "pnpm content photos setup" first.',
		)
	}
	return readCaptureOne(rootIds)
}

function readCaptureOne(rootIds: string[] | null): CaptureOneSnapshot {
	const configured = siteConfig.photos.captureOneCatalogPath
	const packagePath = configured.startsWith("~/")
		? join(homedir(), configured.slice(2))
		: resolve(configured)
	const databasePath = join(
		packagePath,
		`${basename(packagePath, ".cocatalog")}.cocatalogdb`,
	)
	const database = openCaptureOneDatabase(databasePath)

	try {
		validateCatalog(database)

		const allCollections = readCollections(database)
		const collections = rootIds
			? selectedCollections(allCollections, rootIds)
			: allCollections
		const variants = rootIds ? readVariants(database, collections) : []

		return v.parse(CaptureOneSnapshotSchema, {
			documentId: packagePath,
			collections,
			variants,
		})
	} catch (error) {
		throw new Error(
			`Could not read Capture One catalog at ${databasePath}: ${error instanceof Error ? error.message : String(error)}`,
			{cause: error},
		)
	} finally {
		database.$client.close()
	}
}

function openCaptureOneDatabase(path: string) {
	const client = new DatabaseSync(path, {readOnly: true})
	client.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000")
	return drizzle({client})
}

function validateCatalog(database: CaptureOneDatabase): void {
	const row = database
		.select({version: versionInfo.version, format: versionInfo.format})
		.from(versionInfo)
		.orderBy(desc(versionInfo.id))
		.limit(1)
		.get()

	if (!row) {
		throw new Error("Capture One catalog has no version information")
	}

	if (row.version !== SUPPORTED_CATALOG_VERSION) {
		throw new Error(
			`Unsupported Capture One catalog ${row.format} (${row.version})`,
		)
	}
}

function readCollections(database: CaptureOneDatabase): CaptureOneCollection[] {
	const projects = database
		.select({id: captureOneCollections.id})
		.from(captureOneCollections)
		.innerJoin(
			documentContent,
			eq(captureOneCollections.parentId, documentContent.rootCollectionId),
		)
		.where(eq(captureOneCollections.name, "Projects"))
		.limit(1)
		.get()

	if (!projects) {
		throw new Error("Capture One catalog has no Projects collection")
	}

	const rows = database
		.select({
			id: captureOneCollections.id,
			parentId: captureOneCollections.parentId,
			name: captureOneCollections.name,
			entityName: entities.name,
			sortOrder: captureOneCollections.sortOrder,
			collectionIndex: captureOneCollections.collectionIndex,
		})
		.from(captureOneCollections)
		.innerJoin(entities, eq(entities.id, captureOneCollections.entityId))
		.where(inArray(entities.name, Object.keys(COLLECTION_KINDS)))
		.orderBy(asc(captureOneCollections.collectionIndex))
		.all()

	const children = Map.groupBy(rows, ({parentId}) => parentId)
	const treeIds = new Set([projects.id])
	const pending = [projects.id]
	while (pending.length > 0) {
		for (const row of children.get(pending.pop()!) ?? []) {
			treeIds.add(row.id)
			pending.push(row.id)
		}
	}

	const siblingIndexes = new Map<number, number>()
	return rows
		.filter((row) => row.id !== projects.id && treeIds.has(row.id))
		.map((row) => {
			const kind = COLLECTION_KINDS[row.entityName]
			if (!kind) {
				throw new Error(
					`Unsupported Capture One collection kind: ${row.entityName}`,
				)
			}

			const index = (siblingIndexes.get(row.parentId) ?? 0) + 1
			siblingIndexes.set(row.parentId, index)

			return {
				index,
				id: String(row.id),
				parentId: String(row.parentId),
				name: row.name,
				kind,
				sort: SORT_ORDERS[row.sortOrder] ?? row.sortOrder,
				reversed: false,
				members: [],
			}
		})
}

function selectedCollections(
	collections: CaptureOneCollection[],
	rootIds: string[],
): CaptureOneCollection[] {
	const byId = new Map(
		collections.map((collection) => [collection.id, collection]),
	)
	const children = Map.groupBy(collections, ({parentId}) => parentId)
	const selected = new Set<string>()
	const pending = [...rootIds]

	while (pending.length > 0) {
		const id = pending.pop()!

		if (selected.has(id)) {
			continue
		}

		if (!byId.has(id)) {
			throw new Error(`Capture One collection ${id} was not found`)
		}

		selected.add(id)
		pending.push(...(children.get(id) ?? []).map(({id: childId}) => childId))
	}

	return collections.filter(({id}) => selected.has(id))
}

function readVariants(
	database: CaptureOneDatabase,
	collections: CaptureOneCollection[],
): CaptureOneVariant[] {
	const memberCollections = collections.filter(
		({kind}) => kind === "album" || kind === "smart album",
	)

	if (memberCollections.length === 0) {
		return []
	}

	const members = readMembers(database, memberCollections)
	const variants = new Map<string, CaptureOneVariant>()

	for (const collection of memberCollections) {
		const ordered = members
			.filter(({collectionId}) => collectionId === collection.id)
			.sort((left, right) => compareMembers(left, right, collection.sort))
		collection.members = ordered.map(({variantId}, index) => ({
			index: index + 1,
			variantId,
		}))

		for (const row of ordered) {
			addVariant(variants, row)
		}
	}

	readOutputs(database, variants)

	return [...variants.values()]
}

function addVariant(
	variants: Map<string, CaptureOneVariant>,
	row: MemberRow,
): void {
	if (variants.has(row.variantId)) {
		return
	}

	variants.set(row.variantId, {
		id: row.variantId,
		name: row.name,
		outputs: [],
	})
}

function readMembers(
	database: CaptureOneDatabase,
	collections: CaptureOneCollection[],
) {
	return database
		.select({
			collectionId: variantCollections.collectionId,
			variantId: captureOneVariants.id,
			name: images.displayName,
			filename: images.filename,
			manualIndex: imageCollectionProperties.manualIndex,
			captureDate: images.captureDate,
		})
		.from(variantCollections)
		.innerJoin(
			captureOneVariants,
			eq(captureOneVariants.id, variantCollections.variantId),
		)
		.innerJoin(images, eq(images.id, captureOneVariants.imageId))
		.leftJoin(
			imageCollectionProperties,
			and(
				eq(
					imageCollectionProperties.collectionId,
					variantCollections.collectionId,
				),
				eq(imageCollectionProperties.imageId, images.id),
			),
		)
		.where(
			inArray(
				variantCollections.collectionId,
				collections.map(({id}) => Number(id)),
			),
		)
		.all()
		.map((row) => ({
			collectionId: String(row.collectionId),
			variantId: String(row.variantId),
			name: row.name,
			filename: row.filename,
			manualIndex: row.manualIndex,
			captureDate: row.captureDate,
		}))
}

function compareMembers(
	left: MemberRow,
	right: MemberRow,
	sort: string,
): number {
	if (sort === "by manual") {
		return (left.manualIndex ?? 0) - (right.manualIndex ?? 0)
	}

	if (sort === "by name") {
		return left.filename.localeCompare(right.filename)
	}

	return (left.captureDate ?? 0) - (right.captureDate ?? 0)
}

function readOutputs(
	database: CaptureOneDatabase,
	variants: Map<string, CaptureOneVariant>,
): void {
	if (variants.size === 0) {
		return
	}

	const rows = database
		.select({
			id: processHistory.id,
			variantId: processHistory.variantId,
			url: processHistory.url,
		})
		.from(processHistory)
		.where(inArray(processHistory.variantId, [...variants.keys()].map(Number)))
		.orderBy(
			asc(processHistory.variantId),
			asc(processHistory.date),
			asc(processHistory.id),
		)
		.all()

	for (const row of rows) {
		const variantId = String(row.variantId)
		const variant = variants.get(variantId)
		if (!variant) {
			throw new Error(`Output references unknown variant ${variantId}`)
		}

		variant.outputs.push({
			id: String(row.id),
			path: row.url.startsWith("file:") ? fileURLToPath(row.url) : row.url,
		})
	}
}
