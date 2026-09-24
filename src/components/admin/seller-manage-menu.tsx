// One door per row: everything an admin can do to a store lives in the Manage
// menu (owner decision, 20 Sep 2026). The row used to BE the act-as button
// with two bare icons beside it — three targets, two of them unlabelled, and a
// mis-tap on the row entered act-as. Now the row is inert (its name opens the
// read-only sheet) and the menu names each action with its consequence.
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { ChevronDown, Gift, Info, Loader2, Store, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { AdminSellerRow } from "../../../convex/admin";
import { useActAs } from "../../hooks/useActAs";
import { convexErrorMessage } from "../../lib/format";
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
	const [purgeOpen, setPurgeOpen] = useState(false);
	const [compOpen, setCompOpen] = useState(false);
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
					{/* Disabled-with-reason IN the item — a disabled menu row can't
					    show a hover title, so the reason is the subtitle. */}
					<DropdownMenuItem
						onSelect={() => setCompOpen(true)}
						disabled={seller.ownerIsAdmin}
						className="items-start"
					>
						<Gift
							className={cn(
								"mt-0.5 size-4",
								seller.comped
									? "text-violet-600 dark:text-violet-300"
									: "text-muted-foreground",
							)}
							aria-hidden="true"
						/>
						<span className="flex min-w-0 flex-col">
							<span className="font-medium">
								{seller.comped ? "Comp upgrade — on" : "Turn on comp upgrade"}
							</span>
							<span className="text-xs text-muted-foreground">
								{seller.ownerIsAdmin
									? "Admin store — always free already"
									: seller.comped
										? "Edit the sponsorship or turn it off"
										: "Every feature, no limits, never billed"}
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
			{compOpen ? (
				<CompDialog seller={seller} onClose={() => setCompOpen(false)} />
			) : null}
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
