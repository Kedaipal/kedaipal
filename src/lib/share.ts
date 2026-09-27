import { toast } from "sonner";

/** Share/copy a link: OS share sheet when available (the WhatsApp path on
 * mobile), clipboard + toast otherwise. `url` may be relative — it's
 * absolutized against the current origin at call time (SSR-safe: only ever
 * called from a click). Serves every storefront share affordance (the
 * subpage app bar's icon, the store hero's "Share store", the product page's
 * Copy-link chip) so they can't drift. */
export async function shareLink(url: string) {
	const absolute = new URL(url, window.location.origin).toString();
	if (navigator.share) {
		try {
			await navigator.share({ url: absolute });
			return;
		} catch {
			// Cancelled or unsupported payload — fall through to copy.
		}
	}
	try {
		await navigator.clipboard.writeText(absolute);
		toast.success("Link copied — paste it anywhere");
	} catch {
		toast.error("Couldn't copy the link");
	}
}
