import {
	createFileRoute,
	Link,
	redirect,
	useNavigate,
} from "@tanstack/react-router";
import { useConvex, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Download, FileSpreadsheet, Info, Upload } from "lucide-react";
import { type ChangeEvent, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import { PageHeader } from "../components/dashboard/page-header";
import { Button } from "../components/ui/button";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";
import {
	downloadProductCsvTemplate,
	downloadSampleProductsCsv,
	parseProductsCsv,
} from "../lib/csv";
import { BULK_IO_ENABLED } from "../lib/feature-flags";
import { convexErrorMessage } from "../lib/format";
import {
	type GroupedImportResult,
	type GroupedProductImport,
	VARIANT_IMPORT_COLUMNS,
} from "../lib/product-import";
import { parseProductsXlsx } from "../lib/xlsx";

export const Route = createFileRoute("/app/products/import")({
	beforeLoad: () => {
		if (!BULK_IO_ENABLED) throw redirect({ to: "/app/products" });
	},
	component: ImportProductsRoute,
});

// Each bulkUpsert call carries at most this many VARIANT rows (mirrors
// MAX_BULK_IMPORT_BATCH on the server). Products are chunked to stay under it.
const MAX_VARIANTS_PER_BATCH = 50;

const SCHEMA_DOCS: Array<{ column: string; required: boolean; notes: string }> =
	[
		{
			column: "product_handle",
			required: false,
			notes: "Groups a product's variant rows. Falls back to name.",
		},
		{
			column: "name",
			required: true,
			notes: "Product name (max 120). Last row wins per product.",
		},
		{ column: "description", required: false, notes: "Max 1000 characters" },
		{
			column: "option1_name / option1_value",
			required: false,
			notes: 'First axis, e.g. "Size" / "M"',
		},
		{
			column: "option2_name / option2_value",
			required: false,
			notes: "Second axis (optional)",
		},
		{
			column: "sku",
			required: false,
			notes: "Per-variant. Matching SKUs update existing variants.",
		},
		{
			column: "price",
			required: true,
			notes: "Major units, rounded to 2 dp (e.g. 120 or 120.50)",
		},
		{ column: "stock", required: true, notes: "Whole number ≥ 0" },
		{
			column: "weight_grams",
			required: false,
			notes: "Parcel weight (for delivery). Defaults to 0.",
		},
	];

type PreviewResult = FunctionReturnType<typeof api.products.bulkUpsertPreview>;
type PlanEntry = PreviewResult["plan"][number];
type PreviewSummary = PreviewResult["summary"];

/** Map a parsed grouped product to the bulkUpsert API shape. */
function toApiProduct(p: GroupedProductImport) {
	return {
		name: p.name,
		description: p.description,
		options: p.options,
		variants: p.variants.map((vr) => ({
			optionValues: vr.optionValues,
			sku: vr.sku,
			price: vr.price,
			onHand: vr.onHand,
			parcelWeightG: vr.parcelWeightG,
			active: vr.active,
		})),
	};
}

/** Split products into batches whose total variant count stays under the cap. */
function chunkByVariants(
	products: GroupedProductImport[],
): GroupedProductImport[][] {
	const chunks: GroupedProductImport[][] = [];
	let cur: GroupedProductImport[] = [];
	let count = 0;
	for (const p of products) {
		const n = p.variants.length;
		if (cur.length > 0 && count + n > MAX_VARIANTS_PER_BATCH) {
			chunks.push(cur);
			cur = [];
			count = 0;
		}
		cur.push(p);
		count += n;
	}
	if (cur.length > 0) chunks.push(cur);
	return chunks;
}

function ImportProductsRoute() {
	const navigate = useNavigate();
	const convex = useConvex();
	const retailer = useDashboardRetailer();
	const bulkUpsert = useMutation(api.products.bulkUpsert);

	const [parsed, setParsed] = useState<GroupedImportResult | null>(null);
	const [fileName, setFileName] = useState<string | null>(null);
	const [importing, setImporting] = useState(false);
	const [previewing, setPreviewing] = useState(false);
	const [preview, setPreview] = useState<{
		plan: PlanEntry[];
		summary: PreviewSummary;
	} | null>(null);

	if (!retailer) return null;

	async function handleFile(e: ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		if (!file) return;
		setPreview(null);
		setFileName(file.name);
		try {
			const lower = file.name.toLowerCase();
			if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
				setParsed(await parseProductsXlsx(await file.arrayBuffer()));
			} else {
				setParsed(parseProductsCsv(await file.text()));
			}
		} catch (err) {
			setParsed(null);
			toast.error(convexErrorMessage(err));
		}
	}

	function reset() {
		setParsed(null);
		setPreview(null);
		setFileName(null);
	}

	async function handlePreview() {
		if (!parsed || parsed.products.length === 0 || !retailer) return;
		setPreviewing(true);
		try {
			const plan: PlanEntry[] = [];
			const summary: PreviewSummary = {
				products: 0,
				creates: 0,
				updates: 0,
				variants: 0,
				autoFilled: 0,
			};
			for (const chunk of chunkByVariants(parsed.products)) {
				const res = await convex.query(api.products.bulkUpsertPreview, {
					retailerId: retailer._id,
					products: chunk.map(toApiProduct),
				});
				plan.push(...res.plan);
				summary.products += res.summary.products;
				summary.creates += res.summary.creates;
				summary.updates += res.summary.updates;
				summary.variants += res.summary.variants;
				summary.autoFilled += res.summary.autoFilled;
			}
			setPreview({ plan, summary });
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setPreviewing(false);
		}
	}

	async function handleConfirm() {
		if (!parsed || parsed.products.length === 0 || !retailer) return;
		setImporting(true);
		try {
			for (const chunk of chunkByVariants(parsed.products)) {
				await bulkUpsert({
					retailerId: retailer._id,
					currency: retailer.currency,
					products: chunk.map(toApiProduct),
				});
			}
			toast.success("Import complete");
			navigate({ to: "/app/products" });
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setImporting(false);
		}
	}

	const hasParseErrors = (parsed?.errorRows.length ?? 0) > 0;
	const hasPreviewErrors =
		preview?.plan.some((p) => p.action === "error") ?? false;
	const canPreview =
		parsed !== null &&
		parsed.products.length > 0 &&
		!hasParseErrors &&
		!previewing;

	return (
		<div className="flex flex-col gap-5 lg:max-w-3xl">
			<PageHeader
				title="Import products"
				back={{ to: "/app/products", label: "Products" }}
			/>
			<div className="flex items-center gap-2 lg:hidden">
				<Link
					to="/app/products"
					className="text-sm text-muted-foreground hover:text-foreground"
				>
					← Products
				</Link>
			</div>

			<section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
				<div className="flex items-start gap-3">
					<FileSpreadsheet
						className="size-5 shrink-0 text-accent"
						aria-hidden
					/>
					<div className="flex flex-col gap-1">
						<p className="font-medium">CSV or Excel — one row per variant</p>
						<p className="text-sm text-muted-foreground">
							Header row with these columns:
							<br />
							<span className="font-mono text-xs">
								{VARIANT_IMPORT_COLUMNS.join(", ")}
							</span>
						</p>
					</div>
				</div>

				<div className="overflow-hidden rounded-xl border border-border">
					<table className="w-full text-left text-sm">
						<thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
							<tr>
								<th className="px-3 py-2">Column</th>
								<th className="px-3 py-2">Required</th>
								<th className="px-3 py-2">Notes</th>
							</tr>
						</thead>
						<tbody>
							{SCHEMA_DOCS.map((col) => (
								<tr
									key={col.column}
									className="border-t border-border align-top"
								>
									<td className="px-3 py-2 font-mono text-xs">{col.column}</td>
									<td className="px-3 py-2">{col.required ? "✓" : ""}</td>
									<td className="px-3 py-2 text-muted-foreground">
										{col.notes}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>

				<div className="flex items-start gap-2 rounded-xl bg-accent/5 p-3 text-xs text-muted-foreground">
					<Info className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
					<span>
						We complete the full variant grid for you — any option combination
						you don't list is added as an <strong>inactive</strong> variant at 0
						price / 0 stock. Re-activate it from the product editor when you
						have stock. Rows with a SKU matching an existing variant{" "}
						<strong>update</strong> it; unlisted variants are never deleted.
						Images aren't imported — add them per product. Prices use{" "}
						{retailer.currency}.
					</span>
				</div>

				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						variant="secondary"
						onClick={downloadProductCsvTemplate}
						className="h-11"
					>
						<Download className="mr-2 size-4" aria-hidden /> CSV template
					</Button>
					<Button
						type="button"
						variant="secondary"
						onClick={downloadSampleProductsCsv}
						className="h-11"
					>
						<Download className="mr-2 size-4" aria-hidden /> Sample products
					</Button>
				</div>
			</section>

			<section className="flex flex-col gap-3">
				<label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card p-6 text-center hover:border-ring">
					<Upload className="size-5 text-muted-foreground" aria-hidden />
					<span className="font-medium">
						{fileName ?? "Choose a CSV or Excel file"}
					</span>
					<span className="text-xs text-muted-foreground">
						Imported in batches of {MAX_VARIANTS_PER_BATCH} variant rows.
					</span>
					<input
						type="file"
						accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xls,application/vnd.ms-excel"
						onChange={handleFile}
						className="hidden"
					/>
				</label>
				{parsed ? (
					<Button
						type="button"
						variant="secondary"
						onClick={reset}
						className="h-10 self-start text-sm"
					>
						Clear
					</Button>
				) : null}
			</section>

			{parsed ? <ParseSummary parsed={parsed} /> : null}

			{preview ? (
				<PreviewSection plan={preview.plan} summary={preview.summary} />
			) : null}

			{parsed && parsed.products.length > 0 && !preview ? (
				<Button
					type="button"
					onClick={handlePreview}
					disabled={!canPreview}
					className="h-12"
				>
					{previewing
						? "Previewing…"
						: `Preview ${parsed.summary.productCount} product${parsed.summary.productCount === 1 ? "" : "s"} · ${parsed.summary.variantCount} variant${parsed.summary.variantCount === 1 ? "" : "s"}`}
				</Button>
			) : null}

			{preview ? (
				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						onClick={handleConfirm}
						disabled={importing || hasPreviewErrors}
						className="h-12 flex-1"
					>
						{importing
							? "Importing…"
							: `Confirm — ${preview.summary.creates} new, ${preview.summary.updates} updated`}
					</Button>
					<Button
						type="button"
						variant="secondary"
						onClick={() => setPreview(null)}
						disabled={importing}
						className="h-12"
					>
						Back
					</Button>
				</div>
			) : null}
		</div>
	);
}

function ParseSummary({ parsed }: { parsed: GroupedImportResult }) {
	return (
		<section className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center gap-3 text-xs">
				<span className="text-accent">
					{parsed.summary.productCount} products
				</span>
				<span className="text-foreground">
					{parsed.summary.variantCount} variants
				</span>
				{parsed.summary.autoFilledCount > 0 ? (
					<span className="text-muted-foreground">
						{parsed.summary.autoFilledCount} auto-filled
					</span>
				) : null}
				{parsed.errorRows.length > 0 ? (
					<span className="text-destructive">
						{parsed.errorRows.length} error
						{parsed.errorRows.length === 1 ? "" : "s"}
					</span>
				) : null}
			</div>
			{parsed.errorRows.length > 0 ? (
				<ul className="flex flex-col gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
					{parsed.errorRows.map((row) => (
						<li key={`${row.rowNumber}-${row.errors[0]}`} className="text-sm">
							<span className="font-mono font-medium">
								{row.rowNumber === 0 ? "File" : `Row ${row.rowNumber}`}:
							</span>{" "}
							<span className="text-destructive">{row.errors.join("; ")}</span>
						</li>
					))}
				</ul>
			) : null}
		</section>
	);
}

function PreviewSection({
	plan,
	summary,
}: {
	plan: PlanEntry[];
	summary: PreviewSummary;
}) {
	const [showAll, setShowAll] = useState(false);
	const visible = showAll ? plan : plan.slice(0, 20);
	return (
		<section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="font-semibold">Preview</h3>
				<div className="flex gap-3 text-xs">
					<span className="text-accent">{summary.creates} new</span>
					<span className="text-foreground">{summary.updates} updated</span>
					<span className="text-muted-foreground">
						{summary.variants} variants
					</span>
				</div>
			</div>
			<ul className="flex flex-col gap-2">
				{visible.map((p) => (
					<li
						key={`${p.name}-${p.productId ?? p.action}`}
						className="rounded-xl border border-border bg-background p-3 text-sm"
					>
						<div className="flex items-center justify-between gap-2">
							<span className="font-medium">{p.name}</span>
							<Badge action={p.action} />
						</div>
						<p className="mt-1 text-xs text-muted-foreground">
							{p.action === "create"
								? `${p.variantCount} variant${p.variantCount === 1 ? "" : "s"}${p.autoFilled > 0 ? ` · ${p.autoFilled} auto-filled inactive` : ""}`
								: p.action === "update"
									? `${p.changedVariants} changed${p.skippedVariants > 0 ? ` · ${p.skippedVariants} skipped` : ""}`
									: null}
						</p>
						{p.warnings.length > 0 ? (
							<ul className="mt-1 flex flex-col gap-0.5">
								{p.warnings.map((w) => (
									<li
										key={w}
										className={
											p.action === "error"
												? "text-xs text-destructive"
												: "text-xs text-amber-600 dark:text-amber-500"
										}
									>
										{w}
									</li>
								))}
							</ul>
						) : null}
					</li>
				))}
			</ul>
			{plan.length > 20 && !showAll ? (
				<Button
					type="button"
					variant="secondary"
					onClick={() => setShowAll(true)}
					className="h-10 self-start text-sm"
				>
					Show {plan.length - 20} more
				</Button>
			) : null}
		</section>
	);
}

function Badge({ action }: { action: PlanEntry["action"] }) {
	const map = {
		create: "bg-accent/10 text-accent",
		update: "bg-muted text-foreground",
		error: "bg-destructive/10 text-destructive",
	} as const;
	const label = { create: "new", update: "update", error: "error" } as const;
	return (
		<span className={`rounded-full px-2 py-0.5 text-xs ${map[action]}`}>
			{label[action]}
		</span>
	);
}
