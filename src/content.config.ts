import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const postsCollection = defineCollection({
	loader: glob({ pattern: "**/*.md", base: "./src/content/posts" }),
	schema: z.object({
		title: z.string(),
		date: z.date(),
		excerpt: z.string(),
	}),
});

const nowCollection = defineCollection({
	loader: glob({ pattern: "**/*.md", base: "./src/content/now" }),
	schema: z.object({
		date: z.date(),
		location: z.string(),
	}),
});

const freelanceCollection = defineCollection({
	loader: glob({ pattern: "**/*.md", base: "./src/content/freelance" }),
	schema: z.object({
		title: z.string(),
	}),
});

const cvCollection = defineCollection({
	loader: glob({ pattern: "**/*.md", base: "./src/content/cv" }),
	schema: z.object({
		role: z.string(),
		company: z.string().optional(),
		period: z.string(),
		url: z.string().optional(),
		sortYear: z.number(),
	}),
});

export const collections = {
	posts: postsCollection,
	now: nowCollection,
	freelance: freelanceCollection,
	cv: cvCollection,
};
