import { GripVertical } from "lucide-react";
import { SortableList } from "kedaipal";

type Row = { id: string; label: string };

const rows: Row[] = [
	{ id: "1", label: "Cash" },
	{ id: "2", label: "Bank transfer" },
	{ id: "3", label: "DuitNow QR" },
];

export function Default() {
	return (
		<div className="w-72">
			<SortableList
				items={rows}
				getId={(r) => r.id}
				onReorder={() => {}}
				renderItem={(row, handle) => (
					<div className="flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5">
						{handle}
						<span className="text-sm">{row.label}</span>
					</div>
				)}
			/>
		</div>
	);
}

export function StaticHandle() {
	return (
		<div className="w-72 rounded-lg border bg-card px-2 py-1.5">
			<div className="flex items-center gap-2">
				<span className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground">
					<GripVertical className="size-4" />
				</span>
				<span className="text-sm">Drag handle detail</span>
			</div>
		</div>
	);
}
