import {and, eq, isNotNull} from "drizzle-orm"
import * as v from "valibot"
import {equipmentAliases, photos} from "./database-schema.ts"
import type {PhotoDatabase} from "./database.ts"
import {NormalizedMetadataSchema} from "./schema.ts"

export type EquipmentAlias = typeof equipmentAliases.$inferSelect

export function equipmentSource(
	make: string | null,
	model: string | null,
): string {
	return `${make ?? ""} ${model ?? ""}`.trim()
}

export function readEquipmentAliases(database: PhotoDatabase) {
	return new Map(
		database
			.select()
			.from(equipmentAliases)
			.all()
			.map((alias) => [`${alias.kind}:${alias.sourceName}`, alias]),
	)
}

export function resolveEquipment(
	aliases: ReturnType<typeof readEquipmentAliases>,
	kind: "camera" | "lens",
	make: string | null,
	model: string | null,
) {
	const source = equipmentSource(make, model)
	const alias = aliases.get(`${kind}:${source}`)
	return {
		make: alias ? null : make,
		model: alias ? alias.displayName : model,
		name: alias ? alias.displayName : source || null,
		focalLengthDisplay: alias?.focalLengthDisplay ?? "native",
	}
}

export function readEquipment(database: PhotoDatabase) {
	const rows = database
		.select({metadataJson: photos.metadataJson})
		.from(photos)
		.where(and(eq(photos.status, "active"), isNotNull(photos.metadataJson)))
		.all()
	const items = rows.flatMap((row) => {
		const metadata = v.parse(
			NormalizedMetadataSchema,
			JSON.parse(row.metadataJson!),
		)
		return (["camera", "lens"] as const).map((kind) => ({
			kind,
			sourceName: equipmentSource(
				metadata[`${kind}Make`],
				metadata[`${kind}Model`],
			),
		}))
	})
	return [
		...new Map(
			items
				.filter(({sourceName}) => sourceName)
				.map((item) => [`${item.kind}:${item.sourceName}`, item]),
		).values(),
	]
}

export function saveEquipmentAlias(
	database: PhotoDatabase,
	item: EquipmentAlias,
): void {
	database
		.insert(equipmentAliases)
		.values(item)
		.onConflictDoUpdate({
			target: [equipmentAliases.kind, equipmentAliases.sourceName],
			set: {
				displayName: item.displayName,
				...(item.kind === "camera"
					? {focalLengthDisplay: item.focalLengthDisplay}
					: {}),
			},
		})
		.run()
}
