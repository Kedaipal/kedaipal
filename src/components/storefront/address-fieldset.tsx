import { MapPin, Search } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import { parseGoogleAddress } from "../../lib/google-address";
import { type CheckoutAddressValues, MY_STATES } from "../../lib/schemas";
import { withFieldGroup } from "../forms/form";
import {
	GoogleAddressAutocomplete,
	type GoogleSelectedAddress,
} from "../forms/google-address-autocomplete";

const stateOptions = [
	{ value: "", label: "Select state…" },
	...MY_STATES.map((s) => ({ value: s, label: s })),
];

/** Fields that describe WHERE the order goes — cleared together by "Search
 * again", and the only ones that can move the Google pin. `line2` and `notes`
 * are deliberately absent: a unit/floor and "call when you arrive" are the
 * buyer's own typing, and the locked card leaves BOTH editable, so a stale
 * one is visible and one tap from correct. Wiping them on "Search again" —
 * the only route back to fixing a street — would silently lose the unit and
 * ship to a high-rise with no floor. A re-pick never restores it
 * (`handleAutocompleteSelect` doesn't touch either field). */
const LOCATION_FIELDS = [
	"line1",
	"city",
	"state",
	"postcode",
	"latitude",
	"longitude",
	"placeId",
	"mapsUrl",
] as const;

/**
 * Reusable address sub-form. Mounts at any `address` field on a parent form
 * whose value matches `CheckoutAddressValues`. Used by the storefront checkout
 * page and the tracking-page edit dialog.
 *
 * **The Google pin is the single source of truth** (ClickUp `86eye50qv`). The
 * fieldset has two faces:
 *
 * - **Locked** (a pin is set) — the street/postcode/city/state collapse into a
 *   read-only "confirmed address" card. Only unit/floor and delivery notes stay
 *   editable, because neither can move the building. "Wrong address? Search
 *   again" clears the location and returns to the search.
 * - **Searching** (no pin) — the Google search is the *only* address input, so
 *   there aren't two competing address bars. Manual entry is an explicit
 *   escape hatch behind a disclosure, for addresses Google genuinely doesn't
 *   know (new tamans, kampung addresses) — and it is hidden entirely when
 *   `allowManualEntry` is false.
 *
 * Layout is mobile-first: single column, postcode + city side-by-side.
 */
export const AddressFieldset = withFieldGroup({
	defaultValues: {
		line1: "",
		line2: "",
		city: "",
		state: "",
		postcode: "",
		notes: "",
		mapsUrl: "",
		latitude: "",
		longitude: "",
		placeId: "",
	} satisfies CheckoutAddressValues,
	props: {
		retailerId: undefined as Id<"retailers"> | undefined,
		/**
		 * False when the store prices delivery from **coordinates** (a live
		 * Lalamove quote, or radius bands that block out-of-range): a hand-typed
		 * address there can never be quoted or dispatched, so offering manual
		 * entry would only lead the buyer into a dead end. Stores that don't need
		 * coordinates (flat / free / radius-arrange) keep the escape hatch.
		 */
		allowManualEntry: true,
		/**
		 * Visible heading for the group. Omit when the surrounding card or dialog
		 * already announces "delivery address" — both callers usually do, and a
		 * second title would just repeat it. Either way the fieldset keeps an
		 * accessible name (the legend goes `sr-only` when this is unset).
		 */
		legend: undefined as string | undefined,
		/**
		 * Collection-service store (86eyg0n8e): the rider COLLECTS from this
		 * address instead of delivering to it — the fallback legend and the notes
		 * label say so, since "Delivery address" reads backwards to that buyer.
		 */
		collectsFromCustomer: false,
	},
	render: ({
		group,
		retailerId,
		allowManualEntry,
		legend,
		collectsFromCustomer,
	}) => {
		function handleAutocompleteSelect(payload: GoogleSelectedAddress) {
			const parsed = parseGoogleAddress(
				payload.addressComponents,
				payload.formattedAddress,
			);
			group.setFieldValue("line1", parsed.line1);
			group.setFieldValue("city", parsed.city);
			group.setFieldValue("state", parsed.state);
			group.setFieldValue("postcode", parsed.postcode);
			// Stash coordinates as strings (form-state shape is all strings — we
			// parse back to numbers at submit time in checkout-form).
			// NOTE: coords are set AFTER the structured fields on purpose — the
			// invalidation listeners below fire on those sets, and last-write-wins
			// keeps the fresh pin.
			group.setFieldValue("latitude", String(payload.latitude));
			group.setFieldValue("longitude", String(payload.longitude));
			// Place ID travels alongside lat/lng so derived maps URLs deep-link
			// to the named place page (not just raw coords).
			group.setFieldValue("placeId", payload.placeId);
		}

		/** "Wrong address?" — drop the whole location so nothing stale can be
		 * submitted, and land the buyer back on an empty search. */
		function clearLocation() {
			for (const field of LOCATION_FIELDS) {
				group.setFieldValue(field, "");
			}
		}

		/**
		 * Hand-editing a LOCATION-bearing field (line1/postcode/city/state)
		 * invalidates the Google pin — otherwise a manually-corrected address
		 * keeps pricing (and dispatching riders!) to the OLD coordinates. These
		 * fields are only reachable in manual mode now, but the guard stays as
		 * defence in depth: any future surface that renders them inherits it.
		 * Line2/notes stay pin-safe: unit numbers and gate codes don't move the
		 * building.
		 */
		function invalidatePin() {
			if (group.getFieldValue("latitude") === "") return;
			group.setFieldValue("latitude", "");
			group.setFieldValue("longitude", "");
			group.setFieldValue("placeId", "");
			group.setFieldValue("mapsUrl", "");
		}
		const pinInvalidation = {
			onChange: () => invalidatePin(),
		};

		const unitField = (
			<group.AppField name="line2">
				{(field) => (
					<field.TextField
						label="Unit / floor (optional)"
						placeholder="e.g. Unit 12-3, Block B"
						autoComplete="address-line2"
					/>
				)}
			</group.AppField>
		);

		const notesField = (
			<group.AppField name="notes">
				{(field) => (
					<field.TextareaField
						label={
							collectsFromCustomer
								? "Collection notes (optional)"
								: "Delivery notes (optional)"
						}
						placeholder="Landmark, gate code, courier instructions"
						rows={2}
					/>
				)}
			</group.AppField>
		);

		const manualFields = (
			<>
				<group.AppField name="line1" listeners={pinInvalidation}>
					{(field) => (
						<field.TextField
							label="Address line 1"
							placeholder="12 Jln Mawar 3, Taman Mawar"
							autoComplete="address-line1"
							required
						/>
					)}
				</group.AppField>

				<div className="grid grid-cols-2 gap-3">
					<group.AppField name="postcode" listeners={pinInvalidation}>
						{(field) => (
							<field.TextField
								label="Postcode"
								placeholder="47301"
								inputMode="numeric"
								autoComplete="postal-code"
								required
							/>
						)}
					</group.AppField>

					<group.AppField name="city" listeners={pinInvalidation}>
						{(field) => (
							<field.TextField
								label="City"
								placeholder="Petaling Jaya"
								autoComplete="address-level2"
								required
							/>
						)}
					</group.AppField>
				</div>

				<group.AppField name="state" listeners={pinInvalidation}>
					{(field) => (
						<field.SelectField label="State" options={stateOptions} required />
					)}
				</group.AppField>
			</>
		);

		return (
			// No border/background of its own: both callers already sit inside a
			// bordered card (the checkout section) or a dialog with its own title,
			// so the old box drew a second card with a duplicate heading inside the
			// first. `mb-2` on the visible legend, not the fieldset's `gap-3` — a
			// <legend> is not a flex item, so the gap never applies below it.
			<fieldset className="flex flex-col gap-3">
				<legend className={legend ? "mb-2 text-sm font-medium" : "sr-only"}>
					{legend ??
						(collectsFromCustomer ? "Collection address" : "Delivery address")}
				</legend>

				<group.Subscribe selector={(s) => s.values}>
					{(values) => {
						const hasPin = (values.latitude ?? "") !== "";

						if (hasPin) {
							return (
								<>
									<ConfirmedAddressCard
										line1={values.line1}
										city={values.city}
										state={values.state}
										postcode={values.postcode}
										onSearchAgain={clearLocation}
									/>
									{unitField}
									{notesField}
								</>
							);
						}

						return (
							<>
								<GoogleAddressAutocomplete
									retailerId={retailerId}
									placeholder="Start typing your address…"
									description={
										allowManualEntry
											? "Pick a suggestion to confirm your exact location."
											: "Pick a suggestion to confirm your exact location — we price delivery from the pin, so it has to come from the search."
									}
									onSelect={handleAutocompleteSelect}
								/>
								{allowManualEntry ? (
									<ManualEntryDisclosure
										// A restored address with no pin (saved before we had the
										// search, or typed manually last time) opens straight to
										// its own fields instead of hiding the buyer's data.
										initiallyOpen={values.line1.trim().length > 0}
									>
										{manualFields}
									</ManualEntryDisclosure>
								) : null}
								{notesField}
							</>
						);
					}}
				</group.Subscribe>
			</fieldset>
		);
	},
});

/** The read-only "this is where it's going" card shown once a pin is set. */
function ConfirmedAddressCard({
	line1,
	city,
	state,
	postcode,
	onSearchAgain,
}: {
	line1: string;
	city: string;
	state: string;
	postcode: string;
	onSearchAgain: () => void;
}) {
	const locality = [postcode, city].filter(Boolean).join(" ").trim();
	const region = [locality, state].filter(Boolean).join(", ");
	return (
		// Tinted fill, no border — inside an already-bordered section a second
		// outline just boxes a box; the accent wash carries "confirmed" on its own.
		<div className="flex flex-col gap-2 rounded-xl bg-accent/5 p-3">
			<div className="flex items-start gap-2">
				<MapPin
					className="mt-0.5 size-4 shrink-0 text-accent"
					aria-hidden="true"
				/>
				<div className="flex min-w-0 flex-col">
					<span className="text-[11px] font-semibold uppercase tracking-wide text-accent-emphasis">
						Location confirmed
					</span>
					<span className="text-sm font-medium leading-snug">{line1}</span>
					{region ? (
						<span className="text-xs text-muted-foreground">{region}</span>
					) : null}
				</div>
			</div>
			<button
				type="button"
				onClick={onSearchAgain}
				className="tap-target flex w-fit items-center gap-1.5 self-start text-xs font-semibold text-accent-emphasis underline-offset-2 hover:underline"
			>
				<Search className="size-3.5" aria-hidden="true" />
				Wrong address? Search again
			</button>
		</div>
	);
}

/**
 * The manual-entry escape hatch. Own component so its open/closed state
 * survives the parent's re-renders (every keystroke re-runs the field group's
 * subscription).
 */
function ManualEntryDisclosure({
	initiallyOpen,
	children,
}: {
	initiallyOpen: boolean;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(initiallyOpen);

	if (!open) {
		return (
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="tap-target w-fit text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
			>
				Can&apos;t find your address? Enter it manually
			</button>
		);
	}

	return (
		<div className="flex flex-col gap-3 rounded-lg bg-muted/50 p-3">
			<p className="text-xs text-muted-foreground">
				Typing it yourself — we won&apos;t have a map pin for this one, so the
				seller may confirm the exact spot with you.
			</p>
			{children}
		</div>
	);
}
