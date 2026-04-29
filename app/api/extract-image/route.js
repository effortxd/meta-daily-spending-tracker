// app/api/extract-image/route.js
// Server-side proxy for the Anthropic vision API.
// Keeps ANTHROPIC_API_KEY secret (never sent to the browser).

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60; // allow up to 60s for vision extraction

export async function POST(req) {
  try {
    const { base64, mediaType, dataType } = await req.json();

    if (!base64 || !mediaType) {
      return NextResponse.json(
        { error: "Missing base64 or mediaType" },
        { status: 400 }
      );
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY not configured" },
        { status: 500 }
      );
    }

    const prompt =
      dataType === "deposits"
        ? `Analyze this screenshot showing daily deposit counts by country (likely from a CRM, broker dashboard, or internal tool).

Extract every visible row and return ONLY a JSON array.

Each entry must have these fields:
- date: ISO format YYYY-MM-DD (use null if not visible)
- geo: country name as a string (e.g. "Brazil", "Indonesia", "Thailand")
- count: number of deposits as an integer

CRITICAL: Return ONLY the JSON array. Skip totals/summary rows. Strip commas from numbers.

Example: [{"date":"2025-04-20","geo":"Brazil","count":23},{"date":"2025-04-20","geo":"Mexico","count":15}]`
        : `Analyze this screenshot of Meta/Facebook Ads Manager (or similar ad platform).

Extract every visible row of daily ad performance data and return ONLY a JSON array.

Each entry must have these fields (use null if a value isn't visible):
- date: ISO format YYYY-MM-DD
- account: campaign or ad account name as a string (or null)
- geo: country/region as a string (or null)
- amount: total spend in USD as a number (no currency symbol)
- impressions: number (or null)
- clicks: number (or null)
- leads: number — interpret "results", "conversions", "registrations", "sign-ups" as leads (or null)
- notes: any extra context as a string (or null)

CRITICAL: Return ONLY the JSON array, no explanation, no markdown. Skip header/footer/total rows. Strip currency symbols and commas.

Example: [{"date":"2025-04-15","account":"WeTrade LATAM","geo":"Brazil","amount":1234.56,"impressions":50000,"clicks":1200,"leads":45,"notes":null}]`;

    const anthropicResponse = await fetch(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 4000,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: mediaType,
                    data: base64,
                  },
                },
                { type: "text", text: prompt },
              ],
            },
          ],
        }),
      }
    );

    if (!anthropicResponse.ok) {
      const errorText = await anthropicResponse.text();
      console.error("Anthropic error:", errorText);
      return NextResponse.json(
        { error: "Anthropic API error", detail: errorText },
        { status: 500 }
      );
    }

    const data = await anthropicResponse.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("Extract image error:", err);
    return NextResponse.json(
      { error: err.message || "Server error" },
      { status: 500 }
    );
  }
}
