// Handing a CLAIMED store to a different person (admin only). The mirror of
// HandoverDialog: that one names who will claim a store nobody owns, this one
// takes a store OFF its owner and points it at someone else.
//
// Mounted only while open, so the field initialises empty every time — this is
// deliberately NOT prefilled the way the handover dialog is. There is no
// "current value" to edit here; the admin is naming a new person, and a
// prefilled address is one stray Enter away from a transfer nobody meant.

import { useMutation } from "convex/react";
import { Loader2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { AdminSellerRow } from "../../../convex/admin";
import { convexErrorMessage } from "../../lib/format";
import { Button } from "../ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";

/** Shape-only, so the button can disable before a round-trip. The server
 * re-validates with `assertValidEmail` — this is the easement, not the rule. */
function looksLikeEmail(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function TransferOwnershipDialog({
	seller,
	onClose,
}: {
	seller: AdminSellerRow;
	onClose: () => void;
}) {
	const transfer = useMutation(api.retailers.transferStoreOwnership);
	const [email, setEmail] = useState("");
	const [saving, setSaving] = useState(false);
	const trimmed = email.trim();
	const valid = looksLikeEmail(trimmed);

	async function save() {
		setSaving(true);
		try {
			await transfer({ retailerId: seller._id, email: trimmed });
			toast.success(`${seller.storeName} is now waiting for ${trimmed}.`, {
				description:
					"The previous owner has lost access. Next: Manage → Handover email → Send invitation.",
			});
			onClose();
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	return (
		<Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Transfer ownership — {seller.storeName}</DialogTitle>
					<DialogDescription>
						The current owner loses access immediately, and the store waits for
						the address below. Whoever signs in with it takes the store over,
						exactly like a store we built for them.
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-4">
					{/* The consequence, stated before the field rather than under the
					    button: everything stays except the person, and the bit an admin
					    would otherwise have to guess at is the plan. */}
					<div className="flex gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 dark:border-amber-800 dark:bg-amber-950/50">
						<TriangleAlert
							className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
							aria-hidden="true"
						/>
						<div className="flex flex-col gap-1 text-xs text-amber-900 dark:text-amber-200">
							<p>
								Products, orders, customers, settings and the team all stay with
								the store — <strong>including its plan and billing</strong>. A
								transfer moves the person, never the subscription.
							</p>
							<p>
								<strong>Any invoice still unpaid is voided.</strong> It can't
								follow the store to someone who didn't owe it, and left open it
								would lock the new owner's shop the day they claim.{" "}
								<strong>Settle it before transferring</strong> if it needs to be
								paid.
							</p>
							<p>
								Order and billing email is cleared until the new owner claims
								it, and the previous owner's saved card is removed — nothing can
								charge them for a store they no longer own. The new owner sets
								up auto-renewal themselves.
							</p>
							<p>
								While it waits: nothing bills, nothing locks, and the shop drops
								off kedaipal.com/stores. The storefront keeps taking orders by
								direct link throughout.
							</p>
						</div>
					</div>
					<label className="flex flex-col gap-1 text-sm font-medium">
						New owner's email
						<Input
							type="email"
							inputMode="email"
							autoComplete="off"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							placeholder="vendor@example.com"
							variant="field"
						/>
						{trimmed.length > 0 && !valid ? (
							<p className="text-sm font-normal text-destructive">
								✗ That doesn't look like an email address.
							</p>
						) : (
							<p className="text-xs font-normal text-muted-foreground">
								Must be the address they actually sign in with, and Clerk has to
								have verified it before the store can be claimed.
							</p>
						)}
					</label>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={onClose} disabled={saving}>
						Cancel
					</Button>
					<Button
						onClick={() => void save()}
						disabled={!valid || saving}
						className="bg-amber-700 text-white hover:bg-amber-800"
					>
						{saving ? (
							<Loader2 className="size-4 animate-spin" aria-hidden="true" />
						) : null}
						Transfer ownership
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
