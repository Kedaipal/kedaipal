/// <reference types="vite/client" />
// adminAccess.mine — the one list behind admin.kedaipal.com/videos.
// See convex/lib/adminAreas.ts and docs/admin-console.md ("Admin areas").
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { isAdmin } from "./lib/auth";
import { adminAreasFor, blogEditorUserIds } from "./lib/adminAreas";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const ADMIN = "user_area_admin";
const EDITOR = "user_area_editor";
const SELLER = "user_area_seller";

let prevAdmin: string | undefined;
let prevEditors: string | undefined;
beforeEach(() => {
	prevAdmin = process.env.ADMIN_USER_IDS;
	prevEditors = process.env.BLOG_EDITOR_USER_IDS;
	process.env.ADMIN_USER_IDS = ADMIN;
	process.env.BLOG_EDITOR_USER_IDS = ` ${EDITOR} , `;
});
afterEach(() => {
	process.env.ADMIN_USER_IDS = prevAdmin;
	process.env.BLOG_EDITOR_USER_IDS = prevEditors;
});

describe("adminAccess.mine", () => {
	test("a blog editor holds videos", async () => {
		const t = setup();
		const res = await t.withIdentity({ subject: EDITOR }).query(api.adminAccess.mine, {});
		expect(res).toEqual({ areas: ["videos"], hasStore: false });
	});

	test("a Kedaipal admin holds every area", async () => {
		const t = setup();
		const res = await t.withIdentity({ subject: ADMIN }).query(api.adminAccess.mine, {});
		expect(res).toEqual({ areas: ["videos"], hasStore: false });
	});

	test("a seller holds none", async () => {
		const t = setup();
		const res = await t.withIdentity({ subject: SELLER }).query(api.adminAccess.mine, {});
		expect(res).toEqual({ areas: [], hasStore: false });
	});

	test("signed out is an empty answer, not an error — the Worker reads errors as 'Convex is down'", async () => {
		const t = setup();
		expect(await t.query(api.adminAccess.mine, {})).toEqual({
			areas: [],
			hasStore: false,
		});
	});
});

// `hasStore` follows the app shell's own rule (`resolveMyRetailer`): the admin
// page links a caller "back to the app" only when the app would not send them
// to onboarding. A storeless blog editor gets kedaipal.com instead.
describe("adminAccess.mine — hasStore", () => {
	async function seedStore(t: ReturnType<typeof setup>, owner: string) {
		const asOwner = t.withIdentity({ subject: owner });
		await asOwner.mutation(api.retailers.createRetailer, {
			storeName: "Editor Store",
			slug: `editor-store-${owner.replace(/[^a-z0-9]/g, "")}`,
		});
		const store = await asOwner.query(api.retailers.getMyRetailer);
		if (!store) throw new Error("seed failed");
		return store._id;
	}

	test("a storeless blog editor has no store", async () => {
		const t = setup();
		const res = await t.withIdentity({ subject: EDITOR }).query(api.adminAccess.mine, {});
		expect(res).toEqual({ areas: ["videos"], hasStore: false });
	});

	test("a blog editor who owns a store has one", async () => {
		const t = setup();
		await seedStore(t, EDITOR);
		const res = await t.withIdentity({ subject: EDITOR }).query(api.adminAccess.mine, {});
		expect(res).toEqual({ areas: ["videos"], hasStore: true });
	});

	test("an active team member has a store; an invited or removed one does not", async () => {
		const t = setup();
		const retailerId = await seedStore(t, SELLER);
		const member = (status: "active" | "invited" | "removed") =>
			t.run((ctx) =>
				ctx.db.insert("retailerMembers", {
					retailerId,
					userId: EDITOR,
					email: "editor@example.com",
					status,
					permissions: { orders: "read" },
					invitedBy: SELLER,
					invitedAt: Date.now(),
					acceptedAt: status === "active" ? Date.now() : undefined,
				}),
			);
		const ask = () => t.withIdentity({ subject: EDITOR }).query(api.adminAccess.mine, {});
		const invited = await member("invited");
		expect((await ask()).hasStore).toBe(false);
		await t.run((ctx) => ctx.db.patch(invited, { status: "removed" }));
		expect((await ask()).hasStore).toBe(false);
		await member("active");
		expect((await ask()).hasStore).toBe(true);
	});

	test("the store owner who is no editor: has a store, holds no area", async () => {
		const t = setup();
		await seedStore(t, SELLER);
		const res = await t.withIdentity({ subject: SELLER }).query(api.adminAccess.mine, {});
		expect(res).toEqual({ areas: [], hasStore: true });
	});
});

describe("adminAreasFor", () => {
	test("both lists fail closed when unset", () => {
		delete process.env.ADMIN_USER_IDS;
		delete process.env.BLOG_EDITOR_USER_IDS;
		expect(adminAreasFor(ADMIN)).toEqual([]);
		expect(adminAreasFor(EDITOR)).toEqual([]);
		expect(blogEditorUserIds()).toEqual([]);
	});

	test("parses a comma list with spaces and blanks", () => {
		process.env.BLOG_EDITOR_USER_IDS = "user_a, user_b,,user_c ";
		expect(blogEditorUserIds()).toEqual(["user_a", "user_b", "user_c"]);
	});

	test("a blog editor is NOT an admin — the editor list never grants act-as", async () => {
		const asEditor = { auth: { getUserIdentity: async () => ({ subject: EDITOR }) } };
		expect(await isAdmin(asEditor)).toBe(false);
	});
});
