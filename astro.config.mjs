import {createReadStream, readdirSync} from "node:fs"
import {stat} from "node:fs/promises"
import {extname, isAbsolute, relative, resolve} from "node:path"
import {satteri} from "@astrojs/markdown-satteri"
import sitemap from "@astrojs/sitemap"
import tailwindcss from "@tailwindcss/vite"
import {defineConfig} from "astro/config"
import {FontaineTransform} from "fontaine"
import {siteConfig} from "./src/site.config.ts"
import {markdownImages} from "./src/utils/markdown-images.mjs"

const PHOTO_OBJECT_ROOT = resolve("photos/objects")

function localPhotoPath(url) {
	const pathname = decodeURIComponent(
		new URL(url, "http://localhost").pathname,
	).replace(/^\/photos\//, "/")
	const path = resolve(PHOTO_OBJECT_ROOT, `.${pathname}`)
	const pathFromRoot = relative(PHOTO_OBJECT_ROOT, path)
	return pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot) ? null : path
}

async function serveLocalPhoto(request, response, next) {
	if (request.method !== "GET" && request.method !== "HEAD") {
		next()
		return
	}

	const path = localPhotoPath(request.url ?? "/")
	if (!path) {
		response.statusCode = 403
		response.end()
		return
	}

	try {
		const metadata = await stat(path)
		if (!metadata.isFile()) {
			next()
			return
		}
		response.setHeader("Content-Length", metadata.size)
		response.setHeader(
			"Content-Type",
			extname(path) === ".webp" ? "image/webp" : "image/jpeg",
		)
		if (request.method === "HEAD") {
			response.end()
			return
		}
		createReadStream(path).pipe(response)
	} catch (error) {
		if (error?.code === "ENOENT") {
			next()
			return
		}
		next(error)
	}
}

const localPhotos = {
	name: "local-photos",
	configureServer(server) {
		server.middlewares.use("/cdn", serveLocalPhoto)
	},
}

const photoRoutes = {
	name: "photo-routes",
	hooks: {
		"astro:config:setup"({injectRoute}) {
			for (const file of readdirSync(
				new URL("./src/photo-pages/photos/", import.meta.url),
				{recursive: true},
			)) {
				if (!file.endsWith(".astro")) continue
				const route = file
					.replace(/(^|\/)index\.astro$/, "$1")
					.replace(/\.astro$/, "")
				injectRoute({
					pattern: `/photos/${route}`,
					entrypoint: new URL(
						`./src/photo-pages/photos/${file}`,
						import.meta.url,
					),
				})
			}
		},
	},
}

export default defineConfig({
	site: "https://samking.co",
	output: "static",
	// Preserve Astro 6's whitespace handling between inline elements.
	compressHTML: true,
	image: {
		layout: "constrained",
	},
	integrations: [
		sitemap(),
		...(siteConfig.photos.enabled ? [photoRoutes] : []),
	],
	markdown: {
		processor: satteri({hastPlugins: [markdownImages]}),
	},
	vite: {
		plugins: [
			tailwindcss(),
			...(siteConfig.photos.enabled ? [localPhotos] : []),
			FontaineTransform.vite({
				fallbacks: ["Arial"],
				resolvePath: (id) => new URL(`./public${id}`, import.meta.url),
			}),
		],
	},
})
