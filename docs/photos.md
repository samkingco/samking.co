# Photos

Capture One is where I edit and organize photos. This pipeline uses that catalog to generate a static website without maintaining the same albums and metadata in a CMS.

I export JPEGs from Capture One, then run `pnpm content photos sync`. The [reader](../src/repos/photos/capture-one.ts#L84) uses the catalog’s export history to find those files and imports the selected collections with their photo order.

Each photo gets an [ID based on its Capture One variant](../src/repos/photos/database.ts#L62). Sync hashes the JPEG separately to track changes to the file. Re-exporting a photo doesn’t change its ID or photo-page URL.

[Image processing](../src/processing/photos.ts#L54) extracts metadata and colours, then makes WebP thumbnails, larger detail images, and social previews. The WebP files retain credit and copyright metadata. The [Astro loader](../src/loaders/photos.ts#L15) reads the local catalog to build the pages.

I choose which collections to import through the CLI. The website and Refrakt each have their own mappings for those collections. On the website, one collection becomes the main photo list, and albums under another group become sets.

## Local edits and alt text

The CLI lets me change camera and lens display names, add collection descriptions, and write alt text. SQLite stores these edits alongside the imported metadata. The website and Refrakt use the same [catalog reader](../src/repos/photos/catalog.ts#L17) to apply them.

Capture One’s Description is the caption. Alt text comes from IPTC `AltTextAccessibility` when it’s set, otherwise from the catalog’s alt-text field.

There’s also a local [alt-text generator](../src/repos/photos/alt-text.ts#L224) using Ollama. It gets a resized image plus metadata such as tags and album descriptions. The cache includes the image, metadata, prompt settings, and model revision, so unchanged photos don’t need another inference run. Generation skips text I’ve edited or approved.

Open Manage photos → Alt text to generate or review text, or run `pnpm content photos alt generate` directly. The CLI starts Ollama and installs the model if needed.

Review generated text shows one photo at a time with Approve, Edit, and Skip actions. It only includes generated text, not missing, IPTC, approved, or edited text. Each approval or edit is saved immediately. Skipped photos remain generated for the next review.

## Local files and R2

`photos/catalog.sqlite` stores metadata and collection membership. Source JPEGs and generated images are stored in `photos/objects/`. With `pnpm dev`, [Astro serves those local files through `/cdn`](../astro.config.mjs#L23), so I can preview photos before uploading them.

Sync finishes the local work before attempting R2 uploads. Missing exports do not stop the remaining photos from syncing and uploading. Sync lists their filenames so I can export them and run sync again. It [checks hashes and sizes](../src/repos/photos/r2.ts#L72) to avoid uploading the same files again and [backs up the SQLite catalog](../src/repos/photos/backup.ts#L9) too.

Production builds only include photos with uploaded images and use the public CDN URLs. The build machine needs a copy of the catalog.

I might add some way to use the latest backup from R2 as the catalog so you can build from other machines provided the backup is up to date (needs Capture One database access too to sync fresh).

## Using this elsewhere

The [Capture One reader](../src/repos/photos/capture-one.ts#L61) depends on the editor’s internal database schema. That’s the part to replace for a different editor.

For just the image processing, [preparePhoto](../src/processing/photos.ts#L54) accepts a JPEG path and an optional output directory. [Metadata extraction](../src/processing/metadata.ts#L16) is separate too. For a different frontend, [readWebsiteCatalog](../src/repos/photos/catalog.ts#L17) returns the photos and albums without going through Astro.

The catalog path and collection mappings are in [site config](../src/site.config.ts#L1). Sync expects JPEG exports in `photos/exports/website/`, with a longest edge of at most 4096 pixels. Hosting uses the [R2 environment settings](../src/repos/photos/r2.ts#L51) and [CDN URL](../src/repos/photos/r2.ts#L20).
