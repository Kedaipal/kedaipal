// The booking-request checkout (S2 `86eyn4kbw`; design 86eym0pjg §1, Variant
// A locked 16 Aug — the calendar lives INLINE as a numbered step, availability
// visible with no tap, dates and money on one screen). Renders in place of the
// cart checkout when the route carries `?booking=<productSlug>`: a stay has no
// cart, no delivery/pickup and no date-input step — the range IS the order.
//
// Money honesty (locked flow): nothing is charged at request time. The CTA
// reads "Request to book", the receipt totals what approval will ask for, and
// the 24-hour promise is stated where the buyer commits.

import { convexQuery } from "@convex-dev/react-query";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { Minus, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { splitNightsByRate } from "../../../convex/lib/bookingAvailability";
import {
	type DialIso,
	parseBuyerWaPhone,
} from "../../../convex/lib/buyerPhone";
import {
	closedDaysBetween,
	closedRangeDays,
	closuresWithin,
	describeClosure,
} from "../../../convex/lib/closedDates";
import type { Country } from "../../../convex/lib/country";
import {
	DAY_MS,
	formatFulfilmentDate,
	todayMytMidnight,
} from "../../../convex/lib/fulfilmentDate";
import type { Locale } from "../../../convex/lib/locale";
import { storeClosedOn } from "../../../convex/lib/openingHours";
import { weekendDaysLabel } from "../../../convex/lib/productKind";
import { usePublishedHeight } from "../../hooks/usePublishedHeight";
import { MASK_PII } from "../../lib/analytics-privacy";
import {
	addMytMonths,
	type BookingSelection,
	bookingPriceSuffix,
	bookingSpanNoun,
	canCheckIn,
	conflictCeiling,
	describeNights,
	formatNight,
	mytMonthStart,
	nextBookingSelection,
	packageCountLabel,
	packageTerm,
	type SelectionContext,
} from "../../lib/booking-dates";
import { buyerPhoneRejection } from "../../lib/buyer-phone-rejection";
import {
	convexErrorMessage,
	formatMobile,
	formatPrice,
} from "../../lib/format";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { BuyerPhoneCountrySwitch, BuyerPhoneInput } from "../ui/my-phone-input";
import { Skeleton } from "../ui/skeleton";
import { BookingCalendar, BookingCalendarLegend } from "./booking-calendar";
import { CheckoutSection } from "./checkout-form";

const NOTE_MAX = 500;

export function BookingCheckoutForm({
	retailerId,
	storeName,
	storeSlug,
	productSlug,
	locale,
	country,
}: {
	retailerId: Id<"retailers">;
	storeName: string;
	storeSlug: string;
	productSlug: string;
	locale?: Locale;
	/** The store's country (SG-lite) — the phone picker's default, and the
	 * country an untouched picker is judged by, so a booking checkout accepts
	 * exactly what the ordinary checkout does. */
	country: Country;
}) {
	const navigate = useNavigate();
	const requestBooking = useMutation(api.bookings.requestBooking);

	const product = useQuery(
		convexQuery(api.products.getPublicBySlug, {
			retailerId,
			slug: productSlug,
		}),
	).data;

	// Visible month drives the availability window: [month, month + 2 months)
	// stays under the server's 92-day cap while covering the rendered month and
	// its spillover rows. Stable MYT anchors, so the reactive query caches per
	// window as the buyer pages.
	const todayMonth = mytMonthStart(todayMytMidnight(Date.now()));
	const [month, setMonth] = useState(todayMonth);
	const windowFrom = month;
	const windowTo = addMytMonths(month, 2);
	// `placeholderData: keepPreviousData` is load-bearing here, exactly as it is
	// on the seller's inbox. Paging the month rewrites the query ARGS, which
	// makes a new TanStack Query key, which makes `data` undefined until the new
	// subscription resolves — and the guard below turns the ENTIRE checkout into
	// two skeletons while that happens. Tapping "next month" mid-form flashed
	// the buyer's name, phone and note off the screen and back.
	//
	// Keeping the previous window means the page holds still and only the grid's
	// contents change. The trade is one beat of the OLD month's availability, so
	// day taps are refused while `isPlaceholderData` is true — a buyer must
	// never pick a night off a stale answer.
	const availabilityQuery = useQuery({
		...convexQuery(
			api.bookings.availability,
			product
				? { productId: product._id, from: windowFrom, to: windowTo }
				: "skip",
		),
		placeholderData: keepPreviousData,
	});
	const availability = availabilityQuery.data;
	const availabilityStale = availabilityQuery.isPlaceholderData;

	const [selection, setSelection] = useState<BookingSelection>({});
	// How many packages ("3 months up front"). Free-range stays ignore it — the
	// range they pick IS the quantity.
	const [packages, setPackages] = useState(1);
	const [name, setName] = useState("");
	const [phone, setPhone] = useState("");
	// The buyer's own country, picked on the plate (z8r3fdh274). Null until they
	// touch the picker, so the default is DERIVED from the store's country rather
	// than copied into state once.
	const [pickedDialCountry, setPickedDialCountry] = useState<DialIso | null>(
		null,
	);
	// Left the field once — until then the rejection stays quiet
	// (`buyerPhoneRejection`: a complaint on the first digit is noise).
	const [phoneTouched, setPhoneTouched] = useState(false);
	const [note, setNote] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [serverError, setServerError] = useState<string | null>(null);

	const ms = locale === "ms";
	const today = todayMytMidnight(Date.now());
	const ctx: SelectionContext | null = useMemo(() => {
		if (!availability) return null;
		return {
			unavailable: new Set(availability.unavailable),
			earliestCheckIn: today + availability.noticeDays * DAY_MS,
			latestCheckIn: today + availability.horizonDays * DAY_MS,
			maxNights: availability.maxNights,
			packageLength: availability.packageLength,
			packageUnit: availability.packageUnit,
			// The count is part of the SELECTION context, not just the price:
			// three months needs three months of free nights, so raising it can
			// legitimately close start dates that a single package could use.
			packageQuantity: packages,
			// An open-days package (z8r3fdhpm7) resolves each start's term from
			// the same two facts the server uses, so the promised last day is the
			// one charged.
			isClosed:
				availability.closureRule === "skipped"
					? storeClosedOn(availability.closedWeekdays, availability.closures)
					: undefined,
		};
	}, [availability, today, packages]);
	// The shut days on the month in view (z8r3fdhpm7) — the calendar's hatch.
	// Closed dates always; the weekly day off too for an open-days package,
	// because there it's a day the term steps over.
	const closedDaySet = useMemo(() => {
		// The grid also paints the neighbouring months' days in its first and
		// last rows — a closed 1 Oct under September must be hatched too.
		const from = month - 7 * DAY_MS;
		const to = addMytMonths(month, 1) + 14 * DAY_MS;
		if (!ctx?.isClosed) {
			return new Set(closedDaysBetween(availability?.closures, from, to));
		}
		const days = new Set<number>();
		for (let day = from; day < to; day += DAY_MS) {
			if (ctx.isClosed(day)) days.add(day);
		}
		return days;
	}, [availability?.closures, ctx, month]);

	// A vanished/unbookable listing (archived, hidden, kind changed) — send the
	// buyer back to the store rather than a dead form. `undefined` = loading.
	if (product === null || (product && availability === null)) {
		return (
			<div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 text-center">
				<p className="text-sm text-muted-foreground">
					{ms
						? "Maaf — penyenaraian ini tidak menerima tempahan sekarang."
						: "Sorry — this listing isn't taking bookings right now."}
				</p>
				<Button
					variant="outline"
					onClick={() =>
						navigate({ to: "/$slug", params: { slug: storeSlug } })
					}
				>
					{ms ? `Kembali ke ${storeName}` : `Back to ${storeName}`}
				</Button>
			</div>
		);
	}
	if (!product || !availability || !ctx) {
		return (
			<div className="flex flex-col gap-4">
				<Skeleton className="h-24 w-full rounded-2xl" />
				<Skeleton className="h-96 w-full rounded-2xl" />
			</div>
		);
	}

	const unitPrice = product.variants[0]?.price ?? product.priceFrom ?? 0;
	// Refundable security deposit — stated HERE, before the request, and part
	// of "Total when approved" (one payment; 86eyn4kee).
	const securityDeposit = product.booking?.securityDeposit ?? 0;
	// A fixed-length package is ONE flat price for the whole span (S7); a free
	// range multiplies by nights. Mirrors requestBooking's own line-building.
	const packageLength = availability.packageLength;
	const isPackage = packageLength !== undefined && packageLength > 0;
	const packageUnit = availability.packageUnit;
	// Server-computed, so the stepper's ceiling is exactly the mutation's clamp.
	const maxPackages = availability.maxPackageQuantity;
	// Instant book (S7): no approval step, so nothing on this page may promise
	// one. The buyer books and pays straight away.
	const instantBook = product.booking?.autoAccept === true;
	// Weekend rate (S13) — read from the AVAILABILITY payload, the same answer
	// the server prices against, and split through the same pure function
	// `requestBooking` uses, so the receipt can't disagree with the charge by
	// a night. Free-range only; a package has one flat price.
	const weekendPrice = !isPackage ? availability.weekendPrice : undefined;
	const weekendDays =
		weekendPrice !== undefined ? (availability.weekendDays ?? []) : [];
	const hasWeekendRate = weekendPrice !== undefined && weekendDays.length > 0;

	// For a package the check-OUT is never stored, only derived — otherwise
	// bumping the count from 1 to 3 would leave a stale end date sitting next to
	// a tripled price. One source of truth: the start the buyer tapped.
	// The term, with the days an open-days package steps over (z8r3fdhpm7).
	// `null` when the start can't carry it (then `packageOutgrewStart` speaks).
	const term =
		isPackage && selection.checkIn !== undefined
			? packageTerm(selection.checkIn, ctx)
			: null;
	const checkOut = isPackage ? term?.checkOut : selection.checkOut;
	const skippedDays = term?.skipped ?? [];
	// What the calendar paints. A package is a validity WINDOW, so its band
	// ends on the LAST USABLE day — the exclusive check-out painted as the end
	// promised a day the buyer doesn't have ("Valid 2 – 9 Oct" beside a band
	// to 10 Oct), the S7 rule the receipt already keeps. A stay keeps its
	// check-out morning: that IS the day the guest taps and leaves.
	const effectiveSelection: BookingSelection =
		isPackage && selection.checkIn !== undefined
			? {
					checkIn: selection.checkIn,
					// No term (an open-days start the skips can't carry): mark the
					// start alone — never a half-selection the calendar would read
					// as "now pick a check-out".
					checkOut:
						checkOut !== undefined ? checkOut - DAY_MS : selection.checkIn,
				}
			: selection;
	// Raising the count can legitimately close a start that a single package
	// could use — three months needs three months of free nights. Say so rather
	// than silently dropping their date.
	const packageOutgrewStart =
		isPackage &&
		selection.checkIn !== undefined &&
		!canCheckIn(selection.checkIn, ctx);

	const nights =
		selection.checkIn !== undefined && checkOut !== undefined
			? Math.round((checkOut - selection.checkIn) / DAY_MS)
			: 0;
	const split =
		hasWeekendRate && selection.checkIn !== undefined && checkOut !== undefined
			? splitNightsByRate(selection.checkIn, checkOut, {
					weekendPrice,
					weekendDays,
				})
			: { weekdayNights: nights, weekendNights: 0 };
	const stayTotal = isPackage
		? nights > 0
			? unitPrice * packages
			: 0
		: split.weekdayNights * unitPrice +
			split.weekendNights * (weekendPrice ?? 0);
	const conflict =
		!isPackage && selection.checkIn !== undefined && checkOut === undefined
			? conflictCeiling(selection.checkIn, ctx)
			: null;
	// Store closed dates (z8r3fdhpm7): the ones on the month in view (marked
	// and named under the grid), and — for a package that absorbs them — the
	// ones inside the buyer's term.
	// Whole ranges, never clipped to the month: a closure running 30 Sep –
	// 1 Oct clipped to "Wed, 30 Sep" would tell the buyer 1 Oct is fine.
	const nextMonth = addMytMonths(month, 1);
	const monthClosures = (availability.closures ?? []).filter(
		(range) => range.startDate < nextMonth && range.endDate >= month,
	);
	const termClosures =
		isPackage &&
		availability.closureRule === "absorbed" &&
		selection.checkIn !== undefined &&
		checkOut !== undefined
			? closuresWithin(availability.closures, selection.checkIn, checkOut)
			: [];
	const termClosureDays = termClosures.reduce(
		(sum, range) => sum + closedRangeDays(range),
		0,
	);

	const dialCountry = pickedDialCountry ?? country;
	const parsedPhone = parseBuyerWaPhone(phone, dialCountry);
	const phoneEntered = /\d/.test(phone);
	// The reason, under the field — the CTA hint below only says WHERE to look.
	const phoneRejection = buyerPhoneRejection(parsedPhone, phone, phoneTouched);
	const nameOk = name.trim().length >= 3;
	const rangeOk = nights >= 1 && !packageOutgrewStart;
	const blockedReason = packageOutgrewStart
		? `Not all of those ${packageCountLabel(packageLength, packageUnit)} are free — pick another start date`
		: !rangeOk
			? isPackage
				? "Pick your start date"
				: selection.checkIn === undefined
					? "Pick your check-in and check-out dates"
					: "Pick your check-out date"
			: !nameOk
				? "Enter your name"
				: !parsedPhone.ok
					? phoneEntered
						? "Check your WhatsApp number"
						: "Enter your WhatsApp number"
					: null;

	async function submit() {
		if (blockedReason || !product) return;
		if (selection.checkIn === undefined || checkOut === undefined) return;
		setSubmitting(true);
		setServerError(null);
		try {
			const result = await requestBooking({
				retailerId,
				productId: product._id,
				checkIn: selection.checkIn,
				// Omitted for a package: the server derives the end from the
				// listing's own length, so a tampered client can't buy 90 days at
				// the 30-day price. The COUNT it derives from is clamped there too.
				checkOut: isPackage ? undefined : checkOut,
				packageQuantity: isPackage ? packages : undefined,
				customer: {
					name: name.trim(),
					waPhone: phone,
					waDialCountry: dialCountry,
				},
				customerNote: note.trim().length > 0 ? note.trim() : undefined,
			});
			// Straight to the order page — a request has no wa.me handoff and no
			// payment yet; the page shows the awaiting-approval state.
			navigate({
				to: "/track/$token",
				params: { token: result.trackingToken },
			});
		} catch (err) {
			setServerError(convexErrorMessage(err));
			setSubmitting(false);
		}
	}

	const summary = (
		<div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
			<h2 className="font-heading text-sm font-bold">
				{isPackage
					? ms
						? "Pakej anda"
						: "Your package"
					: ms
						? "Penginapan anda"
						: "Your stay"}
			</h2>
			<div className="flex flex-col gap-2 border-t-2 border-dashed border-border pt-3 text-sm tabular-nums">
				<div className="flex items-baseline gap-1.5">
					{/* Wraps rather than truncating — a long stay/package name is the
					    one thing the buyer is confirming here (`z8r3fdhpaj`). The
					    leader bows out on its own once the name claims the row. */}
					<span className="min-w-0 wrap-anywhere">{product.name}</span>
					<span className="flex-1 border-b-2 border-dotted border-border" />
					<span className="font-medium">
						{formatPrice(unitPrice, product.currency)}
						{bookingPriceSuffix(packageLength, packageUnit)}
					</span>
				</div>
				{hasWeekendRate && weekendPrice !== undefined ? (
					// Both rates stated up front, before any date is picked.
					<div className="flex items-baseline gap-1.5 text-muted-foreground">
						<span className="min-w-0 truncate">
							{weekendDaysLabel(weekendDays)}
						</span>
						<span className="flex-1 border-b-2 border-dotted border-border" />
						<span className="font-medium">
							{formatPrice(weekendPrice, product.currency)}/night
						</span>
					</div>
				) : null}
				{nights > 0 &&
				selection.checkIn !== undefined &&
				checkOut !== undefined ? (
					<>
						{/* A package states WHAT WAS BOUGHT — "3 × 1 month" — above the
						    window it produces. The nights count is arithmetic; the
						    package count is the thing the buyer chose. */}
						{isPackage && packages > 1 ? (
							<div className="flex items-baseline gap-1.5">
								<span>
									{packages} × {bookingSpanNoun(packageLength, packageUnit)}
								</span>
								<span className="flex-1 border-b-2 border-dotted border-border" />
								<span className="font-medium">
									{formatPrice(unitPrice * packages, product.currency)}
								</span>
							</div>
						) : null}
						<div className="flex items-baseline gap-1.5">
							<span>
								{isPackage
									? `${ms ? "Sah" : "Valid"} ${formatFulfilmentDate(selection.checkIn)} – ${formatFulfilmentDate(checkOut - DAY_MS)}`
									: `${formatFulfilmentDate(selection.checkIn)} → ${formatFulfilmentDate(checkOut)}`}
							</span>
							<span className="flex-1 border-b-2 border-dotted border-border" />
							{/* The count never wraps: "5 open / days" split across two
							    lines reads as two figures beside a wrapped date. */}
							<span className="shrink-0 whitespace-nowrap font-medium">
								{isPackage
									? skippedDays.length > 0
										? `${nights - skippedDays.length} ${ms ? "hari buka" : "open days"}`
										: `${nights} ${ms ? "hari" : "days"}`
									: `${nights} night${nights === 1 ? "" : "s"}`}
							</span>
						</div>
						{/* An open-days package names the shut days it steps over
						    (z8r3fdhpm7) — the reason its last day is later than the
						    count suggests, stated before the request, not after. */}
						{skippedDays.length > 0 ? (
							<p className="text-xs text-muted-foreground">
								{ms ? "Tidak dikira" : "Skips"}{" "}
								{describeNights(skippedDays, formatNight, "day")}{" "}
								{ms ? "(kedai tutup)" : "(store closed)"}
							</p>
						) : null}
						{/* The split, itemised — exactly the two lines the order will
						    carry, so "why is it RM 400?" is answered before the request
						    is made. Only the kinds that occur; a stay that is all one
						    kind still names it. */}
						{hasWeekendRate && weekendPrice !== undefined ? (
							<>
								{split.weekdayNights > 0 ? (
									<div className="flex items-baseline gap-1.5">
										<span>
											{split.weekdayNights}{" "}
											{ms
												? `malam biasa`
												: `weekday night${split.weekdayNights === 1 ? "" : "s"}`}{" "}
											× {formatPrice(unitPrice, product.currency)}
										</span>
										<span className="flex-1 border-b-2 border-dotted border-border" />
										<span className="font-medium">
											{formatPrice(
												split.weekdayNights * unitPrice,
												product.currency,
											)}
										</span>
									</div>
								) : null}
								{split.weekendNights > 0 ? (
									<div className="flex items-baseline gap-1.5">
										<span>
											{split.weekendNights}{" "}
											{ms
												? `malam hujung minggu`
												: `weekend night${split.weekendNights === 1 ? "" : "s"}`}{" "}
											× {formatPrice(weekendPrice, product.currency)}
										</span>
										<span className="flex-1 border-b-2 border-dotted border-border" />
										<span className="font-medium">
											{formatPrice(
												split.weekendNights * weekendPrice,
												product.currency,
											)}
										</span>
									</div>
								) : null}
							</>
						) : null}
						{securityDeposit > 0 ? (
							<div className="flex items-baseline gap-1.5">
								<span>Security deposit (refundable)</span>
								<span className="flex-1 border-b-2 border-dotted border-border" />
								<span className="font-medium">
									{formatPrice(securityDeposit, product.currency)}
								</span>
							</div>
						) : null}
						<div className="flex items-baseline gap-1.5 border-t-2 border-dashed border-border pt-2 font-heading text-base font-extrabold">
							<span>
								{instantBook
									? ms
										? "Jumlah"
										: "Total"
									: ms
										? "Jumlah selepas diluluskan"
										: "Total when approved"}
							</span>
							<span className="flex-1 border-b-2 border-dotted border-border" />
							<span>
								{formatPrice(stayTotal + securityDeposit, product.currency)}
							</span>
						</div>
					</>
				) : (
					<p className="text-xs text-muted-foreground">
						{isPackage
							? ms
								? "Pilih tarikh mula untuk melihat jumlah."
								: "Pick your start date to see the total."
							: ms
								? "Pilih tarikh untuk melihat jumlah."
								: "Pick your dates to see the total."}
					</p>
				)}
			</div>
			<p className="text-xs leading-relaxed text-muted-foreground">
				{instantBook
					? `Your booking is confirmed straight away — ${storeName} will send you the payment details.`
					: `Nothing is charged now — you pay after ${storeName} approves your request.`}
				{securityDeposit > 0
					? " The security deposit is returned after check-out."
					: ""}
			</p>
		</div>
	);

	const cta = (
		<div className="flex flex-col gap-2">
			<Button
				className="tap-target h-12 w-full"
				disabled={blockedReason !== null || submitting}
				isLoading={submitting}
				onClick={submit}
			>
				{instantBook ? "Book now" : "Request to book"}
			</Button>
			<p className="text-center text-xs text-muted-foreground">
				{blockedReason ??
					(instantBook
						? `Confirmed instantly — ${storeName} will WhatsApp your payment details.`
						: `${storeName} confirms within 24 hours — we'll WhatsApp you either way.`)}
			</p>
		</div>
	);

	return (
		<BookingBarLayout summary={summary} cta={cta} serverError={serverError}>
			<CheckoutSection step={1} title="Who's booking?">
				<label className="flex flex-col gap-1.5 text-sm font-medium">
					Your name
					<Input
						variant="field"
						placeholder="e.g. Aisyah"
						autoComplete="name"
						value={name}
						onChange={(e) => setName(e.target.value)}
					/>
					<span className="text-xs font-normal text-muted-foreground">
						So {storeName} knows who this booking is for.
					</span>
				</label>
				<div className="flex flex-col gap-1.5 text-sm font-medium">
					<label htmlFor="booking-wa-phone">WhatsApp number</label>
					{/* The buyer plate: a country picker defaulting to the store's
					    country, judged by the country PICKED — the same authority
					    (`parseBuyerWaPhone`) requestBooking runs. Its placeholder
					    follows the pick, so an SG store no longer shows an MY-shaped
					    example. */}
					<BuyerPhoneInput
						id="booking-wa-phone"
						aria-describedby="booking-wa-phone-hint"
						storeCountry={country}
						dialCountry={dialCountry}
						onDialCountryChange={setPickedDialCountry}
						value={phone}
						onChange={setPhone}
						onBlur={() => setPhoneTouched(true)}
						isError={phoneRejection !== null}
					/>
					{parsedPhone.ok ? (
						// MASK_PII: echoes the buyer's number as rendered text, which
						// Clarity would otherwise record on this storefront page.
						<span
							{...MASK_PII}
							id="booking-wa-phone-hint"
							className="text-sm font-medium text-accent-emphasis"
						>
							{ms
								? `Keputusan tempahan akan dihantar ke ${formatMobile(parsedPhone.digits)} — pastikan nombor ini betul.`
								: `We'll WhatsApp the decision to ${formatMobile(parsedPhone.digits)} — check it's right.`}
						</span>
					) : phoneRejection ? (
						<>
							<span
								id="booking-wa-phone-hint"
								className="text-xs font-medium text-destructive"
							>
								{phoneRejection.message}
							</span>
							{phoneRejection.suggest ? (
								<BuyerPhoneCountrySwitch
									suggest={phoneRejection.suggest}
									onSwitch={setPickedDialCountry}
									locale={locale}
									inputId="booking-wa-phone"
								/>
							) : null}
						</>
					) : (
						<span
							id="booking-wa-phone-hint"
							className="text-xs font-normal text-muted-foreground"
						>
							{ms
								? "Kelulusan dan bayaran untuk tempahan ini dihantar ke WhatsApp anda."
								: "The approval and payment ask for this booking land in this WhatsApp."}
						</span>
					)}
				</div>
				<p className="text-xs text-muted-foreground">
					{ms ? (
						<>
							Nombor anda digunakan untuk tempahan ini sahaja.{" "}
							<a
								href="/privacy"
								target="_blank"
								rel="noopener noreferrer"
								className="underline hover:text-foreground"
							>
								Dasar Privasi
							</a>
						</>
					) : (
						<>
							Your number is used for this booking only.{" "}
							<a
								href="/privacy"
								target="_blank"
								rel="noopener noreferrer"
								className="underline hover:text-foreground"
							>
								Privacy Policy
							</a>
						</>
					)}
				</p>
			</CheckoutSection>

			<CheckoutSection
				step={2}
				title={isPackage ? "When does it start?" : "When is your stay?"}
			>
				<BookingCalendar
					selection={effectiveSelection}
					onSelect={(day) =>
						setSelection((current) => nextBookingSelection(current, day, ctx))
					}
					// A tap on a stale month would be answered from the previous
					// window's availability — refused rather than risked.
					disabled={availabilityStale}
					ctx={ctx}
					month={month}
					onMonthChange={(next) =>
						setMonth(
							Math.min(
								Math.max(next, todayMonth),
								mytMonthStart(ctx.latestCheckIn),
							),
						)
					}
					minMonth={todayMonth}
					maxMonth={mytMonthStart(ctx.latestCheckIn)}
					weekendDays={hasWeekendRate ? weekendDays : undefined}
					closedDays={closedDaySet}
				/>
				<BookingCalendarLegend
					weekendLabel={
						hasWeekendRate && weekendPrice !== undefined
							? `${weekendDaysLabel(weekendDays)} · ${formatPrice(weekendPrice, product.currency)}/night`
							: undefined
					}
					showClosed={monthClosures.length > 0}
				/>
				{/* Why the hatched days are hatched — the reason the seller gave,
				    for the closures on screen (z8r3fdhpm7). */}
				{monthClosures.length > 0 ? (
					<p className="text-xs text-muted-foreground">
						{storeName} is closed{" "}
						{monthClosures.map((range) => describeClosure(range)).join("; ")}
						{availability.closureRule === "unavailable"
							? " — no stays those nights."
							: "."}
					</p>
				) : null}
				{/* A package that ABSORBS closures (a month, an every-day pass) still
				    sells through them — so the buyer is told which days inside their
				    term the store is shut, before they pay, not after. */}
				{termClosures.length > 0 ? (
					<p className="rounded-xl border border-border bg-muted/60 px-3 py-2 text-xs leading-relaxed text-foreground">
						<span className="font-semibold">
							{storeName} is closed{" "}
							{termClosures.map((range) => describeClosure(range)).join("; ")}
						</span>{" "}
						— {termClosureDays === 1 ? "that day is" : "those days are"} still
						part of your package.
					</p>
				) : null}
				{/* How many packages. A stepper, not a calendar drag: dragging
				    across a package boundary is ambiguous (what does 3 days mean on
				    a 2-day package?) and drag fights scroll on mobile — the reason
				    the whole calendar is two-tap. The stepper is explicit, and the
				    span it produces is highlighted on the grid above, so the two
				    always agree. Hidden when the listing sells only one length. */}
				{isPackage && maxPackages > 1 ? (
					<div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
						<div className="flex items-center justify-between gap-3">
							<span className="text-sm font-medium">
								How many {packageCountLabel(packageLength, packageUnit)}?
							</span>
							<div className="flex items-center gap-1 rounded-xl border border-input">
								<button
									type="button"
									aria-label={`Fewer ${packageCountLabel(packageLength, packageUnit)}`}
									disabled={packages <= 1}
									onClick={() => setPackages((n) => Math.max(1, n - 1))}
									className="tap-target flex size-11 items-center justify-center rounded-l-xl text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
								>
									<Minus className="size-4" aria-hidden />
								</button>
								<span className="min-w-8 text-center text-base font-semibold tabular-nums">
									{packages}
								</span>
								<button
									type="button"
									aria-label={`More ${packageCountLabel(packageLength, packageUnit)}`}
									disabled={packages >= maxPackages}
									onClick={() =>
										setPackages((n) => Math.min(maxPackages, n + 1))
									}
									className="tap-target flex size-11 items-center justify-center rounded-r-xl text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
								>
									<Plus className="size-4" aria-hidden />
								</button>
							</div>
						</div>
						<p className="text-xs text-muted-foreground">
							{selection.checkIn !== undefined && checkOut !== undefined
								? `Runs ${formatFulfilmentDate(selection.checkIn)} – ${formatFulfilmentDate(checkOut - DAY_MS)}${skippedDays.length > 0 ? `, skipping ${skippedDays.length} closed day${skippedDays.length === 1 ? "" : "s"}` : ""}, paid as one booking.`
								: `Take up to ${maxPackages} at once and pay as one booking.`}
						</p>
					</div>
				) : null}
				{packageOutgrewStart ? (
					<p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-foreground">
						{formatFulfilmentDate(selection.checkIn ?? today)} can&apos;t cover{" "}
						<span className="font-semibold">
							{packages} × {bookingSpanNoun(packageLength, packageUnit)}
						</span>{" "}
						— some of those nights are already taken. Pick another start date,
						or take fewer.
					</p>
				) : null}
				{conflict ? (
					<p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-foreground">
						{formatFulfilmentDate(conflict.latestCheckOut)} onwards is booked
						out. From this check-in you can stay{" "}
						<span className="font-semibold">
							{conflict.maxStayNights} night
							{conflict.maxStayNights === 1 ? "" : "s"}
						</span>{" "}
						(check out {formatFulfilmentDate(conflict.latestCheckOut)}) — or tap
						a different check-in to stay longer.
					</p>
				) : selection.checkIn !== undefined &&
					selection.checkOut === undefined ? (
					<p className="text-xs text-muted-foreground">
						Check-in {formatFulfilmentDate(selection.checkIn)} — now tap your
						check-out day.
					</p>
				) : null}
				{/* The rule itself, stated where the dates are picked (z8r3fdhpm7):
				    an open-days package counts only the days the store is open. */}
				{availability.closureRule === "skipped" ? (
					<p className="text-xs text-muted-foreground">
						This package counts only the days {storeName} is open — closed days
						(hatched) are skipped, so it ends later.
					</p>
				) : null}
				{availability.noticeDays > 0 ? (
					<p className="text-xs text-muted-foreground">
						{storeName} needs {availability.noticeDays} day
						{availability.noticeDays === 1 ? "" : "s"}&apos; notice before a
						check-in.
					</p>
				) : null}
			</CheckoutSection>

			<CheckoutSection title={`Note to ${storeName} (optional)`}>
				<textarea
					value={note}
					onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
					rows={2}
					placeholder="e.g. Arriving after dark — a spot near the entrance would help"
					className="rounded-xl border border-input bg-background px-3 py-2 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
				/>
			</CheckoutSection>
		</BookingBarLayout>
	);
}

/**
 * The checkout page's two-column skeleton, booking-sized: sections left,
 * sticky summary + CTA right on desktop; summary above the sections and a
 * FIXED bottom CTA bar on mobile (design-system rule #4 — the route already
 * reserves `--storefront-bar-h`).
 */
function BookingBarLayout({
	children,
	summary,
	cta,
	serverError,
}: {
	children: React.ReactNode;
	summary: React.ReactNode;
	cta: React.ReactNode;
	serverError: string | null;
}) {
	const barRef = usePublishedHeight<HTMLDivElement>("--storefront-bar-h");
	const error = serverError ? (
		<p
			role="alert"
			className="rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive"
		>
			{serverError}
		</p>
	) : null;
	return (
		<div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-8">
			<div className="flex flex-1 flex-col gap-4 lg:order-1">
				<div className="lg:hidden">{summary}</div>
				{children}
				{error}
			</div>
			<div className="hidden lg:sticky lg:top-6 lg:order-2 lg:flex lg:w-96 lg:flex-col lg:gap-3">
				{summary}
				{cta}
			</div>
			{/* Mobile: the commitment bar floats fixed above the page footer. */}
			<div
				ref={barRef}
				className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 lg:hidden"
			>
				{cta}
			</div>
		</div>
	);
}
