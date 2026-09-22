// The comp upgrade dialog (z8r3fdeub2), lifted out of the sellers route when
// the directory grew its table, cards and detail sheet (z8r3fdh37c). Behaviour
// is unchanged; comp-dialog.test.tsx pins it.

import { useMutation } from "convex/react";
import { Gift, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { AdminSellerRow } from "../../../convex/admin";
import {
	COMP_KIND_LABEL,
	COMP_KINDS,
	COMP_LABEL_MAX,
	COMP_NOTE_MAX,
	type CompKind,
} from "../../../convex/lib/comp";
import { convexErrorMessage, formatShortDate } from "../../lib/format";
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
import { Textarea } from "../ui/textarea";

/**
 * The comp upgrade toggle (z8r3fdeub2). A comp has no end date: an admin turns
 * it on and it stays on until an admin turns it off. Mounted only while open,
 * so the fields initialise from the row's current comp on every open — the same
 * dialog turns it ON, edits its details (kind / seller-facing label / internal
 * note) with no gap in access, and turns it OFF behind its own confirm that says
 * exactly what happens next: the store becomes an expired seller. Exported for
 * the dialog-states test.
 */
export function CompDialog({
	seller,
	onClose,
}: {
	seller: AdminSellerRow;
	onClose: () => void;
}) {
	const setComp = useMutation(api.subscriptions.setComp);
	const revokeComp = useMutation(api.subscriptions.revokeComp);
	const on = seller.comped;
	const [kind, setKind] = useState<CompKind>(seller.comp?.kind ?? "sponsor");
	const [label, setLabel] = useState(seller.comp?.label ?? "");
	const [note, setNote] = useState(seller.comp?.note ?? "");
	const [saving, setSaving] = useState(false);
	const [offOpen, setOffOpen] = useState(false);

	async function save() {
		setSaving(true);
		try {
			await setComp({
				retailerId: seller._id,
				kind,
				label: label.trim() || undefined,
				note: note.trim() || undefined,
			});
			toast.success(
				on
					? `Comp details updated for ${seller.storeName}.`
					: `Comp upgrade on — ${seller.storeName} has every feature with no limits, never billed.`,
			);
			onClose();
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	async function turnOff() {
		try {
			await revokeComp({ retailerId: seller._id });
			toast.success(
				`Comp upgrade off — ${seller.storeName} is now an expired store.`,
				{
					description:
						"Storefront stays live; their dashboard is view-only until they choose a plan. They've been emailed.",
				},
			);
			setOffOpen(false);
			onClose();
		} catch (err) {
			toast.error(convexErrorMessage(err));
			// Re-throw so the confirm dialog stays open behind the error toast.
			throw err;
		}
	}

	return (
		<>
			<Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Comp upgrade — {seller.storeName}</DialogTitle>
						<DialogDescription>
							Gives this store what an admin store gets — every feature, no
							limits, never billed — without admin access. There's no end date:
							it stays on until you turn it off.
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-4">
						{/* The toggle's current position, stated up front. */}
						<div
							className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${
								on
									? "border-violet-200 bg-violet-50 dark:border-violet-900 dark:bg-violet-950/40"
									: "border-input bg-background"
							}`}
						>
							<div className="flex min-w-0 items-center gap-2">
								<Gift
									className={`size-4 shrink-0 ${on ? "text-violet-600 dark:text-violet-300" : "text-muted-foreground"}`}
								/>
								<p className="text-sm font-medium">Comp upgrade</p>
							</div>
							<span
								className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
									on
										? "bg-violet-100 text-violet-700 dark:bg-violet-900/60 dark:text-violet-300"
										: "bg-muted text-muted-foreground"
								}`}
							>
								{on
									? seller.comp
										? `On · since ${formatShortDate(seller.comp.grantedAt)}`
										: "On"
									: "Off"}
							</span>
						</div>
						{!on ? (
							<p className="text-xs text-muted-foreground">
								Turning it on voids any pending invoice (a past-due lock lifts)
								and reopens a paused store for orders. The seller can't
								subscribe, change plan or pause while it's on.
							</p>
						) : null}
						<div className="flex flex-col gap-1.5">
							<span className="text-sm font-medium">Why is it free?</span>
							<div className="grid grid-cols-2 gap-2">
								{COMP_KINDS.map((k) => (
									<button
										key={k}
										type="button"
										onClick={() => setKind(k)}
										aria-pressed={kind === k}
										className={`h-11 rounded-xl border text-sm font-medium transition-colors ${
											kind === k
												? "border-accent bg-accent/10 text-accent"
												: "border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
										}`}
									>
										{COMP_KIND_LABEL[k]}
									</button>
								))}
							</div>
						</div>
						<div className="flex flex-col gap-1.5">
							<label htmlFor="comp-label" className="text-sm font-medium">
								Label{" "}
								<span className="font-normal text-muted-foreground">
									(optional)
								</span>
							</label>
							<Input
								id="comp-label"
								value={label}
								onChange={(e) => setLabel(e.target.value)}
								maxLength={COMP_LABEL_MAX}
								placeholder={'e.g. "Sponsored by Maybank SME"'}
							/>
							<p className="text-xs text-muted-foreground">
								The seller sees this on their billing tab, word for word.
							</p>
						</div>
						<div className="flex flex-col gap-1.5">
							<label htmlFor="comp-note" className="text-sm font-medium">
								Note{" "}
								<span className="font-normal text-muted-foreground">
									(optional)
								</span>
							</label>
							<Textarea
								id="comp-note"
								value={note}
								onChange={(e) => setNote(e.target.value)}
								maxLength={COMP_NOTE_MAX}
								rows={2}
								placeholder="Deal terms, contact person…"
							/>
							<p className="text-xs text-muted-foreground">
								Internal — only admins see this.
							</p>
						</div>
					</div>
					<DialogFooter>
						{on ? (
							<Button
								variant="destructive"
								onClick={() => setOffOpen(true)}
								disabled={saving}
								className="sm:mr-auto"
							>
								Turn off…
							</Button>
						) : null}
						<Button variant="outline" onClick={onClose} disabled={saving}>
							Cancel
						</Button>
						<Button onClick={save} disabled={saving}>
							{saving ? <Loader2 className="size-4 animate-spin" /> : null}
							{on ? "Save changes" : "Turn on comp upgrade"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<ConfirmDialog
				open={offOpen}
				onOpenChange={setOffOpen}
				destructive
				title={`Turn off ${seller.storeName}'s comp upgrade?`}
				description={
					<>
						The store becomes an <strong>expired seller</strong> straight away:
						the storefront stays live and buyers can still order, but the
						seller's dashboard goes <strong>view-only</strong> — they can't work
						their orders, edit products or change settings until they choose a
						plan and pay. No free period, and they're emailed that their
						sponsored access has ended. You can turn it back on any time.
					</>
				}
				confirmLabel="Turn off comp upgrade"
				onConfirm={turnOff}
			/>
		</>
	);
}
