// Putting right a referral the link didn't capture (z8r3fdetf5,
// docs/referrals.md) — the seller signed up in another browser, or the intro
// was made off-link. Mounted only while open, so the field initialises from
// the row every time (the handover-dialog / comp-dialog shape).

import { useMutation } from "convex/react";
import { Gift } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { AdminSellerRow } from "../../../convex/admin";
import { sanitizeReferrerSlug } from "../../../convex/lib/poweredBy";
import { referralRefereeOffer } from "../../../convex/lib/referral";
import { convexErrorMessage } from "../../lib/format";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { InputPrefixFrame } from "../ui/input-prefix-frame";

/**
 * Set, change or remove who referred a store.
 *
 * The dialog states what the choice DOES, because the consequence is
 * invisible otherwise: the referral decides who gets bonus credits when this
 * store pays its first invoice. The server applies the link's own rules — the
 * referrer must be on an active (or comped) plan, a store can't refer itself —
 * and its refusal is shown under the field, naming the reason.
 */
export function ReferralDialog({
	seller,
	onClose,
}: {
	seller: AdminSellerRow;
	onClose: () => void;
}) {
	const setReferrer = useMutation(api.referrals.adminSetReferrer);
	const clearReferral = useMutation(api.referrals.adminClearReferral);
	const current = seller.referral?.referrer?.slug ?? "";
	const [slug, setSlug] = useState(current);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [confirmRemove, setConfirmRemove] = useState(false);
	const offer = referralRefereeOffer();
	const clean = sanitizeReferrerSlug(slug);
	const unchanged = clean !== undefined && clean === current;

	async function save() {
		if (!clean) return;
		setSaving(true);
		setError(null);
		try {
			await setReferrer({ refereeId: seller._id, referrerSlug: clean });
			toast.success(`${seller.storeName} is now referred by /${clean}.`, {
				description:
					"Both stores get their bonus credits when this store pays its first invoice.",
			});
			onClose();
		} catch (err) {
			setError(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	async function remove() {
		setSaving(true);
		try {
			await clearReferral({ refereeId: seller._id });
			toast.success(`Referral removed from ${seller.storeName}.`);
			onClose();
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
			setConfirmRemove(false);
		}
	}

	return (
		<>
			<Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Referred by — {seller.storeName}</DialogTitle>
						<DialogDescription>
							The store that referred {seller.storeName}. When{" "}
							{seller.storeName} pays its first invoice it gets {offer.pro}{" "}
							bonus credits on Pro ({offer.starter} on Starter), and the
							referrer gets bonus credits too unless it's comped.
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-2">
						<label
							htmlFor="referrer-slug"
							className="flex items-center gap-1.5 text-sm font-medium"
						>
							<Gift className="size-4 text-accent" aria-hidden />
							Referrer's store link
						</label>
						<InputPrefixFrame
							prefix={<span className="text-sm">kedaipal.com/</span>}
							invalid={error !== null}
						>
							<Input
								id="referrer-slug"
								variant="bare"
								autoComplete="off"
								autoCapitalize="none"
								value={slug}
								onChange={(e) => {
									setSlug(e.target.value);
									setError(null);
								}}
								placeholder="their-store"
								className="min-h-11 flex-1 px-3 font-mono text-base"
								aria-invalid={error !== null}
							/>
						</InputPrefixFrame>
						{error ? (
							<p className="text-sm text-destructive">{error}</p>
						) : (
							<p className="text-xs text-muted-foreground">
								Must be a store on an active or comped plan. Locked once{" "}
								{seller.storeName} pays its first invoice.
							</p>
						)}
					</div>
					<DialogFooter className="sm:justify-between">
						{seller.referral ? (
							<Button
								type="button"
								variant="ghost"
								className="text-destructive hover:text-destructive"
								onClick={() => setConfirmRemove(true)}
								disabled={saving}
							>
								Remove referral
							</Button>
						) : (
							<span />
						)}
						<Button
							type="button"
							onClick={save}
							disabled={!clean || unchanged || saving}
							isLoading={saving}
						>
							{seller.referral ? "Change referrer" : "Set referrer"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<ConfirmDialog
				open={confirmRemove}
				onOpenChange={setConfirmRemove}
				title={`Remove ${seller.storeName}'s referral?`}
				description={`Nobody will get referral bonus credits when ${seller.storeName} pays its first invoice.`}
				confirmLabel="Remove referral"
				destructive
				onConfirm={remove}
			/>
		</>
	);
}
