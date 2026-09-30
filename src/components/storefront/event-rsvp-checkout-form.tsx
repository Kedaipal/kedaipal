// The standalone RSVP checkout (`z8r3fdhh45`). Renders in place of the cart
// checkout when the route carries `?rsvp=<productSlug>`, exactly as
// `?booking=` swaps in the request-to-book form.
//
// WHY it is standalone: an event carries its own fixed fulfilment moment — the
// seller's date, the seller's venue, collected there — and an order holds
// exactly ONE fulfilment contract. Letting an RSVP share a cart meant whichever
// line landed first decided the whole order, so a ceramic mug bought alongside
// a workshop RSVP silently lost delivery, pickup and its date. The mix was
// allowed for "she sells puffs at her own event", but nothing ever let the
// seller opt a product INTO an event, so that case was unreachable while the
// accident was one tap away. Removing the mix costs nothing real and deletes
// the whole rules matrix with it.
//
// The buyer's cart is untouched and stays exactly where it was — said out loud
// by `BasketKeptNote` rather than left to be guessed at.

import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { CalendarClock, Minus, Plus } from "lucide-react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	type DialIso,
	parseBuyerWaPhone,
} from "../../../convex/lib/buyerPhone";
import type { Country } from "../../../convex/lib/country";
import { type Locale, pickLocale } from "../../../convex/lib/locale";
import {
	answerPrompt,
	answersForSubmit,
	firstMissingRequired,
	visibleQuestions,
} from "../../../convex/lib/buyerQuestions";
import { isEventPassed } from "../../../convex/lib/productEvent";
import { readAttributionSource } from "../../hooks/useSourceAttribution";
import { BuyerQuestionsFields } from "../order/buyer-questions-fields";
import { MASK_PII } from "../../lib/analytics-privacy";
import { buyerPhoneRejection } from "../../lib/buyer-phone-rejection";
import {
	convexErrorMessage,
	formatMobile,
	formatPrice,
} from "../../lib/format";
import { variantLabel } from "../../lib/variant";
import { PickupNotes } from "../order/pickup-notes";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { BuyerPhoneCountrySwitch, BuyerPhoneInput } from "../ui/my-phone-input";
import { Skeleton } from "../ui/skeleton";
import { CheckoutSection } from "./checkout-form";
import { EventMomentRow } from "./event-checkout";
import { PickupSummaryCard } from "./pickup-location-options";
import { OptionPills, useProductPurchase } from "./product-purchase";
import {
	BasketKeptNote,
	StandaloneCheckoutLayout,
} from "./standalone-checkout-layout";

const NOTE_MAX = 500;

export function EventRsvpCheckoutForm({
	retailerId,
	storeName,
	storeSlug,
	productSlug,
	locale,
	country,
	confirmPushEnabled,
	cartItemCount,
}: {
	retailerId: Id<"retailers">;
	storeName: string;
	storeSlug: string;
	productSlug: string;
	locale?: Locale;
	/** The store's country — the phone picker's default, and the country an
	 * untouched picker is judged by, so an RSVP accepts exactly what the
	 * ordinary checkout does (z8r3fdh274). */
	country: Country;
	/** Does Kedaipal push the confirmation itself (86eyf1rck)? Decides whether
	 * the tracking page still has to fire the wa.me handoff, and what the fine
	 * print promises. */
	confirmPushEnabled: boolean;
	/** Lines in the buyer's cart — an RSVP never touches it, and says so. */
	cartItemCount: number;
}) {
	const navigate = useNavigate();
	const createOrder = useMutation(api.orders.create);

	const [name, setName] = useState("");
	const [phone, setPhone] = useState("");
	const [phoneTouched, setPhoneTouched] = useState(false);
	const [pickedDialCountry, setPickedDialCountry] = useState<
		DialIso | undefined
	>(undefined);
	const [note, setNote] = useState("");
	// Buyer questions (z8r3fdkjek) — one answer set for the whole RSVP.
	const [answers, setAnswers] = useState<Record<string, string>>({});
	const [submitting, setSubmitting] = useState(false);
	const [serverError, setServerError] = useState<string | null>(null);

	const product = useQuery(
		convexQuery(api.products.getPublicBySlug, {
			retailerId,
			slug: productSlug,
		}),
	).data;

	const event = product?.event;

	// The EVENT's venue, from the server — the same resolver order time uses,
	// so what this page shows is what the order will freeze. Fetched (not read
	// off the standard pickup list) because an event's venue may be a point the
	// seller HIDES from standard orders (an RSVP-only location), which the
	// public active list deliberately omits. undefined = loading, null = the
	// store truly has no point to host at.
	const venue = useQuery(
		convexQuery(
			api.pickupLocations.eventVenuePublicBySlug,
			event
				? {
						slug: storeSlug,
						venueId: event.venueId as Id<"pickupLocations"> | undefined,
					}
				: "skip",
		),
	).data;

	// The same hook the product page's buy box runs — one author for the option
	// axes, the variant resolution and the seat/stock ceiling, so the RSVP page
	// can never offer a seat the server would refuse. `cartQuantity: 0`: an
	// RSVP has no cart to count against.
	const pp = useProductPurchase({
		// `undefined` (still loading) and `null` (no such product) both mean
		// "nothing to purchase yet" to the hook.
		product: product ?? null,
		retailerId,
		cartQuantity: 0,
	});

	// A vanished/unreachable event — archived, hidden, a typo'd or stale shared
	// link — sends the guest back to the store rather than a skeleton that never
	// resolves. `undefined` is LOADING; `null` is gone. Conflating the two left
	// a bad `?rsvp=` slug spinning forever with nothing to read and no way out
	// (the booking flow has always distinguished them; this now matches).
	if (product === null) {
		return (
			<div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 text-center">
				<p className="text-sm text-muted-foreground">
					Sorry — this event isn&apos;t taking RSVPs right now.
				</p>
				<Button
					variant="outline"
					onClick={() =>
						navigate({ to: "/$slug", params: { slug: storeSlug } })
					}
				>
					Back to {storeName}
				</Button>
			</div>
		);
	}
	if (product === undefined) {
		return (
			<div className="flex flex-col gap-4">
				<Skeleton className="h-24 w-full rounded-2xl" />
				<Skeleton className="h-96 w-full rounded-2xl" />
			</div>
		);
	}

	// Reached by URL rather than by the RSVP button — the product is real but
	// isn't an event. Say so and point back, never render a form that would be
	// refused at submit.
	if (!event) {
		return (
			<p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
				{product.name} isn&apos;t an event — there&apos;s nothing to RSVP to.
				Open it from {storeName}&apos;s store to order it normally.
			</p>
		);
	}

	// A finished event still reachable from a stale link or a shared URL. The
	// storefront already hides it; the server refuses it. Explained here rather
	// than left to fail at submit.
	if (isEventPassed(event)) {
		return (
			<p
				role="alert"
				className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground"
			>
				This event has already taken place, so RSVPs are closed. Message{" "}
				{storeName} if you think that&apos;s wrong.
			</p>
		);
	}

	// An event whose only line is made-to-order can NEVER resolve a variant —
	// `resolveVariant` deliberately skips the custom line — so the option pills
	// would have nothing to answer, the total would never settle and the CTA
	// could never enable. The buy box has `sellsStandardLine` for exactly this
	// shape and swaps in the custom card; an RSVP has no equivalent (a quoted
	// price can't hold a seat), and nothing server-side refuses the combination
	// at save. So it is stated, with the exit, instead of leaving the guest on
	// a form they cannot finish. Also covers an event with no variants at all.
	if (!pp.sellsStandardLine) {
		return (
			<p
				role="alert"
				className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground"
			>
				RSVPs for {product.name} aren&apos;t open online — please message{" "}
				{storeName} to ask for a place.
			</p>
		);
	}

	// An event with nowhere to collect from is a dead end for the guest — the
	// server refuses it too. Its own explained state, never a silent failure at
	// submit. `undefined` is still LOADING, not missing.
	if (venue === null) {
		return (
			<p
				role="alert"
				className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive"
			>
				This event doesn&apos;t have a collection point set up yet, so RSVPs
				can&apos;t be taken. Please message {storeName}.
			</p>
		);
	}

	const variant = pp.selectedVariant;
	const seats = pp.displayQuantity;
	// Until an option resolves to a variant there is no price for THIS guest —
	// only the listing's floor. Rendering that floor as "Total RM 3.00" quoted a
	// figure that jumps the moment they pick (Medium is RM 5.00), which is the
	// one thing a receipt may never do. The product page is honest about it
	// ("From RM 3.00"); so is this now.
	// `resolveVariant` returns NULL (not undefined) when the axes are unanswered,
	// so this is a truthiness check — `!== undefined` read as "settled" on every
	// unpicked multi-option event, which is exactly the bug it was added to fix.
	const priceSettled = Boolean(variant);
	const unitPrice = variant?.price ?? product.priceFrom ?? 0;
	// Seats are the whole bill. An event VENUE carries no pickup fee — the guest
	// is attending, not collecting — so `buildEventVenueSnapshot` drops it at
	// order time and there is nothing here to add. Before that, the venue's
	// self-collect fee was charged but never quoted: an RM 680 CTA placed an
	// RM 685 order (z8r3fdjgvd test run).
	const total = unitPrice * seats;
	const isFree = priceSettled && total === 0;

	// Which ceiling actually binds: the event's seat pool, or this option's
	// stock. Stock only counts when the variant hard-blocks on it.
	const stockCeiling = pp.variantBlocks
		? (variant?.onHand ?? 0)
		: Number.POSITIVE_INFINITY;
	const seatsBind =
		pp.eventSeatsLeft !== undefined && pp.eventSeatsLeft <= stockCeiling;

	const dialCountry = pickedDialCountry ?? country;
	const parsedPhone = parseBuyerWaPhone(phone, dialCountry);
	const phoneEntered = /\d/.test(phone);
	// The reason, under the field — the CTA hint below only says WHERE to look.
	const phoneRejection = buyerPhoneRejection(parsedPhone, phone, phoneTouched);
	const nameOk = name.trim().length >= 3;
	// Which axis is still unanswered, named — "Pick your Size" beats "Pick your
	// options" when only one of two axes is missing.
	const unpickedAxis = pp.options.find(
		(_, axisIndex) => pp.selection[axisIndex] == null,
	);

	// Chain order = section order: the questions sit after "Your seats".
	const questions = product?.buyerQuestions;
	const missingQuestion = firstMissingRequired(questions, answers);
	const shownAnswers = visibleQuestions(questions, answers).filter(
		(q) => (answers[q.id] ?? "").trim().length > 0,
	);

	const blockedReason = pp.eventFull
		? "This event is fully booked"
		: !nameOk
			? "Enter your name"
			: !parsedPhone.ok
				? phoneEntered
					? "Check your WhatsApp number"
					: "Enter your WhatsApp number"
				: unpickedAxis
					? `Pick your ${unpickedAxis.name.toLowerCase()}`
					: !variant
						? "That combination isn't available"
						: !pp.sellable
							? "That option is fully taken"
							: missingQuestion
								? answerPrompt(missingQuestion.label)
								: null;

	async function submit() {
		if (blockedReason || !variant || !product) return;
		setSubmitting(true);
		setServerError(null);
		try {
			const result = await createOrder({
				retailerId,
				items: [
					{
						variantId: variant._id,
						quantity: seats,
						answers: answersForSubmit(questions, answers),
					},
				],
				currency: product.currency,
				channel: "whatsapp",
				customer: {
					name: name.trim(),
					// Raw as typed — the server normalizes against the picked dial
					// country via assertValidBuyerWaPhone, the same parse this form
					// ran (z8r3fdh274).
					waPhone: phone.trim(),
					waDialCountry: dialCountry,
				},
				// An RSVP is collected AT the venue. Asserted, never left to a
				// default — and the server overrides the venue and the date from
				// the event itself, so nothing here is load-bearing for either.
				deliveryMethod: "self_collect",
				customerNote: note.trim().length > 0 ? note.trim() : undefined,
				attributionSource: readAttributionSource(storeSlug),
			});
			// Same handoff the cart checkout uses: push path lands on the tracking
			// page already confirmed; legacy path carries ?send=1 so the buyer
			// still reaches WhatsApp without an extra tap (same-tab, never
			// popup-blocked). See docs/order-lifecycle.md.
			navigate({
				to: "/track/$token",
				params: { token: result.trackingToken },
				search: result.confirmedAtCreate ? {} : { send: 1 },
			});
		} catch (err) {
			setServerError(convexErrorMessage(err));
			setSubmitting(false);
		}
	}

	const summary = (
		<>
			<div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
				<h2 className="font-heading text-sm font-bold">Your RSVP</h2>
				<div className="flex flex-col gap-2 border-t-2 border-dashed border-border pt-3 text-sm tabular-nums">
					<div className="flex items-baseline gap-1.5">
						{/* Wraps rather than truncating — the event's name is the one
						    thing the guest is confirming here (`z8r3fdhpaj`). */}
						<span className="min-w-0 wrap-anywhere">{product.name}</span>
						<span className="flex-1 border-b-2 border-dotted border-border" />
						<span className="shrink-0 whitespace-nowrap font-medium">
							{priceSettled
								? `${formatPrice(unitPrice, product.currency)}${isFree ? "" : "/seat"}`
								: `From ${formatPrice(unitPrice, product.currency)}`}
						</span>
					</div>
					{variant && variantLabel(variant.optionValues) ? (
						<p className="text-xs text-muted-foreground">
							{variantLabel(variant.optionValues)}
						</p>
					) : null}
					{shownAnswers.map((q) => (
						<p key={q.id} className="text-xs text-muted-foreground">
							{q.label}: <span className="text-foreground">{answers[q.id]?.trim()}</span>
						</p>
					))}
					{priceSettled ? (
						<>
							<div className="flex items-baseline gap-1.5">
								<span>
									{seats} {seats === 1 ? "seat" : "seats"}
								</span>
								<span className="flex-1 border-b-2 border-dotted border-border" />
								<span className="font-medium">
									{formatPrice(total, product.currency)}
								</span>
							</div>
							<div className="flex items-baseline gap-1.5 border-t-2 border-dashed border-border pt-2 text-base font-bold">
								<span>Total</span>
								<span className="flex-1" />
								<span>
									{isFree ? "Free" : formatPrice(total, product.currency)}
								</span>
							</div>
						</>
					) : (
						// No total yet, and it says so where the total would be — a
						// blank row reads as RM 0.
						<p className="border-t-2 border-dashed border-border pt-2 text-xs text-muted-foreground">
							{unpickedAxis
								? `Pick your ${unpickedAxis.name.toLowerCase()} to see the total.`
								: "Pick an option to see the total."}
						</p>
					)}
				</div>
				<p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
					<CalendarClock
						className="mt-0.5 size-3.5 shrink-0 text-accent"
						aria-hidden
					/>
					{/* The date and the venue are the store's, not the guest's — the
					    one thing an RSVP takes away from the buyer, stated where they
					    commit rather than discovered afterwards. */}
					<span>
						Collected at the venue on the date {storeName} set — there&apos;s no
						delivery, and no date to pick.
					</span>
				</p>
			</div>
			<BasketKeptNote itemCount={cartItemCount} storeName={storeName} />
		</>
	);

	const cta = (
		<div className="flex flex-col gap-2">
			<Button
				className="tap-target h-12 w-full"
				disabled={blockedReason !== null || submitting}
				isLoading={submitting}
				onClick={submit}
			>
				{/* The action carries its consequence: how many seats, and what it
				    costs — never a bare "RSVP". */}
				{!priceSettled
					? "RSVP"
					: isFree
						? `RSVP for ${seats} ${seats === 1 ? "seat" : "seats"}`
						: `RSVP · ${formatPrice(total, product.currency)}`}
			</Button>
			{/* The blocked reason always speaks — a dead button with no reason is
			    the thing this whole bar exists to avoid. The reassurance that
			    replaces it once the form is complete is DESKTOP-only: it runs to
			    two sentences, and in the fixed mobile bar that wraps to three
			    lines and pushes the total off the screen (the same trade the cart
			    checkout makes with `finePrintCompact`). Nothing is lost on a
			    phone — the receipt above already says Free or names the price,
			    and the phone field promises the one WhatsApp confirmation. */}
			{blockedReason ? (
				<p className="text-center text-xs text-muted-foreground">
					{blockedReason}
				</p>
			) : (
				<p className="hidden text-center text-xs text-muted-foreground lg:block">
					{isFree
						? confirmPushEnabled
							? `Your RSVP goes straight to ${storeName} — one confirmation lands in your WhatsApp. There's nothing to pay.`
							: `Opens WhatsApp to confirm with ${storeName} — there's nothing to pay.`
						: confirmPushEnabled
							? `Your RSVP goes straight to ${storeName} — one confirmation lands in your WhatsApp, with a link to follow it. Nothing is paid yet.`
							: `Opens WhatsApp to confirm with ${storeName} — nothing is paid yet.`}
				</p>
			)}
			<p className="text-center text-xs text-muted-foreground">
				By placing this RSVP, you agree to our{" "}
				<a
					href="/privacy"
					target="_blank"
					rel="noopener noreferrer"
					className="underline hover:text-foreground"
				>
					Privacy Policy
				</a>
				.
			</p>
		</div>
	);

	return (
		<StandaloneCheckoutLayout
			summary={summary}
			cta={cta}
			serverError={serverError}
		>
			{/* The event's own facts come FIRST and unnumbered: the numbers below
			    mark what the GUEST decides, and none of this is theirs to choose.
			    A read-back, never a disabled picker — a greyed-out control still
			    reads as a choice they're failing to make. */}
			<CheckoutSection title="The event">
				<EventMomentRow event={event} storeName={storeName} />
				{venue ? (
					<>
						<PickupSummaryCard
							location={venue}
							currency={product.currency}
							// An event venue never charges its pickup fee, so the card
							// must not advertise one — see buildEventVenueSnapshot.
							hideFee
						/>
						<p className="text-xs text-muted-foreground">
							Where the event happens — set by the store, the same for every
							guest.
						</p>
					</>
				) : (
					<Skeleton className="h-24 w-full rounded-xl" />
				)}
				{/* The seller's collection instructions — this event's product
				    alone, which is the whole order. Read BEFORE committing. */}
				<PickupNotes
					audience="buyer"
					locale={pickLocale(locale)}
					notes={product.pickupNote ? [product.pickupNote] : []}
				/>
			</CheckoutSection>

			<CheckoutSection step={1} title="Who's coming?">
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
						So {storeName} knows who this RSVP is for.
					</span>
				</label>
				<div className="flex flex-col gap-1.5 text-sm font-medium">
					<label htmlFor="rsvp-wa-phone">WhatsApp number</label>
					<BuyerPhoneInput
						id="rsvp-wa-phone"
						aria-describedby="rsvp-wa-phone-hint"
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
							id="rsvp-wa-phone-hint"
							className="text-sm font-medium text-accent-emphasis"
						>
							We&apos;ll WhatsApp your RSVP confirmation to{" "}
							{formatMobile(parsedPhone.digits)} — check it&apos;s right.
						</span>
					) : phoneRejection ? (
						<>
							<span
								id="rsvp-wa-phone-hint"
								className="text-xs font-medium text-destructive"
							>
								{phoneRejection.message}
							</span>
							{/* A number that parses under a NEIGHBOURING country offers
							    the switch rather than just refusing (z8r3fdh274). */}
							{phoneRejection.suggest ? (
								<BuyerPhoneCountrySwitch
									suggest={phoneRejection.suggest}
									onSwitch={setPickedDialCountry}
									locale={locale}
									inputId="rsvp-wa-phone"
								/>
							) : null}
						</>
					) : (
						<span
							id="rsvp-wa-phone-hint"
							className="text-xs font-normal text-muted-foreground"
						>
							Your RSVP confirmation lands in this WhatsApp.
						</span>
					)}
				</div>
			</CheckoutSection>

			<CheckoutSection step={2} title="Your seats">
				{/* One picker, one author: the same pills the product page's buy box
				    renders, driven by the same hook — two surfaces expressing the
				    identical choice must not grow two components. */}
				<OptionPills pp={pp} />
				{pp.eventFull ? (
					<p
						role="alert"
						className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground"
					>
						This event is fully booked. Message {storeName} to ask about a
						cancellation.
					</p>
				) : (
					<>
						<div className="flex items-center justify-between gap-3">
							<span className="text-sm font-medium">How many seats?</span>
							<div className="flex items-center gap-1 rounded-xl border border-input">
								<button
									type="button"
									aria-label="Fewer seats"
									disabled={seats <= 1}
									onClick={() => pp.setQuantity(Math.max(1, seats - 1))}
									className="tap-target flex size-11 items-center justify-center rounded-l-xl text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
								>
									<Minus className="size-4" aria-hidden />
								</button>
								<span className="min-w-8 text-center text-base font-semibold tabular-nums">
									{seats}
								</span>
								<button
									type="button"
									aria-label="More seats"
									disabled={seats >= pp.maxQty}
									onClick={() => pp.setQuantity(Math.min(pp.maxQty, seats + 1))}
									className="tap-target flex size-11 items-center justify-center rounded-r-xl text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
								>
									<Plus className="size-4" aria-hidden />
								</button>
							</div>
						</div>
						{/* The ceiling, NAMED where the stepper stops — a button that
						    just goes dead is a constraint enforced silently. Seats and
						    this option's stock are SEPARATE ceilings; whichever binds
						    is the one worth saying. `onHand` only counts on a variant
						    that actually hard-blocks on it — reading it regardless
						    blamed a 0-stock made-to-order option for a seat cap. */}
						<p className="text-xs text-muted-foreground">
							{/* Until an option is picked there is no variant, so the
							    ceiling is a placeholder 1 — saying "that's every seat
							    left" there would be a flat lie next to a 30-seat event.
							    The stepper stays put and disabled; this says why. */}
							{!variant
								? unpickedAxis
									? `Pick your ${unpickedAxis.name.toLowerCase()} first — seats are counted per person.`
									: "That combination isn't available."
								: seats >= pp.maxQty
									? seatsBind
										? pp.eventSeatsLeft === 1
											? `That's the last seat ${storeName} has for this event.`
											: `That's all ${pp.eventSeatsLeft} seats ${storeName} has left for this event.`
										: "That's all that's left of this option."
									: pp.eventSeatsLeft !== undefined
										? `${pp.eventSeatsLeft} ${pp.eventSeatsLeft === 1 ? "seat" : "seats"} left for this event.`
										: "Bringing people along? Count them in here."}
						</p>
					</>
				)}
			</CheckoutSection>

			{questions && questions.length > 0 ? (
				<CheckoutSection step={3} title="A few questions">
					<p className="-mt-1 text-xs text-muted-foreground">
						{seats > 1
							? `${storeName} asks these once for this RSVP, not per seat.`
							: `${storeName} needs these to get ready for you.`}
					</p>
					<BuyerQuestionsFields
						questions={questions}
						answers={answers}
						idPrefix="rsvp-q"
						onChange={(questionId, answer) =>
							setAnswers((prev) => {
								const { [questionId]: _dropped, ...rest } = prev;
								return answer === undefined
									? rest
									: { ...rest, [questionId]: answer };
							})
						}
					/>
				</CheckoutSection>
			) : null}

			<CheckoutSection title={`Note to ${storeName} (optional)`}>
				<textarea
					value={note}
					onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
					rows={2}
					placeholder="e.g. Bringing a friend who's vegetarian"
					className="rounded-xl border border-input bg-background px-3 py-2 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
				/>
			</CheckoutSection>
		</StandaloneCheckoutLayout>
	);
}
