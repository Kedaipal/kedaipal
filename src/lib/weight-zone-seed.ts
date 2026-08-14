// Seed template for the weight/zone delivery rate card (86eyeea1n).
//
// One template, per Arif's spec-review call (28 Jul): the PUBLIC J&T zone ×
// weight rates — both anchor frozen sellers (Lopes Viral JB, Wagyu Walid)
// ship ambient J&T with polystyrene + ice, so the ambient card is the honest
// default and there are deliberately NO cold-chain price floors.
//
// Numbers sourced from J&T's published Malaysia rates as relayed by
// EasyParcel's public rate pages (checked 11 Aug 2026): within Peninsular
// ≈ RM6.99–10 first 3 kg, ~RM19 at 10 kg, ~RM29 at 20 kg; Peninsular →
// East MY ≈ RM16 first kg, then ~RM11–13/kg. Seeded a ringgit or two ABOVE
// the public card at each tier so a seller who forgets to edit never
// undercharges — the editor presents these as a starting point to overwrite
// with the rates they actually pay.
//
// Zone membership assumes a WEST-Malaysia seller (both anchor sellers are);
// an East-based seller reassigns the states — the template is a keystroke
// saver, never a constraint.

import { MY_STATES, type MyState } from "../../convex/lib/address";

export type SeedZone = {
	name: string;
	states: MyState[];
	/** Ascending bands; maxKg inclusive, fee in sen. */
	bands: { maxKg: number; fee: number }[];
};

const EAST_STATES: readonly MyState[] = ["Sabah", "Sarawak", "WP Labuan"];

/** The two-zone J&T-shaped template (West-seller perspective). */
export function jntSeedZones(): SeedZone[] {
	const east = new Set<string>(EAST_STATES);
	return [
		{
			name: "West Malaysia",
			states: MY_STATES.filter((s) => !east.has(s)),
			bands: [
				{ maxKg: 3, fee: 800 },
				{ maxKg: 5, fee: 1300 },
				{ maxKg: 10, fee: 2000 },
				{ maxKg: 20, fee: 3000 },
			],
		},
		{
			name: "East Malaysia",
			states: [...EAST_STATES],
			bands: [
				{ maxKg: 1, fee: 1600 },
				{ maxKg: 3, fee: 3600 },
				{ maxKg: 5, fee: 6600 },
				{ maxKg: 10, fee: 13000 },
				{ maxKg: 20, fee: 25500 },
			],
		},
	];
}
