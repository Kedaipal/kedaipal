// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { useMutation } from "convex/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActAsProvider } from "./useActAs";
import { useUpdateSettings } from "./useUpdateSettings";

// The hook is the act-as seam for retailers.updateSettings: it must inject the
// acted-as retailerId (else the mutation resolves by identity and the edit
// lands on the ADMIN's own store — the production bug this pins).
vi.mock("convex/react");

const wrapper = ({ children }: { children: ReactNode }) => (
	<ActAsProvider>{children}</ActAsProvider>
);

describe("useUpdateSettings", () => {
	let mutate: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		mutate = vi.fn().mockResolvedValue({ ok: true });
		vi.mocked(useMutation).mockReturnValue(mutate as never);
	});

	afterEach(() => {
		window.sessionStorage.clear();
	});

	it("passes args through with retailerId unset on the owner's own store", async () => {
		const { result } = renderHook(() => useUpdateSettings(), { wrapper });
		await result.current({ minFulfilmentNoticeDays: 2 });
		expect(mutate).toHaveBeenCalledWith({
			minFulfilmentNoticeDays: 2,
			retailerId: undefined,
		});
	});

	it("injects the acted-as retailerId in admin act-as", async () => {
		// The provider reads the act-as session from sessionStorage at mount —
		// the same path a refreshed act-as dashboard takes. Key mirrors
		// STORAGE_KEY in useActAs.tsx.
		window.sessionStorage.setItem("kp:actAsRetailerId", "rt_seller_1");
		const { result } = renderHook(() => useUpdateSettings(), { wrapper });
		await result.current({ minFulfilmentNoticeDays: 2 });
		expect(mutate).toHaveBeenCalledWith({
			minFulfilmentNoticeDays: 2,
			retailerId: "rt_seller_1",
		});
	});
});
