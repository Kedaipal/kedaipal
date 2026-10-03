// One door per row: everything an admin can do to a store lives in the Manage
// menu (owner decision, 20 Sep 2026). The row used to BE the act-as button
// with two bare icons beside it — three targets, two of them unlabelled, and a
// mis-tap on the row entered act-as. Now the row is inert (its name opens the
// read-only sheet) and the menu names each action with its consequence.
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import {
	ChevronDown,
	Eye,
	EyeOff,
	Gift,
	Info,
	Loader2,
	Megaphone,
	Store,
	Trash2,
	UserPlus,
	UserRoundCog,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { AdminSellerRow } from "../../../convex/admin";
import { HIDDEN_NOTE_MAX } from "../../../convex/lib/marketplaceListing";
import { useActAs } from "../../hooks/useActAs";
import {
	highlightedThroughLabel,
	sellerCompMenuItem,
	sellerHighlight,
} from "../../lib/admin-seller-view";
import { convexErrorMessage, formatShortDate } from "../../lib/format";
import { cn } from "../../lib/utils";
import { ConfirmDialog } from "../ui/confirm-dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { CompDialog } from "./comp-dialog";
import { HandoverDialog } from "./handover-dialog";
import { HighlightDialog } from "./highlight-dialog";
import { TransferOwnershipDialog } from "./transfer-ownership-dialog";

/**
 * Enter act-as for a store: start the session, audit the tenant ENTRY
 * (read-side attributability — fire-and-forget, a failed log must never block
 * onboarding), then open the seller's dashboard. From here the session holds
 * across all navigation + CRUD until the admin Exits. Shared by the Manage
 * menu and the detail sheet's primary button so the two doors can't drift.
 */
export function useOpenStore(seller: AdminSellerRow): () => void {
	const navigate = useNavigate();
	const { setActAs } = useActAs();
	const startActAsSession = useMutation(api.admin.startActAsSession);
	return () => {
		if (seller.purging) return;
		setActAs(seller._id);
		void startActAsSession({ retailerId: seller._id }).catch(() => {});
		navigate({ to: "/app" });
	};
}

/** The locked-row stand-in while a dev purge cascade runs (z8r3fdbmc9). */
export function DeletingPill({ className }: { className?: string }) {
	return (
		<span
			className={cn(
				"flex shrink-0 items-center gap-1.5 rounded-xl bg-muted px-4 text-sm font-semibold text-muted-foreground",
				className,
			)}
		>
			<Loader2 className="size-4 animate-spin" aria-hidden="true" />
			Deleting…
		</span>
	);
}

export function SellerManageMenu({
	seller,
	purgeEnabled,
	onViewDetails,
	className,
}: {
	seller: AdminSellerRow;
	/** Dev deployments only (z8r3fdbmc9) — the server re-checks. */
	purgeEnabled: boolean;
	/** Absent where the menu already sits inside the sheet. */
	onViewDetails?: (seller: AdminSellerRow) => void;
	/** Trigger height/padding for the surface (the table wants 36px). */
	className?: string;
}) {
	const openStore = useOpenStore(seller);
	const purgeStore = useMutation(api.admin.purgeStoreForAdmin);
	const hideStore = useMutation(api.admin.hideFromMarketplace);
	const showStore = useMutation(api.admin.showOnMarketplace);
	const [purgeOpen, setPurgeOpen] = useState(false);
	const [hideOpen, setHideOpen] = useState(false);
	const [compOpen, setCompOpen] = useState(false);
	const [handoverOpen, setHandoverOpen] = useState(false);
	const [transferOpen, setTransferOpen] = useState(false);
	// Title/subtitle/tone for the comp item — one pure author in
	// admin-seller-view.ts, where the row's other derived sentences live.
	const compItem = sellerCompMenuItem(seller);
	const [highlightOpen, setHighlightOpen] = useState(false);
	// Where the store stands on Store highlights — the item says it before the
	// dialog opens: why it's on (paid window / comp), or why it can't be.
	const highlight = sellerHighlight(seller, Date.now());
	const hidden = seller.marketplace.hidden;
	const highlightItem = seller.marketplace.internal
		? {
				title: "Store highlights",
				hint: "Internal store — never listed on /stores",
				on: false,
			}
		: highlight.source === "paid" &&
				seller.marketplace.sponsoredUntil !== undefined
			? {
					title: "Store highlights — on",
					hint: `Through ${highlightedThroughLabel(seller.marketplace.sponsoredUntil)} — edit or end early`,
					on: true,
				}
			: highlight.source === "comp"
				? {
						title: "Store highlights — on",
						hint: "While comped — turn off if needed",
						on: true,
					}
				: highlight.compEligible
					? {
							title: "Store highlights — off",
							hint: "Comped, but kept off by an admin",
							on: false,
						}
					: {
							title: "Feature in Store highlights",
							hint: "A dated window on kedaipal.com/stores",
							on: false,
						};
	// A highlight keeps its setting while the store is hidden, but nothing
	// shows — the item must not read as featured right above "Show on
	// /stores again".
	const highlightPaused = hidden !== undefined && highlightItem.on;

	async function confirmHide(note?: string) {
		try {
			await hideStore({ retailerId: seller._id, note });
			toast.success(`${seller.storeName} is hidden from /stores.`);
		} catch (err) {
			toast.error(convexErrorMessage(err));
			throw err;
		}
	}

	// Showing a store again is the default being restored, and one more click
	// undoes it — so no confirm step. The toast says when it still won't show.
	async function showAgain() {
		try {
			await showStore({ retailerId: seller._id });
			toast.success(
				seller.marketplace.unlistedAt !== undefined
					? `${seller.storeName} is no longer hidden, but the seller has opted out, so it still won't show.`
					: `${seller.storeName} can appear on /stores again.`,
			);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		}
	}

	// Server truth (`purging` rides the directory row, so every admin session
	// locks) OR the just-clicked local echo, which bridges the moment before
	// the reactive query refreshes.
	const [localPurging, setLocalPurging] = useState(false);
	const purging = seller.purging || localPurging;

	async function confirmPurge() {
		try {
			const result = await purgeStore({
				retailerId: seller._id,
				confirmSlug: seller.slug,
			});
			setLocalPurging(true);
			// The cascade is async — the row vanishes from this list when the
			// retailer doc goes in its final phase, usually within seconds.
			toast.success(
				`Deleting ${result.storeName} — the row disappears once the erase finishes, then that login onboards fresh.`,
			);
		} catch (err) {
			toast.error(convexErrorMessage(err));
			// Re-throw so the dialog stays open behind the error toast.
			throw err;
		}
	}

	if (purging) {
		return <DeletingPill className={cn("h-11", className)} />;
	}
	const onContract = seller.enterprise !== undefined;

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						aria-label={`Manage ${seller.storeName}`}
						className={cn(
							"flex h-11 shrink-0 items-center justify-center gap-1 rounded-xl bg-accent/10 px-4 text-sm font-semibold text-accent-emphasis transition-colors hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-open:bg-accent/15",
							className,
						)}
					>
						Manage
						<ChevronDown className="size-4" aria-hidden="true" />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-72">
					{/* Each item carries its consequence — the old bare icons made
					    the admin hover to learn what they did. */}
					<DropdownMenuItem onSelect={openStore} className="items-start">
						<Store
							className="mt-0.5 size-4 text-muted-foreground"
							aria-hidden="true"
						/>
						<span className="flex min-w-0 flex-col">
							<span className="font-medium">Open store</span>
							<span className="text-xs text-muted-foreground">
								Act-as mode — you operate it as the seller, logged to your admin
								account
							</span>
						</span>
					</DropdownMenuItem>
					{onViewDetails ? (
						<DropdownMenuItem
							onSelect={() => onViewDetails(seller)}
							className="items-start"
						>
							<Info
								className="mt-0.5 size-4 text-muted-foreground"
								aria-hidden="true"
							/>
							<span className="flex min-w-0 flex-col">
								<span className="font-medium">View details</span>
								<span className="text-xs text-muted-foreground">
									Every contact and billing fact, each one copyable
								</span>
							</span>
						</DropdownMenuItem>
					) : null}
					{/* The "who owns this store" slot, placed before the commercial
					    items: the open question about a store in handover is WHO it
					    is for, not what it costs. ONE slot, two states — a store
					    nobody owns yet names the address that will claim it, and a
					    store that already has an owner hands it to someone else.
					    Both end in the same place (`pendingOwnerEmail` + the ordinary
					    claim), so showing them as two unrelated actions would be two
					    controls for one idea (docs/prebuilt-stores.md). */}
					{seller.unclaimed ? (
						<DropdownMenuItem
							onSelect={() => setHandoverOpen(true)}
							className="items-start"
						>
							<UserPlus
								className={cn(
									"mt-0.5 size-4",
									seller.pendingOwnerEmail
										? "text-muted-foreground"
										: "text-amber-600 dark:text-amber-400",
								)}
								aria-hidden="true"
							/>
							<span className="flex min-w-0 flex-col">
								<span className="font-medium">
									{seller.pendingOwnerEmail
										? "Handover email — set"
										: "Set handover email"}
								</span>
								<span className="text-xs text-muted-foreground">
									{seller.pendingOwnerEmail
										? `Waiting for ${seller.pendingOwnerEmail} to sign up`
										: "Nobody can claim this store until you name their email"}
								</span>
							</span>
						</DropdownMenuItem>
					) : (
						<DropdownMenuItem
							onSelect={() => setTransferOpen(true)}
							className="items-start"
						>
							<UserRoundCog
								className="mt-0.5 size-4 text-muted-foreground"
								aria-hidden="true"
							/>
							<span className="flex min-w-0 flex-col">
								<span className="font-medium">Transfer ownership</span>
								<span className="text-xs text-muted-foreground">
									Hand the store to a different email — the plan, team and
									everything else stay
								</span>
							</span>
						</DropdownMenuItem>
					)}
					{/* Disabled-with-reason IN the item — a disabled menu row can't
					    show a hover title, so the reason is the subtitle.

					    A pre-built store is ALWAYS comped (the `internal` comp keeps
					    it unbilled while an admin builds it), so the plain comped
					    copy called that scaffolding a "sponsorship" and offered to
					    "turn it off" — the same lie the Sponsored pill told before
					    `tierPill` learned about unclaimed stores, on the one surface
					    that still believed it (2 Oct). It stays ENABLED rather than
					    disabled: setting a REAL partner/sponsor comp before handover
					    is supported and survives the claim
					    (`startFreePeriodOnClaim`), so refusing here would block a
					    flow we deliberately kept. */}
					<DropdownMenuItem
						onSelect={() => setCompOpen(true)}
						// A contract store is never comped too (T6) — the server
						// refuses it; the reason sits in the subtitle.
						disabled={seller.ownerIsAdmin || onContract}
						className="items-start"
					>
						<Gift
							className={cn(
								"mt-0.5 size-4",
								compItem.sponsored
									? "text-violet-600 dark:text-violet-300"
									: "text-muted-foreground",
							)}
							aria-hidden="true"
						/>
						<span className="flex min-w-0 flex-col">
							<span className="font-medium">{compItem.title}</span>
							<span className="text-xs text-muted-foreground">
								{compItem.hint}
							</span>
						</span>
					</DropdownMenuItem>
					{/* Disabled-with-reason for an internal store, like the comp item. */}
					<DropdownMenuItem
						onSelect={() => setHighlightOpen(true)}
						disabled={seller.marketplace.internal}
						className="items-start"
					>
						<Megaphone
							className={cn(
								"mt-0.5 size-4",
								highlightItem.on && !highlightPaused
									? "text-accent-emphasis"
									: "text-muted-foreground",
							)}
							aria-hidden="true"
						/>
						<span className="flex min-w-0 flex-col">
							<span className="font-medium">{highlightItem.title}</span>
							<span className="text-xs text-muted-foreground">
								{highlightPaused
									? "Paused while hidden from /stores"
									: highlightItem.hint}
							</span>
						</span>
					</DropdownMenuItem>
					{/* Beside highlights: both are the store's place on /stores. */}
					<DropdownMenuItem
						onSelect={hidden ? () => void showAgain() : () => setHideOpen(true)}
						disabled={seller.marketplace.internal}
						className="items-start"
					>
						{hidden ? (
							<Eye
								className="mt-0.5 size-4 text-muted-foreground"
								aria-hidden="true"
							/>
						) : (
							<EyeOff
								className="mt-0.5 size-4 text-muted-foreground"
								aria-hidden="true"
							/>
						)}
						<span className="flex min-w-0 flex-col">
							<span className="font-medium">
								{hidden ? "Show on /stores again" : "Hide from /stores"}
							</span>
							<span className="text-xs text-muted-foreground">
								{seller.marketplace.internal
									? "Internal store — never listed anyway"
									: hidden
										? `Hidden since ${formatShortDate(hidden.at)}`
										: "Off the directory — storefront and orders unaffected"}
							</span>
						</span>
					</DropdownMenuItem>
					{purgeEnabled ? (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								onSelect={() => setPurgeOpen(true)}
								className="items-start text-destructive focus:bg-destructive/10 focus:text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
							>
								<Trash2 className="mt-0.5 size-4" aria-hidden="true" />
								<span className="flex min-w-0 flex-col">
									<span className="font-medium">Delete store</span>
									<span className="text-xs opacity-80">
										Dev only — erases everything; the login onboards fresh
									</span>
								</span>
							</DropdownMenuItem>
						</>
					) : null}
				</DropdownMenuContent>
			</DropdownMenu>
			{handoverOpen ? (
				<HandoverDialog
					seller={seller}
					onClose={() => setHandoverOpen(false)}
				/>
			) : null}
			{transferOpen ? (
				<TransferOwnershipDialog
					seller={seller}
					onClose={() => setTransferOpen(false)}
				/>
			) : null}
			{compOpen ? (
				<CompDialog seller={seller} onClose={() => setCompOpen(false)} />
			) : null}
			{highlightOpen ? (
				<HighlightDialog
					seller={seller}
					onClose={() => setHighlightOpen(false)}
				/>
			) : null}
			<ConfirmDialog
				open={hideOpen}
				onOpenChange={setHideOpen}
				title={`Hide ${seller.storeName} from /stores?`}
				description={
					<>
						Buyers won't find it on kedaipal.com/stores, in its search or on
						Store highlights, whatever the seller's own switch says. Its
						storefront link, orders and WhatsApp carry on as normal. The seller
						sees that Kedaipal hid it in Settings → Store, and you can show it
						again from this menu.
					</>
				}
				reason={{
					label: "Note to the seller",
					placeholder: "e.g. Add real product photos and we'll relist you.",
					maxLength: HIDDEN_NOTE_MAX,
					helper: "Shown to the seller in Settings → Store.",
				}}
				confirmLabel="Hide from /stores"
				onConfirm={confirmHide}
			/>
			{purgeEnabled ? (
				<ConfirmDialog
					open={purgeOpen}
					onOpenChange={setPurgeOpen}
					destructive
					title={`Delete ${seller.storeName}?`}
					description={
						<>
							Dev-only test reset. Erases <strong>everything</strong> this store
							owns — products, orders, customers, settings, images — and the
							store itself, exactly like the account-deletion cascade. The
							owner's login survives, so opening /onboarding afterwards starts a
							fresh store. This cannot be undone.
						</>
					}
					confirmPhrase={seller.slug}
					confirmLabel="Delete store"
					onConfirm={confirmPurge}
				/>
			) : null}
		</>
	);
}
