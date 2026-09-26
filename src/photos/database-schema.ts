import {sql} from "drizzle-orm"
import {
	check,
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core"

export const catalog = sqliteTable(
	"catalog",
	{
		id: integer().primaryKey(),
		documentId: text("document_id").notNull(),
		syncedAt: text("synced_at").notNull(),
	},
	(table) => [check("catalog_check_1", sql`${table.id} = 1`)],
)

export const collections = sqliteTable(
	"collections",
	{
		id: text().primaryKey(),
		parentId: text("parent_id").notNull(),
		name: text().notNull(),
		kind: text().notNull(),
		position: integer().notNull(),
		sortOrder: text("sort_order").notNull(),
		reversed: integer({mode: "boolean"}).notNull(),
		description: text().notNull().default(""),
		createdAt: text("created_at").notNull(),
		updatedAt: text("updated_at").notNull(),
	},
	(table) => [check("collections_check_2", sql`${table.reversed} IN (0, 1)`)],
)

export const collectionRoots = sqliteTable("collection_roots", {
	collectionId: text("collection_id")
		.primaryKey()
		.references(() => collections.id),
	addedAt: text("added_at").notNull(),
})

export const photos = sqliteTable(
	"photos",
	{
		id: text().primaryKey(),
		captureOneVariantId: text("capture_one_variant_id").notNull().unique(),
		captureOneVariantName: text("capture_one_variant_name").notNull(),
		metadataJson: text("metadata_json"),
		status: text({enum: ["active", "deleted"]}).notNull(),
		createdAt: text("created_at").notNull(),
		updatedAt: text("updated_at").notNull(),
	},
	(table) => [
		check("photos_check_3", sql`${table.status} IN ('active', 'deleted')`),
		index("photos_status_idx").on(table.status),
	],
)

export const collectionPhotos = sqliteTable(
	"collection_photos",
	{
		collectionId: text("collection_id")
			.notNull()
			.references(() => collections.id),
		photoId: text("photo_id")
			.notNull()
			.references(() => photos.id),
		position: integer().notNull(),
	},
	(table) => [
		primaryKey({
			columns: [table.collectionId, table.photoId],
			name: "collection_photos_pk",
		}),
		uniqueIndex("collection_photos_position_unique").on(
			table.collectionId,
			table.position,
		),
	],
)

export const photoExports = sqliteTable(
	"photo_exports",
	{
		id: integer().primaryKey(),
		photoId: text("photo_id")
			.notNull()
			.references(() => photos.id),
		captureOneOutputId: text("capture_one_output_id").notNull(),
		profile: text().notNull(),
		sourcePath: text("source_path").notNull(),
		filename: text().notNull(),
		sha256: text().notNull(),
		byteSize: integer("byte_size").notNull(),
		mimeType: text("mime_type").notNull(),
		width: integer().notNull(),
		height: integer().notNull(),
		metadataJson: text("metadata_json").notNull(),
		rawMetadataJson: text("raw_metadata_json").notNull(),
		current: integer({mode: "boolean"}).notNull(),
		deletedAt: text("deleted_at"),
		createdAt: text("created_at").notNull(),
	},
	(table) => [
		uniqueIndex("photo_exports_revision_unique").on(
			table.photoId,
			table.profile,
			table.sha256,
		),
		uniqueIndex("photo_exports_current_idx")
			.on(table.photoId, table.profile)
			.where(sql`${table.current} = 1`),
		check("photo_exports_check_6", sql`${table.current} IN (0, 1)`),
		index("photo_exports_deleted_idx").on(table.deletedAt),
	],
)

export const photoDerivatives = sqliteTable(
	"photo_derivatives",
	{
		id: integer().primaryKey(),
		exportId: integer("export_id")
			.notNull()
			.references(() => photoExports.id),
		kind: text({enum: ["source", "thumb", "detail", "og"]}).notNull(),
		path: text().notNull(),
		r2Key: text("r2_key").notNull(),
		sha256: text().notNull(),
		byteSize: integer("byte_size").notNull(),
		mimeType: text("mime_type").notNull(),
		width: integer().notNull(),
		height: integer().notNull(),
		uploadedAt: text("uploaded_at"),
		deletedAt: text("deleted_at"),
		createdAt: text("created_at").notNull(),
	},
	(table) => [
		uniqueIndex("photo_derivatives_export_kind_unique")
			.on(table.exportId, table.kind)
			.where(sql`${table.deletedAt} IS NULL`),
		uniqueIndex("photo_derivatives_r2_key_unique").on(table.r2Key),
		check(
			"photo_derivatives_check_7",
			sql`${table.kind} IN ('source', 'thumb', 'detail', 'og')`,
		),
		index("photo_derivatives_pending_idx").on(
			table.uploadedAt,
			table.deletedAt,
		),
	],
)

export const equipmentAliases = sqliteTable(
	"equipment_aliases",
	{
		kind: text({enum: ["camera", "lens"]}).notNull(),
		sourceName: text("source_name").notNull(),
		displayName: text("display_name").notNull(),
		focalLengthDisplay: text("focal_length_display", {
			enum: ["native", "35mm"],
		})
			.notNull()
			.default("native"),
	},
	(table) => [
		primaryKey({
			columns: [table.kind, table.sourceName],
			name: "equipment_aliases_pk",
		}),
		check(
			"equipment_aliases_check_4",
			sql`${table.kind} IN ('camera', 'lens')`,
		),
		check(
			"equipment_aliases_check_5",
			sql`${table.focalLengthDisplay} IN ('native', '35mm')`,
		),
	],
)
