import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { readFileSync } from "fs";
import satori from "satori";
import { html } from "satori-html";
import sharp from "sharp";

export const prerender = false;

const avatarBase64 = readFileSync(
  `${process.cwd()}/public/avatar.png`,
  "base64"
);

export async function getStaticPaths() {
  const entries = await getCollection("posts");
  return entries.map((entry) => ({
    params: { slug: entry.slug },
    props: { entry },
  }));
}

export const GET: APIRoute = async () => {
  const title = "Sam King";
  const excerpt = "Photography, Software, and Design\nVancouver, Canada";

  const displayFontPath = `${process.cwd()}/public/fonts/Nikolai-Italic.woff`;
  const displayFont = readFileSync(displayFontPath);

  const bodyFontPath = `${process.cwd()}/public/fonts/Text.woff`;
  const bodyFont = readFileSync(bodyFontPath);

  const monoFontPath = `${process.cwd()}/public/fonts/Mono.woff`;
  const monoFont = readFileSync(monoFontPath);

  const markup = html(`<div
    style="height: 100%; width: 100%; padding: 80px; display: flex; flex-direction: row; align-items: flex-end; justify-content: space-between; background-color: rgb(0,0,0);"
  >
    <div style="display: flex; flex-direction: column;">
      <div style="display: flex; flex-direction: column; padding-bottom: 40px;">
        <div
          style="font-size: 96px; line-height: 1; font-family: Nikolai; display: flex; flex-direction: column; color: white; margin-bottom: 16px;"
        >
          ${title}
        </div>

        ${excerpt.split("\n").map(
          (line) => `<div
          style="font-size: 40px; font-family: Text; line-height: 1; display: flex; flex-direction: column; color: white; opacity: 0.5;"
        >
          ${line}
        </div>`
        )}
      </div>
    </div>

    <img src="data:image/png;base64,${avatarBase64}" style="margin-left: 80px;" width="380" height="380" />
  </div>`);

  const svg = await satori(markup, {
    width: 1200,
    height: 630,
    fonts: [
      {
        name: "Nikolai",
        data: displayFont,
        style: "italic",
      },
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

  const png = sharp(Buffer.from(svg)).png();
  const response = await png.toBuffer();

  return new Response(response, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Length": response.byteLength.toString(),
      "Cache-Control": "s-maxage=1, stale-while-revalidate=59",
      "Content-Disposition": "inline; filename=og.png",
    },
  });
};
