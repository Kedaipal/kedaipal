/**
 * Bridge between the app's stored phone format (digits-only, no `+`, e.g.
 * `60123456789`) and the E.164 format `react-phone-number-input` expects
 * (`+60123456789`). Storage/validation strips the `+` again on save
 * (`waPhoneSchema`, `assertValidWaPhone`), so this never changes what lands in
 * the DB — it only normalizes the value handed to the controlled input.
 */
export function toDisplayE164(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const trimmed = value.trim();
	const digits = trimmed.replace(/\D/g, "");
	if (digits.length === 0) return undefined;
	if (trimmed.startsWith("+")) return trimmed;
	return `+${digits}`;
}
