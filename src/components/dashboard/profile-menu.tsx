/**
 * The profile menu (z8r3fdx34j — Arif's 26 Oct reference, Zaki's 29 Oct
 * picks). It replaces Clerk's `UserButton` in the sidebar foot and the phone
 * header with the house `DropdownMenu`, because the menu now carries the
 * store's Kedaipal credits, which Clerk's popover can't hold:
 *
 *  1. who you are — avatar, name, email, your role in THIS store;
 *  2. the credits stub — the 2A outlined torn receipt: headline, one row of
 *     dots for the month's grant, the reset line, ONE outline button. The stub
 *     itself opens Settings → Billing; the button opens the pack picker (or,
 *     when orders wait, the way back the lock names). Unmetered stores see it
 *     too, reading "∞ orders · On us". A teammate without the credits grant
 *     sees no stub — the balance is the owner's to share;
 *  3. Refer a kedai — a featured row, because credits are what a referral
 *     pays out in; greyed with the reason while the store can't refer yet;
 *  4. Manage account (Clerk's profile) and Sign out.
 *
 * Courier wallets are deliberately NOT here (Zaki, 29 Oct): they're money at
 * each courier, and live on Home and Settings → Integrations.
 *
 * The trigger is just the person (name + email in the rail, the avatar on the
 * phone): the always-on balance is the `CreditTicket` under the plan pill
 * (Zaki, 31 Oct), so it's said once per rail, and nothing needs a tone dot.
 * All words come from `creditStub` (src/lib/credit-stub.ts).
 */

import { useClerk, useUser } from "@clerk/tanstack-react-start";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { ChevronRight, LogOut, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { api } from "../../../convex/_generated/api";
import { TOP_UP_VIEW_ONLY_MESSAGE } from "../../../convex/lib/creditPurchases";
import { USAGE_PACE_DAYS } from "../../../convex/lib/credits";
import { todayMytMidnight } from "../../../convex/lib/fulfilmentDate";
import { useCreditGateFor } from "../../hooks/useCreditGate";
import { usePermission, useStoreRole } from "../../hooks/usePermission";
import { type CreditStub, creditStub, STUB_DOTS } from "../../lib/credit-stub";
import { cn } from "../../lib/utils";
import {
	REFER_ROW_CLASS,
	ReferEntryRowContent,
} from "../referrals/refer-entry";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { STUB_DOT, STUB_INK } from "./credit-stub-tones";

type Retailer = NonNullable<
	FunctionReturnType<typeof api.retailers.getMyRetailer>
>;

const STAMP: Record<NonNullable<CreditStub["stamp"]>, string> = {
	Low: "text-amber-700 dark:text-amber-300",
	Waiting: "text-red-600 dark:text-red-400",
	Trial: "text-accent-emphasis",
	"On us": "text-accent-emphasis",
};

/**
 * The stub for the store on screen, or null when this reader has no credits
 * grant (and `undefined` while loading). Shares every read with
 * `CreditMeter`, so opening the menu after Home costs nothing.
 */
export function useCreditStub(
	retailer: Retailer | null | undefined,
	opts: { menuOpen?: boolean } = {},
): CreditStub | null | undefined {
	const credits = usePermission("credits");
	const actingAsAdmin = retailer?.actingAsAdmin === true;
	const storeArgs = retailer
		? { retailerId: actingAsAdmin ? retailer._id : undefined }
		: ("skip" as const);
	const enabled = retailer && credits.canRead;
	const balance = useQuery(
		convexQuery(api.credits.getBalance, enabled ? storeArgs : "skip"),
	).data;
	const pace = useQuery(
		convexQuery(
			api.credits.getUsagePace,
			enabled && retailer
				? {
						retailerId: actingAsAdmin ? retailer._id : undefined,
						since: todayMytMidnight() - USAGE_PACE_DAYS * 24 * 60 * 60 * 1000,
					}
				: "skip",
		),
	).data;
	// Only when the menu is open — the trigger line doesn't need it.
	const topUp = useQuery(
		convexQuery(
			api.creditPurchases.topUpOptions,
			enabled && opts.menuOpen ? storeArgs : "skip",
		),
	).data;
	const gate = useCreditGateFor(retailer);

	if (!retailer) return null;
	if (credits.role === undefined) return undefined;
	if (!credits.canRead) return null;
	if (balance === undefined) return undefined;
	const refusal =
		topUp?.refusalMessage ??
		(topUp?.viewOnly === "acting_as_admin"
			? TOP_UP_VIEW_ONLY_MESSAGE
			: topUp?.viewOnly === "no_write"
				? "Ask the store owner for credits access to buy packs."
				: null);
	return creditStub({
		balance,
		ordersWaiting: gate.ordersWaiting,
		route: gate.route,
		canAct: gate.canAct,
		perDay: pace?.perDay ?? 0,
		topUpRefusal: refusal,
		// Until the options load (menu just opened) assume packs are sold —
		// the button then greys out with the reason if they aren't, rather than
		// popping in a beat later.
		topUpSold:
			(topUp === undefined || topUp?.available === true) &&
			balance?.lockExempt == null,
		sponsored: retailer.subscription?.comped === true,
	});
}

/** The person's avatar. */
export function ProfileAvatar({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
	const { user } = useUser();
	const initials =
		(user?.firstName?.[0] ?? "") + (user?.lastName?.[0] ?? "") ||
		user?.primaryEmailAddress?.emailAddress?.[0]?.toUpperCase() ||
		"?";
	const box = size === "lg" ? "size-9" : size === "sm" ? "size-7" : "size-8";
	return (
		<span className={cn("relative inline-flex shrink-0", box)}>
			{user?.imageUrl ? (
				<img
					src={user.imageUrl}
					alt=""
					className={cn("rounded-full object-cover", box)}
				/>
			) : (
				<span
					className={cn(
						"flex items-center justify-center rounded-full bg-segment text-[11px] font-bold text-segment-foreground",
						box,
					)}
				>
					{initials.toUpperCase()}
				</span>
			)}
		</span>
	);
}

/**
 * The menu itself, around any trigger. `align`/`side` follow where the
 * trigger sits (the sidebar foot opens up and right; the phone header down).
 */
export function ProfileMenu({
	retailer,
	trigger,
	side,
	align,
	open,
	onOpenChange,
}: {
	retailer: Retailer | null | undefined;
	trigger: ReactNode;
	side: "top" | "bottom" | "right";
	align: "start" | "end";
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<DropdownMenu open={open} onOpenChange={onOpenChange}>
			<DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
			<DropdownMenuContent side={side} align={align} className="w-72 p-1.5">
				<ProfileMenuBody retailer={retailer} open={open} />
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function ProfileMenuBody({
	retailer,
	open,
}: {
	retailer: Retailer | null | undefined;
	open: boolean;
}) {
	const { user } = useUser();
	const clerk = useClerk();
	const role = useStoreRole();
	const stub = useCreditStub(retailer, { menuOpen: open });
	const email = user?.primaryEmailAddress?.emailAddress ?? null;
	const name =
		user?.fullName || user?.firstName || user?.username || email?.split("@")[0];
	const roleLabel =
		role === "owner"
			? "Owner"
			: role === "member"
				? "Team"
				: role === "admin"
					? "Admin"
					: null;

	return (
		<>
			<div className="flex items-center gap-2.5 px-2.5 py-2">
				<ProfileAvatar size="lg" />
				<div className="flex min-w-0 flex-1 flex-col leading-tight">
					<span className="truncate text-sm font-semibold">{name}</span>
					{email ? (
						<span className="truncate text-xs text-muted-foreground">
							{email}
						</span>
					) : null}
				</div>
				{retailer && roleLabel ? (
					<span className="shrink-0 rounded-full bg-segment px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-segment-foreground">
						{roleLabel}
					</span>
				) : null}
			</div>

			{retailer ? (
				<>
					<DropdownMenuSeparator />
					{stub ? <CreditStubBlock stub={stub} /> : null}
					<ReferRow retailer={retailer} />
				</>
			) : null}

			<DropdownMenuSeparator />
			<DropdownMenuItem
				className="min-h-11"
				onSelect={() => clerk.openUserProfile()}
			>
				<UserRound className="size-4 text-muted-foreground" />
				Manage account
			</DropdownMenuItem>
			<DropdownMenuItem
				className="min-h-11 text-red-600 data-[highlighted]:text-red-700 dark:text-red-400 dark:data-[highlighted]:text-red-300"
				onSelect={() => void clerk.signOut({ redirectUrl: "/" })}
			>
				<LogOut className="size-4" />
				Sign out
			</DropdownMenuItem>
		</>
	);
}

/** The 2A stub: outlined torn receipt, the menu's own surface as its paper. */
export function CreditStubBlock({ stub }: { stub: CreditStub }) {
	const month = new Intl.DateTimeFormat("en-MY", {
		month: "long",
		year: "numeric",
		timeZone: "Asia/Kuala_Lumpur",
	}).format(Date.now());
	return (
		<div
			className="kp-credit-stub mx-1 my-1 font-mono"
			data-testid="credit-stub"
			data-tone={stub.tone}
		>
			{stub.stamp ? (
				<span
					aria-hidden
					className={cn(
						"pointer-events-none absolute -top-1.5 right-3 z-10 -rotate-[5deg] rounded-[5px] border-2 border-current bg-popover px-1.5 text-[9px] font-extrabold tracking-[0.14em] uppercase opacity-90",
						STAMP[stub.stamp],
					)}
				>
					{stub.stamp}
				</span>
			) : null}
			<div className="border-x-[1.5px] border-[var(--stub-edge)] px-3.5 pt-2 pb-3">
				{/* The stub is the way to Billing — one item, the whole receipt.
				    `w-auto` beats the primitive's `w-full`: with -mx-2 a full
				    width only SHIFTS the item 8px left instead of widening it,
				    which put the whole receipt off-centre (test-code). */}
				<DropdownMenuItem
					asChild
					className="-mx-2 w-auto flex-col items-stretch gap-0 rounded-md px-2 py-1 data-[highlighted]:bg-accent/5"
				>
					<Link
						to="/app/settings"
						search={{ tab: "billing" }}
						aria-label={`Kedaipal credits: ${stub.headline}. ${stub.leader.label} ${stub.leader.value}. Open billing.`}
					>
						<span className="flex items-center justify-center gap-1 font-heading text-[11px] font-extrabold tracking-[0.3em] uppercase">
							Kedaipal credits
							<ChevronRight
								aria-hidden
								className="size-3 text-muted-foreground"
							/>
						</span>
						{stub.tone !== "onus" ? (
							<span className="text-center text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
								{month}
							</span>
						) : null}
						{/* Edge to edge of the receipt: the item's -mx-2/px-2 cancel,
						    so the rule cancels only the wrapper's px-3.5. */}
						<span
							aria-hidden
							className="-mx-3.5 my-2.5 block border-t-[1.5px] border-dashed border-[var(--stub-edge)]"
						/>
						<span
							className={cn(
								"text-center text-[22px] leading-tight font-bold tabular-nums tracking-tight",
								STUB_INK[stub.tone],
							)}
							data-testid="credit-stub-headline"
						>
							{stub.headline}
						</span>
						<span aria-hidden className="my-2.5 flex justify-center gap-[3px]">
							{Array.from({ length: STUB_DOTS }, (_, i) => (
								<i
									// biome-ignore lint/suspicious/noArrayIndexKey: fixed perforation, never reordered
									key={i}
									className={cn(
										"block size-2 shrink-0 rounded-full",
										i < stub.filled
											? STUB_DOT[stub.tone]
											: "shadow-[inset_0_0_0_1.5px_var(--stub-edge)]",
									)}
								/>
							))}
						</span>
						<span className="flex items-baseline gap-1.5 text-[11px] text-muted-foreground">
							<span className="shrink-0">{stub.leader.label}</span>
							<i
								aria-hidden
								className="min-w-3 flex-1 -translate-y-[3px] border-b-2 border-dotted border-[var(--stub-edge)]"
							/>
							<b className="shrink-0 font-semibold text-foreground">
								{stub.leader.value}
							</b>
						</span>
					</Link>
				</DropdownMenuItem>
				{stub.button ? (
					stub.button.disabledReason ? (
						<>
							<DropdownMenuItem
								disabled
								className="mt-2.5 min-h-11 justify-center rounded-lg font-sans text-xs font-semibold shadow-[inset_0_0_0_1px_var(--stub-edge)]"
							>
								{stub.button.label}
							</DropdownMenuItem>
							<p className="mt-1.5 font-sans text-[11px] leading-snug text-muted-foreground">
								{stub.button.disabledReason}
							</p>
						</>
					) : (
						<DropdownMenuItem
							asChild
							className="mt-2.5 min-h-11 justify-center rounded-lg bg-background font-sans text-xs font-semibold shadow-[inset_0_0_0_1px_var(--stub-edge)] data-[highlighted]:bg-muted"
						>
							<Link to="/app/settings" search={stub.button.search}>
								{stub.button.label}
							</Link>
						</DropdownMenuItem>
					)
				) : null}
			</div>
		</div>
	);
}

/**
 * Refer & earn — featured, because free orders are what a referral pays out
 * in, and the stub above it is the order balance. Same name, same words and
 * same destination as the sidebar's Refer & earn (`/app/refer`, the 28 Oct
 * referral push): one idea, one control. Never greyed — that page explains
 * itself to a trial or paused store, so the row only changes its line. The
 * look and the words are `ReferEntryRowContent` — the same row Home shows a
 * phone under its greeting (src/components/referrals/refer-entry.tsx).
 * `w-auto` beats the menu-item primitive's `w-full`: with `mx-1` a full width
 * pushes the row past the right edge instead of insetting it, so its right
 * gap read narrower than its left (test-code, 31 Oct).
 */
function ReferRow({ retailer }: { retailer: Retailer }) {
	const card = useQuery(
		convexQuery(api.referrals.myCard, {
			retailerId: retailer.actingAsAdmin ? retailer._id : undefined,
		}),
	).data;
	if (!card) return null;
	return (
		<DropdownMenuItem
			asChild
			className={cn(
				"mx-1 my-1 w-auto data-[highlighted]:bg-accent/15",
				REFER_ROW_CLASS,
			)}
			data-testid="refer-row"
		>
			<Link to="/app/refer">
				<ReferEntryRowContent card={card} />
			</Link>
		</DropdownMenuItem>
	);
}
