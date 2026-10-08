import { Link, useNavigate } from "@tanstack/react-router";
import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	useReactTable,
} from "@tanstack/react-table";
import { ChevronDown, Lock } from "lucide-react";
import { useMemo } from "react";
import type { Doc } from "../../../convex/_generated/dataModel";
import { MASK_PII } from "../../lib/analytics-privacy";
import { formatPhone, sellerCustomerName } from "../../lib/customer";
import { formatPrice, formatRelativeTime } from "../../lib/format";
import { cn } from "../../lib/utils";
import { CustomerCard } from "./customer-card";

export type CustomerSort = "recency" | "ltv" | "orderCount";

/** The server's row: a customer document plus the gate flag (Credits T3.1,
 * `SellerCustomer`). */
type Customer = Doc<"customers"> & { creditGated?: boolean };

interface CustomerListProps {
	customers: Customer[];
	currency: string;
	sort: CustomerSort;
	onSortChange: (sort: CustomerSort) => void;
}

/**
 * Sorting is server-side (Convex index, descending only), so the table headers
 * just drive the active `sort` rather than TanStack's own sort model. We use
 * the headless table for structured column/row rendering on desktop; mobile
 * falls back to stacked cards.
 */
export function CustomerList({
	customers,
	currency,
	sort,
	onSortChange,
}: CustomerListProps) {
	const navigate = useNavigate();

	const columns = useMemo<ColumnDef<Customer>[]>(
		() => [
			{
				id: "customer",
				header: "Customer",
				cell: ({ row }) => {
					const c = row.original;
					const hasName = Boolean(c.name?.trim() || c.waProfileName?.trim());
					// Waiting on credits (Credits T3.1): the name and phone were
					// redacted server-side, so this cell says what it is waiting for
					// rather than rendering the blank the redaction leaves behind. The
					// aggregate columns beside it stay real — they are the top-up
					// argument, and the row still opens (the detail page says the same
					// thing, so the link is never a dead end).
					const gated = c.creditGated === true;
					return (
						<div className="flex min-w-0 flex-col">
							<Link
								to="/app/customers/$customerId"
								params={{ customerId: c._id }}
								className={cn(
									"truncate hover:underline",
									gated
										? "inline-flex items-center gap-1.5 font-medium text-muted-foreground"
										: "font-medium",
								)}
								onClick={(e) => e.stopPropagation()}
							>
								{gated ? (
									<Lock className="size-3.5 shrink-0" aria-hidden="true" />
								) : null}
								{sellerCustomerName(c)}
							</Link>
							{hasName ? (
								<span className="truncate font-mono text-xs text-muted-foreground">
									{formatPhone(c.waPhone)}
								</span>
							) : null}
						</div>
					);
				},
			},
			{
				id: "orderCount",
				header: "Orders",
				cell: ({ row }) => (
					<span className="tabular-nums">{row.original.orderCount}</span>
				),
			},
			{
				id: "ltv",
				header: "Total spent",
				cell: ({ row }) => (
					<span className="font-semibold tabular-nums">
						{formatPrice(row.original.totalSpent, currency)}
					</span>
				),
			},
			{
				id: "recency",
				header: "Last order",
				cell: ({ row }) => (
					<span className="text-muted-foreground">
						{formatRelativeTime(row.original.lastOrderAt)}
					</span>
				),
			},
		],
		[currency],
	);

	const table = useReactTable({
		data: customers,
		columns,
		getCoreRowModel: getCoreRowModel(),
	});

	// Which header columns map to a server sort key.
	const sortableColumns: Record<string, CustomerSort> = {
		orderCount: "orderCount",
		ltv: "ltv",
		recency: "recency",
	};

	return (
		<>
			{/* Mobile: stacked cards */}
			<ul className="flex flex-col gap-2 lg:hidden">
				{customers.map((c) => (
					<li key={c._id}>
						<CustomerCard customer={c} currency={currency} />
					</li>
				))}
			</ul>

			{/* Desktop: sortable table. MASK_PII here covers every row's name +
			    phone cell — the mobile path inherits its mask from CustomerCard. */}
			<div
				{...MASK_PII}
				className="hidden overflow-hidden rounded-2xl border border-border lg:block"
			>
				<table className="w-full border-collapse text-sm">
					<thead>
						{table.getHeaderGroups().map((headerGroup) => (
							<tr
								key={headerGroup.id}
								className="border-b border-border bg-muted/40 text-left"
							>
								{headerGroup.headers.map((header) => {
									const sortKey = sortableColumns[header.column.id];
									const active = sortKey === sort;
									return (
										<th
											key={header.id}
											className={cn(
												"px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
												header.column.id === "orderCount" && "text-right",
												header.column.id === "ltv" && "text-right",
											)}
										>
											{sortKey ? (
												<button
													type="button"
													onClick={() => onSortChange(sortKey)}
													className={cn(
														"inline-flex items-center gap-1 transition-colors hover:text-foreground",
														(header.column.id === "orderCount" ||
															header.column.id === "ltv") &&
															"flex-row-reverse",
														active && "text-foreground",
													)}
												>
													{flexRender(
														header.column.columnDef.header,
														header.getContext(),
													)}
													<ChevronDown
														className={cn(
															"size-3.5 transition-opacity",
															active ? "opacity-100" : "opacity-0",
														)}
													/>
												</button>
											) : (
												flexRender(
													header.column.columnDef.header,
													header.getContext(),
												)
											)}
										</th>
									);
								})}
							</tr>
						))}
					</thead>
					<tbody>
						{table.getRowModel().rows.map((row) => (
							<tr
								key={row.id}
								onClick={() =>
									navigate({
										to: "/app/customers/$customerId",
										params: { customerId: row.original._id },
									})
								}
								className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-muted/40"
							>
								{row.getVisibleCells().map((cell) => (
									<td
										key={cell.id}
										className={cn(
											"px-4 py-3 align-middle",
											cell.column.id === "orderCount" && "text-right",
											cell.column.id === "ltv" && "text-right",
											cell.column.id === "customer" && "max-w-0",
										)}
									>
										{flexRender(cell.column.columnDef.cell, cell.getContext())}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</>
	);
}
