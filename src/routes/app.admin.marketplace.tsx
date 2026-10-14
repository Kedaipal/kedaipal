import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { ChevronDown, Plus, ShieldX } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Country } from "../../convex/lib/country";
import { COUNTRIES, COUNTRY_LABELS } from "../../convex/lib/country";
import { SHOWCASE_TITLE_MAX } from "../../convex/lib/showcase";
import type { AdminShowcase } from "../../convex/showcases";
import { ShowcaseRow } from "../components/admin/showcase-row";
import { PageHeader } from "../components/dashboard/page-header";
import { Button } from "../components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { SortableList } from "../components/ui/sortable-list";
import { convexErrorMessage } from "../lib/format";
import { cn } from "../lib/utils";

/**
 * Admin · Marketplace (z8r3fdr6mv) — what Kedaipal curates on
 * kedaipal.com/stores. Today that is the showcases; Store highlights are
 * still set per store from the Sellers directory, and a note here says so
 * rather than leaving an admin to hunt. Showcases are listed in /stores
 * order (drag to change it), the ended ones folded away but kept — an event
 * that happened is a record, not rubbish.
 */
export const Route = createFileRoute("/app/admin/marketplace")({
	component: AdminMarketplaceRoute,
});

function AdminMarketplaceRoute() {
	// Client gate is cosmetic — every showcases function is `requireAdmin`.
	const isAdmin = useQuery(convexQuery(api.billing.amIAdmin, {})).data;
	if (isAdmin === undefined) {
		return (
			<div className="flex flex-col gap-4 lg:max-w-4xl">
				<Skeleton className="h-7 w-40" />
				<Skeleton className="h-28 w-full rounded-2xl" />
				<Skeleton className="h-28 w-full rounded-2xl" />
			</div>
		);
	}
	if (!isAdmin) {
		return (
			<div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-16 text-center">
				<ShieldX className="size-8 text-muted-foreground" />
				<p className="font-medium">Not authorized</p>
				<p className="max-w-xs text-sm text-muted-foreground">
					This area is for Kedaipal admins only.
				</p>
			</div>
		);
	}
	return <AdminMarketplaceContent />;
}

export function AdminMarketplaceContent() {
	const showcases = useQuery(convexQuery(api.showcases.listForAdmin, {})).data;
	const reorder = useMutation(api.showcases.reorder);
	const [creating, setCreating] = useState(false);
	const [showEnded, setShowEnded] = useState(false);

	const active = (showcases ?? []).filter((s) => s.state !== "ended");
	const ended = (showcases ?? []).filter((s) => s.state === "ended");

	async function handleReorder(orderedIds: string[]) {
		try {
			await reorder({
				orderedIds: orderedIds as AdminShowcase["_id"][],
			});
		} catch (err) {
			toast.error(convexErrorMessage(err));
		}
	}

	const newButton = (
		<Button
			type="button"
			onClick={() => setCreating(true)}
			className="tap-target font-bold"
		>
			<Plus aria-hidden />
			New showcase
		</Button>
	);

	return (
		<div className="flex flex-col gap-6 lg:max-w-4xl">
			<PageHeader
				title="Marketplace"
				subtitle={
					<>
						Curate what buyers see on{" "}
						<a
							href="/stores"
							target="_blank"
							rel="noreferrer"
							className="font-medium text-accent-emphasis underline underline-offset-2"
						>
							kedaipal.com/stores
						</a>
						.
					</>
				}
				actions={newButton}
			/>
			<section className="flex items-start justify-between gap-3 lg:hidden">
				<div className="flex flex-col gap-0.5">
					<h2 className="text-xl font-bold">Marketplace</h2>
					<p className="text-sm text-muted-foreground">
						Curate what buyers see on /stores
					</p>
				</div>
				{newButton}
			</section>

			<section className="flex flex-col gap-3">
				<div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between">
					<h3 className="font-heading text-base font-extrabold">Showcases</h3>
					<p className="text-xs text-muted-foreground">
						Shown at the top of /stores, above Store highlights, in this order.
						Drag to reorder.
					</p>
				</div>

				{showcases === undefined ? (
					<div className="flex flex-col gap-3">
						<Skeleton className="h-28 w-full rounded-2xl" />
						<Skeleton className="h-28 w-full rounded-2xl" />
					</div>
				) : active.length === 0 ? (
					<div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-12 text-center">
						<p className="text-sm font-semibold">No showcase yet</p>
						<p className="max-w-sm text-xs text-muted-foreground">
							A showcase groups the stores at an event — a bazaar, a fair, a
							pop-up — under one banner at the top of /stores, for as long as
							you say. Buyers who scan the booth QR land right on it.
						</p>
						{newButton}
					</div>
				) : (
					<SortableList
						items={active}
						getId={(s) => s._id}
						onReorder={handleReorder}
						className="flex flex-col gap-3"
						renderItem={(showcase, handle, state) => (
							<ShowcaseRow
								showcase={showcase}
								dragHandle={handle}
								compact={state.isSorting}
							/>
						)}
					/>
				)}

				{ended.length > 0 ? (
					<div className="flex flex-col gap-3 border-t border-border pt-3">
						<button
							type="button"
							aria-expanded={showEnded}
							onClick={() => setShowEnded((v) => !v)}
							className="tap-target flex w-full items-center justify-between px-1 text-left text-[13.5px] font-bold text-muted-foreground"
						>
							<span>
								Ended ({ended.length}) · kept for reference, never shown
							</span>
							<ChevronDown
								aria-hidden
								className={cn(
									"size-4 transition-transform",
									showEnded && "rotate-180",
								)}
							/>
						</button>
						{showEnded ? (
							<ul className="flex flex-col gap-3">
								{ended.map((s) => (
									<li key={s._id}>
										<ShowcaseRow showcase={s} />
									</li>
								))}
							</ul>
						) : null}
					</div>
				) : null}
			</section>

			<section className="rounded-2xl border border-dashed border-border bg-card px-4 py-3.5">
				<h3 className="text-sm font-bold">Store highlights</h3>
				<p className="mt-0.5 text-xs text-muted-foreground">
					Paid and comped highlights are still set per store, from Sellers →
					Manage → Highlight.{" "}
					<Link
						to="/app/admin/sellers"
						className="font-medium text-accent-emphasis underline underline-offset-2"
					>
						Open Sellers
					</Link>
				</p>
			</section>

			<NewShowcaseDialog open={creating} onOpenChange={setCreating} />
		</div>
	);
}

/**
 * Two facts and the showcase exists — as a draft, with the admin landing in
 * the editor next. The region is asked here because it can't change once
 * stores are in (every member must share it).
 */
function NewShowcaseDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const create = useMutation(api.showcases.create);
	const navigate = useNavigate();
	const [title, setTitle] = useState("");
	const [country, setCountry] = useState<Country>("MY");
	const [busy, setBusy] = useState(false);
	const trimmed = title.trim();

	async function handleCreate() {
		if (!trimmed) return;
		setBusy(true);
		try {
			const showcaseId = await create({ title: trimmed, country });
			onOpenChange(false);
			setTitle("");
			void navigate({
				to: "/app/admin/marketplace/$showcaseId",
				params: { showcaseId },
			});
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>New showcase</DialogTitle>
					<DialogDescription>
						Starts as a draft — add stores and publish when it's ready. The
						region can't change once stores are in.
					</DialogDescription>
				</DialogHeader>
				<form
					className="flex flex-col gap-4"
					onSubmit={(e) => {
						e.preventDefault();
						void handleCreate();
					}}
				>
					<label className="flex flex-col gap-1.5 text-sm font-medium">
						Title
						<Input
							variant="field"
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							placeholder="Malaysia Campfest 2026"
							maxLength={SHOWCASE_TITLE_MAX}
							autoFocus
						/>
						<span className="text-right text-xs font-normal tabular-nums text-muted-foreground">
							{trimmed.length}/{SHOWCASE_TITLE_MAX}
						</span>
					</label>
					<fieldset className="flex flex-col gap-1.5">
						<legend className="text-sm font-medium">Region</legend>
						<div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
							{COUNTRIES.map((c) => (
								<button
									key={c}
									type="button"
									aria-pressed={country === c}
									onClick={() => setCountry(c)}
									className={cn(
										"tap-target rounded-lg text-sm font-bold transition-colors",
										country === c
											? "bg-card shadow-sm"
											: "text-muted-foreground hover:text-foreground",
									)}
								>
									{COUNTRY_LABELS[c]}
								</button>
							))}
						</div>
					</fieldset>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							className="tap-target"
						>
							Cancel
						</Button>
						<Button
							type="submit"
							disabled={!trimmed || busy}
							isLoading={busy}
							className="tap-target font-bold"
						>
							Create &amp; add stores
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
