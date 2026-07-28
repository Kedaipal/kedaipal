import { useMutation } from "convex/react";
import { useCallback } from "react";
import { api } from "../../convex/_generated/api";
import { useActAsRetailerId } from "./useActAs";

/**
 * `retailers.updateSettings`, act-as aware. In admin act-as the seller's
 * `retailerId` is injected so the edit lands on THEIR store — the mutation
 * resolves the target by the caller's identity when the id is omitted, so a
 * raw `useMutation(api.retailers.updateSettings)` inside the dashboard
 * silently writes to the ADMIN's own store instead. Every settings write
 * outside `app.settings.tsx` must go through this hook. See
 * docs/admin-console.md.
 */
export function useUpdateSettings() {
	const mutate = useMutation(api.retailers.updateSettings);
	const actAsRetailerId = useActAsRetailerId();
	return useCallback(
		(args: Omit<Parameters<typeof mutate>[0], "retailerId">) =>
			mutate({ ...args, retailerId: actAsRetailerId }),
		[mutate, actAsRetailerId],
	);
}
