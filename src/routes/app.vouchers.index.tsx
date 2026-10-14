import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Vouchers moved under Promotions (`z8r3fducfd`) — the "Voucher codes" tab.
 * This route stays as a redirect so every bookmark, release-note link and
 * message that already points at `/app/vouchers` keeps landing on them.
 */
export const Route = createFileRoute("/app/vouchers/")({
	beforeLoad: () => {
		throw redirect({ to: "/app/promotions", search: { tab: "vouchers" } });
	},
});
