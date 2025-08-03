import { readFileSync } from "node:fs";
import { getCollection } from "astro:content";
import type { APIRoute } from "astro";
import satori from "satori";
import { html } from "satori-html";
import sharp from "sharp";

export const prerender = true;

const avatarBase64 = readFileSync("public/avatar.png", "base64");
const commitMonoFont = readFileSync("public/fonts/CommitMono-400-Regular.ttf");
const commitMonoBold = readFileSync("public/fonts/CommitMono-700-Regular.ttf");

export const GET: APIRoute = async () => {
  const title = "Sam King";
  const excerpt = "Photography, Software, and Design\nVancouver, Canada";

  const markup = html(`<div
    style="height: 100%; width: 100%; padding: 80px; display: flex; flex-direction: column; gap: 60px; background-color: rgb(0,0,0); justify-content: flex-end;"
  >
    <img src="data:image/png;base64,${avatarBase64}" width="240" height="240" />
    <div style="display: flex; flex-direction: column;">
      <div style="display: flex; flex-direction: column;">
        <div
          style="font-size: 40px; line-height: 40px; font-family: CommitMono; font-weight: 700; color: white; margin-bottom: 20px;"
        >
          ${title}
        </div>

        ${excerpt.split("\n").map(
          (line) => `<div
          style="font-size: 40px; line-height: 40px; font-family: CommitMono; color: white; opacity: 0.5;"
        >
          ${line}
        </div>`,
        )}
      </div>
    </div>
  </div>`);

  const svg = await satori(markup, {
    width: 1200,
    height: 630,
    fonts: [
      {
        name: "CommitMono",
        data: commitMonoFont,
        style: "normal",
        weight: 400,
      },
      {
        name: "CommitMono",
        data: commitMonoBold,
        style: "normal",
        weight: 700,
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
      "Content-Disposition": "inline; filename=og.png",
    },
  });
};
