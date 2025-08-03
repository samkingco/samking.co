import sitemap from "@astrojs/sitemap";
import tailwind from "@astrojs/tailwind";
import { defineConfig } from "astro/config";
import { FontaineTransform } from "fontaine";
import { rehypeImageCaptions } from "./src/utils/rehype-image-captions.mjs";

export default defineConfig({
	site: "https://samking.co",
	output: "static",
	integrations: [tailwind(), sitemap()],
	markdown: {
		rehypePlugins: [rehypeImageCaptions],
	},
	vite: {
		plugins: [
			FontaineTransform.vite({
				fallbacks: ["Arial"],
				resolvePath: (id) => new URL(`./public${id}`, import.meta.url),
			}),
		],
	},
});
