import { cn } from "../../lib/utils";
import { m } from "../../paraglide/messages";

/**
 * CSS-rendered WhatsApp **inbox** inside a simple device frame — the hero's
 * visual, deliberately pain-first (ClickUp 86eye3p6z): real order requests and
 * a "dah transfer" sit buried among family chats, half of them already scrolled
 * past and unanswered. It replaced a single tidy conversation, which showed the
 * happy path the page spends the next four sections promising to build.
 *
 * WhatsApp trade-dress colours (#075E54 header, #25D366 accents) are
 * intentionally literal: a WhatsApp inbox can't theme-flip, and the hero
 * already used #DCF8C6 for the same reason. The whole frame is one
 * `role="img"` — inner text is decorative, so names and timestamps are plain
 * literals and only the message previews carry message keys.
 */

interface InboxRow {
	/** Avatar initials, or an emoji for the non-business chats. */
	avatar: string;
	name: string;
	preview: () => string;
	day: string;
	/** Unread count — absent rows are the ones already read and forgotten. */
	unread?: number;
	/** Rows the seller has scrolled past; dimmed to read as "buried". */
	faded?: boolean;
}

const ROWS: InboxRow[] = [
	{
		avatar: "AR",
		name: "Aisyah Rahim",
		preview: m.problem_chat_2,
		day: "Mon",
		unread: 3,
		faded: true,
	},
	{
		avatar: "MT",
		name: "Mr Tan",
		preview: m.problem_chat_3,
		day: "Mon",
		unread: 1,
	},
	{
		avatar: "PS",
		name: "Puan Siti",
		preview: m.problem_chat_4,
		day: "Tue",
		unread: 2,
		faded: true,
	},
	{ avatar: "❤️", name: "Family", preview: m.hero_inbox_family, day: "Tue" },
	{
		avatar: "ZK",
		name: "Zainab K",
		preview: m.problem_chat_1,
		day: "Wed",
		unread: 5,
		faded: true,
	},
	{ avatar: "AL", name: "Along", preview: m.hero_inbox_ok, day: "Wed" },
	{
		avatar: "?",
		name: "+60 12-338 1122",
		preview: m.hero_inbox_new_ask,
		day: "Thu",
		unread: 4,
	},
	{
		avatar: "HD",
		name: "Hafiz Delivery",
		preview: m.hero_inbox_rider,
		day: "Thu",
	},
];

export function HeroPhone() {
	return (
		<div
			role="img"
			aria-label={m.hero_phone_alt()}
			className="w-[260px] rotate-2 rounded-[2.5rem] bg-slate-900 p-2 shadow-[0_32px_48px_hsl(222_47%_11%_/_0.25)] sm:w-[290px]"
		>
			<div className="flex h-[560px] flex-col overflow-hidden rounded-[2rem] bg-white sm:h-[600px]">
				{/* App bar + tabs */}
				<div className="bg-[#075E54] text-white">
					<div className="flex items-center justify-between px-4 pb-2.5 pt-9">
						<span className="text-[17px] font-semibold">WhatsApp</span>
						<span aria-hidden className="flex gap-4 text-xs opacity-85">
							<span>📷</span>
							<span>🔍</span>
							<span>⋮</span>
						</span>
					</div>
					<div aria-hidden className="flex items-center px-2">
						<span className="flex w-11 justify-center py-2 text-[11px] opacity-70">
							👥
						</span>
						<span className="flex-1 border-b-[3px] border-white py-2 text-center text-[11px] font-bold tracking-[0.08em]">
							CHATS
						</span>
						<span className="flex-1 py-2 text-center text-[11px] font-bold tracking-[0.08em] opacity-65">
							STATUS
						</span>
						<span className="flex-1 py-2 text-center text-[11px] font-bold tracking-[0.08em] opacity-65">
							CALLS
						</span>
					</div>
				</div>

				{/* Chat list */}
				<div className="relative flex flex-1 flex-col overflow-hidden bg-white">
					{ROWS.map((row) => (
						<div
							key={row.name}
							className={cn(
								"flex items-center gap-2.5 px-3.5 py-2.5",
								row.faded && "opacity-65",
							)}
						>
							<span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-200 font-heading text-xs font-extrabold text-slate-600">
								{row.avatar}
							</span>
							<div className="min-w-0 flex-1">
								<p className="truncate text-[12.5px] font-bold text-slate-900">
									{row.name}
								</p>
								<p className="truncate text-[10.5px] text-slate-500">
									{row.preview()}
								</p>
							</div>
							<div className="flex shrink-0 flex-col items-end gap-0.5">
								<span
									className={cn(
										"text-[8.5px]",
										row.unread
											? "font-semibold text-[#25D366]"
											: "text-slate-500",
									)}
								>
									{row.day}
								</span>
								{row.unread ? (
									<span className="flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[#25D366] px-1 text-[8px] font-bold text-white">
										{row.unread}
									</span>
								) : null}
							</div>
						</div>
					))}
					{/* The list keeps going — that's the point. */}
					<div
						aria-hidden
						className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-white to-transparent"
					/>
					<span
						aria-hidden
						className="absolute bottom-4 right-4 flex size-11 items-center justify-center rounded-full bg-[#25D366] text-lg text-white shadow-lg"
					>
						💬
					</span>
				</div>
			</div>
		</div>
	);
}
