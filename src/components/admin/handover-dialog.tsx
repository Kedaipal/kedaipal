// Naming (or clearing) the address that will claim a pre-built store — the
// "then change the email to theirs" step of the handover
// (docs/prebuilt-stores.md). Mounted only while open, so the field initialises
// from the row every time, exactly like comp-dialog.

import { useAction, useMutation } from "convex/react";
import { Loader2, MailCheck, Send, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { AdminSellerRow } from "../../../convex/admin";
import { convexErrorMessage, formatShortDate } from "../../lib/format";
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

/**
 * Set, change or clear a pre-built store's handover email.
 *
 * The dialog states the whole mechanism, because it is the one place an admin
 * decides it and the consequence is invisible otherwise: the vendor is never
 * emailed by us (we paste the link ourselves, as with every other admin
 * onboarding door), and what makes the handover happen is them SIGNING UP with
 * this address. An admin who doesn't know that would set the field and then
 * wait for something to send.
 */
export function HandoverDialog({
	seller,
	onClose,
}: {
	seller: AdminSellerRow;
	onClose: () => void;
}) {
	const setEmail = useMutation(api.retailers.setPendingOwnerEmail);
	const sendInvite = useAction(api.retailers.sendHandoverInvite);
	const [sending, setSending] = useState(false);
	const current = seller.pendingOwnerEmail ?? "";
	const [email, setEmailValue] = useState(current);
	const [saving, setSaving] = useState(false);
	const trimmed = email.trim();
	const clearing = trimmed.length === 0;
	const unchanged = trimmed.toLowerCase() === current.toLowerCase();
	// Clearing is allowed (an admin may have been given the wrong address), so
	// the only invalid state is a non-empty value that isn't an address.
	const valid = clearing || looksLikeEmail(trimmed);

	async function save() {
		setSaving(true);
		try {
			await setEmail({
				retailerId: seller._id,
				email: clearing ? undefined : trimmed,
			});
			toast.success(
				clearing
					? `Handover email cleared — ${seller.storeName} can't be claimed until you set one.`
					: `${seller.storeName} is waiting for ${trimmed}.`,
				{
					description: clearing
						? undefined
						: "Send them the sign-up link yourself — Kedaipal doesn't email it. The store becomes theirs when they sign up with that address.",
				},
			);
			onClose();
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	async function invite() {
		setSending(true);
		try {
			const res = await sendInvite({ retailerId: seller._id });
			toast.success(`Invitation sent to ${res.email}.`, {
				description:
					"They take the store over by signing in with that address — the email carries no link that works on its own.",
			});
			onClose();
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSending(false);
		}
	}

	return (
		<Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Handover email — {seller.storeName}</DialogTitle>
					<DialogDescription>
						Nobody owns this store yet. Whoever signs up with the address below
						becomes its owner — their first sign-in hands them the whole store,
						catalog and settings included.
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-4">
					<div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-muted-foreground/50 bg-background px-3 py-2.5">
						<div className="flex min-w-0 items-center gap-2">
							<UserPlus
								className="size-4 shrink-0 text-muted-foreground"
								aria-hidden="true"
							/>
							<p className="text-sm font-medium">Waiting for</p>
						</div>
						<span className="min-w-0 shrink truncate rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
							{current || "Nobody yet"}
						</span>
					</div>
					<label className="flex flex-col gap-1 text-sm font-medium">
						Their email
						<Input
							type="email"
							inputMode="email"
							autoComplete="off"
							value={email}
							onChange={(e) => setEmailValue(e.target.value)}
							placeholder="vendor@example.com"
							variant="field"
						/>
						{!valid ? (
							<p className="text-sm font-normal text-destructive">
								✗ That doesn't look like an email address.
							</p>
						) : (
							<p className="text-xs font-normal text-muted-foreground">
								Must be the address they actually sign up with, and it has to be
								verified before the store can be claimed. Leave it empty to
								clear.
							</p>
						)}
					</label>
					{/* Inviting sits AFTER the field, not beside the "Waiting for"
					    summary: it is what you do once the address is right, and the
					    saved address is what it sends to. Hidden entirely when no
					    address is saved — there is nothing to send to, and a disabled
					    button would need a reason that the empty field already gives.
					    Unsaved edits are named rather than silently ignored, because
					    "I typed the new address and pressed Send" is the obvious
					    mistake this layout invites. */}
					{current ? (
						<div className="flex flex-col gap-2 rounded-xl border border-input bg-muted/30 p-3">
							<div className="flex items-start gap-2">
								{seller.handoverInviteSentAt ? (
									<MailCheck
										className="mt-0.5 size-4 shrink-0 text-muted-foreground"
										aria-hidden="true"
									/>
								) : (
									<Send
										className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
										aria-hidden="true"
									/>
								)}
								<p className="text-xs text-muted-foreground">
									{seller.handoverInviteSentAt
										? `Invitation last sent ${formatShortDate(seller.handoverInviteSentAt)}. Send it again if they never got it.`
										: "They haven't been told yet. Send the invitation and they can take the store over themselves."}
								</p>
							</div>
							<Button
								type="button"
								variant="outline"
								className="h-11 w-full sm:h-9"
								onClick={() => void invite()}
								disabled={sending || saving || !unchanged}
							>
								{sending ? (
									<Loader2 className="size-4 animate-spin" aria-hidden="true" />
								) : (
									<Send className="size-4" aria-hidden="true" />
								)}
								{seller.handoverInviteSentAt
									? "Send invitation again"
									: "Send invitation"}
							</Button>
							{!unchanged ? (
								<p className="text-xs text-muted-foreground">
									Save the address above first — the invitation goes to{" "}
									<strong>{current}</strong>, not to what you've typed.
								</p>
							) : null}
						</div>
					) : null}
					<p className="text-xs text-muted-foreground">
						Until it's claimed: the storefront works by direct link (so you can
						show them), it stays off kedaipal.com/stores and out of search, and
						nothing is billed. The 14-day free period starts the day they claim
						it, not today.
					</p>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={onClose} disabled={saving}>
						Cancel
					</Button>
					<Button
						onClick={() => void save()}
						disabled={!valid || unchanged || saving}
					>
						{saving ? (
							<Loader2 className="size-4 animate-spin" aria-hidden="true" />
						) : null}
						{clearing ? "Clear handover email" : "Save handover email"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
