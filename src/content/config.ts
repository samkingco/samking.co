import { defineCollection, z } from "astro:content";

const postsCollection = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    date: z.date(),
    excerpt: z.string(),
  }),
});

export const collections = {
  posts: postsCollection,
};
