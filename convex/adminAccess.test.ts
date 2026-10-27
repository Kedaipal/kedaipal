/// <reference types="vite/client" />
// adminAccess.mine — the one list behind admin.kedaipal.com/videos.
// See convex/lib/adminAreas.ts and docs/admin-console.md#admin-areas.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { isAdmin } from "./lib/auth";
import { adminAreasFor, blogEditorUserIds } from "./lib/adminAreas";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

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
		const t = convexTest(schema, modules);
		const res = await t.withIdentity({ subject: EDITOR }).query(api.adminAccess.mine, {});
		expect(res).toEqual({ areas: ["videos"] });
	});

	test("a Kedaipal admin holds every area", async () => {
		const t = convexTest(schema, modules);
		const res = await t.withIdentity({ subject: ADMIN }).query(api.adminAccess.mine, {});
		expect(res).toEqual({ areas: ["videos"] });
	});

	test("a seller holds none", async () => {
		const t = convexTest(schema, modules);
		const res = await t.withIdentity({ subject: SELLER }).query(api.adminAccess.mine, {});
		expect(res).toEqual({ areas: [] });
	});

	test("signed out is an empty list, not an error — the Worker reads errors as 'Convex is down'", async () => {
		const t = convexTest(schema, modules);
		expect(await t.query(api.adminAccess.mine, {})).toEqual({ areas: [] });
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
