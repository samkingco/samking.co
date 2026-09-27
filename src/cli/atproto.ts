import {confirm, isCancel, log, note, select, taskLog} from "@clack/prompts"
import {planBluesky, planRefrakt} from "../atproto/plan.ts"
import {publishBluesky, requireBlueskyPublishing} from "../atproto/publish.ts"
import type {RecordPlan} from "../atproto/records.ts"
import {siteConfig} from "../site.config.ts"
import {menu} from "./menu.ts"
import {viewRecord} from "./record-detail.ts"

const RECORD_LABELS: Record<string, string> = {
	"app.bsky.feed.post": "Notes",
	"app.refrakt.photo": "Photos",
	"app.refrakt.album": "Albums",
	"app.refrakt.profile.item": "Profile",
	"app.refrakt.album.item": "Album items",
}

export async function manageAtproto(): Promise<void> {
	await menu("AT Protocol", [
		{label: "Plan Bluesky notes", run: () => runBlueskyPlan({})},
		{label: "Plan Refrakt photos", run: () => runRefraktPlan({})},
	])
}

export function runBlueskyPlan(options: {json?: boolean}): Promise<void> {
	return reviewPlanResult(
		"Bluesky plan",
		buildBlueskyPlan,
		options,
		siteConfig.atproto.bluesky.publishingEnabled
			? (result) => confirmBlueskyPublish(result)
			: undefined,
	)
}

function buildBlueskyPlan() {
	return planBluesky(
		siteConfig.atproto.did,
		new URL(`https://${siteConfig.domain}`),
	)
}

export async function runBlueskyPublish(options: {
	yes?: boolean
}): Promise<void> {
	requireBlueskyPublishing()
	if (!options.yes && !process.stdin.isTTY) {
		throw new Error("Use --yes to publish without an interactive confirmation.")
	}
	const result = await buildBlueskyPlan()
	note(planSummary(result.plan), "Bluesky plan")
	await confirmBlueskyPublish(result, options.yes)
}

async function confirmBlueskyPublish(
	result: Awaited<ReturnType<typeof planBluesky>>,
	yes = false,
): Promise<boolean> {
	requireBlueskyPublishing()
	const count = result.plan.creates.length + result.plan.updates.length
	if (count === 0) {
		log.info("No changes to publish.")
		return true
	}
	if (!yes) {
		const approved = await confirm({
			message: `Publish ${count} record changes to Bluesky as ${result.did}?`,
			initialValue: false,
		})
		if (isCancel(approved) || !approved) {
			return false
		}
	}
	const task = taskLog({title: "Publish Bluesky notes", output: process.stderr})
	try {
		task.message("Signing in to the PDS")
		const published = await publishBluesky(result, (record) =>
			task.message(`Published ${record.uri}`),
		)
		task.success(`Published ${published} records`)
		return true
	} catch (error) {
		task.error("Publishing failed")
		throw error
	}
}

export function runRefraktPlan(options: {json?: boolean}): Promise<void> {
	return reviewPlanResult(
		"Refrakt plan",
		() => planRefrakt(siteConfig.atproto.did, siteConfig.atproto.refrakt),
		options,
	)
}

async function reviewPlanResult<T extends {plan: RecordPlan}>(
	title: string,
	buildPlan: () => Promise<T>,
	options: {json?: boolean},
	publish?: (result: T) => Promise<boolean>,
): Promise<void> {
	const task = taskLog({title, output: process.stderr})
	let result: T
	try {
		task.message("Reading local content and remote records")
		result = await buildPlan()
		task.success("Plan ready — nothing published")
	} catch (error) {
		task.error("Planning failed")
		throw error
	}
	if (options.json) {
		console.log(JSON.stringify(result, null, 2))
		return
	}
	note(planSummary(result.plan), title)
	if (process.stdin.isTTY) {
		await reviewPlan(result.plan, publish ? () => publish(result) : undefined)
	}
}

function planSummary(plan: RecordPlan): string {
	const lines: string[] = []
	for (const [collection, label] of Object.entries(RECORD_LABELS)) {
		const counts = [plan.creates, plan.updates, plan.unchanged].map(
			(records) =>
				records.filter((record) => record.collection === collection).length,
		)
		if (counts.some(Boolean)) {
			lines.push(
				`${label.padEnd(14)}${counts[0]} new · ${counts[1]} updated · ${counts[2]} unchanged`,
			)
		}
	}
	if (lines.length === 0) {
		lines.push("No local records ready")
	}
	if (plan.unmatched.length > 0) {
		lines.push(`Other remote  ${plan.unmatched.length} (left unchanged)`)
	}
	return lines.join("\n")
}

async function reviewPlan(
	plan: RecordPlan,
	publish?: () => Promise<boolean>,
): Promise<void> {
	let cursor = "changes"
	while (true) {
		const action = await select({
			message: "Review plan",
			initialValue: cursor,
			options: [
				{value: "changes", label: "View changes"},
				...(publish ? [{value: "publish", label: "Publish"}] : []),
			],
		})
		if (isCancel(action)) {
			return
		}
		cursor = action
		const finished =
			action === "publish" ? await publish!() : await viewChanges(plan)
		if (finished) {
			return
		}
	}
}

async function viewChanges(plan: RecordPlan): Promise<void> {
	const changes = [
		...plan.creates.map((record) => ({action: "Create", record})),
		...plan.updates.map((record) => ({action: "Update", record})),
	]
	if (changes.length === 0) {
		log.info("No changes to publish.")
		return
	}
	await menu(
		"Select a record",
		changes.map(({action, record}) => ({
			label: record.label,
			hint: `${action} · ${RECORD_LABELS[record.collection] ?? record.collection}`,
			run: () => viewRecord(action, record),
		})),
	)
}
