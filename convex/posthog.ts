import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

/**
 * Server-side PostHog capture (86eyrayux).
 *
 * WHY PLAIN `fetch` AND NOT A SDK
 *
 * PostHog ships an official `@posthog/convex` component, and it is the better
 * long-term home — but it requires **Convex >= 1.39** and this repo is on
 * 1.34.x. Bumping five minors of the backend SDK is not a change that belongs
 * inside an analytics spike. `posthog-node` is the other option and is worse
 * here: it is built around a long-lived process with a background flush timer,
 * whereas Convex actions are short-lived isolates, and it would introduce the
 * codebase's first `"use node"` file purely for telemetry.
 *
 * So: one `fetch` to PostHog's documented capture endpoint. Zero new backend
 * dependencies, no runtime pressure, and {@link captureServerEvent} is a narrow
 * enough seam that swapping to the component later is a one-file change — the
 * same posture as `ChannelAdapter` (see CLAUDE.md).
 *
 * WHY IT IS SCHEDULED, NOT AWAITED
 *
 * Order creation is a mutation, and mutations cannot `fetch`. Every capture is
 * therefore scheduled with `runAfter(0, ...)`, which also means analytics can
 * never slow down or roll back the transaction that produced the event: the
 * order commits, then the event goes out.
 */

/** PostHog US cloud. Overridden by `POSTHOG_HOST` for EU or self-hosted. */
const POSTHOG_DEFAULT_HOST = "https://us.i.posthog.com";

/** Documented single-event capture path. */
const CAPTURE_PATH = "/i/v0/e/";

/**
 * Reads the PostHog credentials from the Convex environment.
 *
 * Returns `undefined` when `POSTHOG_PROJECT_KEY` is unset — the same env-gated
 * no-op posture as `useClarity` / `useGoogleAnalytics` on the client, so a dev
 * deployment without the var configured is silently analytics-free rather than
 * broken. Set with `npx convex env set POSTHOG_PROJECT_KEY phc_...`.
 */
function posthogConfig(): { key: string; host: string } | undefined {
	const key = process.env.POSTHOG_PROJECT_KEY;
	if (!key) return undefined;
	return {
		key,
		// Trailing slashes would produce `//i/v0/e/`, which PostHog 404s.
		// `??` is not enough: an env var set to "" is a string, and it would build
		// the relative URL "/i/v0/e/" — every event silently lost. Blank means
		// unset, which is exactly how .env.local.example ships the key.
		host: (process.env.POSTHOG_HOST?.trim() || POSTHOG_DEFAULT_HOST).replace(
			/\/+$/,
			"",
		),
	};
}

/**
 * Property values PostHog accepts on a flat event. Deliberately scalar-only:
 * it keeps call sites honest about not shovelling nested order documents (and
 * therefore buyer PII) into a third party.
 */
const propertyValue = v.union(v.string(), v.number(), v.boolean(), v.null());

export const capture = internalAction({
	args: {
		event: v.string(),
		distinctId: v.string(),
		properties: v.record(v.string(), propertyValue),
		/** Event time, taken from the calling mutation's transaction clock. */
		timestamp: v.number(),
		/**
		 * Whether this event may create/update a PostHog *person* record.
		 *
		 * Defaults to false. Buyer events are the common case and must stay
		 * person-less: the client boots with `person_profiles: "identified_only"`
		 * so an anonymous shopper never mints a profile, and a server event that
		 * quietly created one for the same distinct id would defeat that — and
		 * put a durable person record behind an id we joined to an order. Set
		 * true only for genuinely identified subjects (a signed-in seller).
		 */
		withPersonProfile: v.optional(v.boolean()),
	},
	handler: async (_ctx, args) => {
		const config = posthogConfig();
		if (!config) return;

		try {
			const response = await fetch(`${config.host}${CAPTURE_PATH}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					api_key: config.key,
					event: args.event,
					distinct_id: args.distinctId,
					timestamp: new Date(args.timestamp).toISOString(),
					properties: {
						...args.properties,
						$process_person_profile: args.withPersonProfile === true,
					},
				}),
			});
			if (!response.ok) {
				console.warn("posthog capture rejected", {
					event: args.event,
					status: response.status,
				});
			}
		} catch (error) {
			// Analytics is never allowed to be load-bearing. The order already
			// committed; a dropped event is a reporting gap, not a failure the
			// seller or buyer should ever see.
			console.warn("posthog capture failed", {
				event: args.event,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	},
});

/** The scheduler surface {@link captureServerEvent} needs — mutations + actions. */
interface SchedulerCtx {
	scheduler: {
		runAfter: (
			delayMs: number,
			fn: typeof internal.posthog.capture,
			args: {
				event: string;
				distinctId: string;
				properties: Record<string, string | number | boolean | null>;
				timestamp: number;
				withPersonProfile?: boolean;
			},
		) => Promise<unknown>;
	};
}

/**
 * Queue one PostHog event from a mutation or action.
 *
 * No-ops when `distinctId` is absent — an unattributed event would land on a
 * synthetic person and skew every funnel, so dropping it is the honest choice.
 * Callers do not need to guard; call it unconditionally and pass whatever the
 * order carries.
 */
export async function captureServerEvent(
	ctx: SchedulerCtx,
	args: {
		event: string;
		distinctId: string | undefined;
		properties: Record<string, string | number | boolean | null>;
		timestamp: number;
		withPersonProfile?: boolean;
	},
): Promise<void> {
	if (!args.distinctId) return;
	await ctx.scheduler.runAfter(0, internal.posthog.capture, {
		event: args.event,
		distinctId: args.distinctId,
		properties: args.properties,
		timestamp: args.timestamp,
		withPersonProfile: args.withPersonProfile,
	});
}
