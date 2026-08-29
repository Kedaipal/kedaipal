import { describe, expect, it } from "vitest";
import { unreadCount } from "./problem-strip";

/**
 * The buried-chats unread stamp climbs by one per arriving bubble. Pinned as
 * a unit test because the live loop is deliberately unobservable headlessly:
 * it only ticks on a visible tab with the pile in the viewport (the
 * hidden-tab AnimatePresence-accumulation guard, see the component header).
 */
describe("unreadCount", () => {
	it("starts at 47 on the first paint (tick = WINDOW - 1)", () => {
		expect(unreadCount(3)).toBe("47");
	});

	it("climbs by one per tick", () => {
		expect(unreadCount(4)).toBe("48");
		expect(unreadCount(10)).toBe("54");
	});

	it("caps at 99+ instead of growing absurd", () => {
		expect(unreadCount(54)).toBe("98");
		expect(unreadCount(55)).toBe("99+");
		expect(unreadCount(500)).toBe("99+");
	});
});
