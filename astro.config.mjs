import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { FontaineTransform } from "fontaine";
import { rehypeImages } from "./src/utils/rehype-images.mjs";

export default defineConfig({
	site: "https://samking.co",
	output: "static",
	image: {
		layout: "constrained",
	},
	integrations: [sitemap()],
	markdown: {
		rehypePlugins: [rehypeImages],
	},
	vite: {
		plugins: [
			tailwindcss(),
			FontaineTransform.vite({
				fallbacks: ["Arial"],
				resolvePath: (id) => new URL(`./public${id}`, import.meta.url),
			}),
		],
	},
});
