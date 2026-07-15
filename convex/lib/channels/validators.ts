/**
 * Convex arg validators for the channel-agnostic messaging contracts in
 * ./types.ts. Split out because types.ts is deliberately Convex-import-free
 * (it's shared with edge httpActions and pure unit tests); this file is for
 * functions that need to accept an OutboundMessage as a validated argument —
 * e.g. the durably-retried transactional send (convex/wabaProtection.ts).
 */

import { type Infer, v } from "convex/values";
import type { OutboundMessage } from "./types";

export const outboundMessageValidator = v.union(
	v.object({ kind: v.literal("text"), body: v.string() }),
	v.object({
		kind: v.literal("image"),
		imageUrl: v.string(),
		caption: v.optional(v.string()),
	}),
	v.object({
		kind: v.literal("document"),
		documentUrl: v.string(),
		filename: v.optional(v.string()),
		caption: v.optional(v.string()),
	}),
	v.object({
		kind: v.literal("cta"),
		body: v.string(),
		buttonText: v.string(),
		url: v.string(),
		imageUrl: v.optional(v.string()),
	}),
);

// Compile-time parity check: the validator must accept exactly the
// OutboundMessage union. If types.ts gains a kind, this line breaks the build
// until the validator learns it too.
const _assertParity: OutboundMessage extends Infer<typeof outboundMessageValidator>
	? Infer<typeof outboundMessageValidator> extends OutboundMessage
		? true
		: never
	: never = true;
void _assertParity;
