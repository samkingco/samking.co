import {existsSync} from "node:fs"
import {resolve} from "node:path"
import type {Loader} from "astro/loaders"
import * as v from "valibot"
import {readWebsiteCatalog} from "../repos/photos/catalog.ts"
import {
	openReadonlyPhotoDatabase,
	PHOTO_DATABASE_PATH,
} from "../repos/photos/database.ts"
import {PhotoSetEntrySchema} from "../repos/photos/schema.ts"
import {siteConfig} from "../site.config.ts"
import {slugify} from "../utils/slugify.ts"

export function photoSetsLoader(): Loader {
	const path = resolve(PHOTO_DATABASE_PATH)
	return {
		name: "photoSets-sqlite",
		async load(context) {
			const reload = () => {
				if (!existsSync(path)) {
					context.store.clear()
					if (context.watcher) {
						return
					}
					throw new Error(
						"Photo database is missing. Run pnpm content photos sync first.",
					)
				}
				const database = openReadonlyPhotoDatabase(path)
				try {
					const catalog = readWebsiteCatalog(
						database,
						siteConfig.photos,
						Boolean(context.watcher),
					)
					const entries = catalog.albums.map((album) =>
						v.parse(PhotoSetEntrySchema, {
							id: album.id,
							slug: slugify(album.name) || "item",
							title: album.name,
							description: album.description,
							position: album.position,
							photoIds: album.photoIds,
						}),
					)
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
			reload()
			context.watcher?.add(path)
			for (const event of ["add", "change", "unlink"] as const) {
				context.watcher?.on(event, (changed) => {
					if (resolve(changed) === path) {
						reload()
					}
				})
			}
		},
	}
}
