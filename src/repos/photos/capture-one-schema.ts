import {integer, real, sqliteTable, text} from "drizzle-orm/sqlite-core"

export const versionInfo = sqliteTable("ZVERSIONINFO", {
	id: integer("Z_PK").primaryKey(),
	version: integer("ZVERSION").notNull(),
	format: text("ZFORMAT").notNull(),
})

export const captureOneCollections = sqliteTable("ZCOLLECTION", {
	id: integer("Z_PK").primaryKey(),
	parentId: integer("ZPARENT").notNull(),
	name: text("ZNAME").notNull(),
	sortOrder: text("ZSORTORDER").notNull(),
	collectionIndex: real("ZCOLLECTIONINDEX").notNull(),
	entityId: integer("Z_ENT").notNull(),
})

export const documentContent = sqliteTable("ZDOCUMENTCONTENT", {
	id: integer("Z_PK").primaryKey(),
	rootCollectionId: integer("ZROOTCOLLECTION").notNull(),
})

export const entities = sqliteTable("ZENTITIES", {
	id: integer("Z_ENT").primaryKey(),
	name: text("ZNAME").notNull(),
})

export const variantCollections = sqliteTable("ZVARIANTINCOLLECTION", {
	id: integer("Z_PK").primaryKey(),
	collectionId: integer("ZCOLLECTION").notNull(),
	variantId: integer("ZVARIANT").notNull(),
})

export const variants = sqliteTable("ZVARIANT", {
	id: integer("Z_PK").primaryKey(),
	imageId: integer("ZIMAGE").notNull(),
})

export const images = sqliteTable("ZIMAGE", {
	id: integer("Z_PK").primaryKey(),
	displayName: text("ZDISPLAYNAME").notNull(),
	filename: text("ZIMAGEFILENAME").notNull(),
	locationId: integer("ZIMAGELOCATION"),
	captureDate: real("ZEXP_DATE"),
})

export const pathLocations = sqliteTable("ZPATHLOCATION", {
	id: integer("Z_PK").primaryKey(),
	macRoot: text("ZMACROOT"),
	relativePath: text("ZRELATIVEPATH"),
})

export const imageCollectionProperties = sqliteTable(
	"ZIMAGEINCOLLECTIONPROPERTIES",
	{
		id: integer("Z_PK").primaryKey(),
		collectionId: integer("ZCOLLECTION").notNull(),
		imageId: integer("ZIMAGE").notNull(),
		manualIndex: real("ZMANUALSORTINDEX"),
	},
)

export const processHistory = sqliteTable("ZPROCESSHISTORY", {
	id: integer("Z_PK").primaryKey(),
	variantId: integer("ZVARIANT").notNull(),
	date: real("ZDATE").notNull(),
	url: text("ZURL").notNull(),
})
