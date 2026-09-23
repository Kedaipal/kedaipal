// The cells the seller directory's table, cards and sheet share (z8r3fdh37c):
// one status pill, one contact line, one expiry reading — so the three
// surfaces are the same component wearing different layouts, never three
// drawings of the same fact.
import { Award, ExternalLink, Mail, MessageCircle } from "lucide-react";
import type { AdminSellerRow } from "../../../convex/admin";
import {
	type ExpiryTone,
	SELLER_STATUS_LABEL,
	type SellerBucket,
	type SellerExpiry,
} from "../../lib/admin-seller-view";
import { formatMobile } from "../../lib/format";
import { cn } from "../../lib/utils";
import { CopyButton } from "../ui/copy-button";

/** Pill tones per bucket. Semantic-ish Tailwind hues rather than raw hex —
 * the same ones the dashboard's tier pill and status badges already use. */
const STATUS_PILL: Record<SellerBucket, string> = {
	active:
		"bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
	trialing: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
	past_due: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
	on_hold: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
	cancelled: "bg-muted text-muted-foreground",
	comped:
		"bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
	admin:
		"bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
	none: "bg-muted text-muted-foreground",
};

export function StatusPill({
	bucket,
	className,
}: {
	bucket: SellerBucket;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"inline-flex h-[22px] shrink-0 items-center rounded-full px-2 text-[11px] font-semibold whitespace-nowrap",
				STATUS_PILL[bucket],
				className,
			)}
		>
			{SELLER_STATUS_LABEL[bucket]}
		</span>
	);
}

export function FoundingPill({ rank }: { rank: number }) {
	return (
		<span
			className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300"
			title={`Founding Member #${rank}`}
		>
			<Award className="size-3" aria-hidden="true" />#{rank}
		</span>
	);
}

/** Acquisition tag the signup arrived with (z8r3fdd1v0), plus the store whose
 * badge it came through (z8r3fdcwd0). Absent = direct, so nothing renders. */
export function ViaPill({ seller }: { seller: AdminSellerRow }) {
	if (!seller.signupSource) return null;
	return (
		<span className="inline-flex max-w-full items-center rounded-md bg-muted px-1.5 py-px text-[11px] text-muted-foreground">
			<span className="truncate">
				via {seller.signupSource}
				{seller.signupReferrer ? ` · /${seller.signupReferrer.slug}` : null}
			</span>
		</span>
	);
}

const TONE_TEXT: Record<ExpiryTone, string> = {
	muted: "text-muted-foreground",
	warn: "text-amber-700 dark:text-amber-400",
	danger: "text-red-700 dark:text-red-400",
};

/** "Renews 14 Oct 2026" over "in 22 days", the second line coloured by how
 * urgent it is. */
export function ExpiryText({
	expiry,
	className,
}: {
	expiry: SellerExpiry;
	className?: string;
}) {
	return (
		<div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
			<span className="truncate text-sm font-semibold">{expiry.headline}</span>
			{expiry.detail ? (
				<span
					className={cn("truncate text-xs font-medium", TONE_TEXT[expiry.tone])}
				>
					{expiry.detail}
				</span>
			) : null}
		</div>
	);
}

/** Icon-only copy control sized for the surface: 32px beside a mouse, the
 * 44px floor under a thumb. The visible label is screen-reader only; the
 * aria-label names what gets copied. */
function copyButtonClass(compact: boolean): string {
	return compact
		? "h-8 min-h-0 w-8 justify-center rounded-lg px-0"
		: "h-11 w-11 justify-center rounded-lg px-0";
}

/**
 * One contact fact with its copy control — the email, or a WhatsApp number
 * with a chat link beside the copy. An absent value says so in words rather
 * than leaving a blank cell, and grows no buttons.
 */
export function ContactLine({
	kind,
	value,
	compact = false,
	className,
}: {
	kind: "email" | "whatsapp";
	value?: string;
	/** Desktop table density (32px controls). Off = the 44px touch floor. */
	compact?: boolean;
	className?: string;
}) {
	const Icon = kind === "email" ? Mail : MessageCircle;
	const noun = kind === "email" ? "email" : "WhatsApp";
	if (!value) {
		return (
			<div
				className={cn(
					"flex min-w-0 items-center gap-1.5 text-muted-foreground",
					compact ? "min-h-8" : "min-h-11",
					className,
				)}
			>
				<Icon className="size-3.5 shrink-0" aria-hidden="true" />
				<span className="truncate text-[13px] italic">No {noun} on file</span>
			</div>
		);
	}
	const shown = kind === "email" ? value : formatMobile(value);
	const digits = value.replace(/\D/g, "");
	return (
		<div
			className={cn("flex min-w-0 items-center gap-1.5", className)}
			data-contact={kind}
		>
			<Icon
				className="size-3.5 shrink-0 text-muted-foreground"
				aria-hidden="true"
			/>
			<span className="min-w-0 flex-1 truncate text-[13px]">{shown}</span>
			{kind === "whatsapp" ? (
				<a
					href={`https://wa.me/${digits}`}
					target="_blank"
					rel="noreferrer"
					aria-label={`Chat on WhatsApp with ${shown}`}
					className={cn(
						"flex shrink-0 items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
						copyButtonClass(compact),
					)}
				>
					<ExternalLink className="size-3.5" aria-hidden="true" />
				</a>
			) : null}
			<CopyButton
				value={shown}
				ariaLabel={`Copy ${noun} ${shown}`}
				successMessage={`${kind === "email" ? "Email" : "Number"} copied`}
				className={copyButtonClass(compact)}
				labelClassName="sr-only"
			/>
		</div>
	);
}
