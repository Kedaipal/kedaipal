import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { COUNTRIES, COUNTRY_LABELS } from "../../../convex/lib/country";
import {
	SHOWCASE_LABEL_MAX,
	SHOWCASE_MEMBER_CAP,
	SHOWCASE_TAGLINE_MAX,
	SHOWCASE_THEME_LABELS,
	SHOWCASE_THEMES,
	SHOWCASE_TITLE_MAX,
	type ShowcaseTheme,
} from "../../../convex/lib/showcase";
import type { MarketplaceStoreCard } from "../../../convex/marketplace";
import type {
	AdminShowcase,
	AdminShowcaseMember,
	PublicShowcase,
} from "../../../convex/showcases";
import {
	describeChanges,
	draftFromRow,
	formatDateTime,
	fromDateTimeLocal,
	NOT_LISTED_COPY,
	type ShowcaseDraft,
	showcaseStatusLabel,
	toDateTimeLocal,
	visibilitySummary,
} from "../../lib/admin-showcase";
import { convexErrorMessage } from "../../lib/format";
import { IMAGE_ACCEPT, prepareImageUpload } from "../../lib/image-upload";
import {
	type ShowcaseTicketData,
	showcasePath,
	showcaseThemeClass,
} from "../../lib/showcase";
import { cn } from "../../lib/utils";
import { PageHeader } from "../dashboard/page-header";
import { ShowcaseStage } from "../marketplace/showcase-stage";
import { StoreLogoTile } from "../storefront/storefront-header";
import { AppImage } from "../ui/app-image";
import { BulkSelectRow } from "../ui/bulk-select-row";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Input } from "../ui/input";
import { Skeleton } from "../ui/skeleton";
import { SortableList } from "../ui/sortable-list";
import { Textarea } from "../ui/textarea";
import { StatusPill } from "./showcase-row";
import { ShowcaseStorePicker } from "./showcase-store-picker";

/**
 * The showcase editor (z8r3fdr6mv). Four cards — Details, Look, When buyers
 * see it, Stores — a buyer preview that is the REAL stage component fed the
 * draft, and a pinned save bar that names what is unsaved. Publishing is a
 * separate act from saving: Save writes the draft, Publish (or Unpublish)
 * flips the one bit that decides whether buyers see it.
 *
 * Every member row names why it won't show (`NOT_LISTED_COPY`), because a
 * showcase member that silently never appears is the "where did that go?"
 * the house rules forbid. The booth label is the one per-store field, set on
 * the row; the list reorders by drag, with select-all and bulk remove once
 * there is more than a handful.
 */
export function ShowcaseEditor({
	showcaseId,
}: {
	showcaseId: Id<"marketplaceShowcases">;
}) {
	const row = useQuery(
		convexQuery(api.showcases.getForAdmin, { showcaseId }),
	).data;
	if (row === undefined) {
		return (
			<div className="flex flex-col gap-4 lg:max-w-4xl">
				<Skeleton className="h-7 w-48" />
				<Skeleton className="h-40 w-full rounded-2xl" />
				<Skeleton className="h-40 w-full rounded-2xl" />
			</div>
		);
	}
	if (row === null) {
		return (
			<div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-16 text-center">
				<p className="font-medium">This showcase no longer exists</p>
				<Button asChild variant="outline" className="tap-target">
					<Link to="/app/admin/marketplace">Back to Marketplace</Link>
				</Button>
			</div>
		);
	}
	return <EditorForm key={row.updatedAt} row={row} />;
}

/**
 * Keyed on `updatedAt` by the parent, so a save (or another admin's edit)
 * re-seeds the draft from the row and the "unsaved" line goes quiet on its
 * own — no effect that syncs server state into form state.
 */
function EditorForm({ row }: { row: AdminShowcase }) {
	const update = useMutation(api.showcases.update);
	const setMembers = useMutation(api.showcases.setMembers);
	const publish = useMutation(api.showcases.publish);
	const unpublish = useMutation(api.showcases.unpublish);
	const remove = useMutation(api.showcases.remove);
	const generateCoverUploadUrl = useMutation(
		api.showcases.generateCoverUploadUrl,
	);
	const navigate = useNavigate();

	const [draft, setDraft] = useState<ShowcaseDraft>(() => draftFromRow(row));
	const [selected, setSelected] = useState<Set<Id<"retailers">>>(
		() => new Set(),
	);
	const [picking, setPicking] = useState(false);
	const [saving, setSaving] = useState(false);
	const [uploading, setUploading] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [noEnd, setNoEnd] = useState(row.endsAt === undefined);
	const now = Date.now();
	const status = showcaseStatusLabel(row, now);
	const changes = describeChanges(draft, row);
	const dirty = changes.length > 0;
	const memberById = new Map(row.members.map((m) => [m.retailerId, m]));
	const membersInShowcase = new Set(draft.members.map((m) => m.retailerId));

	function patch(next: Partial<ShowcaseDraft>) {
		setDraft((d) => ({ ...d, ...next }));
	}

	async function save(): Promise<boolean> {
		setSaving(true);
		try {
			const fieldChanges = changes.some((c) =>
				["title", "tagline", "region", "theme", "dates"].includes(c),
			);
			if (fieldChanges) {
				await update({
					showcaseId: row._id,
					title: draft.title,
					tagline: draft.tagline.trim() ? draft.tagline : null,
					...(draft.country !== row.country ? { country: draft.country } : {}),
					theme: draft.theme,
					startsAt: draft.startsAt ?? null,
					endsAt: draft.endsAt ?? null,
				});
			}
			const memberChanges = changes.some(
				(c) =>
					c.includes("store") || c.includes("label") || c === "store order",
			);
			if (memberChanges) {
				await setMembers({
					showcaseId: row._id,
					members: draft.members.map((m) => ({
						retailerId: m.retailerId,
						...(m.label.trim() ? { label: m.label } : {}),
					})),
				});
			}
			toast.success(
				row.state === "live" ? "Saved — live on /stores now." : "Saved.",
			);
			return true;
		} catch (err) {
			toast.error(convexErrorMessage(err));
			return false;
		} finally {
			setSaving(false);
		}
	}

	async function handlePublish() {
		if (dirty && !(await save())) return;
		try {
			await publish({ showcaseId: row._id });
			toast.success(`${row.title} is published.`);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		}
	}

	async function handleUnpublish() {
		try {
			await unpublish({ showcaseId: row._id });
			toast.success(`${row.title} is off /stores — kept as a draft.`);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		}
	}

	async function handleCover(file: File | null) {
		if (!file) return;
		setUploading(true);
		try {
			const prepared = await prepareImageUpload(file);
			if (!prepared.ok) {
				toast.error(prepared.message);
				return;
			}
			const url = await generateCoverUploadUrl({});
			const res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": prepared.contentType },
				body: prepared.blob,
			});
			if (!res.ok) throw new Error("Upload failed");
			const { storageId } = (await res.json()) as { storageId: string };
			await update({ showcaseId: row._id, coverImageStorageId: storageId });
			toast.success("Cover saved.");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setUploading(false);
		}
	}

	async function removeCover() {
		try {
			await update({ showcaseId: row._id, coverImageStorageId: null });
			toast.success("Cover removed — the theme art is back.");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		}
	}

	function addMembers(ids: Id<"retailers">[]) {
		patch({
			members: [
				...draft.members,
				...ids
					.filter((id) => !membersInShowcase.has(id))
					.map((retailerId) => ({ retailerId, label: "" })),
			],
		});
	}
	function removeMembers(ids: ReadonlySet<Id<"retailers">>) {
		patch({ members: draft.members.filter((m) => !ids.has(m.retailerId)) });
		setSelected((prev) => {
			const next = new Set(prev);
			for (const id of ids) next.delete(id);
			return next;
		});
	}

	// The preview is the real stage, fed the draft: the saved members' card
	// facts (a just-added store has none yet — it shows once saved).
	const previewTickets: ShowcaseTicketData[] = draft.members.flatMap((m) => {
		const member = memberById.get(m.retailerId);
		if (!member || member.notListed !== null) return [];
		return [
			{
				card: cardFromMember(member),
				label: m.label.trim() || undefined,
				coverImageUrl: member.coverImageUrl,
			},
		];
	});
	const previewShowcase: PublicShowcase = {
		slug: row.slug,
		title: draft.title.trim() || row.title,
		tagline: draft.tagline.trim() || undefined,
		country: draft.country,
		theme: draft.theme,
		coverImageUrl: row.coverImageUrl,
		startsAt: draft.startsAt,
		endsAt: draft.endsAt,
		members: [],
	};
	const unsavedAdds = draft.members.filter(
		(m) => !memberById.has(m.retailerId),
	).length;

	return (
		<div className="flex flex-col gap-5 pb-28 lg:max-w-5xl">
			<PageHeader
				title={row.title}
				subtitle={
					<span className="inline-flex items-center gap-2">
						<StatusPill tone={status.tone} label={status.label} />
						<span className="font-mono text-xs">{showcasePath(row.slug)}</span>
					</span>
				}
				back={{ to: "/app/admin/marketplace", label: "Marketplace" }}
			/>
			<section className="flex flex-col gap-1 lg:hidden">
				<Link
					to="/app/admin/marketplace"
					className="text-xs font-semibold text-muted-foreground"
				>
					← Marketplace
				</Link>
				<h2 className="text-xl font-bold">{row.title}</h2>
				<StatusPill tone={status.tone} label={status.label} />
			</section>

			<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
				<div className="flex flex-col gap-4">
					{/* Details */}
					<EditorCard title="Details">
						<Labelled
							id="showcase-title"
							label="Title"
							counter={`${draft.title.trim().length}/${SHOWCASE_TITLE_MAX}`}
						>
							<Input
								id="showcase-title"
								variant="field"
								value={draft.title}
								onChange={(e) => patch({ title: e.target.value })}
								maxLength={SHOWCASE_TITLE_MAX}
							/>
						</Labelled>
						<Labelled
							id="showcase-tagline"
							label="Tagline (optional)"
							counter={`${draft.tagline.trim().length}/${SHOWCASE_TAGLINE_MAX}`}
							helper="One line under the title — where it is, what's on, how to order."
						>
							<Textarea
								id="showcase-tagline"
								value={draft.tagline}
								onChange={(e) => patch({ tagline: e.target.value })}
								maxLength={SHOWCASE_TAGLINE_MAX}
								rows={2}
								placeholder="Gear, coffee and campfire food from the stalls at MAEPS Serdang. Order ahead, pick up at the booth."
							/>
						</Labelled>
						<fieldset className="flex flex-col gap-1.5">
							<legend className="text-sm font-medium">Region</legend>
							<div className="grid w-full grid-cols-2 gap-1 rounded-xl bg-muted p-1 sm:w-max sm:grid-cols-[repeat(2,minmax(120px,1fr))]">
								{COUNTRIES.map((c) => (
									<button
										key={c}
										type="button"
										aria-pressed={draft.country === c}
										onClick={() => patch({ country: c })}
										disabled={row.members.length > 0 && c !== row.country}
										className={cn(
											"tap-target rounded-lg px-4 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
											draft.country === c
												? "bg-card shadow-sm"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										{COUNTRY_LABELS[c]}
									</button>
								))}
							</div>
							<p className="text-xs text-muted-foreground">
								Only buyers browsing {draft.country} stores see it.{" "}
								{row.members.length > 0
									? "Remove every store to change the region — a showcase's stores must all be in it."
									: "Stores from the other region can't be added."}
							</p>
						</fieldset>
					</EditorCard>

					{/* Look */}
					<EditorCard title="Look">
						<fieldset className="flex flex-col gap-2">
							<legend className="text-sm font-medium">Theme</legend>
							<div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
								{SHOWCASE_THEMES.map((theme) => (
									<ThemeSwatch
										key={theme}
										theme={theme}
										selected={draft.theme === theme}
										onPick={() => patch({ theme })}
									/>
								))}
							</div>
							<p className="text-xs text-muted-foreground">
								Every theme is a dark ground with light text, so it reads the
								same in light and dark mode. Pick the mood; the colours are
								taken care of.
							</p>
						</fieldset>
						<div className="flex flex-col gap-2">
							<span className="text-sm font-medium">
								Cover photo (optional)
							</span>
							<div className="flex flex-col gap-3 rounded-2xl border border-dashed border-border p-3 sm:flex-row sm:items-center">
								<span
									aria-hidden
									className={cn(
										showcaseThemeClass(draft.theme),
										"relative h-[68px] w-[120px] shrink-0 overflow-hidden rounded-xl bg-showcase",
									)}
								>
									{row.coverImageUrl ? (
										<AppImage
											src={row.coverImageUrl}
											alt=""
											aspect="absolute inset-0 h-full w-full"
											sizes="120px"
											objectFit="cover"
										/>
									) : null}
								</span>
								<span className="flex min-w-0 grow flex-col">
									<span className="text-sm font-semibold">
										{row.coverImageUrl
											? "Cover uploaded"
											: `No cover — showing the ${SHOWCASE_THEME_LABELS[draft.theme]} art`}
									</span>
									<span className="text-xs text-muted-foreground">
										Wide photo, at least 1600 × 900. We darken it so the title
										stays readable. Saves on upload.
									</span>
								</span>
								<span className="flex shrink-0 gap-2">
									<label className="tap-target inline-flex cursor-pointer items-center justify-center rounded-xl border border-input bg-background px-4 text-sm font-semibold hover:bg-accent/5">
										{uploading
											? "Uploading…"
											: row.coverImageUrl
												? "Replace"
												: "Upload photo"}
										<input
											type="file"
											accept={IMAGE_ACCEPT}
											className="hidden"
											disabled={uploading}
											onChange={(e) =>
												void handleCover(e.target.files?.[0] ?? null)
											}
										/>
									</label>
									{row.coverImageUrl ? (
										<Button
											type="button"
											variant="ghost"
											className="tap-target"
											onClick={() => void removeCover()}
										>
											Remove
										</Button>
									) : null}
								</span>
							</div>
						</div>
					</EditorCard>

					{/* When */}
					<EditorCard title="When buyers see it">
						<div className="grid gap-4 sm:grid-cols-2">
							<Labelled
								id="showcase-starts"
								label="Show from"
								helper="Leave empty to show as soon as it's published."
							>
								<Input
									id="showcase-starts"
									variant="field"
									type="datetime-local"
									value={toDateTimeLocal(draft.startsAt)}
									onChange={(e) =>
										patch({ startsAt: fromDateTimeLocal(e.target.value) })
									}
								/>
							</Labelled>
							<Labelled id="showcase-ends" label="Show until">
								<Input
									id="showcase-ends"
									variant="field"
									type="datetime-local"
									value={toDateTimeLocal(draft.endsAt)}
									disabled={noEnd}
									onChange={(e) =>
										patch({ endsAt: fromDateTimeLocal(e.target.value) })
									}
								/>
								<label className="flex min-h-9 items-center gap-2 text-sm">
									<input
										type="checkbox"
										className="size-4 accent-primary"
										checked={noEnd}
										onChange={(e) => {
											setNoEnd(e.target.checked);
											if (e.target.checked) patch({ endsAt: undefined });
										}}
									/>
									No end date
								</label>
							</Labelled>
						</div>
						<p className="rounded-xl bg-muted/60 px-3.5 py-2.5 text-xs leading-relaxed text-muted-foreground">
							{draft.endsAt !== undefined ? (
								<>
									It comes off /stores on its own at{" "}
									<b className="text-foreground">
										{formatDateTime(draft.endsAt)}
									</b>
									. You don't need to come back and take it down. Buyers see
									"Ends today" on the last day.
								</>
							) : (
								<>
									With no end date it stays on /stores until you unpublish it.
								</>
							)}
						</p>
					</EditorCard>

					{/* Stores */}
					<EditorCard
						title={`Stores (${draft.members.length})`}
						helper="Drag to set the order buyers see. The booth label is optional."
						action={
							<Button
								type="button"
								onClick={() => setPicking(true)}
								disabled={draft.members.length >= SHOWCASE_MEMBER_CAP}
								className="tap-target font-bold"
							>
								<Plus aria-hidden />
								Add stores
							</Button>
						}
					>
						{draft.members.length === 0 ? (
							<p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
								No stores yet. Add the stores at the event — buyers see them as
								tickets under the banner.
							</p>
						) : (
							<div className="overflow-hidden rounded-xl border border-border">
								{draft.members.length > 1 ? (
									<div className="flex items-center gap-2 border-b border-border bg-muted/50 px-2 py-1">
										<BulkSelectRow
											label="All stores"
											selected={
												draft.members.filter((m) => selected.has(m.retailerId))
													.length
											}
											total={draft.members.length}
											unit="stores"
											tone="master"
											onToggle={(all) =>
												setSelected(
													all
														? new Set(draft.members.map((m) => m.retailerId))
														: new Set(),
												)
											}
											trailing={
												selected.size > 0 ? (
													<Button
														type="button"
														variant="outline"
														size="sm"
														className="border-destructive/40 text-destructive hover:bg-destructive/10"
														onClick={() => removeMembers(selected)}
													>
														Remove {selected.size} from showcase
													</Button>
												) : null
											}
										/>
									</div>
								) : null}
								<SortableList
									items={draft.members}
									getId={(m) => m.retailerId}
									onReorder={(ids) =>
										patch({
											members: ids
												.map((id) =>
													draft.members.find((m) => m.retailerId === id),
												)
												.filter(
													(m): m is ShowcaseDraft["members"][number] =>
														m !== undefined,
												),
										})
									}
									className="flex flex-col divide-y divide-border"
									renderItem={(member, handle, state) => (
										<MemberRow
											member={member}
											saved={memberById.get(member.retailerId)}
											handle={handle}
											compact={state.isSorting}
											checked={selected.has(member.retailerId)}
											onCheck={(on) =>
												setSelected((prev) => {
													const next = new Set(prev);
													if (on) next.add(member.retailerId);
													else next.delete(member.retailerId);
													return next;
												})
											}
											onLabel={(label) =>
												patch({
													members: draft.members.map((m) =>
														m.retailerId === member.retailerId
															? { ...m, label }
															: m,
													),
												})
											}
											onRemove={() =>
												removeMembers(new Set([member.retailerId]))
											}
										/>
									)}
								/>
							</div>
						)}
					</EditorCard>

					{/* Take it down */}
					<EditorCard title="Take it down" tone="danger">
						<div className="flex flex-col gap-2 sm:flex-row">
							{row.publishedAt !== undefined ? (
								<Button
									type="button"
									variant="outline"
									onClick={() => void handleUnpublish()}
									className="tap-target justify-start font-semibold"
								>
									Unpublish
									<span className="font-normal text-muted-foreground">
										· off /stores now, kept as a draft
									</span>
								</Button>
							) : null}
							<Button
								type="button"
								variant="outline"
								onClick={() => setConfirmDelete(true)}
								className="tap-target justify-start border-destructive/40 font-semibold text-destructive hover:bg-destructive/10"
							>
								Delete showcase…
							</Button>
						</div>
					</EditorCard>
				</div>

				{/* Buyer preview */}
				<aside
					aria-label="Buyer preview"
					className="flex flex-col gap-2.5 lg:sticky lg:top-6"
				>
					<div className="flex items-baseline justify-between">
						<span className="font-heading text-sm font-extrabold">
							Buyer preview · {draft.country}
						</span>
						<span className="text-xs text-muted-foreground">
							Updates as you type
						</span>
					</div>
					<div className="rounded-3xl border border-border bg-card p-2.5 shadow-[0_10px_30px_-18px_color-mix(in_oklab,var(--foreground)_40%,transparent)]">
						<div className="[&>section]:mx-0 [&>section]:rounded-[22px]">
							<ShowcaseStage
								showcase={previewShowcase}
								tickets={previewTickets}
								now={now}
								mode="stage"
								railClassName="flex snap-x gap-3 overflow-x-auto scrollbar-none scroll-px-5 px-5"
								forcePhone
							/>
						</div>
					</div>
					<p className="text-xs leading-relaxed text-muted-foreground">
						{visibilitySummary(row.members)}
						{unsavedAdds > 0
							? ` ${unsavedAdds} just added — in the preview once saved.`
							: ""}
						{row.members.some((m) => m.notListed === "no_visible_product")
							? " A store with no visible product appears once it has one."
							: ""}
					</p>
				</aside>
			</div>

			{/* Save bar — fixed, every action bar's posture (design-system §4). */}
			<div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur lg:left-[var(--sidebar-w,0px)]">
				<div className="mx-auto flex max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
					<span className="text-center text-xs text-muted-foreground sm:text-left">
						{dirty ? `Unsaved: ${changes.join(", ")}` : "Everything is saved."}
					</span>
					<div className="flex gap-2">
						{row.publishedAt === undefined ? (
							<Button
								type="button"
								variant="outline"
								onClick={() => void handlePublish()}
								disabled={saving || draft.members.length === 0}
								className="tap-target grow font-bold sm:grow-0"
								title={
									draft.members.length === 0
										? "Add at least one store before publishing"
										: undefined
								}
							>
								{dirty ? "Save & publish" : "Publish"}
							</Button>
						) : null}
						<Button
							type="button"
							onClick={() => void save()}
							disabled={!dirty || saving}
							isLoading={saving}
							className="tap-target grow font-bold sm:grow-0"
						>
							{row.state === "live" ? "Save · live on /stores now" : "Save"}
						</Button>
					</div>
				</div>
			</div>

			<ShowcaseStorePicker
				open={picking}
				onOpenChange={setPicking}
				showcaseTitle={row.title}
				country={row.country}
				alreadyIn={membersInShowcase}
				capacityLeft={SHOWCASE_MEMBER_CAP - draft.members.length}
				onAdd={addMembers}
			/>
			<ConfirmDialog
				open={confirmDelete}
				onOpenChange={setConfirmDelete}
				title={`Delete ${row.title}?`}
				description="The showcase, its booth labels and its cover are removed for good. The stores in it are untouched — a showcase only ever pointed at them."
				confirmLabel="Delete showcase"
				destructive
				onConfirm={async () => {
					await remove({ showcaseId: row._id });
					toast.success(`${row.title} deleted.`);
					void navigate({ to: "/app/admin/marketplace" });
				}}
			/>
		</div>
	);
}

/** The directory card the preview ticket needs, from the admin member row —
 * the same facts `listStores` would ship, so the preview's status line is
 * the real one. */
function cardFromMember(member: AdminShowcaseMember): MarketplaceStoreCard {
	return {
		slug: member.slug,
		storeName: member.storeName,
		storeDescription: member.storeDescription,
		storeArea: member.storeArea,
		country: member.country,
		logoUrl: member.logoUrl,
		offersDelivery: member.offersDelivery,
		openingHours: member.openingHours,
		closedDates: member.closedDates,
		sponsored: false,
		orderingPaused: member.orderingPaused,
		createdAt: member.createdAt,
	};
}

function EditorCard({
	title,
	helper,
	action,
	tone,
	children,
}: {
	title: string;
	helper?: string;
	action?: React.ReactNode;
	tone?: "danger";
	children: React.ReactNode;
}) {
	return (
		<section
			className={cn(
				"flex flex-col gap-4 rounded-2xl border bg-card p-4 lg:p-5",
				tone === "danger" ? "border-destructive/30" : "border-border",
			)}
		>
			<div className="flex items-start justify-between gap-3">
				<div className="flex flex-col gap-0.5">
					<h3 className="font-heading text-base font-extrabold">{title}</h3>
					{helper ? (
						<p className="text-xs text-muted-foreground">{helper}</p>
					) : null}
				</div>
				{action}
			</div>
			{children}
		</section>
	);
}

function Labelled({
	id,
	label,
	counter,
	helper,
	children,
}: {
	id: string;
	label: string;
	counter?: string;
	helper?: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<label
				htmlFor={id}
				className="flex items-baseline justify-between text-sm font-medium"
			>
				{label}
				{counter ? (
					<span className="font-normal text-muted-foreground text-xs tabular-nums">
						{counter}
					</span>
				) : null}
			</label>
			{children}
			{helper ? (
				<span className="text-muted-foreground text-xs">{helper}</span>
			) : null}
		</div>
	);
}

function ThemeSwatch({
	theme,
	selected,
	onPick,
}: {
	theme: ShowcaseTheme;
	selected: boolean;
	onPick: () => void;
}) {
	return (
		<label className="flex min-h-11 cursor-pointer flex-col items-center gap-1.5 font-semibold text-muted-foreground text-xs has-[:focus-visible]:[&>span:first-of-type]:ring-2 has-[:focus-visible]:[&>span:first-of-type]:ring-ring">
			<input
				type="radio"
				name="showcase-theme"
				value={theme}
				checked={selected}
				onChange={onPick}
				className="sr-only"
			/>
			<span
				aria-hidden="true"
				className={cn(
					showcaseThemeClass(theme),
					"block h-11 w-full rounded-xl bg-showcase ring-offset-2 ring-offset-card transition-shadow",
					selected && "ring-2 ring-accent",
				)}
			/>
			<span className={selected ? "text-foreground" : undefined}>
				{SHOWCASE_THEME_LABELS[theme]}
			</span>
		</label>
	);
}

function MemberRow({
	member,
	saved,
	handle,
	compact,
	checked,
	onCheck,
	onLabel,
	onRemove,
}: {
	member: ShowcaseDraft["members"][number];
	/** The saved row for this store — undefined until the first save. */
	saved: AdminShowcaseMember | undefined;
	handle: React.ReactNode;
	compact: boolean;
	checked: boolean;
	onCheck: (on: boolean) => void;
	onLabel: (label: string) => void;
	onRemove: () => void;
}) {
	const name = saved?.storeName ?? "New store";
	const warning = saved?.notListed ? NOT_LISTED_COPY[saved.notListed] : null;
	return (
		<div
			className={cn(
				"flex items-start gap-2 bg-card px-2 py-2.5",
				warning && "bg-amber-50 dark:bg-amber-950/20",
			)}
		>
			{handle}
			<input
				type="checkbox"
				className="mt-3 size-4 shrink-0 accent-primary"
				checked={checked}
				onChange={(e) => onCheck(e.target.checked)}
				aria-label={`Select ${name}`}
			/>
			<div className="flex min-w-0 grow flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
				<div className="flex min-w-0 grow items-center gap-2.5">
					<StoreLogoTile storeName={name} logoUrl={saved?.logoUrl} size="bar" />
					<span className="flex min-w-0 flex-col">
						<span className="truncate text-sm font-bold">{name}</span>
						<span
							className={cn(
								"truncate text-xs",
								warning
									? "font-semibold text-amber-700 dark:text-amber-300"
									: "text-muted-foreground",
							)}
						>
							{warning ??
								(saved ? `/${saved.slug}` : "Saves with the showcase")}
						</span>
					</span>
				</div>
				{compact ? null : (
					<Input
						value={member.label}
						onChange={(e) => onLabel(e.target.value)}
						placeholder="Booth (optional)"
						maxLength={SHOWCASE_LABEL_MAX}
						aria-label={`Booth label for ${name}`}
						className="sm:w-[150px]"
					/>
				)}
			</div>
			{compact ? null : (
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="tap-target shrink-0 text-muted-foreground"
					onClick={onRemove}
					aria-label={`Remove ${name}`}
				>
					<X aria-hidden />
				</Button>
			)}
		</div>
	);
}
