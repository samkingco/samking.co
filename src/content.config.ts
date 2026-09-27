import {glob} from "astro/loaders"
import {z} from "astro/zod"
import {defineCollection} from "astro:content"
import {notesLoader} from "./loaders/notes.ts"
import {photoSetsLoader} from "./loaders/photo-sets.ts"
import {photosLoader} from "./loaders/photos.ts"
import {postsLoader} from "./loaders/posts.ts"
import {noteMetadataSchema} from "./repos/notes.ts"
import {postMetadataSchema} from "./repos/posts.ts"
import {siteConfig} from "./site.config"

const postsCollection = defineCollection({
	loader: postsLoader(),
	schema: postMetadataSchema,
})

const notesCollection = defineCollection({
	loader: notesLoader(),
	schema: noteMetadataSchema,
})

const nowCollection = defineCollection({
	loader: glob({pattern: "**/*.md", base: "./src/content/now"}),
	schema: z.object({
		date: z.date(),
		location: z.string(),
	}),
})

const freelanceCollection = defineCollection({
	loader: glob({pattern: "**/*.md", base: "./src/content/freelance"}),
	schema: z.object({
		title: z.string(),
	}),
})

const rightsCollection = defineCollection({
	loader: glob({pattern: "**/*.md", base: "./src/content/rights"}),
	schema: z.object({
		title: z.string(),
	}),
})

const cvCollection = defineCollection({
	loader: glob({pattern: "**/*.md", base: "./src/content/cv"}),
	schema: z.object({
		role: z.string(),
		company: z.string().optional(),
		period: z.string(),
		url: z.string().optional(),
		sortYear: z.number(),
	}),
})

const photosCollection = defineCollection({
	loader: siteConfig.photos.enabled ? photosLoader() : () => [],
})

const photoSetsCollection = defineCollection({
	loader: siteConfig.photos.enabled ? photoSetsLoader() : () => [],
})

export const collections = {
	posts: postsCollection,
	notes: notesCollection,
	now: nowCollection,
	freelance: freelanceCollection,
	rights: rightsCollection,
	cv: cvCollection,
	photos: photosCollection,
	photoSets: photoSetsCollection,
}
