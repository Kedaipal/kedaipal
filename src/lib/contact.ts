export { DEFAULT_SUPPORT_WA_NUMBER } from "../../convex/lib/contact";

/**
 * Build a wa.me deep link with a prefilled message.
 *
 * The number is a parameter, never a module constant: it's operator-configured
 * (`SUPPORT_WA_PHONE`, served by `contact.supportWhatsapp`), so callers read it
 * with `useSupportWaNumber()` and pass it in. Keeping this pure means the link
 * shape stays testable and usable outside React.
 */
export function buildWaContactLink(message: string, waNumber: string): string {
	return `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`;
}
