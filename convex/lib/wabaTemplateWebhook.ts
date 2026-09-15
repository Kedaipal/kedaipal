/**
 * Pure parser for WhatsApp Business Account TEMPLATE webhooks — the three
 * change-events Meta posts about a message template AFTER it was approved,
 * on the SAME webhook URL as inbound messages and the health events
 * (`wabaWebhook.ts`). No Convex imports (unit-tested in isolation).
 *
 *   - `message_template_status_update` — APPROVED / REJECTED / PAUSED /
 *     DISABLED / PENDING_DELETION / … (a paused or disabled template makes
 *     every send that names it fail outright).
 *   - `template_category_update` — Meta re-classified the template, e.g.
 *     UTILITY → MARKETING. From 1 Oct 2026 that is a 6.1× price jump on every
 *     send (RM 0.0564 → RM 0.3467 in MY) with an appeal window we'd miss
 *     entirely if nobody looked (ClickUp z8r3fddtkh).
 *   - `message_template_quality_update` — GREEN / YELLOW / RED. Persistent
 *     RED is what precedes a PAUSED event, so it is the early warning.
 *
 * We run FIVE approved utility templates (confirm push, claim link, three
 * seller alerts) and, with this ticket, a sixth (payment reminder). Before
 * this module the handler explicitly ignored all three fields — the first
 * sign of a recategorised template would have been the Meta invoice.
 *
 * These fields must be subscribed in the Meta App dashboard (App → WhatsApp →
 * Configuration → Webhook fields) — a dashboard toggle, not code. See
 * docs/waba-protection.md.
 */

export type TemplateEventKind = "status" | "category" | "quality";

export type WabaTemplateEvent = {
	kind: TemplateEventKind;
	/** Meta's template name, e.g. `order_confirmation_utility`. */
	templateName: string;
	/** Language the event is about ("en" / "ms"); "?" when Meta omits it. */
	language: string;
	/** Status event (`status` kind only), upper-cased: APPROVED, PAUSED, … */
	event?: string;
	previousCategory?: string;
	newCategory?: string;
	previousQuality?: string;
	newQuality?: string;
	/** Meta's stated reason, when present (rejection reason, disable info). */
	reason?: string;
	/**
	 * Whether ops should be paged for this event. Every event is persisted;
	 * only the ones that change what we pay or whether the send works alert.
	 */
	shouldAlert: boolean;
	/** One-line human summary for the alert email + admin console. */
	summary: string;
};

/** Status events that mean "sends naming this template will fail or cost more". */
const ALERT_STATUS_EVENTS = new Set([
	"REJECTED",
	"PAUSED",
	"DISABLED",
	"PENDING_DELETION",
	"FLAGGED",
]);

/** Categories billed at the low rate. Anything else is MARKETING-priced. */
const LOW_RATE_CATEGORIES = new Set(["UTILITY", "AUTHENTICATION", "SERVICE"]);

/** Quality scores that precede a PAUSE — worth a look before Meta acts. */
const ALERT_QUALITY_SCORES = new Set(["YELLOW", "RED"]);

function str(v: unknown): string | undefined {
	return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

function upper(v: unknown): string | undefined {
	const s = str(v);
	return s ? s.toUpperCase() : undefined;
}

/**
 * Meta nests the disable/rejection detail differently per event; flatten
 * whatever is there into one string so the alert can quote it.
 */
function reasonOf(v: Record<string, unknown>): string | undefined {
	const direct = str(v.reason);
	if (direct) return direct;
	const disable = v.disable_info;
	if (disable && typeof disable === "object") {
		const d = str((disable as Record<string, unknown>).disable_date);
		if (d) return `disable_date=${d}`;
	}
	const other = v.other_info;
	if (other && typeof other === "object") {
		const title = str((other as Record<string, unknown>).title);
		const desc = str((other as Record<string, unknown>).description);
		if (title || desc) return [title, desc].filter(Boolean).join(": ");
	}
	return undefined;
}

/**
 * Template category flips are the expensive case: a template that LEAVES a
 * low-rate category costs 6.1× per send from 1 Oct 2026. A flip between two
 * low-rate categories, or INTO one, is informational.
 */
export function categoryChangeShouldAlert(
	previousCategory: string | undefined,
	newCategory: string | undefined,
): boolean {
	if (!newCategory) return false;
	if (LOW_RATE_CATEGORIES.has(newCategory)) return false;
	// Unknown previous category (Meta omitted it): treat a non-low-rate
	// destination as an alert — we only ever register utility templates.
	return previousCategory === undefined || LOW_RATE_CATEGORIES.has(previousCategory);
}

export function extractWabaTemplateEvents(payload: unknown): WabaTemplateEvent[] {
	const out: WabaTemplateEvent[] = [];
	if (!payload || typeof payload !== "object") return out;
	const entries = (payload as { entry?: unknown }).entry;
	if (!Array.isArray(entries)) return out;
	for (const entry of entries) {
		if (!entry || typeof entry !== "object") continue;
		const changes = (entry as { changes?: unknown }).changes;
		if (!Array.isArray(changes)) continue;
		for (const change of changes) {
			if (!change || typeof change !== "object") continue;
			const field = (change as { field?: unknown }).field;
			const value = (change as { value?: unknown }).value;
			const v =
				value && typeof value === "object"
					? (value as Record<string, unknown>)
					: {};
			// Meta uses `message_template_name` on status/category events and a
			// bare `name` on quality events; read both so a shape drift on their
			// side degrades to "?" rather than dropping the event.
			const templateName = str(v.message_template_name) ?? str(v.name);
			const language =
				str(v.message_template_language) ?? str(v.language) ?? "?";
			if (!templateName) continue;

			if (field === "message_template_status_update") {
				const event = upper(v.event) ?? "UNKNOWN";
				const reason = reasonOf(v);
				out.push({
					kind: "status",
					templateName,
					language,
					event,
					reason,
					shouldAlert: ALERT_STATUS_EVENTS.has(event),
					summary: `${templateName} (${language}) status → ${event}${
						reason ? ` — ${reason}` : ""
					}`,
				});
			} else if (field === "template_category_update") {
				const previousCategory = upper(v.previous_category);
				const newCategory = upper(v.new_category);
				const correct = upper(v.correct_category);
				out.push({
					kind: "category",
					templateName,
					language,
					previousCategory,
					newCategory,
					reason: correct ? `correct_category=${correct}` : undefined,
					shouldAlert: categoryChangeShouldAlert(previousCategory, newCategory),
					summary: `${templateName} (${language}) category ${
						previousCategory ?? "?"
					} → ${newCategory ?? "?"}`,
				});
			} else if (field === "message_template_quality_update") {
				const previousQuality = upper(v.previous_quality_score);
				const newQuality = upper(v.new_quality_score) ?? "UNKNOWN";
				out.push({
					kind: "quality",
					templateName,
					language,
					previousQuality,
					newQuality,
					shouldAlert: ALERT_QUALITY_SCORES.has(newQuality),
					summary: `${templateName} (${language}) quality ${
						previousQuality ?? "?"
					} → ${newQuality}`,
				});
			}
			// phone_number_quality_update / account_update: wabaWebhook.ts.
		}
	}
	return out;
}
