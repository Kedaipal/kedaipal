/**
 * Pure parser for WhatsApp Cloud API inbound webhook payloads. Kept free of
 * Convex imports so it can be unit-tested in isolation. Extracts text messages
 * along with the sender's pushname (from the parallel `contacts` array) so the
 * customer record can be enriched without an extra API call.
 */

export type InboundMessage = {
	from: string;
	text: string;
	/** Sender's WhatsApp pushname (contacts[].profile.name), if present. */
	profileName?: string;
};

export function extractInboundMessages(payload: unknown): InboundMessage[] {
	const out: InboundMessage[] = [];
	if (!payload || typeof payload !== "object") return out;
	const entries = (payload as { entry?: unknown }).entry;
	if (!Array.isArray(entries)) return out;
	for (const entry of entries) {
		if (!entry || typeof entry !== "object") continue;
		const changes = (entry as { changes?: unknown }).changes;
		if (!Array.isArray(changes)) continue;
		for (const change of changes) {
			if (!change || typeof change !== "object") continue;
			const value = (change as { value?: unknown }).value;
			if (!value || typeof value !== "object") continue;

			// Build a wa_id → pushname map from the parallel contacts array.
			const pushnameByWaId = new Map<string, string>();
			const contacts = (value as { contacts?: unknown }).contacts;
			if (Array.isArray(contacts)) {
				for (const contact of contacts) {
					if (!contact || typeof contact !== "object") continue;
					const waId = (contact as { wa_id?: unknown }).wa_id;
					const profile = (contact as { profile?: unknown }).profile;
					const name =
						profile && typeof profile === "object"
							? (profile as { name?: unknown }).name
							: undefined;
					if (typeof waId === "string" && typeof name === "string") {
						pushnameByWaId.set(waId, name);
					}
				}
			}

			const messages = (value as { messages?: unknown }).messages;
			if (!Array.isArray(messages)) continue;
			for (const m of messages) {
				if (!m || typeof m !== "object") continue;
				const from = (m as { from?: unknown }).from;
				const type = (m as { type?: unknown }).type;
				if (typeof from !== "string") continue;
				if (type !== "text") continue;
				const textObj = (m as { text?: unknown }).text;
				if (!textObj || typeof textObj !== "object") continue;
				const body = (textObj as { body?: unknown }).body;
				if (typeof body !== "string") continue;
				out.push({ from, text: body, profileName: pushnameByWaId.get(from) });
			}
		}
	}
	return out;
}
