# [samking.co](https://samking.co)

My personal site. Writing, notes, photography, and a few other things.

Built with [Astro](https://astro.build), [TypeScript](https://www.typescriptlang.org), and [Tailwind CSS](https://tailwindcss.com). Hosted on Cloudflare Pages.

## A few details

- **Capture One.** Imports collections, photo order, and exports from my catalog.
- **Offline photo workflow.** Sync and preview photos locally, then upload to R2 when online. The SQLite catalog is backed up to R2 too.
- **AT Protocol.** Publishes Markdown notes to Bluesky, with a preview before publishing. Includes a photo record planner for [Refrakt](https://refrakt.app).
- **Content CLI.** Write notes, start posts, and manage photos and publishing. Commands can also be scripted or scheduled.
- **RSS.** Separate feeds for the journal, photos, and [/now](https://nownownow.com/about) updates.

Photo pages are currently disabled while I cull and re-edit photos after moving from Lightroom.

Bluesky publishing uses an app password for now. I might add OAuth later.

## How it works

- [Photos](docs/photos.md) — Capture One, offline previews, static pages, and R2 backups.
- [AT Protocol](docs/atproto.md) — Markdown notes, the CLI, and publishing with atcute.

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

Settings are in [`src/site.config.ts`](src/site.config.ts#L1). The docs above cover setup for photos and publishing.

`pnpm content` stays open between tasks. Esc returns to the previous menu; Ctrl+C closes the session. Esc at the top-level menu leaves it open. Direct commands such as `pnpm content photos sync` run once and exit.
