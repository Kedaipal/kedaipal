import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "kp:sidebar:collapsed";

function readInitial(): boolean {
	if (typeof window === "undefined") return false;
	try {
		return window.localStorage.getItem(STORAGE_KEY) === "1";
	} catch {
		return false;
	}
}

export function useSidebarCollapsed(): [boolean, (next: boolean) => void] {
	const [collapsed, setCollapsedState] = useState<boolean>(false);

	useEffect(() => {
		setCollapsedState(readInitial());
	}, []);

	const setCollapsed = useCallback((next: boolean) => {
		setCollapsedState(next);
		try {
			window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
		} catch {
			// localStorage unavailable (private mode, quota) — keep in-memory state.
		}
	}, []);

	return [collapsed, setCollapsed];
}
