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

export type OutboundStatus = {
	/** Meta's message id (`wamid…`) — the send-time receipt's id. */
	id: string;
	status: "sent" | "delivered" | "read" | "failed";
	/** Recipient wa_id (digits-only phone). */
	recipientId?: string;
	/** Flattened error summary — populated only on `failed`. */
	errorDetail?: string;
};

const OUTBOUND_STATUSES = new Set(["sent", "delivered", "read", "failed"]);

/**
 * Extract outbound-delivery `statuses` events (the messages field carries
 * them alongside inbound `messages`). Meta emits one per state transition of
 * every message the number sends; `failed` is the one that matters today —
 * it's how a confirmation push to a typo'd/unreachable number reports back
 * (see orders.markConfirmationPushFailed).
 */
export function extractStatusEvents(payload: unknown): OutboundStatus[] {
	const out: OutboundStatus[] = [];
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
			const statuses = (value as { statuses?: unknown }).statuses;
			if (!Array.isArray(statuses)) continue;
			for (const s of statuses) {
				if (!s || typeof s !== "object") continue;
				const id = (s as { id?: unknown }).id;
				const status = (s as { status?: unknown }).status;
				if (typeof id !== "string" || typeof status !== "string") continue;
				if (!OUTBOUND_STATUSES.has(status)) continue;
				const recipientId = (s as { recipient_id?: unknown }).recipient_id;
				let errorDetail: string | undefined;
				const errors = (s as { errors?: unknown }).errors;
				if (Array.isArray(errors) && errors.length > 0) {
					const first = errors[0];
					if (first && typeof first === "object") {
						const code = (first as { code?: unknown }).code;
						const title = (first as { title?: unknown }).title;
						const parts = [
							typeof code === "number" || typeof code === "string"
								? String(code)
								: undefined,
							typeof title === "string" ? title : undefined,
						].filter((p): p is string => p !== undefined);
						if (parts.length > 0) errorDetail = parts.join(": ");
					}
				}
				out.push({
					id,
					status: status as OutboundStatus["status"],
					recipientId:
						typeof recipientId === "string" ? recipientId : undefined,
					errorDetail,
				});
			}
		}
	}
	return out;
}

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
