# Photos

Capture One is where I manage photos. It suits my work and how I publish, without building a CMS or adapting to someone else's setup and hosting.

The site reads the catalog without modifying it. Exported JPEGs become local image files and a SQLite catalog. Astro uses those to generate static pages, so viewers do not have to wait for database queries or image `processing`.

## Capture One setup

This is built around my catalog, not a general Capture One plugin. The [reader](../src/repos/photos/capture-one.ts#L61) accepts catalog schema version `160800`.

1. Set `photos.captureOneCatalogPath` in [`src/site.config.ts`](../src/site.config.ts#L16) to your `.cocatalog` package.
2. Run `pnpm photos:db:migrate` to create or update the local database.
3. Run `pnpm content photos setup` to choose which Capture One collections to import. Their descendants are included.
4. Set `allPhotosCollectionId` and `setsCollectionId` in site config. The first selects the main photo collection; albums directly below the second become sets.
5. Export JPEGs from Capture One into `photos/exports/website/`. The `website` directory matches `photos.exportProfile`. Exports must have a longest edge of at most 4096 pixels.

Sync uses Capture One's export history to find files; it does not render RAW files. The catalog and exports must be available locally.

### Choose collections

The sync selection controls which Capture One collections are available in the local catalog. Selecting a parent includes its descendants, including collections added later. Sync preserves their hierarchy, photo membership, and order.

Each destination assigns meaning to the collections it uses. For example, the website maps child albums in its configured “Sets” group to website sets. Refrakt can map those same albums to album records, or use a different collection entirely. These mappings are configured separately in [`src/site.config.ts`](../src/site.config.ts#L16). Changes in Capture One are read when you run `pnpm content photos sync`.

## Work offline

Sync locally and preview photos:

```sh
pnpm content photos sync
pnpm dev
```

Enable `photos.enabled` in [`src/site.config.ts`](../src/site.config.ts#L16) to see the photo pages.

[Sync](../src/repos/photos/sync.ts#L66) imports collections and their order, extracts metadata and colour palettes, and generates WebP images and social previews. WebP files retain credit and copyright metadata.

Metadata comes from the source image. Missing metadata stays empty. Photos still appear in their albums and sets, but missing camera data, capture dates, or tags means they do not appear on the corresponding camera, date, or tag pages.

- `photos/catalog.sqlite` holds the local catalog.
- `photos/objects/` holds the source copies and generated images.
- The [dev server](../astro.config.mjs#L61) serves those objects through `/cdn`, as a local replacement for the hosted CDN.

This preview uses `pnpm dev`, not `pnpm preview`. It includes photos that have not been uploaded. Once dependencies, the catalog, and exports are local, photo sync and preview need no network.

The command reports local completion before starting the R2 stage. If it cannot connect, local sync still succeeds and remote work remains pending. Run sync again when connected. With no R2 settings, the remote stage is skipped. Invalid or incomplete settings and permission errors return an error without undoing local work.

## Upload and back up

When online, supply these settings in a local `.env` file or the process environment:

- `R2_ENDPOINT`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `R2_BACKUP_BUCKET`

Keep credentials out of Git. Set your public image domain in [the R2 module](../src/repos/photos/r2.ts#L20) if you reuse this.

Run `pnpm content photos sync` again. It checks pending image files with an R2 `HEAD` request. Matching hashes, sizes, and content types are recorded as uploaded without sending the file again. Missing or different objects are uploaded. A failed check stops the remote stage rather than assuming the object is missing. Confirmed uploads remain recorded, so retries do not repeat them.

After that, sync [backs up the SQLite database](../src/repos/photos/backup.ts#L9) to the backup bucket. Each backup has a timestamp and content hash in its name. This is the site's catalog backup, not a backup of the Capture One catalog or RAW files.

Successful image uploads are recorded locally, so a later sync can retry pending files. Production builds [include only photos with uploaded image files](../src/repos/photos/catalog.ts#L17) and use the public CDN URLs. The build machine needs the SQLite catalog. I might add some way to use the latest backup from R2 as the catalog so you can build from other machines provided the backup is up to date (needs Capture One database access too to sync fresh).

## Reuse and automation

Start with [the Capture One reader](../src/repos/photos/capture-one.ts#L84), [image processing](../src/processing/photos.ts#L54), and [the Astro loader](../src/loaders/photos.ts#L15). They separate catalog access, image preparation, and site output.

`pnpm content photos sync` does not need interactive input once you have selected the Capture One collections to sync. A scheduler can run it from the repo directory with access to the catalog, exports, and credentials. Scheduling is external to the CLI; avoid overlapping runs against the same local files.

## Catalog schema

After editing [`database-schema.ts`](../src/repos/photos/database-schema.ts#L1), generate a migration with an explicit name:

```sh
pnpm photos:db:generate --name add_photo_field
pnpm photos:db:migrate
```

`--name` is required. Use lowercase letters, numbers, hyphens, or underscores, starting with a letter.
