import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { validateSlugShape } from "../lib/slug";

export type SlugAvailabilityState =
	| { status: "idle" }
	| { status: "invalid"; message: string }
	| { status: "checking" }
	| { status: "available" }
	| { status: "taken" };

const INVALID_MESSAGES: Record<
	Exclude<ReturnType<typeof validateSlugShape>, { ok: true }>["reason"],
	string
> = {
	empty: "Enter a slug",
	tooShort: "At least 3 characters",
	tooLong: "At most 32 characters",
	invalid: "Lowercase letters, numbers and single dashes only",
	reserved: "That slug is reserved",
};

/**
 * Live slug availability hook. 300ms debounce between user input and the
 * Convex query so we don't thrash the backend while typing.
 */
export function useSlugAvailability(rawSlug: string): SlugAvailabilityState {
	const [debounced, setDebounced] = useState(rawSlug);

	useEffect(() => {
		const t = setTimeout(() => setDebounced(rawSlug), 300);
		return () => clearTimeout(t);
	}, [rawSlug]);

	const shape = validateSlugShape(debounced);
	const queryArgs = shape.ok ? { slug: shape.value } : "skip";
	const result = useQuery(
		convexQuery(api.retailers.checkSlugAvailability, queryArgs),
	).data;

	if (!shape.ok) {
		if (rawSlug.length === 0) return { status: "idle" };
		return { status: "invalid", message: INVALID_MESSAGES[shape.reason] };
	}

	// Still awaiting debounce catch-up
	if (debounced !== rawSlug) return { status: "checking" };
	if (result === undefined) return { status: "checking" };

	if (result.status === "available") return { status: "available" };
	if (result.status === "taken") return { status: "taken" };
	return { status: "invalid", message: result.reason };
}
