# [samking.co](https://samking.co)

My personal site. Writing, notes, photography, and a few other things.

Built with [Astro](https://astro.build), [TypeScript](https://www.typescriptlang.org), and [Tailwind CSS](https://tailwindcss.com). Hosted on Cloudflare Pages.

## How it works

Posts and notes are Markdown files. The [content CLI](src/cli/index.ts#L26) creates them with the frontmatter the site needs, and [Astro](src/content.config.ts#L1) builds the pages and RSS feeds.

I also manage photos in Capture One. [Photo sync](docs/photos.md) reads my collections and JPEG exports, generates images for the site, and stores the metadata in SQLite. Astro builds the photo pages from that database. The images are served from R2, or from local files during development.

Photo pages are currently disabled while I cull and re-edit photos after moving from Lightroom.

The CLI can also [publish notes to Bluesky](docs/atproto.md) from the same Markdown files. It compares them with existing posts so I can review changes before publishing. There’s a record planner for [Refrakt](https://refrakt.app) too, though publishing photos there isn’t implemented yet.

Bluesky publishing uses an app password for now. I might add OAuth later.

For the Markdown readers and writers, see [notes.ts](src/repos/notes.ts#L28) and [posts.ts](src/repos/posts.ts#L17). The [loaders](src/loaders/notes.ts#L6) connect those functions to Astro.

## Run locally

With a current version of Node.js and pnpm:

```sh
pnpm install
pnpm dev
```

```sh
pnpm content       # Content tools
pnpm build         # Static build
pnpm test          # Tests
pnpm lint          # Lint and type checks
```

Settings are in [`src/site.config.ts`](src/site.config.ts#L1). Photo pages need a local catalog and exported images; see the [photo setup](docs/photos.md#using-this-elsewhere).
