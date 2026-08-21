/**
 * Display rule for the address's state line (SG-lite, 86eynw29u).
 *
 * SG addresses store the literal "Singapore" in BOTH `city` and `state`
 * (Singapore has no state tier — see convex/lib/address.ts SG_STATE_LABEL),
 * so every renderer that prints "postcode city" followed by the state would
 * read "123456 Singapore, Singapore". One author of the dedupe: the state is
 * display noise whenever it merely repeats the city, whatever the country —
 * no MY address triggers it (no city shares a name with a state).
 */
export function displayAddressState(addr: {
	city: string;
	state: string;
}): string | undefined {
	const state = addr.state.trim();
	if (state.length === 0) return undefined;
	return state.toLowerCase() === addr.city.trim().toLowerCase()
		? undefined
		: state;
}
