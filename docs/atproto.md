# AT Protocol

I write notes in Markdown and publish the same files on the site and Bluesky.

The CLI uses [atcute](https://github.com/mary-ext/atcute) for the AT Protocol client, record validation, and rich text. The code in this repo reads the local content, converts it to records, and compares it with what’s already published.

## From a note to a post

The [note writer](../src/repos/notes.ts#L28) saves Markdown under `src/content/notes/<year>/`, with a TID and date in frontmatter. The TID is also the Bluesky record key, so editing a note updates the same post.

The [converter](../src/atproto/bluesky.ts#L15) converts Markdown to plain text. Bold, italics, and code formatting are stripped; paragraph breaks remain. Links, mentions, and hashtags become Bluesky facets attached to ranges in that text. Images and lists cause an error for now. I might add embeds later. Text must fit Bluesky’s limits; it isn’t silently shortened.

`@handle` mentions are resolved to DID-based Markdown links when the note is saved. Later conversion can use that saved identity without looking up the handle again.

The [planner](../src/atproto/plan.ts#L38) converts all local notes and [fetches the account’s public records](../src/atproto/pds.ts#L8). The [comparison](../src/atproto/records.ts#L34) matches record URIs and checks their content IDs. Those IDs are calculated from the encoded records, so an edit only needs publishing if the resulting record changes.

Remote posts without a matching local note are left alone. Deleting a local file doesn’t delete its Bluesky post.

The conversion and comparison functions can be used without the CLI. [createPlannedRecord](../src/atproto/records.ts#L12) builds a record’s URI and content ID; [publishBluesky](../src/atproto/publish.ts#L14) signs in, checks the account, and writes records.

## Using your own account

Before using your own account, change `domain` and `atproto.did` in [site config](../src/site.config.ts#L1). Set `atproto.bluesky.publishingEnabled` to `true` only when ready. Supply `ATPROTO_APP_PASSWORD` through the process environment or a local `.env` file; never commit it.

Publishing includes every note in `src/content/notes`, so replace my content with your own before running it.

```sh
pnpm content note "A short note."
pnpm content atproto plan bluesky --json
pnpm content atproto publish bluesky
```

Planning needs a network connection, but no app password. Publishing builds a fresh plan and asks for confirmation before writing changes. If a run fails partway through, completed writes remain published. Run the plan again before retrying.

## Refrakt

The [Refrakt planner](../src/atproto/plan.ts#L15) reads the [photo catalog](photos.md) and prepares photo and album records, including their order. It compares those with the remote records in the same way as the Bluesky planner.

Refrakt publishing and blob uploads aren’t implemented yet as Refrakt isn't fully on AT Protocol just yet. `pnpm content atproto plan refrakt --json` shows the plan.
