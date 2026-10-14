import { Link } from "@tanstack/react-router";
import { Tent } from "lucide-react";
import type { ReactNode } from "react";
import { type ShowcaseTicketData, ticketPlace } from "../../lib/showcase";
import { cn } from "../../lib/utils";
import { storeInitials } from "../storefront/storefront-header";
import { AppImage } from "../ui/app-image";
import { StoreStatusLine } from "./store-card";

/**
 * A showcase ticket (z8r3fdr6mv) — ONE shape at every size, so the store a
 * buyer taps on their phone is the one they recognise on a laptop. Three
 * parts, as on a real tear-off ticket:
 *
 * - **the info panel** (top-left): the store's own cover photo under a dark
 *   fade, or — with no cover — the SHOWCASE's theme ground with the store's
 *   initials watermarked large. Either way the panel is dark and the name is
 *   white, so a row of tickets reads as one row whatever each store uploaded
 *   (the uniform-fallback decision, Round 4);
 * - **the status strip** under a dashed tear line: the directory's own live
 *   "Open now" line, same author as every other card;
 * - **the stub** (right), past a second tear line: the booth label, or a tent
 *   mark reading "at the event" when the admin gave none.
 *
 * The paper is cream in every theme and in dark mode too — it is a ticket.
 * The notches are cut in the theme's ground colour; the ticket only ever
 * sits on a showcase surface, so they read as holes. `onSurface` names which
 * variable to cut them with.
 */
export function ShowcaseTicket({
	ticket,
	now,
	className,
	inert = false,
}: {
	ticket: ShowcaseTicketData;
	now: number;
	className?: string;
	/** In the pile, tickets under the top one can't be tapped — a stray tap
	 * on the stack must go to what the buyer can SEE. */
	inert?: boolean;
}) {
	const { card } = ticket;
	const place = ticketPlace(ticket);
	const initials = storeInitials(card.storeName);
	return (
		<Link
			to="/$slug"
			params={{ slug: card.slug }}
			tabIndex={inert ? -1 : undefined}
			aria-hidden={inert || undefined}
			className={cn(
				"group relative flex overflow-visible rounded-2xl bg-[var(--sc-paper)] text-foreground shadow-[0_12px_28px_-14px_rgb(0_0_0/0.65)] transition-[translate,box-shadow] duration-200 ease-out focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[var(--sc-accent)]/60 motion-reduce:transition-none",
				inert
					? "pointer-events-none"
					: "hover:-translate-y-0.5 hover:shadow-[0_18px_34px_-14px_rgb(0_0_0/0.7)] motion-reduce:hover:translate-y-0",
				className,
			)}
		>
			<Notch className="-top-2 right-[64px]" />
			<Notch className="-bottom-2 right-[64px]" />
			<Notch className="-left-2 top-[76px]" />

			<span className="flex min-w-0 grow flex-col">
				<span className="relative flex h-[84px] items-center overflow-hidden rounded-tl-2xl bg-showcase px-3.5">
					{ticket.coverImageUrl ? (
						<>
							<AppImage
								src={ticket.coverImageUrl}
								alt=""
								aspect="absolute inset-0 h-full w-full"
								sizes="(min-width: 1024px) 300px, 80vw"
								objectFit="cover"
							/>
							<span
								aria-hidden
								className="absolute inset-0 bg-showcase-scrim"
							/>
						</>
					) : (
						<span
							aria-hidden
							className="pointer-events-none absolute -right-1.5 -top-3.5 select-none font-heading text-[88px] font-black leading-none tracking-[-0.05em] text-white/[0.08]"
						>
							{initials}
						</span>
					)}
					<span className="relative flex min-w-0 items-center gap-2.5 text-white">
						<span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-white/90 bg-primary font-heading text-[13px] font-extrabold text-primary-foreground">
							{card.logoUrl ? (
								<AppImage
									src={card.logoUrl}
									alt=""
									aspect="size-full"
									sizes="40px"
									objectFit="contain"
									className="bg-background"
								/>
							) : (
								initials
							)}
						</span>
						<span className="flex min-w-0 flex-col">
							<span className="truncate font-heading text-[15px] font-extrabold leading-tight">
								{card.storeName}
							</span>
							{place ? (
								<span className="truncate text-[11.5px] text-white/80">
									{place}
								</span>
							) : null}
						</span>
					</span>
				</span>
				<span className="flex items-center border-t-2 border-dashed border-[var(--sc-tear)] px-3.5 pb-2.5 pt-2">
					<StoreStatusLine card={card} now={now} showArea={false} />
				</span>
			</span>

			<span className="flex w-[72px] shrink-0 flex-col items-center justify-center border-l-2 border-dashed border-[var(--sc-tear)]">
				{ticket.label ? (
					<StubLabel label={ticket.label} />
				) : (
					<>
						<Tent aria-hidden className="size-6 text-[var(--sc-ink-soft)]" />
						<span className="mt-1 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--sc-ink-soft)]">
							At event
						</span>
					</>
				)}
			</span>
		</Link>
	);
}

/**
 * "Booth B4" → BOOTH over B4; "Food court 7" → FOOD COURT over 7; a label
 * with no trailing number ("Hall 2 wing") stays one line. The number is what
 * a buyer reads walking the aisles, so it gets the mono weight.
 */
function StubLabel({ label }: { label: string }) {
	const match = /^(.*?)[\s·-]*([A-Za-z]?\d+[A-Za-z]?)$/.exec(label);
	if (match?.[1]) {
		return (
			<>
				<span className="line-clamp-2 max-w-[64px] text-center text-[9px] font-bold uppercase leading-[1.2] tracking-[0.12em] text-[var(--sc-ink-soft)]">
					{match[1]}
				</span>
				<span className="font-mono text-[20px] font-bold leading-tight text-[var(--sc-ink)]">
					{match[2]}
				</span>
			</>
		);
	}
	return (
		<span className="max-w-[64px] text-center font-mono text-[12px] font-bold leading-tight text-[var(--sc-ink)]">
			{label}
		</span>
	);
}

function Notch({ className }: { className: string }): ReactNode {
	return (
		<span
			aria-hidden
			className={cn(
				"absolute size-4 rounded-full bg-[var(--sc-surface,var(--sc-b))]",
				className,
			)}
		/>
	);
}
