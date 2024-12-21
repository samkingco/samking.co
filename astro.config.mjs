import sitemap from "@astrojs/sitemap";
import tailwind from "@astrojs/tailwind";
import { defineConfig } from "astro/config";
import { FontaineTransform } from "fontaine";

export default defineConfig({
	site: "https://samking.co",
	output: "static",
	integrations: [tailwind(), sitemap()],
	vite: {
		plugins: [
			FontaineTransform.vite({
				fallbacks: ["Arial"],
				resolvePath: (id) => new URL(`./public${id}`, import.meta.url),
			}),
		],
	},
});
