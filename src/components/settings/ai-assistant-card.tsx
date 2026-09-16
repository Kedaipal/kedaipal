/**
 * AI assistant connection card — Settings → Integrations (z8r3fdff6p).
 *
 * The seller-facing face of the MCP server: what it is, the server URL to
 * paste into Claude/ChatGPT, and the ground rules (read-only, free, Pro).
 * There is deliberately NO connection status or revoke list here in v1 — the
 * OAuth grant lives with Clerk and the connector lives inside the seller's AI
 * app, so "remove the connector in the AI app" is the honest disconnect story
 * until Clerk exposes per-user grant management we can surface.
 *
 * Gating mirrors the house pattern (wa-order-alerts-card): `canUse` is the
 * client mirror of `PLAN_FEATURES.mcp`; the server (`/mcp` route →
 * `sellerTools.resolveMcpContext`) is the real lock, and it also refuses
 * while the subscription is past due — both refusals reach the seller as
 * plain sentences inside their AI chat.
 */

import { Bot } from "lucide-react";
import { clientEnv } from "../../lib/env";
import { ProBadge } from "../app/pro-gate";
import { CopyButton } from "../ui/copy-button";

/** Convex serves HTTP actions on .convex.site (the .convex.cloud origin is
 * the WebSocket/API one) — same rewrite the calendar-feed URL uses. */
function mcpServerUrl(): string {
	const convexUrl = clientEnv.VITE_CONVEX_URL ?? "";
	return `${convexUrl.replace(".convex.cloud", ".convex.site")}/mcp`;
}

export function AiAssistantCard({
	canUse,
}: {
	/** Client mirror of PLAN_FEATURES.mcp (server is the lock). */
	canUse: boolean;
}) {
	const serverUrl = mcpServerUrl();
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-2">
				<div className="flex items-center gap-2.5">
					<Bot className="size-5 shrink-0 text-accent" />
					<h2 className="font-heading text-lg font-bold">AI assistant</h2>
					{!canUse ? <ProBadge /> : null}
				</div>
				<p className="text-sm text-muted-foreground">
					Connect your store to{" "}
					<span className="font-medium text-foreground">Claude</span> or{" "}
					<span className="font-medium text-foreground">ChatGPT</span> and ask
					for your numbers in plain language — &ldquo;How were sales this
					week?&rdquo;, &ldquo;Who hasn&apos;t paid yet?&rdquo;, &ldquo;What&apos;s
					due for delivery tomorrow?&rdquo; The connection is{" "}
					<span className="font-medium text-foreground">read-only</span>: your
					AI can see your numbers but can never change your store, your orders,
					or message anyone.
				</p>
				{/* The gate reason LEADS for a gated seller — they must not read
				    the connect steps first and find the lock at the bottom. */}
				{canUse ? (
					<p className="text-xs text-muted-foreground">
						Included with Pro — asking costs nothing extra, however often you
						ask.
					</p>
				) : (
					<p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
						This is a Pro feature — upgrade in Settings → Billing to use it.
						You can already add the connector below; it starts working the
						moment you upgrade.
					</p>
				)}
			</div>

			<div className="flex flex-col gap-2 rounded-xl border border-input p-3">
				<span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
					Server URL
				</span>
				<div className="flex flex-wrap items-center gap-2">
					<code className="min-w-0 break-all rounded bg-muted px-2 py-1 text-xs">
						{serverUrl}
					</code>
					<CopyButton value={serverUrl} ariaLabel="Copy server URL" />
				</div>
			</div>

			<div className="flex flex-col gap-3 text-sm text-muted-foreground">
				<div className="flex flex-col gap-1">
					<span className="font-medium text-foreground">Connect in Claude</span>
					<p>
						Settings → Connectors → <b>Add custom connector</b>, paste the
						server URL, then sign in with your Kedaipal account when asked.
					</p>
				</div>
				<div className="flex flex-col gap-1">
					<span className="font-medium text-foreground">Connect in ChatGPT</span>
					<p>
						Settings → Connectors → <b>Create</b>, paste the server URL, then
						sign in with your Kedaipal account. (The menu name varies by app
						version — look for &ldquo;connectors&rdquo;.)
					</p>
				</div>
				<p className="text-xs">
					To disconnect, remove the connector inside the AI app — access stops
					with it. Asking very rapidly can hit a per-store rate limit; your AI
					will say so and it clears within a minute.
				</p>
			</div>

		</div>
	);
}
