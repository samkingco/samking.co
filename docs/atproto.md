# AT Protocol

Notes live in local Markdown files. The site renders them, and the CLI can publish them to Bluesky. There is no separate editor or copy of the text to maintain.

The integration uses [atcute](https://github.com/mary-ext/atcute) for AT Protocol clients, identity resolution, record validation, and rich text. The code in this repo connects those libraries to local content; it is not a separately published library.

## Try it with your own account

Before publishing, set `atproto.did` and `domain` in [`src/site.config.ts`](../src/site.config.ts#L1) to your own account and site. Set `atproto.bluesky.publishingEnabled` to `true` when ready.

Create a note:

```sh
pnpm content note "A short note."
# Or read Markdown from stdin:
pnpm content note --stdin < note.md
```

The [note writer](../src/repos/notes.ts#L29) saves it under `src/content/notes/<year>/`, with a TID and date in frontmatter. The TID is also its Bluesky record key, so later edits update the same record.

The CLI resolves `@handle` mentions to DID-based Markdown links before saving. That step needs a network connection when mentions are present.

## Review and publish

```sh
pnpm content atproto plan bluesky
pnpm content atproto plan bluesky --json
```

Planning reads public records from your personal data server (PDS), so it needs a connection but not an app password. It compares all local notes with remote records and groups them into new, updated, unchanged, and unmatched records.

Check the plan carefully when reusing the repo: it includes all notes in `src/content/notes`, not just the note you last wrote. Unmatched remote records are left alone. Removing a local note does not delete its Bluesky post.

To publish, supply `ATPROTO_APP_PASSWORD` in a local `.env` file or the process environment. Do not commit it.

```sh
pnpm content atproto publish bluesky
```

This builds a fresh plan and asks for confirmation before writing new and updated records. It does not deploy the website. Authentication uses an app password.

If publishing fails partway through, confirmed writes remain published. Run the plan again before retrying.

## How the code fits together

- [CLI](../src/cli/atproto.ts#L1): commands, plan display, and confirmation.
- [Bluesky conversion](../src/atproto/bluesky.ts#L15): Markdown to validated post text and facets for links, mentions, and hashtags.
- [Planning](../src/atproto/plan.ts#L38): local notes to desired records, then remote comparison.
- [Record comparison](../src/atproto/records.ts#L34): matches record URIs and compares content IDs.
- [Publishing](../src/atproto/publish.ts#L14): app-password login, account check, and record writes.

The conversion and comparison modules are useful starting points if you want this in another site. The CLI handles interaction separately.

Markdown support is deliberately limited. Paragraphs, emphasis, code, and links become post text; unsupported structures such as images and lists cause an error for now. I might add embeds later. Posts must pass the Bluesky schema limits rather than being silently shortened.

## Refrakt

```sh
pnpm content atproto plan refrakt --json
```

The [Refrakt planner](../src/atproto/plan.ts#L15) uses the local photo catalog to prepare photo, album, and ordering records for [Refrakt](https://refrakt.app). It uses the export profile and collection IDs under `atproto.refrakt` in site config.

This is planning only. Refrakt record publishing and blob uploads are not implemented.

## Scripts and schedules

The CLI has direct commands as well as interactive menus. A scheduler can run them from the repo directory with the required environment:

```sh
pnpm content atproto plan bluesky --json
pnpm content atproto publish bluesky --yes
```

`--yes` skips confirmation and publishes every new or changed local note. Use it only when that is the intended scheduled action. The CLI does not include a scheduler.

Run `pnpm test:atproto` to check the record conversion tests.
