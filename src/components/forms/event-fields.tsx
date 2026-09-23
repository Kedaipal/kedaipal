import { CalendarClock } from "lucide-react";
import {
	DAY_MS,
	hhmmFromMinutes,
	mytMidnightFromYmd,
	timeMinutesFromHhmm,
	todayMytMidnight,
	ymdFromEpoch,
} from "../../../convex/lib/fulfilmentDate";
import {
	formatEventBadge,
	LONG_EVENT_WARN_DAYS,
	MAX_EVENT_SEATS,
} from "../../../convex/lib/productEvent";
import { ProBadge } from "../app/pro-gate";
import { Input } from "../ui/input";
import { ToggleSwitch } from "../ui/toggle-switch";

/**
 * The event block's state, kept as TYPED-RAW strings like every other draft in
 * the product form (a half-typed seat cap must survive a re-render). `on` is
 * separate from the values so turning the toggle off and on again doesn't
 * make the seller re-enter the date she just typed.
 */
export type EventDraft = {
	on: boolean;
	/** "YYYY-MM-DD" — the native date input's own value shape. */
	date: string;
	/** "YYYY-MM-DD" or "" — the LAST day of a multi-day event; blank = one day. */
	endDate: string;
	/** "HH:MM" or "" — blank means an all-day event. */
	time: string;
	/** Seat cap as typed; blank = no limit. */
	seats: string;
};

export const EMPTY_EVENT_DRAFT: EventDraft = {
	on: false,
	date: "",
	endDate: "",
	time: "",
	seats: "",
};

/** Seed the draft from a saved product (or the empty draft when it isn't an
 * event). Shared by the form and the wizard's handoff so a round-trip through
 * either can't lose a value. */
export function eventDraftFrom(
	event:
		| { date: number; timeMinutes?: number; seats?: number; endDate?: number }
		| undefined,
): EventDraft {
	if (!event) return { ...EMPTY_EVENT_DRAFT };
	return {
		on: true,
		date: ymdFromEpoch(event.date),
		endDate: event.endDate === undefined ? "" : ymdFromEpoch(event.endDate),
		time:
			event.timeMinutes === undefined ? "" : hhmmFromMinutes(event.timeMinutes),
		seats: event.seats === undefined ? "" : String(event.seats),
	};
}

export type EventSubmitValue = {
	date: number;
	timeMinutes?: number;
	seats?: number;
	endDate?: number;
} | null;

/** The draft's last day as an epoch: `undefined` when blank or the same day as
 * the start (one spelling for "one day", mirroring `sanitizeEvent`), NaN when
 * unparseable. */
function draftEndDate(draft: EventDraft, date: number): number | undefined {
	if (draft.endDate.trim().length === 0) return undefined;
	const end = mytMidnightFromYmd(draft.endDate);
	return end === date ? undefined : end;
}

/** Seller-facing problem with the draft's last day, or null. Shared by the
 * inline error and `eventDraftValid` so the two can't disagree. */
export function eventEndDateIssue(draft: EventDraft): string | null {
	if (draft.date.trim().length === 0) return null;
	const date = mytMidnightFromYmd(draft.date);
	const end = draftEndDate(draft, date);
	if (end === undefined || !Number.isFinite(date)) return null;
	if (!Number.isFinite(end)) return "Pick a valid last day, or leave it blank.";
	if (end < date) return "The last day can't be before the event date.";
	return null;
}

/**
 * Amber nudge for an unusually long event — a typo'd month or year on the
 * last day keeps the listing up (and taking RSVPs) long after the event, so
 * past `LONG_EVENT_WARN_DAYS` the form asks for a second look. A WARNING, not
 * a block: Save stays enabled, because a real 6-week class series is allowed
 * (the server enforces only "a calendar day, not before the start").
 */
export function eventEndDateWarning(draft: EventDraft): string | null {
	if (eventEndDateIssue(draft) !== null) return null;
	if (draft.date.trim().length === 0) return null;
	const date = mytMidnightFromYmd(draft.date);
	const end = draftEndDate(draft, date);
	if (end === undefined || !Number.isFinite(date) || !Number.isFinite(end))
		return null;
	const days = Math.round((end - date) / DAY_MS) + 1;
	if (days <= LONG_EVENT_WARN_DAYS) return null;
	return `That's a ${days}-day event — double-check the last day.`;
}

/**
 * Draft → what `products.create`/`update` take. `null` (not `undefined`) when
 * the toggle is off, because that's the spelling that CLEARS a stored event —
 * `undefined` would mean "no change" and quietly leave the event in place.
 */
export function eventSubmitValue(draft: EventDraft): EventSubmitValue {
	if (!draft.on || draft.date.trim().length === 0) return null;
	const timeMinutes = timeMinutesFromHhmm(draft.time);
	const seats = Number.parseInt(draft.seats.trim(), 10);
	const date = mytMidnightFromYmd(draft.date);
	const endDate = draftEndDate(draft, date);
	return {
		date,
		timeMinutes: Number.isNaN(timeMinutes) ? undefined : timeMinutes,
		seats: Number.isInteger(seats) && seats > 0 ? seats : undefined,
		endDate:
			endDate !== undefined && Number.isFinite(endDate) ? endDate : undefined,
	};
}

/** Is the draft in a state the server would accept? Mirrors `sanitizeEvent`, so
 * the form can't offer a Save that the mutation then refuses. */
export function eventDraftValid(
	draft: EventDraft,
	opts: { allowPastDate?: boolean; now?: number } = {},
): boolean {
	if (!draft.on) return true;
	if (draft.date.trim().length === 0) return false;
	const date = mytMidnightFromYmd(draft.date);
	if (!Number.isFinite(date)) return false;
	if (!opts.allowPastDate && date < todayMytMidnight(opts.now)) return false;
	if (eventEndDateIssue(draft) !== null) return false;
	const seatsRaw = draft.seats.trim();
	if (seatsRaw.length > 0) {
		const seats = Number.parseInt(seatsRaw, 10);
		if (!Number.isInteger(seats) || seats < 1 || seats > MAX_EVENT_SEATS)
			return false;
	}
	return true;
}

/**
 * "This is an event" — the fixed-date mode (`z8r3fdff9u`).
 *
 * Its own card rather than a third row under "Order rules" on purpose: min
 * quantity and min notice are LIMITS on how a buyer may order, while this
 * changes what the product IS (it gains a date, a venue, a seat count, and it
 * takes itself off the storefront afterwards). It also overrides the minimum
 * notice below it, which is why it sits above it and says so.
 */
export function EventFields({
	draft,
	onChange,
	locked,
	/** Live RSVPs already taken — the date and the toggle lock once this is > 0.
	 * Undefined on create (nothing can have RSVP'd yet). */
	rsvpCount,
	noToggle,
}: {
	draft: EventDraft;
	onChange: (next: EventDraft) => void;
	/** Client mirror of the `events` plan gate — the server enforces it too. */
	locked: boolean;
	rsvpCount?: number;
	/** Wizard EVENT-FLOW step (`z8r3fdff9u` round 4): the flow itself is the
	 * toggle, so the header row (title + switch) drops and the fields render
	 * unconditionally. The drawer/full-form rendering is unchanged. */
	noToggle?: boolean;
}) {
	const taken = rsvpCount ?? 0;
	const hasRsvps = taken > 0;
	const set = (patch: Partial<EventDraft>) => onChange({ ...draft, ...patch });

	const todayYmd = ymdFromEpoch(todayMytMidnight());
	const dateEpoch =
		draft.date.trim().length > 0 ? mytMidnightFromYmd(draft.date) : Number.NaN;
	const dateInPast =
		Number.isFinite(dateEpoch) && dateEpoch < todayMytMidnight() && !hasRsvps;

	const seatsRaw = draft.seats.trim();
	const seatsParsed = Number.parseInt(seatsRaw, 10);
	const seatsValid =
		seatsRaw.length === 0 ||
		(Number.isInteger(seatsParsed) &&
			seatsParsed >= 1 &&
			seatsParsed <= MAX_EVENT_SEATS);
	// A cap below the guests already coming would render "−3 seats left" and
	// refuse people who are already on the list. Refused at the server too.
	const seatsBelowTaken =
		seatsValid && seatsRaw.length > 0 && seatsParsed < taken;
	const endDateIssue = eventEndDateIssue(draft);
	const endDateWarning = eventEndDateWarning(draft);

	return (
		<div className="flex flex-col gap-4">
			{noToggle ? null : (
				<div className="flex items-start justify-between gap-4">
					<div className="min-w-0">
						<h4 className="flex items-center gap-2 text-sm font-semibold leading-tight">
							This is an event
							{locked ? <ProBadge /> : null}
						</h4>
						<p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
							{locked
								? "Events are part of the Pro plan. Upgrade in Settings → Billing to take RSVPs."
								: hasRsvps
									? `${taken} ${taken === 1 ? "guest has" : "guests have"} RSVP'd — cancel or archive this event instead of turning it off.`
									: "Guests RSVP to one fixed date instead of picking their own. Collected at your pickup point, and the listing comes off your storefront by itself the day after it ends."}
						</p>
					</div>
					<ToggleSwitch
						on={draft.on}
						onChange={(on) => set({ on })}
						disabled={locked || hasRsvps}
						label="This product is an event"
					/>
				</div>
			)}

			{draft.on || noToggle ? (
				<div
					className={
						noToggle
							? "flex flex-col gap-4"
							: "flex flex-col gap-4 border-t border-border pt-4"
					}
				>
					<div className="flex flex-wrap items-start gap-4">
						<div className="flex flex-col gap-1.5">
							<label htmlFor="event-date" className="text-sm font-medium">
								Event date
							</label>
							<Input
								id="event-date"
								type="date"
								min={hasRsvps ? undefined : todayYmd}
								value={draft.date}
								onChange={(e) => set({ date: e.target.value })}
								variant="field"
								disabled={locked || hasRsvps}
								isError={dateInPast}
								className="w-44"
							/>
						</div>
						{/* A multi-day event (a weekend camp): display + how long the
						    listing stays up. Stays editable with guests booked — every
						    RSVP keeps the check-in day, so this never moves a seat. */}
						<div className="flex flex-col gap-1.5">
							<label htmlFor="event-end-date" className="text-sm font-medium">
								Last day{" "}
								<span className="font-normal text-muted-foreground">
									(optional)
								</span>
							</label>
							<Input
								id="event-end-date"
								type="date"
								min={draft.date || todayYmd}
								value={draft.endDate}
								onChange={(e) => set({ endDate: e.target.value })}
								variant="field"
								disabled={locked}
								isError={endDateIssue !== null}
								className="w-44"
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<label htmlFor="event-time" className="text-sm font-medium">
								Start time{" "}
								<span className="font-normal text-muted-foreground">
									(optional)
								</span>
							</label>
							<Input
								id="event-time"
								type="time"
								value={draft.time}
								onChange={(e) => set({ time: e.target.value })}
								variant="field"
								disabled={locked}
								className="w-36"
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<label htmlFor="event-seats" className="text-sm font-medium">
								Seats{" "}
								<span className="font-normal text-muted-foreground">
									(optional)
								</span>
							</label>
							<Input
								id="event-seats"
								type="number"
								inputMode="numeric"
								min={1}
								max={MAX_EVENT_SEATS}
								placeholder="e.g. 30"
								value={draft.seats}
								onChange={(e) => set({ seats: e.target.value })}
								variant="field"
								disabled={locked}
								isError={!seatsValid || seatsBelowTaken}
								className="w-28"
							/>
						</div>
					</div>

					{dateInPast ? (
						<p className="text-xs text-destructive">
							Pick today or a future date — RSVPs can&apos;t be taken for a day
							that has passed.
						</p>
					) : null}
					{endDateIssue !== null ? (
						<p className="text-xs text-destructive">{endDateIssue}</p>
					) : null}
					{/* Amber, not red — Save stays enabled. A 6-week series is real;
					    this only asks for a second look at a span a typo'd month or
					    year would produce. */}
					{endDateWarning !== null ? (
						<p className="text-xs text-amber-600 dark:text-amber-500">
							{endDateWarning}
						</p>
					) : null}
					{!seatsValid ? (
						<p className="text-xs text-destructive">
							Enter a whole number between 1 and {MAX_EVENT_SEATS}, or leave
							blank for no limit.
						</p>
					) : null}
					{seatsBelowTaken ? (
						<p className="text-xs text-destructive">
							{taken} {taken === 1 ? "seat is" : "seats are"} already taken —
							the cap can&apos;t go below {taken}. Raise it any time.
						</p>
					) : null}

					{/* Every consequence of the toggle, stated where it's switched on.
					    A seller must never discover at checkout that her event forced
					    pickup, or wonder why her minimum notice stopped applying. */}
					<div className="rounded-xl bg-muted/60 px-3 py-2.5">
						<p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
							<CalendarClock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
							<span>
								{/* A full sentence in EVERY state: before a date exists the
								    line used to open mid-sentence ("they can't pick…"). */}
								Guests RSVP for{" "}
								{Number.isFinite(dateEpoch) ? (
									<strong className="font-semibold text-foreground">
										{/* An end date the field is rejecting must not be read
										    back ("6 Dec to 4 Dec") — drop it until it's valid. */}
										{formatEventBadge({
											...(eventSubmitValue(draft) ?? { date: dateEpoch }),
											...(endDateIssue !== null ? { endDate: undefined } : {}),
										})}
									</strong>
								) : (
									"the date you set above"
								)}{" "}
								— they can&apos;t pick their own date, delivery is off for the
								whole order, and your minimum notice and prep time don&apos;t
								apply.
								{/* Says nothing about a cap the field is currently rejecting —
								    "RSVPs stop at 10 seats" beside a red error describes a
								    state that will never exist. Same for an INVALID value:
								    "No seat limit" under a red 501 contradicts the error. */}
								{seatsBelowTaken || !seatsValid
									? ""
									: seatsRaw.length > 0
										? ` RSVPs stop at ${seatsParsed} seats.`
										: " No seat limit — per-option stock still applies."}{" "}
								The listing hides itself the day after it ends.
							</span>
						</p>
					</div>
				</div>
			) : null}
		</div>
	);
}
