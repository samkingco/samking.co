import {isCancel, log, note, select, taskLog} from "@clack/prompts"
import {planBluesky, planRefrakt} from "../atproto/plan.ts"
import type {RecordPlan} from "../atproto/records.ts"
import {siteConfig} from "../site.config.ts"

const RECORD_LABELS: Record<string, string> = {
	"app.bsky.feed.post": "Notes",
	"app.refrakt.photo": "Photos",
	"app.refrakt.album": "Albums",
	"app.refrakt.profile.item": "Profile",
	"app.refrakt.album.item": "Album items",
}

export async function manageAtproto(): Promise<void> {
	while (true) {
		const action = await select({
			message: "AT Protocol",
			options: [
				{value: runBlueskyPlan, label: "Plan Bluesky notes"},
				{value: runRefraktPlan, label: "Plan Refrakt photos"},
				{value: null, label: "Back"},
			],
		})
		if (isCancel(action) || action === null) {
			return
		}
		await action({json: false})
	}
}

export function runBlueskyPlan(options: {json?: boolean}): Promise<void> {
	return reviewPlanResult(
		"Bluesky plan",
		() =>
			planBluesky(
				siteConfig.atproto.did,
				new URL(`https://${siteConfig.domain}`),
			),
		options,
	)
}

export function runRefraktPlan(options: {json?: boolean}): Promise<void> {
	return reviewPlanResult(
		"Refrakt plan",
		() => planRefrakt(siteConfig.atproto.did, siteConfig.atproto.refrakt),
		options,
	)
}

async function reviewPlanResult(
	title: string,
	buildPlan: () => Promise<{plan: RecordPlan}>,
	options: {json?: boolean},
): Promise<void> {
	const task = taskLog({title, output: process.stderr})
	let result: Awaited<ReturnType<typeof buildPlan>>
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
		await reviewPlan(result.plan)
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

async function reviewPlan(plan: RecordPlan): Promise<void> {
	while (true) {
		const action = await select({
			message: "Review plan",
			options: [
				{value: "changes", label: "View changes"},
				{value: "publish", label: "Publish"},
				{value: "back", label: "Back"},
			],
		})
		if (isCancel(action) || action === "back") {
			return
		}
		if (action === "publish") {
			log.info("No AT Protocol auth configured. Nothing published.")
			continue
		}
		await viewChanges(plan)
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
	const selected = await select({
		message: "Select a record",
		maxItems: 12,
		options: [
			...changes.map(({action, record}, index) => ({
				value: index,
				label: record.label,
				hint: `${action} · ${RECORD_LABELS[record.collection] ?? record.collection}`,
			})),
			{value: -1, label: "Back"},
		],
	})
	if (isCancel(selected) || selected === -1) {
		return
	}
	const {action, record} = changes[selected]!
	note(
		`${record.uri}\n\n${JSON.stringify(record.record, null, 2)}`,
		`${action} record`,
	)
}
