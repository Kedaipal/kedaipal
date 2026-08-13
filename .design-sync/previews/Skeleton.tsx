import { Skeleton } from "kedaipal";

export function TextLines() {
	return (
		<div className="flex w-64 flex-col gap-2">
			<Skeleton className="h-4 w-3/4" />
			<Skeleton className="h-4 w-1/2" />
		</div>
	);
}

export function Card() {
	return (
		<div className="flex w-64 items-center gap-3">
			<Skeleton className="size-12 shrink-0 rounded-full" />
			<div className="flex flex-1 flex-col gap-2">
				<Skeleton className="h-3.5 w-2/3" />
				<Skeleton className="h-3 w-1/3" />
			</div>
		</div>
	);
}

export function ImageBlock() {
	return <Skeleton className="aspect-video w-64 rounded-xl" />;
}
