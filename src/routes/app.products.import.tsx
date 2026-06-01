import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useConvex, useMutation, useQuery } from "convex/react";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { type ChangeEvent, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import { PageHeader } from "../components/dashboard/page-header";
import { Button } from "../components/ui/button";
import {
	downloadProductCsvTemplate,
	downloadSampleProductsCsv,
	parseProductsCsv,
} from "../lib/csv";
import { convexErrorMessage, formatPrice } from "../lib/format";
import {
	type ParsedProductImport,
	PRODUCT_IMPORT_COLUMNS,
	type ProductImportRow,
} from "../lib/product-import";
import { parseProductsXlsx } from "../lib/xlsx";

export const Route = createFileRoute("/app/products/import")({
	component: ImportProductsRoute,
});

const CHUNK_SIZE = 50;

const SCHEMA_DOCS: Array<{
	column: string;
	type: string;
	required: boolean;
	notes: string;
}> = [
	{
		column: "sku",
		type: "text",
		required: false,
		notes: "Max 60 characters. Stable identifier used for updates.",
	},
	{ column: "name", type: "text", required: true, notes: "Max 120 characters" },
	{
		column: "description",
		type: "text",
		required: false,
		notes: "Max 1000 characters",
	},
	{
		column: "price",
		type: "decimal",
		required: true,
		notes: "Major units in store currency, e.g. 120 or 120.50",
	},
	{ column: "stock", type: "integer", required: true, notes: "≥ 0" },
];

interface PlanRow {
	rowNumber: number;
	sku: string | undefined;
	action: "insert" | "update";
	diff: {
		name?: { before: string; after: string };
		description?: {
			before: string | undefined;
			after: string | undefined;
		};
		price?: { before: number; after: number };
		stock?: { before: number; after: number };
	};
}

interface PreviewPlan {
	plan: PlanRow[];
	summary: { inserts: number; updates: number; noChange: number };
}

function itemsForApi(rows: ProductImportRow[]) {
	return rows.map((r) => ({
		sku: r.sku,
		name: r.name,
		description: r.description,
		price: r.price,
		stock: r.stock,
	}));
}

function ImportProductsRoute() {
	const navigate = useNavigate();
	const convex = useConvex();
	const retailer = useQuery(api.retailers.getMyRetailer);
	const bulkUpsert = useMutation(api.products.bulkUpsert);

	const [parsed, setParsed] = useState<ParsedProductImport | null>(null);
	const [fileName, setFileName] = useState<string | null>(null);
	const [importing, setImporting] = useState(false);
	const [previewing, setPreviewing] = useState(false);
	const [preview, setPreview] = useState<PreviewPlan | null>(null);
	const [progress, setProgress] = useState<{
		done: number;
		total: number;
	} | null>(null);

	if (!retailer) return null;

	async function handleFile(e: ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		if (!file) return;
		resetDerivedState();
		setFileName(file.name);
		try {
			const lower = file.name.toLowerCase();
			if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
				const buffer = await file.arrayBuffer();
				setParsed(await parseProductsXlsx(buffer));
			} else {
				const text = await file.text();
				setParsed(parseProductsCsv(text));
			}
		} catch (err) {
			setParsed(null);
			toast.error(convexErrorMessage(err));
		}
	}

	function resetDerivedState() {
		setProgress(null);
		setPreview(null);
	}

	function reset() {
		resetDerivedState();
		setParsed(null);
		setFileName(null);
	}

	async function handlePreview() {
		if (!parsed || parsed.validRows.length === 0 || !retailer) return;
		setPreviewing(true);
		try {
			const rows = parsed.validRows;
			const totalChunks = Math.ceil(rows.length / CHUNK_SIZE);
			const mergedPlan: PlanRow[] = [];
			const mergedSummary = { inserts: 0, updates: 0, noChange: 0 };
			for (let i = 0; i < totalChunks; i++) {
				const slice = rows.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
				const result = await convex.query(api.products.bulkUpsertPreview, {
					retailerId: retailer._id,
					items: itemsForApi(slice),
				});
				const offset = i * CHUNK_SIZE;
				for (const entry of result.plan) {
					mergedPlan.push({
						...entry,
						// Map the preview's chunk-local rowNumber to the parsed row's
						// source rowNumber so expandable rows line up with the sheet.
						rowNumber:
							slice[entry.rowNumber - 1]?.rowNumber ?? offset + entry.rowNumber,
					});
				}
				mergedSummary.inserts += result.summary.inserts;
				mergedSummary.updates += result.summary.updates;
				mergedSummary.noChange += result.summary.noChange;
			}
			setPreview({ plan: mergedPlan, summary: mergedSummary });
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setPreviewing(false);
		}
	}

	async function handleConfirm() {
		if (!parsed || parsed.validRows.length === 0 || !retailer) return;
		setImporting(true);
		const rows = parsed.validRows;
		const totalChunks = Math.ceil(rows.length / CHUNK_SIZE);
		setProgress({ done: 0, total: rows.length });
		try {
			for (let i = 0; i < totalChunks; i++) {
				const slice = rows.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
				await bulkUpsert({
					retailerId: retailer._id,
					currency: retailer.currency,
					items: itemsForApi(slice),
				});
				setProgress({ done: (i + 1) * CHUNK_SIZE, total: rows.length });
			}
			toast.success("Import complete");
			navigate({ to: "/app/products" });
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setImporting(false);
		}
	}

	const canPreview =
		parsed !== null &&
		parsed.validRows.length > 0 &&
		parsed.errorRows.length === 0 &&
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

			<h2 className="text-xl font-bold">Import products</h2>

			<section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
				<div className="flex items-start gap-3">
					<FileSpreadsheet
						className="size-5 shrink-0 text-accent"
						aria-hidden
					/>
					<div className="flex flex-col gap-1">
						<p className="font-medium">CSV or Excel format</p>
						<p className="text-sm text-muted-foreground">
							The first row must be a header with these exact column names:
							<br />
							<span className="font-mono text-xs">
								{PRODUCT_IMPORT_COLUMNS.join(", ")}
							</span>
						</p>
					</div>
				</div>

				<div className="overflow-hidden rounded-xl border border-border">
					<table className="w-full text-left text-sm">
						<thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
							<tr>
								<th className="px-3 py-2">Column</th>
								<th className="px-3 py-2">Type</th>
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
									<td className="px-3 py-2 font-mono">{col.column}</td>
									<td className="px-3 py-2 text-muted-foreground">
										{col.type}
									</td>
									<td className="px-3 py-2">{col.required ? "✓" : ""}</td>
									<td className="px-3 py-2 text-muted-foreground">
										{col.notes}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>

				<p className="text-xs text-muted-foreground">
					Prices use your store currency ({retailer.currency}). Change it in{" "}
					<Link
						to="/app/settings"
						search={{ tab: "store" }}
						className="underline"
					>
						Settings
					</Link>
					. Rows with a matching SKU update existing products in place;
					everything else is created new. Images are not supported in bulk — add
					them per product after importing.
				</p>

				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						variant="secondary"
						onClick={downloadProductCsvTemplate}
						className="h-11"
					>
						<Download className="mr-2 size-4" aria-hidden /> Download CSV
						template
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
						Or drag &amp; drop — imported in batches of 50 rows.
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

			{parsed ? (
				<PreviewSection parsed={parsed} currency={retailer.currency} />
			) : null}

			{preview ? (
				<DiffSection
					plan={preview.plan}
					summary={preview.summary}
					currency={retailer.currency}
				/>
			) : null}

			{progress ? (
				<p className="rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent-foreground">
					Importing… {Math.min(progress.done, progress.total)} /{" "}
					{progress.total}
				</p>
			) : null}

			{parsed && parsed.validRows.length > 0 && !preview ? (
				<Button
					type="button"
					onClick={handlePreview}
					disabled={!canPreview}
					className="h-12"
				>
					{previewing
						? "Previewing…"
						: `Preview changes for ${parsed.validRows.length} row${parsed.validRows.length === 1 ? "" : "s"}`}
				</Button>
			) : null}

			{preview ? (
				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						onClick={handleConfirm}
						disabled={importing}
						className="h-12 flex-1"
					>
						{importing
							? "Importing…"
							: `Confirm — ${preview.summary.inserts} new, ${preview.summary.updates} updated`}
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

function PreviewSection({
	parsed,
	currency,
}: {
	parsed: ParsedProductImport;
	currency: string;
}) {
	return (
		<section className="flex flex-col gap-3">
			<div className="flex items-center justify-between">
				<h3 className="font-semibold">Preview</h3>
				<div className="flex gap-3 text-xs">
					<span className="text-accent">{parsed.validRows.length} valid</span>
					{parsed.errorRows.length > 0 ? (
						<span className="text-destructive">
							{parsed.errorRows.length} error
							{parsed.errorRows.length === 1 ? "" : "s"}
						</span>
					) : null}
				</div>
			</div>

			{parsed.errorRows.length > 0 ? (
				<ul className="flex flex-col gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
					{parsed.errorRows.map((row) => (
						<li key={row.rowNumber} className="text-sm">
							<span className="font-mono font-medium">
								{row.rowNumber === 0 ? "Header" : `Row ${row.rowNumber}`}:
							</span>{" "}
							<span className="text-destructive">{row.errors.join("; ")}</span>
						</li>
					))}
				</ul>
			) : null}

			{parsed.validRows.length > 0 ? (
				<div className="overflow-x-auto rounded-xl border border-border">
					<table className="w-full text-left text-sm">
						<thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
							<tr>
								<th className="px-3 py-2">#</th>
								<th className="px-3 py-2">SKU</th>
								<th className="px-3 py-2">Name</th>
								<th className="px-3 py-2">Price</th>
								<th className="px-3 py-2">Stock</th>
							</tr>
						</thead>
						<tbody>
							{parsed.validRows.slice(0, 20).map((row) => (
								<tr key={row.rowNumber} className="border-t border-border">
									<td className="px-3 py-2 font-mono text-muted-foreground">
										{row.rowNumber}
									</td>
									<td className="px-3 py-2 font-mono text-xs">
										{row.sku ?? (
											<span className="text-muted-foreground">—</span>
										)}
									</td>
									<td className="px-3 py-2">{row.name}</td>
									<td className="px-3 py-2">
										{formatPrice(row.price, currency)}
									</td>
									<td className="px-3 py-2">{row.stock}</td>
								</tr>
							))}
						</tbody>
					</table>
					{parsed.validRows.length > 20 ? (
						<p className="border-t border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
							… and {parsed.validRows.length - 20} more
						</p>
					) : null}
				</div>
			) : null}
		</section>
	);
}

function DiffSection({
	plan,
	summary,
	currency,
}: {
	plan: PlanRow[];
	summary: { inserts: number; updates: number; noChange: number };
	currency: string;
}) {
	const [showAll, setShowAll] = useState(false);
	const rowsWithChanges = plan.filter(
		(p) => p.action === "insert" || Object.keys(p.diff).length > 0,
	);
	const visible = showAll ? rowsWithChanges : rowsWithChanges.slice(0, 15);

	return (
		<section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="font-semibold">Changes</h3>
				<div className="flex gap-3 text-xs">
					<span className="text-accent">{summary.inserts} new</span>
					<span className="text-foreground">{summary.updates} updated</span>
					<span className="text-muted-foreground">
						{summary.noChange} unchanged
					</span>
				</div>
			</div>

			{rowsWithChanges.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					All rows already match what's in your store. Nothing to import.
				</p>
			) : (
				<ul className="flex flex-col gap-2">
					{visible.map((row) => (
						<li
							key={row.rowNumber}
							className="rounded-xl border border-border bg-background p-3 text-sm"
						>
							<div className="flex items-center justify-between gap-2">
								<span className="font-mono text-xs text-muted-foreground">
									Row {row.rowNumber}{" "}
									{row.sku ? <span>· {row.sku}</span> : null}
								</span>
								<span
									className={
										row.action === "insert"
											? "rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent"
											: "rounded-full bg-muted px-2 py-0.5 text-xs"
									}
								>
									{row.action === "insert" ? "new" : "update"}
								</span>
							</div>
							{row.action === "update" ? (
								<ul className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
									{row.diff.name ? (
										<DiffField label="Name">
											{row.diff.name.before} → {row.diff.name.after}
										</DiffField>
									) : null}
									{row.diff.price ? (
										<DiffField label="Price">
											{formatPrice(row.diff.price.before, currency)} →{" "}
											{formatPrice(row.diff.price.after, currency)}
										</DiffField>
									) : null}
									{row.diff.stock ? (
										<DiffField label="Stock">
											{row.diff.stock.before} → {row.diff.stock.after}
										</DiffField>
									) : null}
									{row.diff.description ? (
										<DiffField label="Description">
											{row.diff.description.before ?? "(empty)"} →{" "}
											{row.diff.description.after ?? "(empty)"}
										</DiffField>
									) : null}
								</ul>
							) : null}
						</li>
					))}
				</ul>
			)}

			{rowsWithChanges.length > 15 && !showAll ? (
				<Button
					type="button"
					variant="secondary"
					onClick={() => setShowAll(true)}
					className="h-10 self-start text-sm"
				>
					Show {rowsWithChanges.length - 15} more
				</Button>
			) : null}
		</section>
	);
}

function DiffField({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<li className="flex gap-2">
			<span className="w-20 shrink-0 font-medium text-foreground">{label}</span>
			<span className="min-w-0 break-words">{children}</span>
		</li>
	);
}
