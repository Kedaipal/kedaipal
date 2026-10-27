import { Link } from "@tanstack/react-router";
import { Button } from "../ui/button";

/**
 * The "create a booking listing" door for empty states that cover BOTH booking
 * cards — the Google Calendar feed and the bookings calendar hold plans and
 * stays alike. Since the Booking card split into Plan and Stay (z8r3fdxt99)
 * one link can't know which the seller means, so each card gets its own,
 * named in the wizard's own words, and lands with that card already picked.
 */
export function NewBookingLinks() {
	return (
		<div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
			<Button asChild variant="outline" className="tap-target">
				<Link to="/app/products/new" search={{ card: "plan" }}>
					Add a plan or package
				</Link>
			</Button>
			<Button asChild variant="outline" className="tap-target">
				<Link to="/app/products/new" search={{ card: "stay" }}>
					Add a stay or rental
				</Link>
			</Button>
		</div>
	);
}
