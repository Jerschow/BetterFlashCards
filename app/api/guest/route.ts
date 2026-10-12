import { apiError } from "../../../lib/ai";
import { openGuestTrial } from "../../../lib/guest-server";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try { return await openGuestTrial(request); }
  catch (error) { const response = apiError(error); response.headers.set("Cache-Control", "no-store"); return response; }
}
