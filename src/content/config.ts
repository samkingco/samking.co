import { defineCollection, z } from "astro:content";

const postsCollection = defineCollection({
	type: "content",
	schema: z.object({
		title: z.string(),
		date: z.date(),
		excerpt: z.string(),
	}),
});

const nowCollection = defineCollection({
	type: "content",
	schema: z.object({
		date: z.date(),
		location: z.string(),
	}),
});

export const collections = {
	posts: postsCollection,
	now: nowCollection,
};

export const siteConfig = {
	domain: "samking.co",
	title: "Sam King",
	description:
		"Freelance software engineer and designer with over a decade of startup experience. Specializing in early-stage and creative projects, from concept to production. Based in Vancouver, Canada.",
	ogImage: "/og.png",
	refrakt: {
		handle: "sk",
	},
	youtube: {
		handle: "samkingco",
		channelId: "UCCihXYu_A9yA-TSAX5UpQfw",
	},
	bluesky: {
		handle: "samking.co",
	},
	substack: {
		handle: "samkingco",
	},
	github: {
		handle: "samkingco",
	},
	linkedin: {
		handle: "samkingco",
	},
	instagram: {
		handle: "samkingco",
	},
};
