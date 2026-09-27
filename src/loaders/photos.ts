import {existsSync} from "node:fs"
import {resolve} from "node:path"
import type {Loader} from "astro/loaders"
import * as v from "valibot"
import {readWebsiteCatalog} from "../repos/photos/catalog.ts"
import {
	openReadonlyPhotoDatabase,
	PHOTO_DATABASE_PATH,
} from "../repos/photos/database.ts"
import {PHOTO_CDN_URL} from "../repos/photos/r2.ts"
import {PhotoEntrySchema} from "../repos/photos/schema.ts"
import {siteConfig} from "../site.config.ts"

/** Only Astro storage, watching, and output URLs belong in this adapter. */
export function photosLoader(): Loader {
	const path = resolve(PHOTO_DATABASE_PATH)
	return {
		name: "photos-sqlite",
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
					const mediaRoot = context.watcher ? "/cdn" : PHOTO_CDN_URL
					const entries = catalog.photos.map((photo) => {
						const urls = Object.fromEntries(
							photo.derivatives.map(({kind, r2Key}) => [
								`${kind}Url`,
								`${mediaRoot}/${r2Key}`,
							]),
						)
						return v.parse(PhotoEntrySchema, {
							id: photo.id,
							name: photo.name,
							position: photo.position,
							sha256: photo.selectedExport.sha256,
							...urls,
							cameraName: photo.camera.name,
							lensName: photo.lens.name,
							displayFocalLength: photo.displayFocalLength,
							metadata: photo.metadata,
						})
					})
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
