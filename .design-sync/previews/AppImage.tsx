import { AppImage } from "kedaipal";

// A self-contained data: URI stands in for a Convex-hosted photo so the
// "loaded" state renders with zero network dependency.
const SAMPLE_IMG =
	"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='240'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%237BA394'/%3E%3Cstop offset='1' stop-color='%23010066'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='320' height='240' fill='url(%23g)'/%3E%3C/svg%3E";

const LOGO_IMG =
	"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='32'%3E%3Crect width='64' height='32' rx='6' fill='%23010066'/%3E%3Ctext x='32' y='21' font-family='sans-serif' font-size='14' fill='white' text-anchor='middle'%3EKP%3C/text%3E%3C/svg%3E";

export function Loaded() {
	return <AppImage src={SAMPLE_IMG} alt="Chocolate fudge cake" aspect="aspect-square w-40" rounded="rounded-xl" />;
}

export function Fallback() {
	return <AppImage src={undefined} alt="Product photo" aspect="aspect-square w-40" rounded="rounded-xl" />;
}

export function LogoFixedHeight() {
	return <AppImage src={LOGO_IMG} alt="Store logo" aspect="h-8 w-auto" fill={false} />;
}
