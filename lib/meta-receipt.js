/**
 * Meta-style receipt PDF generator.
 *
 * Produces a PDF that visually mirrors Meta's actual billing receipt layout:
 * header with account info + Meta wordmark, left metadata block (invoice date,
 * payment method, transaction ID, product type), right "Paid" headline with
 * subtotal/SST breakdown, and a "Campaigns" section grouping spend entries
 * by campaign name with per-entry impressions and amount sub-rows.
 *
 * Pixel-tuned by measuring real Meta receipts at 200 DPI. Uses Inter font as
 * the closest free match to Meta's proprietary "Optimistic Display" typeface.
 *
 * Usage:
 *   import { generateMetaReceipt } from "../lib/meta-receipt";
 *   await generateMetaReceipt({
 *     entries,           // array of campaign spend entries
 *     config,            // dashboard config (reads receipt* fields for identity)
 *     startDate,         // "YYYY-MM-DD"
 *     endDate,           // "YYYY-MM-DD"
 *     accountFilter,     // "all" or specific account name
 *     currency,          // "MYR" | "USD"
 *     exchangeRate,      // USD→target rate (default 4.45 for MYR)
 *     taxRatePct,        // SST percentage (default 8)
 *   });
 *
 * Returns: void. Triggers PDF download via jsPDF.save().
 */

// Color palette eyedropped from real Meta receipts
const META_BLACK = [20, 24, 33];      // #141821 — main heading
const META_DARK = [50, 57, 68];       // #323944 — body
const META_GRAY = [115, 121, 131];    // #737983 — secondary/labels
const META_DIVIDER = [224, 227, 232]; // #e0e3e8 — horizontal rules
const META_DOT = [200, 200, 200];     // dotted separators

// Layout constants
const MARGIN_X = 50;

/** Format an amount as "MYR2,700.00" — used inline next to amounts. */
function fmtAmount(n, symbol, rate) {
  return `${symbol}${(n * rate).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

/** Format an amount as "2,500.00 MYR" — used in subtotal/tax breakdown. */
function fmtBreakdown(n, symbol, rate) {
  return `${(n * rate).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} ${symbol}`;
}

/** Format an integer with thousands separators. */
function fmtInt(n) {
  return Math.round(n).toLocaleString("en-US");
}

/** Format ISO date as "8 Apr 2026" (Meta's format). */
function fmtMetaDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Format ISO date with current time as "24 Apr 2026, 06:52" (Meta's format). */
function fmtMetaDateTime(iso) {
  const time = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${fmtMetaDate(iso)}, ${time}`;
}

/** Group spend entries by campaign name, preserving the [GEO] prefix Meta uses. */
function groupByCampaign(entries) {
  const groups = new Map();
  entries.forEach((e) => {
    const key = e.campaign || `${e.geo ? `[${e.geo}] ` : ""}(uncategorized)`;
    if (!groups.has(key)) groups.set(key, { entries: [], total: 0 });
    const g = groups.get(key);
    g.entries.push(e);
    g.total += e.amount || 0;
  });
  // Sort by total descending — biggest campaigns first
  return Array.from(groups.entries()).sort(([, a], [, b]) => b.total - a.total);
}

/** Truncate text with "..." suffix to fit within a given pixel width. */
function truncateToWidth(doc, text, maxW) {
  if (doc.getTextWidth(text) <= maxW) return text;
  let truncated = text;
  while (doc.getTextWidth(truncated + "...") > maxW && truncated.length > 10) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + "...";
}

/** Draw the page header: "Receipt for X" + Account ID on left, Meta logo on right. */
function drawHeader(doc, y, config, accountName, pageW, logoB64) {
  doc.setFont("Inter", "normal");
  doc.setFontSize(16);
  doc.setTextColor(...META_BLACK);
  doc.text(`Receipt for ${config.receiptAccountName || accountName || "your account"}`, MARGIN_X, y);

  doc.setFontSize(8);
  doc.setTextColor(...META_GRAY);
  doc.text(`Account ID: ${config.receiptAccountId || "—"}`, MARGIN_X, y + 14);

  // Meta logo — sized to match original receipt (~18pt)
  const logoH = 18;
  const logoAR = 600 / 124;
  const logoW = logoH * logoAR;
  doc.addImage(`data:image/png;base64,${logoB64}`, "PNG", pageW - MARGIN_X - logoW, y - 14, logoW, logoH);

  // Top divider
  const dividerY = y + 38;
  doc.setDrawColor(...META_DIVIDER);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_X, dividerY, pageW - MARGIN_X, dividerY);
  return dividerY + 32; // y position to continue from
}

/** Draw a single label-value pair (label on top in gray, value below in bold). */
function drawLabelValue(doc, label, value, y) {
  doc.setFont("Inter", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...META_GRAY);
  doc.text(label, MARGIN_X, y);

  doc.setFont("Inter", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...META_BLACK);
  doc.text(value, MARGIN_X, y + 13);
}

/** Draw the left metadata column. Returns final y position and the y-coord where "Paid" should align. */
function drawMetadata(doc, y, config, endDate) {
  let leftY = y;

  drawLabelValue(doc, "Invoice/payment date", fmtMetaDateTime(endDate), leftY);
  leftY += 32;

  // Payment method block (multi-line, has Reference number on third line)
  // The "Paid" headline aligns vertically with this block in the original
  const rightPaidY = leftY;
  doc.setFont("Inter", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...META_GRAY);
  doc.text("Payment method", MARGIN_X, leftY);

  doc.setFont("Inter", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...META_BLACK);
  doc.text(config.receiptPaymentMethod || "MasterCard ···· 0000", MARGIN_X, leftY + 13);

  doc.setFont("Inter", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...META_GRAY);
  const reference = config.receiptReference || Math.random().toString(36).slice(2, 12).toUpperCase();
  doc.text(`Reference number: ${reference}`, MARGIN_X, leftY + 24);
  leftY += 46;

  drawLabelValue(doc, "Transaction ID",
    config.receiptTransactionId || `${Date.now()}-${Math.floor(Math.random() * 1e16)}`.slice(0, 36),
    leftY);
  leftY += 32;

  drawLabelValue(doc, "Product type", "Meta ads", leftY);

  return { finalY: leftY, rightPaidY };
}

/** Draw the right-side "Paid" block: label, big amount, subtotal/SST breakdown. */
function drawPaidBlock(doc, y, pageW, grandTotal, subtotal, taxAmount, taxRatePct, symbol, rate) {
  doc.setFont("Inter", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...META_DARK);
  doc.text("Paid", pageW - MARGIN_X, y, { align: "right" });

  // Headline — 24pt regular weight (NOT bold) to match original
  doc.setFont("Inter", "normal");
  doc.setFontSize(24);
  doc.setTextColor(...META_BLACK);
  doc.text(fmtAmount(grandTotal, symbol, rate), pageW - MARGIN_X, y + 30, { align: "right" });

  doc.setFontSize(8);
  doc.setTextColor(...META_GRAY);
  doc.text(`Subtotal: ${fmtBreakdown(subtotal, symbol, rate)}`, pageW - MARGIN_X, y + 46, { align: "right" });
  if (taxAmount > 0) {
    doc.text(`SST: ${fmtBreakdown(taxAmount, symbol, rate)} (Rate: ${taxRatePct}%)`, pageW - MARGIN_X, y + 58, { align: "right" });
  }
  doc.text("You requested this manual payment.", pageW - MARGIN_X, y + 76, { align: "right" });
}

/** Draw a divider line and return the new y position past it. */
function drawDivider(doc, y, pageW, gap = 28) {
  doc.setDrawColor(...META_DIVIDER);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_X, y, pageW - MARGIN_X, y);
  return y + gap;
}

/** Draw a single campaign group: bold name + total on top, date range below, dotted line, then sub-rows. */
function drawCampaignGroup(doc, y, pageW, pageH, campaignName, group, dateRangeText, symbol, rate) {
  // Page break if not enough room for header + at least 2 sub-rows
  const needed = 50 + group.entries.length * 22;
  if (y + needed > pageH - 100) {
    doc.addPage();
    y = 55;
  }

  // Campaign name (bold) + total (bold), both on same row
  doc.setFont("Inter", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...META_BLACK);
  const truncatedName = truncateToWidth(doc, campaignName, pageW - MARGIN_X * 2 - 100);
  doc.text(truncatedName, MARGIN_X, y);
  doc.text(fmtAmount(group.total, symbol, rate), pageW - MARGIN_X, y, { align: "right" });

  // Date range below, in gray
  doc.setFont("Inter", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...META_GRAY);
  doc.text(dateRangeText, MARGIN_X, y + 13);

  y += 24;

  // Dotted separator
  doc.setLineDashPattern([1, 2], 0);
  doc.setDrawColor(...META_DOT);
  doc.line(MARGIN_X, y, pageW - MARGIN_X, y);
  doc.setLineDashPattern([], 0);
  y += 16;

  // Sub-rows: indented name, impressions, amount (right-aligned)
  group.entries.forEach((e) => {
    if (y > pageH - 110) {
      doc.addPage();
      y = 55;
    }
    doc.setFont("Inter", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...META_DARK);

    const subName = e.notes ? `${campaignName} – ${e.notes}` : campaignName;
    const truncatedSub = truncateToWidth(doc, subName, pageW - MARGIN_X * 2 - 220);
    doc.text(truncatedSub, MARGIN_X + 30, y);

    // Impressions column — right-aligned, comfortable space from name
    doc.setTextColor(...META_GRAY);
    doc.text(`${fmtInt(e.impressions || 0)} Impressions`, pageW - MARGIN_X - 100, y, { align: "right" });

    // Amount — flush right
    doc.setTextColor(...META_DARK);
    doc.text(fmtAmount(e.amount || 0, symbol, rate), pageW - MARGIN_X, y, { align: "right" });
    y += 22;
  });

  return y + 6; // tail gap between campaign groups
}

/** Draw the page footer with Meta Ireland Limited address and invoice number. */
function drawFooter(doc, pageW, pageH, invoiceNo) {
  const footerY = pageH - 80;
  doc.setFont("Inter", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...META_GRAY);
  doc.text("Meta Platforms Ireland Limited", MARGIN_X, footerY);
  doc.text("Merrion Road", MARGIN_X, footerY + 11);
  doc.text("Dublin 4", MARGIN_X, footerY + 22);
  doc.text("D04 X2K5", MARGIN_X, footerY + 33);
  doc.text("Ireland", MARGIN_X, footerY + 44);
  doc.text("SST: 19000029", MARGIN_X, footerY + 55);
  doc.text("Malaysia", MARGIN_X, footerY + 66);
  doc.text(`Invoice no. ${invoiceNo}`, pageW - MARGIN_X, footerY + 66, { align: "right" });
}

/**
 * Main entry point. Generates the receipt PDF and triggers download.
 * Lazy-loads jspdf and the embedded font/logo assets to keep main bundle small.
 */
export async function generateMetaReceipt({
  entries,
  config,
  startDate,
  endDate,
  accountFilter = "all",
  currency = "MYR",
  exchangeRate = 4.45,
  taxRatePct = 8,
}) {
  // Lazy-load jspdf and assets so they don't bloat the main bundle for users
  // who never generate receipts
  const [{ default: jsPDF }, assets] = await Promise.all([
    import("jspdf"),
    import("./receipt-assets"),
  ]);

  // === Compute totals ===
  const taxRate = (taxRatePct || 0) / 100;
  const symbol = currency === "MYR" ? "MYR" : "USD";
  const rate = currency === "MYR" ? (exchangeRate || 1) : 1;

  // Filter entries to the date range and account
  const inRange = entries.filter((e) =>
    e.date >= startDate && e.date <= endDate &&
    (!accountFilter || accountFilter === "all" || e.account === accountFilter)
  );

  const groups = groupByCampaign(inRange);
  const subtotal = inRange.reduce((s, e) => s + (e.amount || 0), 0);
  const taxAmount = subtotal * taxRate;
  const grandTotal = subtotal + taxAmount;

  // === Build PDF ===
  const doc = new jsPDF({ unit: "pt", format: "a4" });

  // Embed Inter font (closest free match to Meta's Optimistic Display typeface)
  doc.addFileToVFS("Inter-Regular.ttf", assets.INTER_REGULAR_B64);
  doc.addFileToVFS("Inter-SemiBold.ttf", assets.INTER_SEMIBOLD_B64);
  doc.addFont("Inter-Regular.ttf", "Inter", "normal");
  doc.addFont("Inter-SemiBold.ttf", "Inter", "bold");

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // === Layout ===
  // jsPDF uses top-left origin: y starts small and grows downward.
  let y = 55;

  // Header (returns new y position past the divider)
  y = drawHeader(doc, y, config, accountFilter !== "all" ? accountFilter : null, pageW, assets.META_LOGO_B64);

  // Left metadata column + right "Paid" block (drawn at same y, side-by-side)
  const { finalY: leftEndY, rightPaidY } = drawMetadata(doc, y, config, endDate);
  drawPaidBlock(doc, rightPaidY, pageW, grandTotal, subtotal, taxAmount, taxRatePct, symbol, rate);

  // Move past whichever column ends lower
  y = leftEndY + 28;
  y = drawDivider(doc, y, pageW);

  // Campaigns section heading
  doc.setFont("Inter", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...META_BLACK);
  doc.text("Campaigns", MARGIN_X, y);
  y += 22;

  // Each campaign group
  const dateRangeText = `From ${fmtMetaDate(startDate)}, 00:00 to ${fmtMetaDate(endDate)}, 23:59`;
  groups.forEach(([campaignName, group]) => {
    y = drawCampaignGroup(doc, y, pageW, pageH, campaignName, group, dateRangeText, symbol, rate);
  });

  // Footer (page break first if too close to bottom)
  if (y > pageH - 130) {
    doc.addPage();
  }
  const invoiceNo = config.receiptInvoiceNo || `FBADS-${Math.floor(Math.random() * 900) + 100}-${Math.floor(Math.random() * 900000000) + 100000000}`;
  drawFooter(doc, pageW, pageH, invoiceNo);

  // === Trigger download ===
  const filename = `Meta-Receipt-${startDate}-to-${endDate}.pdf`;
  doc.save(filename);
}
