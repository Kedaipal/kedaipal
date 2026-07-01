/**
 * Channel-agnostic messaging contracts. WhatsApp is the only wired channel
 * today; the `Channel` union and adapter interface exist so future providers
 * (Telegram, WeChat) slot in behind the same seam without touching the order
 * orchestration in convex/whatsapp.ts.
 *
 * Kept free of Convex imports so it can be unit-tested in isolation and reused
 * from actions and httpActions (which run on the edge runtime).
 */

/** Supported messaging channels. Only "whatsapp" has an adapter today. */
export type Channel = "whatsapp" | "telegram" | "wechat";

/**
 * Normalized outbound message. Each adapter maps these to its provider's wire
 * format. The orchestrator emits intent ("send this CTA") and lets the adapter
 * decide how to render it — including degrading a `cta` to a plain image/text
 * when the channel (or the environment) can't honour interactive buttons.
 */
export type OutboundMessage =
	| { kind: "text"; body: string }
	| { kind: "image"; imageUrl: string; caption?: string }
	| {
			/** A file attachment (PDF receipt/invoice today) hosted at a public URL
			 * the provider fetches. `filename` is what the recipient sees + saves. */
			kind: "document";
			documentUrl: string;
			filename?: string;
			caption?: string;
	  }
	| {
			kind: "cta";
			body: string;
			buttonText: string;
			url: string;
			/** Optional image header shown above the CTA body. */
			imageUrl?: string;
	  };

/**
 * Normalized inbound message, channel-independent. `channelUserId` is the
 * per-channel sender identifier (phone for WhatsApp, chat id for Telegram).
 * `callbackData` is reserved for button-driven channels and is always
 * undefined for WhatsApp text webhooks today.
 */
export type InboundEnvelope = {
	channel: Channel;
	channelUserId: string;
	text: string;
	profileName?: string;
	callbackData?: string;
};

/** What a channel can do, so the orchestrator doesn't hardcode provider quirks. */
export type ChannelCapabilities = {
	/** Whether the channel supports interactive call-to-action URL buttons. */
	ctaButtons: boolean;
};

/**
 * A messaging provider behind a uniform interface. Implementations stay in the
 * default Convex runtime (fetch + Web Crypto) so they work inside both actions
 * and edge httpActions.
 */
export interface ChannelAdapter {
	readonly channel: Channel;
	readonly capabilities: ChannelCapabilities;
	/** Deliver a normalized message to `to` (the channelUserId / address). */
	send(to: string, msg: OutboundMessage): Promise<void>;
	/** Parse a verified raw webhook body into normalized inbound envelopes. */
	parseInbound(rawBody: string, headers: Headers): InboundEnvelope[];
	/** Verify the raw webhook body genuinely came from the provider. */
	verifySignature(rawBody: string, headers: Headers): Promise<boolean>;
}
