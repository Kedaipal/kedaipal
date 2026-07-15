import { ActionRetrier } from "@convex-dev/action-retrier";
import { components } from "../_generated/api";

/**
 * Durable retrier for transactional WhatsApp sends (ClickUp 86ey5dz0a). A
 * transient Meta failure (429/5xx/network) used to silently drop the buyer's
 * order confirmation / status update — the component re-runs the send action
 * with exponential backoff instead, surviving action crashes because retries
 * are scheduled through the database (unlike an in-process loop).
 *
 * Policy: 5 attempts total (1 + 4 retries) at ~250ms/500ms/1s/2s jittered
 * gaps — rides out a blip without stretching into "the buyer already asked
 * the seller" territory. Only `transactional` sends go through this; gated
 * categories stay single-shot so WABA-protection decisions are never replayed
 * (see makeGuardedSender in convex/wabaProtection.ts).
 */
export const retrier = new ActionRetrier(components.actionRetrier, {
	initialBackoffMs: 250,
	base: 2,
	maxFailures: 4,
});

/** Inline-retry policy for ordered/fallback transactional sequences that can't
 * ride the fire-and-forget component (they need await-with-throw semantics). */
export const INLINE_RETRY = { attempts: 3, initialBackoffMs: 250, base: 2 };
