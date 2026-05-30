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

/**
 * Reusable address sub-form. Mounts at any `address` field on a parent form
 * whose value matches `CheckoutAddressValues`. Used by the storefront checkout
 * sheet and the tracking-page edit dialog.
 *
 * Layout is mobile-first: single column, with postcode + city side-by-side on
 * wider screens. The Google autocomplete sits at the top — picking a suggestion
 * auto-fills line1/city/state/postcode and stashes lat/lng so the WhatsApp
 * confirm message can include a tappable location pin. All fields remain
 * hand-editable after a pick (e.g. for unit/apartment numbers).
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
	},
	render: ({ group, retailerId }) => {
		function handleAutocompleteSelect(payload: GoogleSelectedAddress) {
			const parsed = parseGoogleAddress(
				payload.addressComponents,
				payload.formattedAddress,
			);
			// Auto-fill the structured fields. Buyer can still hand-edit after.
			group.setFieldValue("line1", parsed.line1);
			group.setFieldValue("city", parsed.city);
			group.setFieldValue("state", parsed.state);
			group.setFieldValue("postcode", parsed.postcode);
			// Stash coordinates as strings (form-state shape is all strings — we
			// parse back to numbers at submit time in checkout-sheet).
			group.setFieldValue("latitude", String(payload.latitude));
			group.setFieldValue("longitude", String(payload.longitude));
			// Place ID travels alongside lat/lng so derived maps URLs deep-link
			// to the named place page (not just raw coords).
			group.setFieldValue("placeId", payload.placeId);
		}

		return (
			<fieldset className="flex flex-col gap-3 rounded-xl border border-border bg-card/40 p-4">
				<legend className="px-1 text-sm font-medium">Delivery address</legend>

				<GoogleAddressAutocomplete
					retailerId={retailerId}
					placeholder="Start typing your address…"
					description="Pick a Google suggestion to auto-fill the fields below — you can still edit any field for unit numbers etc."
					onSelect={handleAutocompleteSelect}
				/>

				<group.AppField name="line1">
					{(field) => (
						<field.TextField
							label="Address line 1"
							placeholder="12 Jln Mawar 3, Taman Mawar"
							autoComplete="address-line1"
							required
						/>
					)}
				</group.AppField>

				<group.AppField name="line2">
					{(field) => (
						<field.TextField
							label="Address line 2 (optional)"
							placeholder="Unit, building, floor"
							autoComplete="address-line2"
						/>
					)}
				</group.AppField>

				<div className="grid grid-cols-2 gap-3">
					<group.AppField name="postcode">
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

					<group.AppField name="city">
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

				<group.AppField name="state">
					{(field) => (
						<field.SelectField label="State" options={stateOptions} required />
					)}
				</group.AppField>

				<group.AppField name="notes">
					{(field) => (
						<field.TextareaField
							label="Delivery notes (optional)"
							placeholder="Landmark, gate code, courier instructions"
							rows={2}
						/>
					)}
				</group.AppField>
			</fieldset>
		);
	},
});
