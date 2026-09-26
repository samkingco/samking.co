---
name: land
description: >-
  Land changes in samking.co only when the user explicitly requests landing, such as by choosing Land Changes or invoking /land. Do not invoke for review, preparation, passing checks, or skill installation.
disable-model-invocation: true
metadata:
  delta-action: land
---

# Land changes in samking.co

The Land request authorizes commit and push; do not ask for that permission again. Deployment needs a separate yes.

1. In the attached worktree, check status, applicable instructions, remote `origin`, current `main`, and destination rules. Review **every** changed file. Preserve unrelated edits; ask before omitting any changed file. Commit uncommitted changes in scope, or use the existing commit. Do not create branches, rewrite history, force-push, or use the `local` remote to publish.
2. Run `pnpm format:check`, `pnpm lint`, `pnpm build`, and, for photo changes, `pnpm test:photos` (`package.json`, `scripts.format:check`, `scripts.lint`, `scripts.build`, `scripts.test:photos`). Check any required remote CI on the change being landed. Stop on failing, pending, missing, or unverifiable required checks; ask before accepting an exception.
3. If `origin/main` advanced, stop and suggest a resolution; ask before resolving conflicts. Otherwise push the fast-forward change to `origin/main` and verify its commit on the remote. Do not push again without a new request.
4. After the push, ask whether to deploy. Only on yes, run `pnpm run ship` (`package.json`, `scripts.ship`: build then Wrangler Pages deploy; `wrangler.json`, `name` and `pages_build_output_dir`) and verify the deployment result.
5. In a subthread, use `report_subthread_status`; elsewhere report in the conversation. Report `success` only after the commit reaches remote `main`, and `failure` for a blocker. Use a short title, one-line description, short SHA, and only verified commit/check/deployment links. Distinguish push from deployment; never report skill installation as landing.
