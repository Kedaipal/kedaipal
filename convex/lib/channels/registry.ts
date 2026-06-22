/**
 * Adapter registry. The single place that maps a Channel to its ChannelAdapter.
 * Only "whatsapp" is wired today; adding a channel means implementing its
 * adapter and registering it here — no order-orchestration changes required.
 */

import type { Channel, ChannelAdapter } from "./types";
import { whatsappAdapter } from "./whatsapp/adapter";

const adapters: Partial<Record<Channel, ChannelAdapter>> = {
	whatsapp: whatsappAdapter,
};

/**
 * Resolve the adapter for a channel. Throws on an unregistered channel — a
 * defensive guard since the type permits "telegram"/"wechat" before they have
 * adapters.
 */
export function getAdapter(channel: Channel): ChannelAdapter {
	const adapter = adapters[channel];
	if (!adapter) {
		throw new Error(`No messaging adapter registered for channel: ${channel}`);
	}
	return adapter;
}
