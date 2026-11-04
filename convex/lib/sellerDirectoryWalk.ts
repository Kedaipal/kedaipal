// Test-only helper (imported by *.test.ts; no runtime caller). Structural
// reader type, so this module never imports convex-test into the deployed
// bundle — the same shape as `convexTestSettle.ts`.
import { api } from "../_generated/api";
import type { AdminSellerRow } from "./adminSellerRow";

type DirectoryReader = {
	query: (
		ref: typeof api.adminSellers.listSellersPage,
		args: { paginationOpts: { numItems: number; cursor: string | null } },
	) => Promise<{
		page: AdminSellerRow[];
		isDone: boolean;
		continueCursor: string;
	}>;
};

/**
 * Every row of the paginated seller directory, walked page by page the way
 * the page's infinite scroll does.
 *
 * The one way a test reads "the directory row for store X" since the
 * whole-book `admin.listSellersForAdmin` was retired (4 Nov 2026): a fact a
 * row carries — cached credits, the acquisition channel, an Enterprise
 * contract, a purge in flight — is asserted through the read the console
 * actually makes, so a row field the page can no longer reach fails here too.
 */
export async function allSellerRows(
	reader: DirectoryReader,
): Promise<AdminSellerRow[]> {
	const rows: AdminSellerRow[] = [];
	let cursor: string | null = null;
	for (let pages = 0; pages < 50; pages++) {
		const res = await reader.query(api.adminSellers.listSellersPage, {
			paginationOpts: { numItems: 25, cursor },
		});
		rows.push(...res.page);
		if (res.isDone) return rows;
		cursor = res.continueCursor;
	}
	throw new Error("the seller directory never finished paginating");
}
