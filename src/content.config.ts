import {glob} from "astro/loaders"
import {z} from "astro/zod"
import {defineCollection} from "astro:content"
import {photoSetsLoader, photosLoader} from "./photos/loader"
import {siteConfig} from "./site.config"

const postsCollection = defineCollection({
	loader: glob({pattern: "**/*.md", base: "./src/content/posts"}),
	schema: z.object({
		title: z.string(),
		date: z.date(),
		excerpt: z.string(),
	}),
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
	now: nowCollection,
	freelance: freelanceCollection,
	rights: rightsCollection,
	cv: cvCollection,
	photos: photosCollection,
	photoSets: photoSetsCollection,
}
