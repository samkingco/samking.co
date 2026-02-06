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

const freelanceCollection = defineCollection({
	type: "content",
	schema: z.object({
		title: z.string(),
	}),
});

const cvCollection = defineCollection({
	type: "content",
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

export const siteConfig = {
	domain: "samking.co",
	title: "Sam King",
	description:
		"Freelance software engineer and designer with over 15 years of startup experience. Specializing in early-stage and creative projects, from concept to production. Based in Vancouver, Canada.",
	bio: [
		"I'm a freelance software engineer and designer with over 15 years of experience at various startups across a range of industries. I'm not currently available for new projects, but I'm always open to hearing about potential collaborations.",
		"When I'm not working, I'm usually out exploring with my camera, making friends with the local crows, and building games or working on numerous unfinished side projects.",
	],
	coreValues: "Honesty, authenticity, curiosity, veganism, socialism.",
	bigFanOf: "Old growth forests & mountains, crows, Alexisonfire.",
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
