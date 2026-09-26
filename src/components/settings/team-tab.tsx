import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
	Crown,
	ExternalLink,
	Lock,
	LogOut,
	MailPlus,
	MoreHorizontal,
	UserRoundPlus,
	UsersRound,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useStoreLock } from "../../hooks/useStoreLock";
import { useSupportWaNumber } from "../../hooks/useSupportWaNumber";
import { buildWaContactLink } from "../../lib/contact";
import { convexErrorMessage, formatShortDate } from "../../lib/format";
import {
	AREA_COPY,
	AREA_GROUPS,
	areaControl,
	grantSummary,
	MAX_GRANTABLE,
	type MemberPermissions,
	matchingPreset,
	type PermissionArea,
	TEAM_PRESETS,
} from "../../lib/team-permissions";
import { ViewOnlyNote } from "../app/view-only-note";
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import { ToggleSwitch } from "../ui/toggle-switch";

/**
 * Settings → Team (86exr91r4, docs/team-members.md).
 *
 * The owner's control surface for seats: who's on the team, who hasn't
 * accepted yet, and exactly what each person can do — per-AREA grants, edited
 * here and nowhere else. A member sees the same list read-only (colleagues'
 * emails masked server-side) plus their one action, Leave. Starter gets a
 * locked teaser in the Insights pattern, because the tab must exist where the
 * feature will live, not appear only after an upgrade.
 *
 * States designed (grade-A rule): Starter teaser · empty (explainer + form) ·
 * list · at-cap (invite disabled WITH the reason + upgrade path) · pending
 * invite (resend cooldown, expiry line) · member view · lapsed store
 * (ViewOnlyNote + invite disabled). Every constraint is written where the
 * tap happens.
 */

type TeamList = FunctionReturnType<typeof api.team.list>;

type TeamMember = TeamList["members"][number];

export function TeamTab({
	retailerId,
	storeName,
}: {
	retailerId: Id<"retailers">;
	storeName: string;
}) {
	const team = useQuery(convexQuery(api.team.list, { retailerId })).data as
		| TeamList
		| undefined;
	const { readOnly } = useStoreLock();

	if (team === undefined) {
		return (
			<div className="flex flex-col gap-3 pt-2">
				<div className="h-24 animate-pulse rounded-2xl border border-border bg-muted/40" />
				<div className="h-40 animate-pulse rounded-2xl border border-border bg-muted/40" />
			</div>
		);
	}

	const viewerIsPrivileged =
		team.viewerRole === "owner" || team.viewerRole === "admin";
	const starterLocked =
		!team.seats.unlimited && team.seats.memberLimit === 0 && viewerIsPrivileged;

	return (
		<div className="flex flex-col gap-5 pt-2">
			<ViewOnlyNote />
			{starterLocked ? (
				<LockedTeamTeaser storeName={storeName} />
			) : (
				<>
					<TeamListCard
						retailerId={retailerId}
						storeName={storeName}
						team={team}
					/>
					{viewerIsPrivileged ? (
						<InviteCard retailerId={retailerId} team={team} locked={readOnly} />
					) : null}
				</>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Seat meter + list
// ---------------------------------------------------------------------------

function TeamListCard({
	retailerId,
	storeName,
	team,
}: {
	retailerId: Id<"retailers">;
	storeName: string;
	team: TeamList;
}) {
	const viewerIsPrivileged =
		team.viewerRole === "owner" || team.viewerRole === "admin";
	// Seats are counted in PEOPLE including the owner, so the maths on screen
	// matches the pricing page's "You + 2 teammates".
	const used = 1 + team.seats.activeCount + team.seats.invitedCount;
	const total = team.seats.unlimited ? null : team.seats.memberLimit + 1;

	return (
		<section className="rounded-2xl border border-border bg-card">
			<header className="flex items-center justify-between gap-3 border-b border-border p-4">
				<div className="flex items-center gap-2.5">
					<span className="flex size-9 items-center justify-center rounded-full bg-accent/12 text-accent">
						<UsersRound className="size-4.5" />
					</span>
					<div>
						<h3 className="font-heading text-base font-extrabold">Team</h3>
						<p className="text-xs text-muted-foreground">
							{total === null
								? `${used} ${used === 1 ? "person" : "people"} · unlimited seats`
								: `${used} of ${total} seats used`}
						</p>
					</div>
				</div>
			</header>

			<ul className="divide-y divide-border">
				<li className="flex items-center gap-3 p-4">
					<Avatar name={viewerIsPrivileged ? "You" : storeName} accent />
					<div className="min-w-0 flex-1">
						<p className="truncate text-sm font-semibold">
							{viewerIsPrivileged ? "You" : "Store owner"}
						</p>
						<p className="text-xs text-muted-foreground">
							Full access, billing and this Team page
						</p>
					</div>
					<span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400">
						<Crown className="size-3" /> Owner
					</span>
				</li>
				{team.members.map((member) => (
					<MemberRow
						key={member.memberId}
						retailerId={retailerId}
						storeName={storeName}
						member={member}
						viewerIsPrivileged={viewerIsPrivileged}
					/>
				))}
			</ul>

			{team.members.length === 0 && viewerIsPrivileged ? (
				<p className="border-t border-border p-4 text-xs leading-relaxed text-muted-foreground">
					No teammates yet. Invite a helper below — you choose exactly what they
					can open, and you can change or remove it any time. Billing, your
					WhatsApp numbers and this page always stay yours.
				</p>
			) : null}

			{/* The one-store rule, said where it bites. A teammate who wants a
			    store of their own has exactly one route — Leave, right above —
			    and without this line the only signal is a destructive-looking
			    button, which nobody presses hoping to gain something. */}
			{viewerIsPrivileged ? null : (
				<p className="border-t border-border p-4 text-xs leading-relaxed text-muted-foreground">
					An account can be in one store at a time. Want your own storefront?
					Leave {storeName} first — then Kedaipal walks you through setting it
					up.
				</p>
			)}
		</section>
	);
}

function MemberRow({
	retailerId,
	storeName,
	member,
	viewerIsPrivileged,
}: {
	retailerId: Id<"retailers">;
	storeName: string;
	member: TeamMember;
	viewerIsPrivileged: boolean;
}) {
	const remove = useMutation(api.team.remove);
	const resend = useMutation(api.team.resend);
	const cancelInvite = useMutation(api.team.cancelInvite);
	const leave = useMutation(api.team.leave);
	const [confirming, setConfirming] = useState<
		"remove" | "cancel" | "leave" | null
	>(null);
	const [editing, setEditing] = useState(false);

	const name = member.displayName ?? member.email;
	const summary = grantSummary(member.permissions);
	const expired =
		member.status === "invited" &&
		member.expiresAt !== undefined &&
		member.expiresAt < Date.now();

	const statusLine =
		member.status === "active"
			? `Joined ${member.acceptedAt ? formatShortDate(member.acceptedAt) : "recently"}`
			: expired
				? "Invitation expired — resend to give them a fresh link"
				: `Invited · expires ${member.expiresAt ? formatShortDate(member.expiresAt) : "in 7 days"}`;

	const run = async (
		fn: () => Promise<unknown>,
		success: string,
	): Promise<void> => {
		try {
			await fn();
			toast.success(success);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		}
	};

	return (
		<li className="flex items-start gap-3 p-4">
			<Avatar name={name} dimmed={member.status === "invited"} />
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm font-semibold">
					{name}
					{member.isSelf ? (
						<span className="ml-1.5 text-xs font-normal text-muted-foreground">
							(you)
						</span>
					) : null}
				</p>
				{member.displayName ? (
					<p className="truncate text-xs text-muted-foreground">
						{member.email}
					</p>
				) : null}
				<p
					className={`mt-0.5 text-xs ${expired ? "text-destructive" : "text-muted-foreground"}`}
				>
					{statusLine}
				</p>
				{summary.chips.length > 0 ? (
					<p className="mt-1.5 flex flex-wrap gap-1">
						{summary.chips.map((chip) => (
							<span
								key={chip}
								className="rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
							>
								{chip}
							</span>
						))}
						{summary.more > 0 ? (
							<span className="rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
								+{summary.more} more
							</span>
						) : null}
					</p>
				) : null}
			</div>

			{viewerIsPrivileged ? (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							aria-label={`Actions for ${name}`}
						>
							<MoreHorizontal className="size-4" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onSelect={() => setEditing(true)}>
							Edit access
						</DropdownMenuItem>
						{member.status === "invited" ? (
							<>
								<DropdownMenuItem
									onSelect={() =>
										run(
											() => resend({ memberId: member.memberId }),
											`Invitation resent to ${member.email}`,
										)
									}
								>
									Resend invitation
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									className="text-destructive"
									onSelect={() => setConfirming("cancel")}
								>
									Cancel invitation
								</DropdownMenuItem>
							</>
						) : (
							<>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									className="text-destructive"
									onSelect={() => setConfirming("remove")}
								>
									Remove from team
								</DropdownMenuItem>
							</>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			) : member.isSelf ? (
				<Button
					variant="outline"
					size="sm"
					className="shrink-0"
					onClick={() => setConfirming("leave")}
				>
					<LogOut className="size-3.5" /> Leave
				</Button>
			) : null}

			<ConfirmDialog
				open={confirming === "remove"}
				onOpenChange={(open) => setConfirming(open ? "remove" : null)}
				title={`Remove ${name} from your team?`}
				description="They lose access immediately and we'll email them that you removed it. You can invite them again any time."
				confirmLabel="Remove"
				destructive
				onConfirm={() =>
					run(
						() => remove({ memberId: member.memberId }),
						`${name} removed from your team`,
					)
				}
			/>
			<ConfirmDialog
				open={confirming === "cancel"}
				onOpenChange={(open) => setConfirming(open ? "cancel" : null)}
				title={`Cancel the invitation to ${member.email}?`}
				description="Their link stops working and the seat frees up straight away."
				confirmLabel="Cancel invitation"
				cancelLabel="Keep invitation"
				destructive
				onConfirm={() =>
					run(
						() => cancelInvite({ memberId: member.memberId }),
						"Invitation cancelled",
					)
				}
			/>
			<ConfirmDialog
				open={confirming === "leave"}
				onOpenChange={(open) => setConfirming(open ? "leave" : null)}
				title={`Leave ${storeName}?`}
				// Names BOTH sides of the door. One account can only be in one
				// store, so leaving is also the only way a teammate ever gets a
				// store of their own — and nothing else in the app says so, which
				// would leave them guessing that the destructive-looking button is
				// the route (86exr91r4).
				description="You lose access immediately and the owner is emailed that the seat is free. They'd have to invite you again to bring you back — and once you've left, this account is free to start a store of its own."
				confirmLabel="Leave team"
				destructive
				onConfirm={() =>
					run(() => leave({ retailerId }), `You've left ${storeName}`)
				}
			/>
			{editing ? (
				<EditAccessDialog member={member} onClose={() => setEditing(false)} />
			) : null}
		</li>
	);
}

function Avatar({
	name,
	accent = false,
	dimmed = false,
}: {
	name: string;
	accent?: boolean;
	dimmed?: boolean;
}) {
	const initial = (name.trim()[0] ?? "?").toUpperCase();
	return (
		<span
			aria-hidden="true"
			className={`flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
				accent
					? "bg-accent/12 text-accent"
					: dimmed
						? "border border-dashed border-border text-muted-foreground"
						: "bg-muted text-foreground"
			}`}
		>
			{initial}
		</span>
	);
}

// ---------------------------------------------------------------------------
// Permission matrix (shared by the invite form + Edit access)
// ---------------------------------------------------------------------------

function PermissionMatrix({
	value,
	onChange,
	disabled = false,
}: {
	value: MemberPermissions;
	onChange: (next: MemberPermissions) => void;
	disabled?: boolean;
}) {
	const set = (area: PermissionArea, level: "read" | "write" | null) => {
		const next = { ...value };
		if (level === null) delete next[area];
		else next[area] = level;
		onChange(next);
	};

	return (
		<div className="flex flex-col gap-4">
			{AREA_GROUPS.map((group) => (
				<fieldset key={group.label} className="flex flex-col gap-1.5">
					<legend className="pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
						{group.label}
					</legend>
					<div className="overflow-hidden rounded-xl border border-border">
						{group.areas.map((area, i) => {
							const copy = AREA_COPY[area];
							const level = value[area];
							// Phone: label above, control below (wraps). Desktop: one row,
							// control right-aligned and never wrapping — the stacked
							// version at desktop width read as a tall, thin column
							// (Zaki, 25 Sep).
							return (
								<div
									key={area}
									className={`flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2 p-3 sm:flex-nowrap ${i > 0 ? "border-t border-border" : ""}`}
								>
									<div className="min-w-0 flex-1 basis-full sm:basis-auto">
										<p className="text-sm font-medium">{copy.label}</p>
										<p className="text-xs leading-snug text-muted-foreground">
											{copy.description}
											{copy.caveat ? (
												<span className="mt-0.5 block text-[11px] italic">
													{copy.caveat}
												</span>
											) : null}
										</p>
									</div>
									{areaControl(area) === "three-way" ? (
										<LevelSegment
											area={copy.label}
											value={level ?? null}
											disabled={disabled}
											onChange={(next) => set(area, next)}
										/>
									) : (
										<ToggleSwitch
											on={level !== undefined}
											disabled={disabled}
											label={`Can view ${copy.label}`}
											onChange={(on) =>
												set(area, on ? MAX_GRANTABLE[area] : null)
											}
										/>
									)}
								</div>
							);
						})}
					</div>
				</fieldset>
			))}
		</div>
	);
}

/** None / View / Edit — one control for one idea, reused on every row that
 * can hold a write grant. The segments are the smallest targets on this page,
 * so they carry the house 44px minimum outright rather than the 36px the
 * `min-h-9` beside the other chips would have given them. */
function LevelSegment({
	area,
	value,
	onChange,
	disabled,
}: {
	area: string;
	value: "read" | "write" | null;
	onChange: (next: "read" | "write" | null) => void;
	disabled: boolean;
}) {
	const options: Array<{ key: "none" | "read" | "write"; label: string }> = [
		{ key: "none", label: "None" },
		{ key: "read", label: "View" },
		{ key: "write", label: "Edit" },
	];
	const current = value ?? "none";
	return (
		<fieldset
			aria-label={`${area} access`}
			className="inline-flex shrink-0 overflow-hidden rounded-lg border border-border"
		>
			{options.map((opt, i) => {
				const selected = current === opt.key;
				return (
					<button
						key={opt.key}
						type="button"
						disabled={disabled}
						aria-pressed={selected}
						onClick={() => onChange(opt.key === "none" ? null : opt.key)}
						className={`min-h-11 px-3 text-xs font-semibold transition-colors disabled:opacity-50 ${
							i > 0 ? "border-l border-border" : ""
						} ${
							selected
								? opt.key === "none"
									? // A selected "None" must read as NOTHING GRANTED — the
										// accent on it would say the opposite of what it means.
										"bg-muted text-foreground"
									: "bg-accent text-primary-foreground"
								: "bg-background text-muted-foreground hover:bg-muted"
						}`}
					>
						{opt.label}
					</button>
				);
			})}
		</fieldset>
	);
}

function PresetPicker({
	value,
	onChange,
	disabled = false,
}: {
	value: MemberPermissions;
	onChange: (next: MemberPermissions) => void;
	/** The one control in the invite form that used to ignore the lock: with
	 * the email field and the matrix disabled, tapping a preset still moved
	 * grants that could not be sent. */
	disabled?: boolean;
}) {
	const active = matchingPreset(value);
	return (
		<fieldset className="flex flex-wrap gap-2" aria-label="Access presets">
			{TEAM_PRESETS.map((preset) => {
				const selected = active === preset.id;
				return (
					<button
						key={preset.id}
						type="button"
						aria-pressed={selected}
						disabled={disabled}
						onClick={() => onChange({ ...preset.grants })}
						title={preset.description}
						className={`min-h-11 rounded-full border px-3.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
							selected
								? "border-accent bg-accent/12 text-accent"
								: "border-border bg-background text-muted-foreground hover:bg-muted"
						}`}
					>
						{preset.label}
					</button>
				);
			})}
			{active === "custom" ? (
				<span className="inline-flex min-h-9 items-center rounded-full border border-dashed border-border px-3.5 text-xs font-medium text-muted-foreground">
					Custom
				</span>
			) : null}
		</fieldset>
	);
}

// ---------------------------------------------------------------------------
// Invite
// ---------------------------------------------------------------------------

function InviteCard({
	retailerId,
	team,
	locked,
}: {
	retailerId: Id<"retailers">;
	team: TeamList;
	locked: boolean;
}) {
	const invite = useMutation(api.team.invite);
	const [email, setEmail] = useState("");
	const [grants, setGrants] = useState<MemberPermissions>({
		...TEAM_PRESETS[0].grants,
	});
	const [showMatrix, setShowMatrix] = useState(false);
	const [sending, setSending] = useState(false);

	const seatsLeft = team.seats.unlimited
		? Number.POSITIVE_INFINITY
		: team.seats.memberLimit - team.seats.activeCount - team.seats.invitedCount;
	const atCap = seatsLeft <= 0;
	const emailValid = /.+@.+\..+/.test(email.trim());

	const disabledReason = locked
		? null // ViewOnlyNote above already explains; keep one voice.
		: atCap
			? `All ${team.seats.memberLimit + 1} seats are in use — remove a teammate or upgrade for more.`
			: null;

	const submit = async () => {
		setSending(true);
		try {
			await invite({ retailerId, email: email.trim(), permissions: grants });
			toast.success(`Invitation sent to ${email.trim()}`, {
				description: "It expires in 7 days — you can resend it any time.",
			});
			setEmail("");
			setGrants({ ...TEAM_PRESETS[0].grants });
			setShowMatrix(false);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSending(false);
		}
	};

	return (
		<section className="rounded-2xl border border-border bg-card p-4">
			<div className="flex items-center gap-2.5">
				<span className="flex size-9 items-center justify-center rounded-full bg-accent/12 text-accent">
					<UserRoundPlus className="size-4.5" />
				</span>
				<div>
					<h3 className="font-heading text-base font-extrabold">
						Invite a teammate
					</h3>
					<p className="text-xs text-muted-foreground">
						They sign in with their own email — you control what they can open.
						Teammates don't receive order alerts; those still go to the store's
						own email and WhatsApp number.
					</p>
				</div>
			</div>

			<div className="mt-4 flex flex-col gap-3">
				<Input
					type="email"
					inputMode="email"
					autoComplete="off"
					placeholder="helper@email.com"
					aria-label="Teammate's email address"
					value={email}
					disabled={locked || atCap}
					onChange={(e) => setEmail(e.target.value)}
				/>
				<PresetPicker
					value={grants}
					onChange={setGrants}
					disabled={locked || atCap}
				/>
				<button
					type="button"
					className="self-start text-xs font-semibold text-accent underline underline-offset-2"
					onClick={() => setShowMatrix((v) => !v)}
				>
					{showMatrix ? "Hide detailed access" : "Customise access"}
				</button>
				{showMatrix ? (
					<PermissionMatrix
						value={grants}
						onChange={setGrants}
						disabled={locked || atCap}
					/>
				) : null}

				{disabledReason ? (
					<p className="flex items-start gap-2 rounded-xl border border-border bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
						<Lock className="mt-0.5 size-3.5 shrink-0" />
						{disabledReason}
					</p>
				) : null}

				<Button
					className="h-11 w-full sm:w-auto sm:self-end"
					disabled={locked || atCap || !emailValid || sending}
					onClick={submit}
				>
					<MailPlus className="size-4" />
					{sending ? "Sending…" : "Send invitation"}
				</Button>
			</div>
		</section>
	);
}

function EditAccessDialog({
	member,
	onClose,
}: {
	member: TeamMember;
	onClose: () => void;
}) {
	const updatePermissions = useMutation(api.team.updatePermissions);
	const [grants, setGrants] = useState<MemberPermissions>({
		...(member.permissions ?? {}),
	});
	const [saving, setSaving] = useState(false);
	const name = member.displayName ?? member.email;

	const save = async () => {
		setSaving(true);
		try {
			await updatePermissions({
				memberId: member.memberId,
				permissions: grants,
			});
			toast.success(`Access updated for ${name}`, {
				description: "Changes apply the next time they load a page.",
			});
			onClose();
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
			{/* Wide enough for label + description + control on ONE line at desktop;
			    the phone keeps the stacked layout. */}
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Access for {name}</DialogTitle>
					<DialogDescription>
						Changes take effect on their next page load — nothing to reinstall
						or re-invite.
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-3">
					<PresetPicker value={grants} onChange={setGrants} />
					<PermissionMatrix value={grants} onChange={setGrants} />
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button disabled={saving} onClick={save}>
						{saving ? "Saving…" : "Save access"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

// ---------------------------------------------------------------------------
// Starter teaser
// ---------------------------------------------------------------------------

function LockedTeamTeaser({ storeName }: { storeName: string }) {
	const supportWa = useSupportWaNumber();
	const upgradeUrl = buildWaContactLink(
		`Hi, I'd like to upgrade to Pro so I can add teammates to my Kedaipal store (${storeName}).`,
		supportWa,
	);
	return (
		<div className="relative overflow-hidden rounded-2xl border border-border">
			{/* Blurred sample — Starter sees what the page becomes, never a wall of nothing. */}
			<div
				aria-hidden="true"
				className="pointer-events-none select-none blur-[3px]"
			>
				<div className="flex flex-col gap-3 p-5">
					{[
						"Aina — Orders & counter",
						"Farid — Store manager",
						"Mira — Front-desk helper",
					].map((row) => (
						<div
							key={row}
							className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
						>
							<span className="size-9 rounded-full bg-muted" />
							<div className="flex-1">
								<div className="h-3 w-40 rounded bg-muted" />
								<div className="mt-1.5 h-2.5 w-24 rounded bg-muted/70" />
							</div>
						</div>
					))}
				</div>
			</div>
			<div className="absolute inset-0 flex items-center justify-center bg-background/60 p-6 backdrop-blur-[1px]">
				<div className="flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-border bg-card p-6 text-center shadow-lg">
					<span className="flex size-12 items-center justify-center rounded-full bg-accent/12 text-accent">
						<UsersRound className="size-5" />
					</span>
					<h3 className="font-heading text-lg font-extrabold">
						Team seats are a Pro feature
					</h3>
					<p className="text-sm text-muted-foreground">
						Invite up to 2 teammates on Pro (you + 2) to run orders and the
						counter from their own logins — you choose exactly what each person
						can open, and billing stays yours.
					</p>
					<a
						href={upgradeUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="tap-target mt-1 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 font-semibold text-primary-foreground transition-colors hover:bg-accent/90"
					>
						<UsersRound className="size-4" />
						Upgrade to Pro
						<ExternalLink className="size-3.5 opacity-70" />
					</a>
					<p className="text-[11px] text-muted-foreground">
						We'll set it up for you on WhatsApp.
					</p>
				</div>
			</div>
		</div>
	);
}
