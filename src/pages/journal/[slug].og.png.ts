import { readFileSync } from "node:fs";
import { getCollection } from "astro:content";
import type { APIRoute } from "astro";
import satori from "satori";
import { html } from "satori-html";
import sharp from "sharp";
import { formatDate } from "../../utils/dates";

export const prerender = true;

const bodyFont = readFileSync(`${process.cwd()}/public/fonts/Text.woff`);
const monoFont = readFileSync(`${process.cwd()}/public/fonts/Mono.woff`);

export async function getStaticPaths() {
	const entries = await getCollection("posts");
	return entries.map((entry) => ({
		params: { slug: entry.slug },
		props: { entry },
	}));
}

export const GET: APIRoute = async ({ props }) => {
	const post = props.entry;

	const title = post.data.title;
	const excerpt = post.data.excerpt;
	const date = post.data.date;

	const markup = html(`<div
    style="height: 100%; width: 100%; padding: 80px; display: flex; flex-direction: column; justify-content: space-between; background-color: rgb(0,0,0);"
  >
    <div style="display: flex; flex-direction: column;">
      <div
        style="font-size: 32px; font-family: Mono; line-height: 56px; margin-top: 16px; display: flex; flex-direction: column; color: white; opacity: 0.5;"
      >
        ${formatDate(date)}
      </div>
      <div
        style="font-size: 64px; font-family: Text; display: flex; flex-direction: column; color: white;"
      >
        ${title}
      </div>
      <div
        style="font-size: 40px; font-family: Text; line-height: 56px; margin-top: 16px; display: flex; flex-direction: column; color: white; opacity: 0.5;"
      >
        ${excerpt.slice(0, 160)}${excerpt.length > 160 ? "…" : ""}
      </div>
    </div>

    <div
      style="font-size: 32px; font-family: Text; line-height: 56px; margin-top: 16px; display: flex; flex-direction: column; color: white; opacity: 0.5;"
    >
      samking.co
    </div>
  </div>`);

	const svg = await satori(markup, {
		width: 1200,
		height: 630,
		fonts: [
			{
				name: "Text",
				data: bodyFont,
				style: "normal",
			},
			{
				name: "Mono",
				data: monoFont,
				style: "normal",
			},
		],
	});

	const png = await sharp(Buffer.from(svg)).png().toBuffer();

	return new Response(png, {
		status: 200,
		headers: {
			"Content-Type": "image/png",
			"Content-Length": png.byteLength.toString(),
			"Cache-Control": "s-maxage=1, stale-while-revalidate=59",
			"Content-Disposition": `inline; filename=og_${post.slug}.png`,
		},
	});
};
