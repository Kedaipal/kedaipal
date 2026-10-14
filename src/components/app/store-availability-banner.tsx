import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { MessageCircle, PauseCircle, PowerOff } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useAreaLock } from "../../hooks/useStoreLock";
import { useSupportWaNumber } from "../../hooks/useSupportWaNumber";
import { buildWaContactLink } from "../../lib/contact";
import { convexErrorMessage } from "../../lib/format";
import { Button } from "../ui/button";

/**
 * The dashboard-wide "you're not taking orders" strip (`z8r3fdudf7`), on every
 * page while the store is paused or offline — a closed shop is never
 * something a seller should find out from a quiet order inbox.
 *
 * Two cases, two tones:
 *  - the SELLER's own pause: calm amber, their note, and one-tap "Resume
 *    orders" (disabled-with-reason for a teammate without the grant);
 *  - KEDAIPAL's switch: firmer, with our note and a way to message us — the
 *    seller can't lift it themselves, so the banner says so.
 * An Off-Season Hold is NOT repeated here: the subscription banner already
 * owns that state and its way back.
 */
export function StoreAvailabilityBanner({
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
	const areaLock = useAreaLock("store_settings");
	const supportWa = useSupportWaNumber();
	const [resuming, setResuming] = useState(false);

	if (!status) return null;
	const a = status.availability;
	if (a.state === "open" || a.by === "hold") return null;

	if (a.by === "admin") {
		const offline = a.state === "offline";
		return (
			<div className="flex flex-col gap-3 border-b border-red-200 bg-red-50 px-5 py-3 dark:border-red-900 dark:bg-red-950/40 sm:flex-row sm:items-start sm:justify-between lg:px-8">
				<div className="flex items-start gap-3">
					<PowerOff
						className="mt-0.5 size-5 shrink-0 text-red-600 dark:text-red-400"
						aria-hidden
					/>
					<div className="flex flex-col gap-0.5">
						<p className="text-sm font-medium text-foreground/90">
							{offline
								? "Kedaipal has taken your store offline."
								: "Kedaipal has paused ordering at your store."}
						</p>
						<p className="text-sm text-foreground/70">
							{a.note ? `${a.note} ` : ""}
							{offline
								? "Buyers see that your store isn't available right now."
								: "Buyers can browse but can't order, at the counter too."}{" "}
							Orders already placed carry on as normal.
						</p>
					</div>
				</div>
				<Button
					asChild
					size="sm"
					className="tap-target w-full shrink-0 sm:w-auto"
				>
					<a
						href={buildWaContactLink(
							`Hi Kedaipal — ${storeName} ${offline ? "is offline" : "isn't taking orders"}. Can you tell me why and how to reopen?`,
							supportWa,
						)}
						target="_blank"
						rel="noreferrer"
					>
						<MessageCircle className="size-4" aria-hidden />
						Message us
					</a>
				</Button>
			</div>
		);
	}

	async function resume() {
		setResuming(true);
		try {
			await setAccepting({ retailerId, accepting: true });
			toast.success("You're taking orders again.");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setResuming(false);
		}
	}

	return (
		<div className="flex flex-col gap-3 border-b border-amber-200 bg-amber-50 px-5 py-3 dark:border-amber-900 dark:bg-amber-950/40 sm:flex-row sm:items-center sm:justify-between lg:px-8">
			<div className="flex items-start gap-3">
				<PauseCircle
					className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400"
					aria-hidden
				/>
				<div className="flex flex-col gap-0.5">
					<p className="text-sm font-medium text-foreground/90">
						Ordering is paused.
					</p>
					<p className="text-sm text-foreground/70">
						Buyers can browse but can't order online — your counter still works.
						{a.note ? ` Buyers see: “${a.note}”` : ""}
					</p>
					{areaLock.readOnly ? (
						<p className="text-xs text-foreground/60">{areaLock.reason}</p>
					) : null}
				</div>
			</div>
			<Button
				size="sm"
				onClick={() => void resume()}
				disabled={resuming || areaLock.readOnly}
				className="tap-target w-full shrink-0 sm:w-auto"
			>
				{resuming ? "Resuming…" : "Resume orders"}
			</Button>
		</div>
	);
}
