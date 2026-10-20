import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { Lock } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { STORE_PAUSE_NOTE_MAX } from "../../../convex/lib/storeAvailability";
import { useAreaLock } from "../../hooks/useStoreLock";
import { useSupportWaNumber } from "../../hooks/useSupportWaNumber";
import { buildWaContactLink } from "../../lib/contact";
import { convexErrorMessage, formatShortDate } from "../../lib/format";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Skeleton } from "../ui/skeleton";
import { ToggleSwitch } from "../ui/toggle-switch";
import { SAVE_BTN_CLASS, SectionHeading } from "./settings-primitives";

/**
 * Settings → Store → Store status (`z8r3fdudf7`) — the seller's own "Accepting
 * orders" switch. FIRST on the Store tab: it is the most consequential setting
 * there, and a seller looking to close for a week should not scroll past their
 * store name and email to find it.
 *
 * Off = buyers can browse but not order, the counter still works (they're
 * standing at it), and billing carries on — the card says so, and points at
 * Off-Season Hold for pausing billing too. Saves on flip (a state, not a
 * form), like the marketplace switch below it.
 *
 * Disabled WITH its reason, never enabled-but-ineffective, whenever something
 * stronger holds the store: Kedaipal's switch (their note + a way to ask), an
 * Off-Season Hold (the way back is Billing), a lapsed plan or a missing
 * grant (`useAreaLock`).
 */
export function StoreStatusCard({
	retailerId,
	storeName,
}: {
	retailerId: Id<"retailers">;
	storeName: string;
}) {
	const status = useQuery(
		convexQuery(api.storeAvailability.forSeller, { retailerId }),
	).data;
	const setAccepting = useMutation(api.storeAvailability.setAcceptingOrders);
	const areaLock = useAreaLock("store_settings", { openWhenLapsed: true });
	const supportWa = useSupportWaNumber();
	const [saving, setSaving] = useState(false);
	const [note, setNote] = useState<string | null>(null);

	if (status === undefined)
		return (
			<div className="flex flex-col gap-4">
				<Skeleton className="h-5 w-40 rounded" />
				<Skeleton className="h-12 rounded-xl" />
			</div>
		);

	const a = status.availability;
	const byAdmin = a.state !== "open" && a.by === "admin";
	const byHold = a.state !== "open" && a.by === "hold";
	const accepting = !status.sellerPaused;
	const noteValue = note ?? status.sellerPauseNote ?? "";
	const noteDirty = noteValue.trim() !== (status.sellerPauseNote ?? "");

	const blockedReason = byAdmin
		? `Kedaipal ${a.state === "offline" ? "took this store offline" : "paused ordering at this store"}${a.note ? `: ${a.note}` : "."} You can't reopen it from here.`
		: byHold
			? "Your store is on an Off-Season Hold, so ordering is already paused. It reopens when you resume your plan in Billing."
			: areaLock.readOnly
				? areaLock.reason
				: null;

	async function flip(next: boolean) {
		setSaving(true);
		try {
			await setAccepting({
				retailerId,
				accepting: next,
				note: next ? undefined : noteValue,
			});
			toast.success(
				next
					? "You're taking orders again."
					: "Ordering paused — buyers can browse but can't order.",
			);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	async function saveNote(e: FormEvent) {
		e.preventDefault();
		if (!noteDirty) return;
		setSaving(true);
		try {
			await setAccepting({ retailerId, accepting: false, note: noteValue });
			setNote(null);
			toast.success(noteValue.trim() ? "Note updated." : "Note removed.");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="flex flex-col gap-4">
			<SectionHeading
				title="Store status"
				description="Close your shop for a while without changing anything else."
			/>
			<div className="flex items-center justify-between gap-3">
				<div className="flex flex-col">
					<span className="text-sm font-medium">Accepting orders</span>
					<span
						className={
							accepting && a.state === "open"
								? "text-xs text-accent-emphasis"
								: "text-xs text-muted-foreground"
						}
					>
						{a.state === "open"
							? "Open — buyers can order from your storefront"
							: byAdmin
								? a.state === "offline"
									? "Offline — your storefront isn't showing"
									: "Paused by Kedaipal"
								: byHold
									? "Paused — Off-Season Hold"
									: `Paused${status.sellerPausedAt !== undefined ? ` since ${formatShortDate(status.sellerPausedAt)}` : ""} — buyers can browse, not order`}
					</span>
				</div>
				<ToggleSwitch
					on={accepting && !byAdmin && !byHold}
					disabled={saving || blockedReason !== null}
					onChange={flip}
					label="Accepting orders"
				/>
			</div>

			{blockedReason ? (
				<div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/50 p-3 text-muted-foreground">
					<Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
					<p className="text-xs leading-relaxed">
						{blockedReason}{" "}
						{byAdmin ? (
							<a
								href={buildWaContactLink(
									`Hi Kedaipal — ${storeName} isn't taking orders. Can you tell me why and how to reopen?`,
									supportWa,
								)}
								target="_blank"
								rel="noreferrer"
								className="font-semibold text-accent-emphasis underline underline-offset-2"
							>
								Message us
							</a>
						) : byHold ? (
							<Link
								to="/app/settings"
								search={{ tab: "billing" }}
								className="font-semibold text-accent-emphasis underline underline-offset-2"
							>
								Open Billing
							</Link>
						) : null}
					</p>
				</div>
			) : null}

			{!accepting && !byAdmin && !byHold ? (
				<form onSubmit={saveNote} className="flex flex-col gap-1.5">
					<label htmlFor="store-pause-note" className="text-sm font-medium">
						Note for buyers{" "}
						<span className="font-normal text-muted-foreground">
							(optional)
						</span>
					</label>
					<Input
						id="store-pause-note"
						variant="field"
						value={noteValue}
						onChange={(e) => setNote(e.target.value)}
						placeholder="e.g. Back on 1 Nov — pre-orders open then"
						maxLength={STORE_PAUSE_NOTE_MAX}
						disabled={blockedReason !== null}
					/>
					<span className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
						<span>Shown on your storefront while ordering is paused.</span>
						<span className="shrink-0 tabular-nums">
							{noteValue.trim().length}/{STORE_PAUSE_NOTE_MAX}
						</span>
					</span>
					<Button
						type="submit"
						disabled={!noteDirty || saving || blockedReason !== null}
						className={SAVE_BTN_CLASS}
					>
						Save note
					</Button>
				</form>
			) : null}

			{/* What the SELLER's switch does — only beside that switch. Under
			    Kedaipal's switch or a hold the counter is closed too, so this
			    paragraph would be false there; their lock note says what is true. */}
			{byAdmin || byHold ? null : (
				<p className="text-xs text-muted-foreground">
					While paused, buyers can still browse your storefront but can't check
					out, book or RSVP. Your counter keeps working, orders already placed
					carry on, and billing continues — to pause billing between seasons,
					use Off-Season Hold in{" "}
					<Link
						to="/app/settings"
						search={{ tab: "billing" }}
						className="font-medium text-accent-emphasis underline underline-offset-2"
					>
						Billing
					</Link>
					.
				</p>
			)}
		</div>
	);
}
