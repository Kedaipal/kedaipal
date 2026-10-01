import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { useActAs } from "./useActAs";

/**
 * End the act-as session and return to the seller directory — the one exit,
 * shared by the banner, the shell's stale-store redirect and its failed-read
 * screen, so they can't drift.
 *
 * Its own module rather than `useActAs.tsx`, which stays router-free: the
 * session is storage + rules, and where an admin lands afterwards is a
 * navigation concern only these surfaces share.
 */
export function useExitActAs(): () => void {
	const navigate = useNavigate();
	const { setActAs } = useActAs();
	return useCallback(() => {
		setActAs(undefined);
		navigate({ to: "/app/admin/sellers" });
	}, [navigate, setActAs]);
}
