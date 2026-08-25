/**
 * Redacts personal data before it reaches `console.*`.
 *
 * Convex platform logs live outside the schema: they have their own retention,
 * are visible to anyone with dashboard access, and are replicated into any
 * log-drain integration. Since the PDPA 2024 amendments made breach
 * notification mandatory, PII copied into logs widens what an incident
 * touches — so logs carry a phone's last four digits (enough to correlate
 * against a known order or customer row) and never message bodies, only their
 * length.
 *
 * Convention: every `console.*` in convex/ that references a buyer identity
 * goes through `redactPhone`; a raw `fromPhone`/`waPhone`/text-preview value
 * in a log line is a review-blocking bug. See
 * docs/whatsapp-webhook-security.md.
 */
export function redactPhone(phone: string | null | undefined): string {
	const digits = (phone ?? "").replace(/\D/g, "");
	if (digits.length === 0) return "(none)";
	return `…${digits.slice(-4)}`;
}
