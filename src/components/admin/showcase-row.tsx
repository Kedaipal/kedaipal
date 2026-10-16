import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { MoreHorizontal } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { SHOWCASE_THEME_LABELS } from "../../../convex/lib/showcase";
import type { AdminShowcase } from "../../../convex/showcases";
import {
	showcaseMetaLine,
	showcaseStatusLabel,
} from "../../lib/admin-showcase";
import { convexErrorMessage } from "../../lib/format";
import { showcaseLook, showcasePath } from "../../lib/showcase";
import { cn } from "../../lib/utils";
import { AppImage } from "../ui/app-image";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../ui/dropdown-menu";

/**
 * One showcase in the admin list (z8r3fdr6mv): its look as a thumbnail, the
 * status pill, the facts an admin scans for (region, window, stores, how
 * many won't show), and the actions — Edit, View on /stores, and a menu for
 * Copy link / Unpublish / Publish / Delete. Publishing from here is refused
 * for an empty showcase by the server, and the toast says why.
 */
export function ShowcaseRow({
	showcase,
	dragHandle,
	compact = false,
}: {
	showcase: AdminShowcase;
	dragHandle?: ReactNode;
	/** While a drag is in progress every row collapses to one line. */
	compact?: boolean;
}) {
	const now = Date.now();
	const status = showcaseStatusLabel(showcase, now);
	const hidden = showcase.members.filter((m) => m.notListed !== null).length;
	const live = showcase.state === "live";
	return (
		<div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 lg:p-4">
			{dragHandle}
			{compact ? null : <Thumb showcase={showcase} />}
			<div className="flex min-w-0 grow flex-col gap-1">
				<div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
					<span className="truncate font-heading text-[15px] font-extrabold">
						{showcase.title}
					</span>
					<StatusPill tone={status.tone} label={status.label} />
				</div>
				{compact ? null : (
					<>
						<span className="line-clamp-2 text-xs text-muted-foreground sm:line-clamp-1">
							{showcaseMetaLine(
								showcase,
								SHOWCASE_THEME_LABELS[showcase.theme],
							)}
						</span>
						<span className="text-xs text-muted-foreground">
							{showcase.members.length === 0 ? (
								<span className="font-semibold text-amber-700 dark:text-amber-300">
									No stores yet. Add some before publishing.
								</span>
							) : (
								<>
									{showcase.members.length}{" "}
									{showcase.members.length === 1 ? "store" : "stores"}
									{hidden > 0 ? (
										<>
											{" · "}
											<span className="font-semibold text-amber-700 dark:text-amber-300">
												{hidden} not shown to buyers
											</span>
										</>
									) : null}
								</>
							)}
						</span>
					</>
				)}
			</div>
			{compact ? null : (
				<div className="flex shrink-0 items-center gap-2">
					{live ? (
						<Button
							asChild
							variant="outline"
							className="tap-target hidden font-semibold sm:inline-flex"
						>
							<a
								href={showcasePath(showcase.slug)}
								target="_blank"
								rel="noreferrer"
							>
								View on /stores
							</a>
						</Button>
					) : null}
					<Button asChild className="tap-target font-bold">
						<Link
							to="/app/admin/showcases/$showcaseId"
							params={{ showcaseId: showcase._id }}
						>
							Edit
						</Link>
					</Button>
					<ShowcaseMenu showcase={showcase} />
				</div>
			)}
		</div>
	);
}

function Thumb({ showcase }: { showcase: AdminShowcase }) {
	const look = showcaseLook(showcase);
	return (
		<span
			aria-hidden
			style={look.style}
			className={cn(
				look.className,
				"relative hidden h-[74px] w-[132px] shrink-0 overflow-hidden rounded-xl bg-showcase sm:block",
			)}
		>
			{showcase.coverImageUrl ? (
				<AppImage
					src={showcase.coverImageUrl}
					alt=""
					aspect="absolute inset-0 h-full w-full"
					sizes="132px"
					objectFit="cover"
					className="opacity-80"
				/>
			) : null}
			<span className="absolute inset-x-0 bottom-0 line-clamp-2 px-2.5 pb-2 font-heading text-[12px] font-black leading-[1.1] text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">
				{showcase.title}
			</span>
		</span>
	);
}

export function StatusPill({
	tone,
	label,
}: {
	tone: "live" | "scheduled" | "draft" | "ended";
	label: string;
}) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold",
				tone === "live" && "bg-accent/15 text-accent-emphasis",
				tone === "scheduled" &&
					"bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200",
				tone === "draft" && "bg-muted text-muted-foreground",
				tone === "ended" && "bg-muted text-muted-foreground",
			)}
		>
			{tone === "live" ? (
				<span aria-hidden className="size-1.5 rounded-full bg-accent" />
			) : null}
			{label}
		</span>
	);
}

/** Copy link · Unpublish/Publish · Delete… — one menu, the directory's
 * Manage-menu posture (one door per row). */
export function ShowcaseMenu({ showcase }: { showcase: AdminShowcase }) {
	const publish = useMutation(api.showcases.publish);
	const unpublish = useMutation(api.showcases.unpublish);
	const remove = useMutation(api.showcases.remove);
	const [confirmDelete, setConfirmDelete] = useState(false);

	async function run(work: () => Promise<unknown>, done: string) {
		try {
			await work();
			toast.success(done);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		}
	}
	async function copyLink() {
		try {
			await navigator.clipboard.writeText(
				`${window.location.origin}${showcasePath(showcase.slug)}`,
			);
			toast.success("Showcase link copied.");
		} catch {
			toast.error("Couldn't copy — your browser blocked the clipboard.");
		}
	}

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="outline"
						size="icon"
						className="tap-target"
						aria-label={`More actions for ${showcase.title}`}
					>
						<MoreHorizontal aria-hidden />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-64">
					<DropdownMenuItem onSelect={() => void copyLink()}>
						Copy showcase link
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					{showcase.publishedAt === undefined ? (
						<DropdownMenuItem
							onSelect={() =>
								void run(
									() => publish({ showcaseId: showcase._id }),
									`${showcase.title} is published.`,
								)
							}
							className="flex-col items-start gap-0"
						>
							<span>Publish</span>
							<span className="text-xs text-muted-foreground">
								Live on /stores for its window.
							</span>
						</DropdownMenuItem>
					) : (
						<DropdownMenuItem
							onSelect={() =>
								void run(
									() => unpublish({ showcaseId: showcase._id }),
									`${showcase.title} is off /stores — kept as a draft.`,
								)
							}
							className="flex-col items-start gap-0"
						>
							<span>Unpublish</span>
							<span className="text-xs text-muted-foreground">
								Off /stores now. Kept as a draft.
							</span>
						</DropdownMenuItem>
					)}
					<DropdownMenuItem
						onSelect={() => setConfirmDelete(true)}
						className="flex-col items-start gap-0 text-destructive focus:text-destructive"
					>
						<span>Delete…</span>
						<span className="text-xs text-muted-foreground">
							Removes it for good. Stores aren't affected.
						</span>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<ConfirmDialog
				open={confirmDelete}
				onOpenChange={setConfirmDelete}
				title={`Delete ${showcase.title}?`}
				description="The showcase, its booth labels and its cover are removed for good. The stores in it are untouched — a showcase only ever pointed at them."
				confirmLabel="Delete showcase"
				destructive
				onConfirm={async () => {
					await remove({ showcaseId: showcase._id });
					toast.success(`${showcase.title} deleted.`);
				}}
			/>
		</>
	);
}
