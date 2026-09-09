import { NextResponse } from "next/server";
import { getUsage, todayPublishedCount } from "@/lib/ai/cfUsage";
import { getSettings } from "@/lib/settings";
import { neuronsPerImage, displayNeurons, FREE_DAILY_NEURONS } from "@/lib/ai/neurons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const settings = getSettings();
  const usage = await getUsage();
  return NextResponse.json({
    neurons: {
      usedToday: displayNeurons(usage.neuronsUsedToday),
      budget: FREE_DAILY_NEURONS,
      source: usage.source,
      note: usage.note,
      perImage: displayNeurons(neuronsPerImage(settings.cfImageSteps)),
    },
    publish: {
      todayCount: todayPublishedCount(),
      dailyLimit: settings.dailyPublishLimit,
    },
  });
}
