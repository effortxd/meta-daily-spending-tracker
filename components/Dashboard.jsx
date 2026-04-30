import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Plus, Trash2, Pencil, Download, Upload, TrendingUp, TrendingDown,
  Calendar, X, Check, Filter, DollarSign, Lock, LogOut, Target,
  Activity, RefreshCw, Globe, MousePointerClick, Eye, Users,
  ChevronDown, ClipboardPaste, FileSpreadsheet, ImageIcon, Sparkles,
  AlertCircle, Wallet, Banknote,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from "recharts";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { storage } from "@/lib/storage";

const ENTRIES_KEY = "meta_spend_entries_v3";
const CONFIG_KEY = "meta_spend_config_v3";
const DEPOSITS_KEY = "meta_spend_deposits_v1";
const TOPUPS_KEY = "meta_spend_topups_v1";

const DEFAULT_ACCOUNTS = ["WeTrade LATAM", "WeTrade SEA", "WeTrade Global", "Other"];
const COMMON_GEOS = [
  "Brazil", "Mexico", "Argentina", "Chile", "Colombia", "Peru",
  "Indonesia", "Thailand", "Vietnam", "Malaysia", "Philippines", "Singapore",
  "Multi-country", "Other",
];

const FIELD_OPTIONS = [
  { value: "skip", label: "— Skip —" },
  { value: "date", label: "Date" },
  { value: "account", label: "Account" },
  { value: "campaign", label: "Campaign Name" },
  { value: "geo", label: "Geo" },
  { value: "amount", label: "Spend" },
  { value: "impressions", label: "Impressions" },
  { value: "clicks", label: "Clicks" },
  { value: "leads", label: "Leads" },
  { value: "notes", label: "Notes" },
];

const DEPOSIT_FIELD_OPTIONS = [
  { value: "skip", label: "— Skip —" },
  { value: "date", label: "Date" },
  { value: "geo", label: "Geo / Country" },
  { value: "count", label: "Deposit Count" },
  { value: "amount", label: "Deposit Amount (USD)" },
];

const COLUMN_PATTERNS = [
  { field: "date", pattern: /^(date|day|reporting[\s_.-]*start|reporting[\s_.-]*end|date[\s_.-]*range)/i },
  { field: "amount", pattern: /^(amount[\s_.-]*spent|spend|total[\s_.-]*spent)\b/i },
  { field: "impressions", pattern: /^(impressions|imp\b)/i },
  { field: "clicks", pattern: /^(link[\s_.-]*clicks|clicks|all[\s_.-]*clicks)/i },
  { field: "leads", pattern: /^(leads|results|conversions|registrations|complete[\s_.-]*registration|sign[\s_.-]*ups?)/i },
  { field: "campaign", pattern: /^(campaign[\s_.-]*name|ad[\s_.-]*set[\s_.-]*name|ad[\s_.-]*name|campaign\b|ad[\s_.-]*set\b)/i },
  { field: "account", pattern: /^(account[\s_.-]*name|account|ad[\s_.-]*account)\b/i },
  { field: "geo", pattern: /^(country|geo|region|location|market)/i },
  { field: "notes", pattern: /^(notes?|description|comment)/i },
];

const DEPOSIT_COLUMN_PATTERNS = [
  { field: "date", pattern: /^(date|day)/i },
  { field: "geo", pattern: /^(country|geo|region|location|market)/i },
  { field: "amount", pattern: /^(amount[\s_().]*usd|deposit[\s_.-]*amount|total[\s_.-]*amount|usd[\s_.-]*amount|volume)/i },
  { field: "count", pattern: /^(deposits?|count|deposit[\s_.-]*count|total[\s_.-]*deposits?|ftd|first[\s_.-]*deposit|num[\s_.-]*deposits?)/i },
];

// CRM-style deposits: each row is one transaction. The dashboard aggregates
// transaction rows into date+country buckets at import time.
// Country comes from the Source column prefix (e.g. "TH_LP_DC2_2026" → Thailand).
// Amount uses "Actual Payment Amount(USD)" — what the customer actually paid in USD.
const CRM_DEPOSIT_FIELD_OPTIONS = [
  { value: "skip", label: "— Skip —" },
  { value: "datetime", label: "Submission Date/Time" },
  { value: "crm_id", label: "CRM ID" },
  { value: "source", label: "Source (→ Country)" },
  { value: "amount_usd", label: "Actual Payment Amount (USD)" },
  { value: "currency", label: "Payment Currency (fallback for Country)" },
];

const CRM_DEPOSIT_COLUMN_PATTERNS = [
  // Prefer "Submission Time" over "Processing Time" (first match wins via dedup)
  { field: "datetime", pattern: /^(submission[\s_.-]*time|submitted[\s_.-]*at|order[\s_.-]*time|created[\s_.-]*at|date[\s_.-]*time)/i },
  // CRM-ID column — typically the first column, used to uniquely identify clients
  { field: "crm_id", pattern: /^(crm[\s_.-]*id|client[\s_.-]*id|customer[\s_.-]*id|user[\s_.-]*id)\b/i },
  // Source column prefix gives explicit country code (TH_, ID_, etc.) — preferred over currency guess
  { field: "source", pattern: /^(source|order[\s_.-]*source|utm|campaign|landing[\s_.-]*page)\b/i },
  // "Actual Payment Amount(USD)" — what the user explicitly asked for. Matches with or without space before (USD)
  { field: "amount_usd", pattern: /^actual[\s_.-]*payment[\s_.-]*amount[\s_().]*usd/i },
  // Fallback amount field — only if no "Actual Payment Amount(USD)" exists
  { field: "currency", pattern: /^(payment[\s_.-]*currency)\b/i },
];

// Country code → full name normalization for imports.
// Catches Meta Ads Manager exports that use ISO 2-letter codes (BR, ID, TH, etc.)
// plus common Spanish/Portuguese/local-language variants.
const COUNTRY_NORMALIZE = {
  // LATAM
  BR: "Brazil", BRA: "Brazil", BRASIL: "Brazil",
  MX: "Mexico", MEX: "Mexico", "MÉXICO": "Mexico",
  AR: "Argentina", ARG: "Argentina",
  CL: "Chile", CHL: "Chile",
  CO: "Colombia", COL: "Colombia",
  PE: "Peru", PER: "Peru", "PERÚ": "Peru",
  UY: "Uruguay", PY: "Paraguay", BO: "Bolivia", EC: "Ecuador", VE: "Venezuela",
  // SEA
  ID: "Indonesia", IDN: "Indonesia",
  TH: "Thailand", THA: "Thailand",
  VN: "Vietnam", VNM: "Vietnam", "VIÊTNAM": "Vietnam", "VIET NAM": "Vietnam",
  MY: "Malaysia", MYS: "Malaysia",
  PH: "Philippines", PHL: "Philippines", FILIPINAS: "Philippines",
  SG: "Singapore", SGP: "Singapore",
  KH: "Cambodia", LA: "Laos", MM: "Myanmar",
  // Other common
  US: "United States", USA: "United States",
  GB: "United Kingdom", UK: "United Kingdom",
  CA: "Canada", AU: "Australia", NZ: "New Zealand",
  DE: "Germany", FR: "France", ES: "Spain", IT: "Italy", PT: "Portugal", NL: "Netherlands",
  JP: "Japan", KR: "South Korea", CN: "China", HK: "Hong Kong", TW: "Taiwan",
  IN: "India", PK: "Pakistan", BD: "Bangladesh",
  AE: "United Arab Emirates", SA: "Saudi Arabia",
  EG: "Egypt", TR: "Turkey", ZA: "South Africa", NG: "Nigeria", KE: "Kenya", GH: "Ghana",
};

// Map ISO currency codes → country names. Used by CRM deposit imports
// where the country is implicit in the payment currency.
const CURRENCY_TO_COUNTRY = {
  THB: "Thailand", IDR: "Indonesia", VND: "Vietnam", PHP: "Philippines",
  MYR: "Malaysia", SGD: "Singapore", KHR: "Cambodia", LAK: "Laos", MMK: "Myanmar",
  BRL: "Brazil", MXN: "Mexico", ARS: "Argentina", CLP: "Chile", COP: "Colombia",
  PEN: "Peru", UYU: "Uruguay", BOB: "Bolivia",
  USD: "United States", CAD: "Canada", GBP: "United Kingdom", EUR: "Multi-country",
  AUD: "Australia", NZD: "New Zealand", JPY: "Japan", KRW: "South Korea",
  CNY: "China", HKD: "Hong Kong", TWD: "Taiwan", INR: "India",
  AED: "United Arab Emirates", SAR: "Saudi Arabia", ZAR: "South Africa",
  TRY: "Turkey", EGP: "Egypt", NGN: "Nigeria",
  USDT: "Multi-country", USDC: "Multi-country",
};

function normalizeGeo(input) {
  if (input == null) return input;
  const trimmed = String(input).trim();
  if (!trimmed) return trimmed;
  const upper = trimmed.toUpperCase();
  if (COUNTRY_NORMALIZE[upper]) return COUNTRY_NORMALIZE[upper];
  return trimmed;
}

// Flag emoji for displayed country names — visual scanability for boss view
const COUNTRY_FLAGS = {
  // SEA
  Thailand: "🇹🇭", Indonesia: "🇮🇩", Vietnam: "🇻🇳", Philippines: "🇵🇭",
  Malaysia: "🇲🇾", Singapore: "🇸🇬", Cambodia: "🇰🇭", Laos: "🇱🇦", Myanmar: "🇲🇲",
  // East/South Asia
  India: "🇮🇳", Japan: "🇯🇵", "South Korea": "🇰🇷", China: "🇨🇳",
  "Hong Kong": "🇭🇰", Taiwan: "🇹🇼", Pakistan: "🇵🇰", Bangladesh: "🇧🇩",
  // LATAM
  Brazil: "🇧🇷", Mexico: "🇲🇽", Argentina: "🇦🇷", Chile: "🇨🇱",
  Colombia: "🇨🇴", Peru: "🇵🇪", Uruguay: "🇺🇾", Paraguay: "🇵🇾",
  Bolivia: "🇧🇴", Ecuador: "🇪🇨", Venezuela: "🇻🇪",
  // Other
  "United States": "🇺🇸", Canada: "🇨🇦", "United Kingdom": "🇬🇧",
  Germany: "🇩🇪", France: "🇫🇷", Spain: "🇪🇸", Italy: "🇮🇹",
  Portugal: "🇵🇹", Netherlands: "🇳🇱", Australia: "🇦🇺", "New Zealand": "🇳🇿",
  "United Arab Emirates": "🇦🇪", "Saudi Arabia": "🇸🇦",
  Egypt: "🇪🇬", Turkey: "🇹🇷", "South Africa": "🇿🇦",
  Nigeria: "🇳🇬", Kenya: "🇰🇪", Ghana: "🇬🇭",
  // Regions
  "Multi-country": "🌍",
};

const flagFor = (geo) => COUNTRY_FLAGS[geo] || "🏳️";

// Reverse lookup: country name → 2-letter ISO code (e.g. "Thailand" → "TH").
// Used to synthesize a fallback Source label for legacy deposit rows that
// were imported before the source field was tracked. Falls back to first
// 2 letters of the country name if no canonical code exists.
const codeForGeo = (geo) => {
  if (!geo) return "??";
  const preferred = { Thailand: "TH", Indonesia: "ID", Vietnam: "VN", Philippines: "PH",
    Malaysia: "MY", Singapore: "SG", Brazil: "BR", Mexico: "MX", Argentina: "AR",
    Chile: "CL", Colombia: "CO", Peru: "PE", India: "IN", Japan: "JP",
    "South Korea": "KR", China: "CN", "Hong Kong": "HK", Taiwan: "TW",
    "United States": "US", Canada: "CA", "United Kingdom": "GB",
    Australia: "AU", "New Zealand": "NZ", "Multi-country": "MULTI" };
  if (preferred[geo]) return preferred[geo];
  // Reverse lookup in COUNTRY_NORMALIZE for any other matches
  for (const [code, name] of Object.entries(COUNTRY_NORMALIZE)) {
    if (name === geo && code.length <= 3) return code;
  }
  return geo.slice(0, 2).toUpperCase();
};

// Display label for a deposit row's source. Returns the actual stored source
// when present, or a synthesized fallback like "TH_*" so legacy rows aren't
// shown as just "—". The asterisk signals "campaign details unknown".
const displaySource = (d) => {
  if (d?.source && String(d.source).trim()) return String(d.source).trim();
  if (d?.geo) return `${codeForGeo(d.geo)}_*`;
  return "";
};

// ===== I18N =====
// English (default) and Simplified Chinese translations.
// Keys are stable English strings; values are the localized output.
// To add another language, add a new key under TRANSLATIONS with the same shape.
const TRANSLATIONS = {
  en: null, // null = use the key verbatim
  zh: {
    // Header & status
    "Daily Performance Dashboard": "每日业绩仪表板",
    "LIVE · META ADS PERFORMANCE": "实时 · META 广告表现",
    "Updated just now": "刚刚更新",
    "Updated": "更新于",
    "Spend incl.": "支出含",
    "tax": "税",
    "Export": "导出",
    "Admin": "管理员",
    "Import": "导入",
    "Bulk delete": "批量删除",
    "Refresh": "刷新",
    "Lock": "锁定",

    // Hero & periods
    "Showing:": "显示：",
    "Today": "今日",
    "Yesterday": "昨日",
    "Last 7d": "近7天",
    "Last 30d": "近30天",
    "MTD": "本月至今",
    "All-time": "全部时间",
    "Today's Spend": "今日支出",
    "Yesterday's Spend": "昨日支出",
    "Last 7 Days": "近7天",
    "Last 30 Days": "近30天",
    "Month to Date": "本月至今",
    "All-time Spend": "累计支出",
    "Daily Target": "每日目标",
    "Period Detail": "时段详情",
    "Impressions": "展示量",
    "Clicks": "点击量",
    "Leads": "线索",
    "Deposits": "入金",
    "CPL": "每线索成本",
    "CPD": "每入金成本",
    "Lead → Dep": "线索→入金",
    "Lead → Dep %": "线索→入金 %",
    "L→D %": "线索→入金 %",
    "Tax incl.": "含税",
    "yesterday": "昨日",
    "vs": "对比",
    "On pace": "进度正常",
    "over": "超出",
    "under": "低于",
    "Not set": "未设置",
    "Set a target in admin settings": "在管理员设置中设定目标",

    // Filters
    "Quick view": "快捷视图",
    "This week": "本周",
    "This month": "本月",
    "Custom": "自定义",
    "Range:": "范围：",
    "Clear range": "清除范围",
    "Filter": "筛选",
    "All accounts": "所有账户",
    "All countries": "所有国家",
    "Reset all": "重置全部",
    "Click to filter": "点击筛选",
    "Click any row to filter": "点击任意行进行筛选",

    // Performance summary
    "Performance Summary": "业绩汇总",
    "All periods at a glance": "一览所有时段",
    "All accounts & countries": "所有账户和国家",
    "Filtered": "已筛选",
    "Filtered to": "筛选至",
    "Period": "时段",
    "Spend": "支出",
    "Last 7 days": "近7天",
    "Last 30 days": "近30天",
    "Month to date": "本月至今",

    // Geo & breakdown
    "Performance by Country": "各国家业绩",
    "Spend, leads, and deposits per market": "各市场支出、线索及入金",
    "By Account": "按账户",
    "Account-level split": "账户层级分布",
    "Country": "国家",
    "Share": "占比",
    "Amount (USD)": "金额（美元）",
    "Amount": "金额",

    // Charts
    "Trend": "趋势",
    "Daily breakdown": "每日明细",

    // Funnel
    "Conversion Funnel": "转化漏斗",
    "Impressions → Clicks → Leads → Deposits": "展示量 → 点击 → 线索 → 入金",
    "of impressions": "占展示量",
    "of clicks": "占点击",
    "of leads": "占线索",

    // Admin & forms
    "Admin Input": "管理员输入",
    "Add daily entries · deposits · settings": "添加每日条目 · 入金 · 设置",
    "Add Campaign Entry": "添加广告条目",
    "Edit Campaign Entry": "编辑广告条目",
    "Per campaign · Spend required, others optional": "每个广告 · 必填支出，其他可选",
    "Bulk import": "批量导入",
    "Date": "日期",
    "Account": "账户",
    "Geo / Country": "国家",
    "Spend (USD)": "支出（美元）",
    "Notes": "备注",
    "Add Entry": "添加条目",
    "Save Changes": "保存更改",
    "Cancel": "取消",
    "Daily Deposits by Country": "各国每日入金",
    "Total deposits per country for the selected date": "所选日期各国总入金",
    "Save Deposits": "保存入金",
    "Daily Target (USD)": "每日目标（美元）",
    "Save": "保存",
    "Tax Rate (applied to all spend)": "税率（应用于所有支出）",

    // Quick add
    "Quick add deposit": "快速添加入金",
    "Select country…": "选择国家…",
    "Count": "数量",
    "USD amount (opt)": "金额美元（可选）",
    "Add": "添加",
    "Saved": "已保存",
    "Pick country & count > 0": "请选国家及大于0的数量",
    "Existing record:": "已有记录：",
    "deposits": "入金",
    "saving will overwrite": "保存将覆盖",

    // Tables
    "Daily Deposits": "每日入金",
    "entries": "条目",
    "No deposit data yet — use the quick-add above to add daily counts.": "暂无入金数据 — 使用上方快速添加。",
    "No deposit data yet.": "暂无入金数据。",
    "No deposits match the current filter.": "当前筛选无匹配入金。",
    "Period total": "时段合计",
    "Campaign Entries": "广告条目",
    "ACCOUNT": "账户",
    "GEO": "国家",
    "SPEND": "支出",
    "IMPR.": "展示",
    "CLICKS": "点击",
    "LEADS": "线索",
    "CTR": "点击率",
    "Click to edit": "点击编辑",
    "Edit": "编辑",
    "Delete": "删除",
    "Save (Enter)": "保存（回车）",
    "Cancel (Esc)": "取消（Esc）",
    "add…": "添加…",

    // Footer
    "Admin mode · Shared with all viewers": "管理员模式 · 与所有查看者共享",
    "Read-only view · Unlock admin to input data": "只读视图 · 解锁管理员以输入数据",
  },
};

const useT = (lang) => {
  return (key) => {
    const dict = TRANSLATIONS[lang];
    if (!dict) return key;
    return dict[key] || key;
  };
};


const formatUSD = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const formatUSDCompact = (n) => {
  if (n == null || isNaN(n)) return "—";
  if (Math.abs(n) >= 1000) return "$" + (n / 1000).toFixed(1) + "k";
  return formatUSD(n);
};
const formatNum = (n) => {
  if (n == null || isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US").format(Math.round(n));
};
const formatNumCompact = (n) => {
  if (n == null || isNaN(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return new Intl.NumberFormat("en-US").format(Math.round(n));
};
const formatPct = (n, digits = 2) => {
  if (n == null || isNaN(n) || !isFinite(n)) return "—";
  return n.toFixed(digits) + "%";
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const daysAgoISO = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};
const formatDate = (iso) => {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
const formatShortDate = (iso) => {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
const timeAgo = (iso, lang = "en") => {
  if (!iso) return lang === "zh" ? "从未" : "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (lang === "zh") {
    if (mins < 1) return "刚刚";
    if (mins < 60) return `${mins} 分钟前`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} 小时前`;
    return `${Math.floor(hrs / 24)} 天前`;
  }
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

function parseDate(str) {
  if (!str || typeof str !== "string") return null;
  const s = str.trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const slash = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (slash) {
    let [, a, b, y] = slash;
    if (y.length === 2) y = "20" + y;
    const aN = parseInt(a, 10), bN = parseInt(b, 10);
    if (aN > 12) return `${y}-${String(bN).padStart(2, "0")}-${String(aN).padStart(2, "0")}`;
    return `${y}-${String(aN).padStart(2, "0")}-${String(bN).padStart(2, "0")}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function parseNumberLoose(v) {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const cleaned = String(v).replace(/[$,\s]/g, "").replace(/%$/, "").trim();
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function autoDetectField(header, patterns = COLUMN_PATTERNS) {
  if (!header) return "skip";
  const h = String(header).trim();
  for (const { field, pattern } of patterns) {
    if (pattern.test(h)) return field;
  }
  return "skip";
}

// Region/multi-country codes for auto-extraction from campaign names like "[LATAM] ..."
const REGION_CODES = {
  LATAM: "Multi-country", SEA: "Multi-country", APAC: "Multi-country",
  EMEA: "Multi-country", EU: "Multi-country", MENA: "Multi-country",
  GLOBAL: "Multi-country", WW: "Multi-country", ROW: "Multi-country",
};

// Try to pull a country code from text like "[TH] Million Dollar..." or "[ID - Test] ..."
// Returns { geo, codeToken } where codeToken is the matched bracket text (e.g. "[TH]" or "[ID - Test]")
function extractGeoFromText(text) {
  if (!text || typeof text !== "string") return null;
  // Find a bracketed block and extract the leading 2-6 letter code from it.
  // Handles: [TH], [ID - Test], [LATAM-2026], [PH V1], etc.
  const bracketContent = text.match(/\[([^\]]+)\]/);
  if (bracketContent) {
    const codeMatch = bracketContent[1].match(/^([A-Za-z]{2,6})\b/);
    if (codeMatch) {
      const code = codeMatch[1].toUpperCase();
      if (COUNTRY_NORMALIZE[code]) {
        return { geo: COUNTRY_NORMALIZE[code], codeToken: bracketContent[0] };
      }
      if (REGION_CODES[code]) {
        return { geo: REGION_CODES[code], codeToken: bracketContent[0] };
      }
    }
  }
  // Fallback: full country name appearing anywhere in text
  const knownGeos = Array.from(new Set(Object.values(COUNTRY_NORMALIZE)));
  for (const geo of knownGeos) {
    const re = new RegExp(`\\b${geo}\\b`, "i");
    if (re.test(text)) return { geo, codeToken: null };
  }
  return null;
}

// Strip the matched "[XX] " token from a campaign name once geo has been extracted
function stripCodeFromName(name, codeToken) {
  if (!codeToken || !name) return name;
  return name.replace(codeToken, "").replace(/^[\s\-_:|]+/, "").trim() || name;
}

const aggregate = (entryList, depositList = [], taxRate = 0) => {
  const totals = entryList.reduce(
    (acc, e) => {
      acc.spend += e.amount || 0;
      acc.impressions += e.impressions || 0;
      acc.clicks += e.clicks || 0;
      acc.leads += e.leads || 0;
      return acc;
    },
    { spend: 0, impressions: 0, clicks: 0, leads: 0, deposits: 0 }
  );
  totals.deposits = depositList.reduce((s, d) => s + (d.count || 0), 0);
  totals.depositAmount = depositList.reduce((s, d) => s + (d.amount || 0), 0);
  // Tax applied to spend before deriving cost-based metrics, so CPL/CPD/CPC reflect true cost
  totals.rawSpend = totals.spend;
  totals.spend = totals.spend * (1 + (taxRate || 0));
  totals.tax = totals.spend - totals.rawSpend;
  totals.ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : null;
  totals.cpc = totals.clicks > 0 ? totals.spend / totals.clicks : null;
  totals.cpm = totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : null;
  totals.cpl = totals.leads > 0 ? totals.spend / totals.leads : null;
  totals.cvr = totals.clicks > 0 ? (totals.leads / totals.clicks) * 100 : null;
  totals.cpd = totals.deposits > 0 ? totals.spend / totals.deposits : null;
  totals.l2d = totals.leads > 0 ? (totals.deposits / totals.leads) * 100 : null;
  return totals;
};

export default function MetaSpendDashboard() {
  const [entries, setEntries] = useState([]);
  const [deposits, setDeposits] = useState([]);
  const [topups, setTopups] = useState([]);
  const [config, setConfig] = useState({ passcode: null, dailyBudget: 0, taxRate: 0.07, lastUpdated: null });
  const [loaded, setLoaded] = useState(false);

  const [isAdmin, setIsAdmin] = useState(false);
  const [showPasscodeModal, setShowPasscodeModal] = useState(false);
  const [passcodeInput, setPasscodeInput] = useState("");
  const [passcodeError, setPasscodeError] = useState("");
  const [isFirstSetup, setIsFirstSetup] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  // Inline editing state for deposit rows
  const [editingDepositId, setEditingDepositId] = useState(null);
  const [editDepCount, setEditDepCount] = useState("");
  const [editDepAmount, setEditDepAmount] = useState("");
  const [editDepSource, setEditDepSource] = useState("");
  const [editDepCrmId, setEditDepCrmId] = useState("");
  const [showAdminPanels, setShowAdminPanels] = useState(false);
  // Hero strip period selector — lets bosses flip the top stat between
  // Today / Yesterday / 7D / 30D / MTD / All-time without affecting filters below.
  const [heroPeriod, setHeroPeriod] = useState("today");
  // Language state — persists across reloads via localStorage.
  // Currently supports "en" (default) and "zh" (Simplified Chinese).
  const [lang, setLang] = useState(() => {
    if (typeof window === "undefined") return "en";
    return localStorage.getItem("dashboard_lang") || "en";
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("dashboard_lang", lang);
      // Update <html lang="..."> so the CJK CSS overrides activate.
      // Browsers map "zh" to all CJK descendants for :lang(zh) matching.
      document.documentElement.setAttribute("lang", lang === "zh" ? "zh" : "en");
    }
  }, [lang]);
  const t = useT(lang);

  // Entry form
  const [date, setDate] = useState(todayISO());
  const [account, setAccount] = useState(DEFAULT_ACCOUNTS[0]);
  const [customAccount, setCustomAccount] = useState("");
  const [geo, setGeo] = useState(COMMON_GEOS[0]);
  const [customGeo, setCustomGeo] = useState("");
  const [amount, setAmount] = useState("");
  const [impressions, setImpressions] = useState("");
  const [clicks, setClicks] = useState("");
  const [leads, setLeads] = useState("");
  const [notes, setNotes] = useState("");
  const [editId, setEditId] = useState(null);

  // Deposit form (multi-row)
  const [depositDate, setDepositDate] = useState(todayISO());
  const [depositCounts, setDepositCounts] = useState({});
  const [depositAmounts, setDepositAmounts] = useState({});
  // Quick-add deposit row (lives at the top of the deposits table — admin only)
  const [qDate, setQDate] = useState(todayISO());
  const [qGeo, setQGeo] = useState("");
  const [qCount, setQCount] = useState("");
  const [qAmount, setQAmount] = useState("");
  const [qSource, setQSource] = useState("");
  const [qCrmId, setQCrmId] = useState("");
  const [qBusy, setQBusy] = useState(false);
  const [qFlash, setQFlash] = useState(null); // { type: 'ok' | 'err', text: string }
  const [activeGeos, setActiveGeos] = useState(["Brazil", "Mexico", "Indonesia", "Thailand"]);
  const [addGeoSelect, setAddGeoSelect] = useState("");

  // Top-up form
  const [topupDate, setTopupDate] = useState(todayISO());
  const [topupAccount, setTopupAccount] = useState(DEFAULT_ACCOUNTS[0]);
  const [topupCustomAccount, setTopupCustomAccount] = useState("");
  const [topupAmount, setTopupAmount] = useState("");
  const [topupNotes, setTopupNotes] = useState("");

  const [budgetInput, setBudgetInput] = useState("");
  const [taxInput, setTaxInput] = useState("7");

  // Filters
  const [rangeFilter, setRangeFilter] = useState("30");
  const [accountFilter, setAccountFilter] = useState("all");
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [geoFilter, setGeoFilter] = useState("all");
  // Custom date range — when set, overrides rangeFilter quick presets
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [showCustomRange, setShowCustomRange] = useState(false);
  // Quick search bar — natural language filter input
  const [quickSearch, setQuickSearch] = useState("");
  const [chartMetric, setChartMetric] = useState("spend");

  const [, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(i);
  }, []);

  const loadAll = async () => {
    try {
      const [e, c, d, t] = await Promise.all([
        storage.get(ENTRIES_KEY, true).catch(() => null),
        storage.get(CONFIG_KEY, true).catch(() => null),
        storage.get(DEPOSITS_KEY, true).catch(() => null),
        storage.get(TOPUPS_KEY, true).catch(() => null),
      ]);
      if (e?.value) setEntries(JSON.parse(e.value));
      if (d?.value) setDeposits(JSON.parse(d.value));
      if (t?.value) setTopups(JSON.parse(t.value));
      if (c?.value) {
        const parsed = JSON.parse(c.value);
        setConfig(parsed);
        setBudgetInput(parsed.dailyBudget ? String(parsed.dailyBudget) : "");
        setTaxInput(parsed.taxRate != null ? String((parsed.taxRate * 100).toFixed(2).replace(/\.?0+$/, "")) : "7");
      }
    } catch (err) {
      // ignore
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => { loadAll(); }, []);

  // Load deposit counts for selected date into form
  useEffect(() => {
    const existing = {};
    deposits
      .filter((d) => d.date === depositDate)
      .forEach((d) => { existing[d.geo] = String(d.count); });
    setDepositCounts(existing);
    // Add any geos that have deposits on this date but aren't in active list
    const newGeos = Object.keys(existing).filter((g) => !activeGeos.includes(g));
    if (newGeos.length) setActiveGeos((prev) => [...prev, ...newGeos]);
  }, [depositDate, deposits.length]);

  const persistEntries = async (next) => {
    const newConfig = { ...config, lastUpdated: new Date().toISOString() };
    setConfig(newConfig);
    try {
      await storage.set(ENTRIES_KEY, JSON.stringify(next), true);
      await storage.set(CONFIG_KEY, JSON.stringify(newConfig), true);
    } catch (err) { console.error(err); }
  };
  const persistDeposits = async (next) => {
    const newConfig = { ...config, lastUpdated: new Date().toISOString() };
    setConfig(newConfig);
    try {
      await storage.set(DEPOSITS_KEY, JSON.stringify(next), true);
      await storage.set(CONFIG_KEY, JSON.stringify(newConfig), true);
    } catch (err) { console.error(err); }
  };
  const persistTopups = async (next) => {
    const newConfig = { ...config, lastUpdated: new Date().toISOString() };
    setConfig(newConfig);
    try {
      await storage.set(TOPUPS_KEY, JSON.stringify(next), true);
      await storage.set(CONFIG_KEY, JSON.stringify(newConfig), true);
    } catch (err) { console.error(err); }
  };
  const persistConfig = async (next) => {
    const newConfig = { ...next, lastUpdated: new Date().toISOString() };
    setConfig(newConfig);
    try { await storage.set(CONFIG_KEY, JSON.stringify(newConfig), true); }
    catch (err) { console.error(err); }
  };

  const openAdminModal = () => {
    setPasscodeInput("");
    setPasscodeError("");
    setIsFirstSetup(!config.passcode);
    setShowPasscodeModal(true);
  };
  const submitPasscode = async () => {
    if (isFirstSetup) {
      if (passcodeInput.length < 4) { setPasscodeError("Use at least 4 characters"); return; }
      await persistConfig({ ...config, passcode: passcodeInput });
      setIsAdmin(true); setShowPasscodeModal(false); setPasscodeInput("");
      return;
    }
    if (passcodeInput === config.passcode) {
      setIsAdmin(true); setShowPasscodeModal(false); setPasscodeInput(""); setPasscodeError("");
    } else {
      setPasscodeError("Incorrect passcode");
    }
  };
  const exitAdmin = () => { setIsAdmin(false); resetEntryForm(); };

  const resetEntryForm = () => {
    setDate(todayISO());
    setAccount(DEFAULT_ACCOUNTS[0]); setCustomAccount("");
    setGeo(COMMON_GEOS[0]); setCustomGeo("");
    setAmount(""); setImpressions(""); setClicks(""); setLeads(""); setNotes("");
    setEditId(null);
  };

  const handleSubmitEntry = async () => {
    const amt = parseFloat(amount);
    if (!date || isNaN(amt) || amt < 0) return;
    const finalAccount = account === "Other" ? customAccount.trim() || "Other" : account;
    const finalGeo = geo === "Other" ? customGeo.trim() || "Other" : geo;
    const parseOpt = (v) => { const n = parseFloat(v); return isNaN(n) || n < 0 ? 0 : n; };
    let next;
    const data = {
      date, account: finalAccount, geo: finalGeo, amount: amt,
      impressions: parseOpt(impressions), clicks: parseOpt(clicks), leads: parseOpt(leads),
      notes: notes.trim(),
    };
    if (editId) {
      next = entries.map((e) => (e.id === editId ? { ...e, ...data } : e));
    } else {
      next = [{
        id: Date.now().toString() + Math.random().toString(36).slice(2, 7),
        ...data, createdAt: new Date().toISOString(),
      }, ...entries];
    }
    setEntries(next);
    await persistEntries(next);
    resetEntryForm();
  };

  const handleEditEntry = (e) => {
    setEditId(e.id);
    setDate(e.date);
    if (DEFAULT_ACCOUNTS.includes(e.account)) { setAccount(e.account); setCustomAccount(""); }
    else { setAccount("Other"); setCustomAccount(e.account); }
    if (COMMON_GEOS.includes(e.geo)) { setGeo(e.geo); setCustomGeo(""); }
    else if (e.geo) { setGeo("Other"); setCustomGeo(e.geo); }
    else { setGeo(COMMON_GEOS[0]); }
    setAmount(String(e.amount || ""));
    setImpressions(e.impressions ? String(e.impressions) : "");
    setClicks(e.clicks ? String(e.clicks) : "");
    setLeads(e.leads ? String(e.leads) : "");
    setNotes(e.notes || "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDeleteEntry = async (id) => {
    const next = entries.filter((e) => e.id !== id);
    setEntries(next);
    await persistEntries(next);
    if (editId === id) resetEntryForm();
  };

  // Deposits
  const handleSaveDeposits = async () => {
    let next = deposits.filter((d) => d.date !== depositDate);
    Object.entries(depositCounts).forEach(([g, c]) => {
      const n = parseFloat(c);
      const amt = parseFloat(depositAmounts[g] || "");
      if (!isNaN(n) && n > 0) {
        next.push({
          id: Date.now().toString() + Math.random().toString(36).slice(2, 7) + g,
          date: depositDate, geo: g, count: n,
          amount: !isNaN(amt) && amt > 0 ? amt : 0,
          createdAt: new Date().toISOString(),
        });
      }
    });
    setDeposits(next);
    await persistDeposits(next);
  };

  // Quick-add a single deposit row without replacing the whole day.
  // If a record exists for that date+geo, it gets replaced (typed value wins).
  const handleQuickAddDeposit = async (date, geo, count, amount, source, crmId) => {
    const n = parseFloat(count);
    const a = parseFloat(amount);
    if (!date || !geo || isNaN(n) || n <= 0) return false;
    const next = deposits.filter((d) => !(d.date === date && d.geo === geo));
    next.push({
      id: Date.now().toString() + Math.random().toString(36).slice(2, 7) + geo,
      date, geo, count: n,
      amount: !isNaN(a) && a > 0 ? a : 0,
      source: (source || "").trim(),
      crmId: (crmId || "").trim(),
      createdAt: new Date().toISOString(),
    });
    setDeposits(next);
    await persistDeposits(next);
    return true;
  };

  const handleDeleteDeposit = async (id) => {
    const next = deposits.filter((d) => d.id !== id);
    setDeposits(next);
    await persistDeposits(next);
  };

  // Update an existing deposit's count, amount, source, and/or crmId inline.
  const handleEditDeposit = async (id, newValues) => {
    const next = deposits.map((d) => {
      if (d.id !== id) return d;
      const updated = { ...d };
      if (newValues.count !== undefined) {
        const n = parseFloat(newValues.count);
        if (!isNaN(n) && n >= 0) updated.count = n;
      }
      if (newValues.amount !== undefined) {
        const a = parseFloat(newValues.amount);
        if (!isNaN(a) && a >= 0) updated.amount = a;
      }
      if (newValues.source !== undefined) {
        updated.source = String(newValues.source).trim();
      }
      if (newValues.crmId !== undefined) {
        updated.crmId = String(newValues.crmId).trim();
      }
      return updated;
    });
    setDeposits(next);
    await persistDeposits(next);
  };

  // Top-up handlers
  const handleAddTopup = async () => {
    const amt = parseFloat(topupAmount);
    if (!topupDate || isNaN(amt) || amt <= 0) return;
    const finalAccount =
      topupAccount === "Other" ? topupCustomAccount.trim() || "Other" : topupAccount;
    const newTopup = {
      id: Date.now().toString() + Math.random().toString(36).slice(2, 7),
      date: topupDate,
      account: finalAccount,
      amount: amt,
      notes: topupNotes.trim(),
      createdAt: new Date().toISOString(),
    };
    const next = [newTopup, ...topups];
    setTopups(next);
    await persistTopups(next);
    setTopupAmount("");
    setTopupNotes("");
  };

  const handleDeleteTopup = async (id) => {
    const next = topups.filter((t) => t.id !== id);
    setTopups(next);
    await persistTopups(next);
  };

  const handleAddGeoToDepositForm = () => {
    if (addGeoSelect && !activeGeos.includes(addGeoSelect)) {
      setActiveGeos([...activeGeos, addGeoSelect]);
    }
    setAddGeoSelect("");
  };

  const handleRemoveGeoFromDepositForm = (g) => {
    setActiveGeos(activeGeos.filter((x) => x !== g));
    const next = { ...depositCounts };
    delete next[g];
    setDepositCounts(next);
  };

  const saveBudget = async () => {
    const v = parseFloat(budgetInput);
    if (isNaN(v) || v < 0) return;
    await persistConfig({ ...config, dailyBudget: v });
  };

  const saveTax = async () => {
    const v = parseFloat(taxInput);
    if (isNaN(v) || v < 0 || v > 100) return;
    await persistConfig({ ...config, taxRate: v / 100 });
  };

  // Bulk import
  const handleBulkImport = async (data, dataType, options = {}) => {
    const { skipDuplicates = true } = options;
    if (dataType === "entries") {
      let toAdd = data.map((e) => ({
        id: Date.now().toString() + Math.random().toString(36).slice(2, 9),
        date: e.date, account: e.account || "Other",
        campaign: e.campaign || "",
        geo: e.geo || "",
        amount: e.amount || 0, impressions: e.impressions || 0,
        clicks: e.clicks || 0, leads: e.leads || 0, notes: e.notes || "",
        createdAt: new Date().toISOString(),
      }));
      if (skipDuplicates) {
        // Dedup by date+account+campaign+geo so the same campaign on the same day
        // for the same country gets replaced rather than duplicated on re-import.
        const existing = new Set(entries.map((e) => `${e.date}__${e.account}__${e.campaign || ""}__${e.geo}`));
        toAdd = toAdd.filter((e) => !existing.has(`${e.date}__${e.account}__${e.campaign || ""}__${e.geo}`));
      }
      const next = [...toAdd, ...entries];
      setEntries(next);
      await persistEntries(next);
      setShowImportModal(false);
      return toAdd.length;
    } else {
      // deposits
      let toAdd = data.map((d) => ({
        id: Date.now().toString() + Math.random().toString(36).slice(2, 9),
        date: d.date, geo: d.geo || "Other", count: d.count || 0,
        amount: d.amount || 0,
        source: d.source || "",
        crmId: d.crmId || "",
        createdAt: new Date().toISOString(),
      }));
      let next = [...deposits];
      if (skipDuplicates) {
        // Replace existing deposits with same date+geo
        toAdd.forEach((d) => {
          next = next.filter((existing) => !(existing.date === d.date && existing.geo === d.geo));
        });
        next = [...toAdd, ...next];
      } else {
        next = [...toAdd, ...next];
      }
      setDeposits(next);
      await persistDeposits(next);
      setShowImportModal(false);
      return toAdd.length;
    }
  };

  // Bulk delete — supports filtered subsets or full wipes for entries/deposits/topups
  const handleBulkDelete = async (mode) => {
    let nextEntries = entries;
    let nextDeposits = deposits;
    let nextTopups = topups;
    let entriesChanged = false;
    let depositsChanged = false;
    let topupsChanged = false;

    if (mode === "filtered_entries") {
      const idsToRemove = new Set(filteredEntries.map((e) => e.id));
      nextEntries = entries.filter((e) => !idsToRemove.has(e.id));
      entriesChanged = true;
    } else if (mode === "filtered_deposits") {
      const idsToRemove = new Set(filteredDeposits.map((d) => d.id));
      nextDeposits = deposits.filter((d) => !idsToRemove.has(d.id));
      depositsChanged = true;
    } else if (mode === "all_entries") {
      nextEntries = [];
      entriesChanged = true;
    } else if (mode === "all_deposits") {
      nextDeposits = [];
      depositsChanged = true;
    } else if (mode === "all_topups") {
      nextTopups = [];
      topupsChanged = true;
    } else if (mode === "everything") {
      nextEntries = [];
      nextDeposits = [];
      nextTopups = [];
      entriesChanged = true;
      depositsChanged = true;
      topupsChanged = true;
    }

    if (entriesChanged) {
      setEntries(nextEntries);
      await persistEntries(nextEntries);
    }
    if (depositsChanged) {
      setDeposits(nextDeposits);
      await persistDeposits(nextDeposits);
    }
    if (topupsChanged) {
      setTopups(nextTopups);
      await persistTopups(nextTopups);
    }
    setShowDeleteModal(false);
  };

  const exportCSV = () => {
    const taxRate = config.taxRate || 0;
    const taxLabel = taxRate > 0 ? ` (incl. ${(taxRate * 100).toFixed(0)}% tax)` : "";
    const header = ["Date", "Account", "Geo", `Spend (USD)${taxLabel}`, "Impressions", "Clicks", "Leads", "CTR (%)", "CPC (USD)", "CPL (USD)", "Notes"];
    const rows = [...entries].sort((a, b) => a.date.localeCompare(b.date)).map((e) => {
      const taxedAmount = e.amount * (1 + taxRate);
      const ctr = e.impressions > 0 ? ((e.clicks || 0) / e.impressions) * 100 : "";
      const cpc = e.clicks > 0 ? taxedAmount / e.clicks : "";
      const cpl = e.leads > 0 ? taxedAmount / e.leads : "";
      return [
        e.date, `"${(e.account || "").replace(/"/g, '""')}"`, `"${(e.geo || "").replace(/"/g, '""')}"`,
        taxedAmount.toFixed(2), e.impressions || 0, e.clicks || 0, e.leads || 0,
        ctr === "" ? "" : ctr.toFixed(2), cpc === "" ? "" : cpc.toFixed(2),
        cpl === "" ? "" : cpl.toFixed(2), `"${(e.notes || "").replace(/"/g, '""')}"`,
      ];
    });
    const depHeader = ["Date", "Geo", "Deposits"];
    const depRows = [...deposits].sort((a, b) => a.date.localeCompare(b.date)).map((d) => [
      d.date, `"${(d.geo || "").replace(/"/g, '""')}"`, d.count,
    ]);
    const csv =
      "# Campaign Entries\n" +
      [header.join(","), ...rows.map((r) => r.join(","))].join("\n") +
      "\n\n# Daily Deposits\n" +
      [depHeader.join(","), ...depRows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `meta-spend-${todayISO()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const allAccounts = useMemo(
    () => Array.from(new Set(entries.map((e) => e.account).filter(Boolean))),
    [entries]
  );
  const allCampaigns = useMemo(
    () => Array.from(new Set(entries.map((e) => e.campaign).filter(Boolean))).sort(),
    [entries]
  );
  const allGeos = useMemo(() => {
    const s = new Set();
    entries.forEach((e) => { if (e.geo) s.add(e.geo); });
    deposits.forEach((d) => { if (d.geo) s.add(d.geo); });
    return Array.from(s);
  }, [entries, deposits]);

  // Filtered campaign entries — respects account + geo + range
  // Active date range — custom range overrides the quick preset when set
  const activeRange = useMemo(() => {
    if (customStart && customEnd) {
      return { start: customStart, end: customEnd, isCustom: true };
    }
    if (rangeFilter === "all") return { start: null, end: null, isCustom: false };
    return { start: daysAgoISO(parseInt(rangeFilter, 10)), end: null, isCustom: false };
  }, [rangeFilter, customStart, customEnd]);

  const inActiveRange = (dateStr) => {
    if (!activeRange.start) return true;
    if (dateStr < activeRange.start) return false;
    if (activeRange.end && dateStr > activeRange.end) return false;
    return true;
  };

  const filteredEntries = useMemo(() => {
    let list = entries.filter((e) => inActiveRange(e.date));
    if (accountFilter !== "all") list = list.filter((e) => e.account === accountFilter);
    if (campaignFilter !== "all") list = list.filter((e) => e.campaign === campaignFilter);
    if (geoFilter !== "all") list = list.filter((e) => e.geo === geoFilter);
    return list.sort((a, b) => b.date.localeCompare(a.date));
  }, [entries, rangeFilter, accountFilter, campaignFilter, geoFilter, customStart, customEnd]);

  // Filtered deposits — respects geo + range only (deposits aren't tied to accounts)
  const filteredDeposits = useMemo(() => {
    let list = deposits.filter((d) => inActiveRange(d.date));
    if (geoFilter !== "all") list = list.filter((d) => d.geo === geoFilter);
    return list.sort((a, b) => b.date.localeCompare(a.date));
  }, [deposits, rangeFilter, geoFilter, customStart, customEnd]);

  // Multi-period summary stats — independent of the date range filter so the
  // summary table can show Today / 7D / 30D / MTD / All-time side by side.
  // Respects account+geo filter for drill-down (e.g. "show all periods for Brazil").
  // Budget tracking — total loaded (top-ups), total spent, remaining.
  // Computed on full data (not filtered by date range) since "remaining" is a
  // current state, not a period total. Account/geo filter does scope it though.
  const budgetStats = useMemo(() => {
    let entriesScoped = entries;
    let topupsScoped = topups;
    if (accountFilter !== "all") {
      entriesScoped = entriesScoped.filter((e) => e.account === accountFilter);
      topupsScoped = topupsScoped.filter((t) => t.account === accountFilter);
    }
    if (geoFilter !== "all") {
      entriesScoped = entriesScoped.filter((e) => e.geo === geoFilter);
    }

    const totalLoaded = topupsScoped.reduce((s, t) => s + (t.amount || 0), 0);
    const totalSpent = entriesScoped.reduce((s, e) => s + (e.amount || 0), 0);
    const remaining = totalLoaded - totalSpent;
    const utilizationPct = totalLoaded > 0 ? (totalSpent / totalLoaded) * 100 : 0;

    // Per-account breakdown
    const accountMap = new Map();
    topupsScoped.forEach((t) => {
      if (!accountMap.has(t.account)) accountMap.set(t.account, { loaded: 0, spent: 0 });
      accountMap.get(t.account).loaded += t.amount || 0;
    });
    entriesScoped.forEach((e) => {
      if (!accountMap.has(e.account)) accountMap.set(e.account, { loaded: 0, spent: 0 });
      accountMap.get(e.account).spent += e.amount || 0;
    });
    const byAccount = Array.from(accountMap.entries())
      .map(([name, data]) => ({
        name,
        loaded: data.loaded,
        spent: data.spent,
        remaining: data.loaded - data.spent,
        utilizationPct: data.loaded > 0 ? (data.spent / data.loaded) * 100 : 0,
      }))
      .sort((a, b) => b.loaded - a.loaded);

    return { totalLoaded, totalSpent, remaining, utilizationPct, byAccount };
  }, [entries, topups, accountFilter, geoFilter]);

  const summaryStats = useMemo(() => {
    let entriesScoped = entries;
    let depositsScoped = deposits;
    if (accountFilter !== "all") {
      entriesScoped = entriesScoped.filter((e) => e.account === accountFilter);
    }
    if (campaignFilter !== "all") {
      entriesScoped = entriesScoped.filter((e) => e.campaign === campaignFilter);
    }
    if (geoFilter !== "all") {
      entriesScoped = entriesScoped.filter((e) => e.geo === geoFilter);
      depositsScoped = depositsScoped.filter((d) => d.geo === geoFilter);
    }

    const today = todayISO();
    const yesterday = daysAgoISO(1);
    const weekAgo = daysAgoISO(7);
    const monthAgo = daysAgoISO(30);
    const monthStart = today.slice(0, 7) + "-01";

    const filterRange = (list, start, end) =>
      list.filter((x) => x.date >= start && (end ? x.date <= end : true));

    return {
      today: aggregate(
        entriesScoped.filter((e) => e.date === today),
        depositsScoped.filter((d) => d.date === today), config.taxRate
      ),
      yesterday: aggregate(
        entriesScoped.filter((e) => e.date === yesterday),
        depositsScoped.filter((d) => d.date === yesterday), config.taxRate
      ),
      last7: aggregate(
        filterRange(entriesScoped, weekAgo),
        filterRange(depositsScoped, weekAgo), config.taxRate
      ),
      last30: aggregate(
        filterRange(entriesScoped, monthAgo),
        filterRange(depositsScoped, monthAgo), config.taxRate
      ),
      mtd: aggregate(
        filterRange(entriesScoped, monthStart),
        filterRange(depositsScoped, monthStart), config.taxRate
      ),
      allTime: aggregate(entriesScoped, depositsScoped, config.taxRate),
    };
  }, [entries, deposits, accountFilter, campaignFilter, geoFilter, config.taxRate]);

  const stats = useMemo(() => {
    const today = todayISO();
    const yesterday = daysAgoISO(1);
    const weekAgo = daysAgoISO(7);
    const twoWeeksAgo = daysAgoISO(14);
    const monthAgo = daysAgoISO(30);

    const todayData = aggregate(
      filteredEntries.filter((e) => e.date === today),
      filteredDeposits.filter((d) => d.date === today), config.taxRate
    );
    const yesterdayData = aggregate(
      filteredEntries.filter((e) => e.date === yesterday),
      filteredDeposits.filter((d) => d.date === yesterday), config.taxRate
    );
    const weekData = aggregate(
      filteredEntries.filter((e) => e.date >= weekAgo),
      filteredDeposits.filter((d) => d.date >= weekAgo), config.taxRate
    );
    const lastWeekData = aggregate(
      filteredEntries.filter((e) => e.date >= twoWeeksAgo && e.date < weekAgo),
      filteredDeposits.filter((d) => d.date >= twoWeeksAgo && d.date < weekAgo), config.taxRate
    );
    const monthData = aggregate(
      filteredEntries.filter((e) => e.date >= monthAgo),
      filteredDeposits.filter((d) => d.date >= monthAgo), config.taxRate
    );
    const total = aggregate(filteredEntries, filteredDeposits, config.taxRate);

    const dod = yesterdayData.spend > 0 ? ((todayData.spend - yesterdayData.spend) / yesterdayData.spend) * 100 : null;
    const wow = lastWeekData.spend > 0 ? ((weekData.spend - lastWeekData.spend) / lastWeekData.spend) * 100 : null;
    const leadsWow = lastWeekData.leads > 0 ? ((weekData.leads - lastWeekData.leads) / lastWeekData.leads) * 100 : null;
    const cplWow = lastWeekData.cpl != null && weekData.cpl != null ? ((weekData.cpl - lastWeekData.cpl) / lastWeekData.cpl) * 100 : null;
    const depositsWow = lastWeekData.deposits > 0 ? ((weekData.deposits - lastWeekData.deposits) / lastWeekData.deposits) * 100 : null;
    const cpdWow = lastWeekData.cpd != null && weekData.cpd != null ? ((weekData.cpd - lastWeekData.cpd) / lastWeekData.cpd) * 100 : null;

    const days = new Set(filteredEntries.map((e) => e.date));
    const avgDaily = days.size > 0 ? total.spend / days.size : 0;

    return { today: todayData, yesterday: yesterdayData, week: weekData, lastWeek: lastWeekData, month: monthData, total, dod, wow, leadsWow, cplWow, depositsWow, cpdWow, avgDaily, activeDays: days.size };
  }, [filteredEntries, filteredDeposits, config.taxRate]);

  const dailySeries = useMemo(() => {
    const days = parseInt(rangeFilter === "all" ? "60" : rangeFilter, 10);
    const map = new Map();
    for (let i = days - 1; i >= 0; i--) {
      map.set(daysAgoISO(i), { spend: 0, impressions: 0, clicks: 0, leads: 0, deposits: 0 });
    }
    filteredEntries.forEach((e) => {
      if (map.has(e.date)) {
        const cur = map.get(e.date);
        cur.spend += e.amount || 0;
        cur.impressions += e.impressions || 0;
        cur.clicks += e.clicks || 0;
        cur.leads += e.leads || 0;
      }
    });
    filteredDeposits.forEach((d) => {
      if (map.has(d.date)) map.get(d.date).deposits += d.count || 0;
    });
    return Array.from(map.entries()).map(([date, d]) => {
      const taxedSpend = d.spend * (1 + (config.taxRate || 0));
      const cpl = d.leads > 0 ? taxedSpend / d.leads : 0;
      const cpd = d.deposits > 0 ? taxedSpend / d.deposits : 0;
      return {
        date, label: formatShortDate(date),
        spend: parseFloat(taxedSpend.toFixed(2)),
        impressions: d.impressions, clicks: d.clicks, leads: d.leads, deposits: d.deposits,
        cpl: parseFloat(cpl.toFixed(2)), cpd: parseFloat(cpd.toFixed(2)),
      };
    });
  }, [filteredEntries, filteredDeposits, rangeFilter, config.taxRate]);

  const byAccount = useMemo(() => {
    const map = new Map();
    filteredEntries.forEach((e) => {
      if (!map.has(e.account)) map.set(e.account, []);
      map.get(e.account).push(e);
    });
    return Array.from(map.entries())
      .map(([name, list]) => ({ name, ...aggregate(list, [], config.taxRate) }))
      .sort((a, b) => b.spend - a.spend);
  }, [filteredEntries, config.taxRate]);

  const byGeo = useMemo(() => {
    const eMap = new Map();
    filteredEntries.forEach((e) => {
      const k = e.geo || "Unspecified";
      if (!eMap.has(k)) eMap.set(k, []);
      eMap.get(k).push(e);
    });
    const dMap = new Map();
    filteredDeposits.forEach((d) => {
      const k = d.geo || "Unspecified";
      if (!dMap.has(k)) dMap.set(k, []);
      dMap.get(k).push(d);
    });
    const allKeys = new Set([...eMap.keys(), ...dMap.keys()]);
    return Array.from(allKeys)
      .map((k) => ({ name: k, ...aggregate(eMap.get(k) || [], dMap.get(k) || [], config.taxRate) }))
      .sort((a, b) => b.spend - a.spend);
  }, [filteredEntries, filteredDeposits, config.taxRate]);

  const accountColors = ["#22d3ee", "#a78bfa", "#f472b6", "#fb923c", "#34d399", "#facc15"];
  const geoColors = ["#34d399", "#22d3ee", "#a78bfa", "#f472b6", "#fb923c", "#facc15", "#60a5fa", "#fb7185"];

  const budgetPct = config.dailyBudget > 0 ? Math.min((stats.today.spend / config.dailyBudget) * 100, 200) : null;
  const budgetStatus = budgetPct == null ? null : budgetPct < 80 ? "under" : budgetPct <= 110 ? "on" : "over";

  const chartMetricMeta = {
    spend: { label: "Spend", color: "#22d3ee", format: formatUSD },
    deposits: { label: "Deposits", color: "#fbbf24", format: formatNum },
    leads: { label: "Leads", color: "#34d399", format: formatNum },
    cpd: { label: "CPD", color: "#fb923c", format: formatUSD },
    cpl: { label: "CPL", color: "#f472b6", format: formatUSD },
    clicks: { label: "Clicks", color: "#a78bfa", format: formatNum },
    impressions: { label: "Impressions", color: "#60a5fa", format: formatNum },
  };

  return (
    <div className="min-h-screen text-slate-100 p-4 md:p-8" style={{ background: "radial-gradient(1200px 600px at 10% -10%, rgba(34,211,238,0.08), transparent 60%), radial-gradient(900px 500px at 100% 0%, rgba(167,139,250,0.06), transparent 60%), #0a0e1a", fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap');
        .font-display { font-family: 'Manrope', ui-sans-serif, system-ui, sans-serif; letter-spacing: -0.02em; }
        .font-mono-num { font-family: 'JetBrains Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }
        .glass { background: rgba(15, 23, 42, 0.55); backdrop-filter: blur(12px); border: 1px solid rgba(148,163,184,0.10); }
        .glass-hover:hover { border-color: rgba(148,163,184,0.22); }
        input, select, textarea { color-scheme: dark; }
        ::placeholder { color: rgb(100 116 139); }
        @keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        .pulse-dot { animation: pulse-dot 2s ease-in-out infinite; }
        .scroll-x::-webkit-scrollbar { height: 6px; }
        .scroll-x::-webkit-scrollbar-thumb { background: rgba(148,163,184,0.2); border-radius: 3px; }
        .input-base { width: 100%; padding: 0.625rem 0.75rem; border-radius: 0.5rem; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(51, 65, 85, 0.5); color: rgb(241, 245, 249); font-size: 0.875rem; outline: none; transition: all 0.15s; }
        .input-base:focus { border-color: rgba(34, 211, 238, 0.5); box-shadow: 0 0 0 1px rgba(34, 211, 238, 0.3); }
      `}</style>

      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-cyan-400/80 mb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-dot"></span>
              {t("LIVE · META ADS PERFORMANCE")}
            </div>
            <h1 className="font-display text-3xl md:text-5xl font-extrabold text-white">{t("Daily Performance Dashboard")}</h1>
            <p className="text-slate-400 mt-2 text-sm flex items-center gap-3 flex-wrap">
              <span>{new Date().toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-500">{t("Updated")} {timeAgo(config.lastUpdated, lang)}</span>
              {(config.taxRate || 0) > 0 && (
                <>
                  <span className="text-slate-600">·</span>
                  <span className="text-amber-400/80">
                    {t("Spend incl.")} {((config.taxRate || 0) * 100).toFixed(0)}% {t("tax")}
                  </span>
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Language switcher — pill toggle EN | 中文 */}
            <div className="flex items-center gap-0.5 p-0.5 rounded-lg glass">
              <button
                onClick={() => setLang("en")}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  lang === "en" ? "bg-cyan-500/25 text-cyan-200" : "text-slate-500 hover:text-slate-200"
                }`}
                title="English"
              >EN</button>
              <button
                onClick={() => setLang("zh")}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  lang === "zh" ? "bg-cyan-500/25 text-cyan-200" : "text-slate-500 hover:text-slate-200"
                }`}
                title="简体中文"
              >中文</button>
            </div>
            <button onClick={loadAll} className="flex items-center gap-2 px-3 py-2.5 rounded-lg glass glass-hover text-sm text-slate-300" title={t("Refresh")}><RefreshCw className="w-4 h-4" /></button>
            <button onClick={exportCSV} disabled={entries.length === 0 && deposits.length === 0} className="flex items-center gap-2 px-4 py-2.5 rounded-lg glass glass-hover text-sm text-slate-200 disabled:opacity-40">
              <Download className="w-4 h-4" /><span className="hidden md:inline">{t("Export")}</span>
            </button>
            {isAdmin && (
              <button onClick={() => setShowImportModal(true)} className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-violet-500/20 border border-violet-500/40 text-violet-300 text-sm font-medium hover:bg-violet-500/30">
                <Upload className="w-4 h-4" /><span className="hidden md:inline">{t("Import")}</span>
              </button>
            )}
            {isAdmin && (
              <button onClick={() => setShowDeleteModal(true)} className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-pink-500/15 border border-pink-500/30 text-pink-300 text-sm font-medium hover:bg-pink-500/25">
                <Trash2 className="w-4 h-4" /><span className="hidden md:inline">{t("Bulk delete")}</span>
              </button>
            )}
            {isAdmin ? (
              <button onClick={exitAdmin} className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-sm font-medium hover:bg-cyan-500/30">
                <LogOut className="w-4 h-4" /><span className="hidden md:inline">{lang === "zh" ? "退出管理员" : "Exit Admin"}</span>
              </button>
            ) : (
              <button onClick={openAdminModal} className="flex items-center gap-2 px-4 py-2.5 rounded-lg glass glass-hover text-sm text-slate-300">
                <Lock className="w-4 h-4" /><span className="hidden md:inline">{t("Admin")}</span>
              </button>
            )}
          </div>
        </header>

        {/* Hero — switchable period (Today / Yesterday / 7D / 30D / MTD / All-time).
            Bosses pick what they want to see at the top without changing filters below. */}
        {(() => {
          // Map heroPeriod key to the right summaryStats bucket + display labels
          const periodMap = {
            today: { label: t("Today's Spend"), data: summaryStats.today, compareLabel: `vs ${formatUSD(summaryStats.yesterday.spend)} yesterday` },
            yesterday: { label: t("Yesterday's Spend"), data: summaryStats.yesterday, compareLabel: null },
            last7: { label: t("Last 7 Days"), data: summaryStats.last7, compareLabel: null },
            last30: { label: t("Last 30 Days"), data: summaryStats.last30, compareLabel: null },
            mtd: { label: t("Month to Date"), data: summaryStats.mtd, compareLabel: null },
            allTime: { label: t("All-time Spend"), data: summaryStats.allTime, compareLabel: null },
          };
          const active = periodMap[heroPeriod] || periodMap.today;
          const showDayCompare = heroPeriod === "today";
          // Daily target pacing only makes sense for "today" bucket
          const showTargetPacing = heroPeriod === "today" && config.dailyBudget > 0;

          return (
            <div className="glass rounded-2xl mb-6 relative overflow-hidden">
              <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(34,211,238,0.18), transparent 70%)" }} />
              <div className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(167,139,250,0.10), transparent 70%)" }} />

              {/* Period switcher tabs */}
              <div className="relative px-5 md:px-6 pt-4 pb-0 flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mr-2">{t("Showing:")}</span>
                {[
                  { key: "today", label: t("Today") },
                  { key: "yesterday", label: t("Yesterday") },
                  { key: "last7", label: t("Last 7d") },
                  { key: "last30", label: t("Last 30d") },
                  { key: "mtd", label: t("MTD") },
                  { key: "allTime", label: t("All-time") },
                ].map((p) => (
                  <button
                    key={p.key}
                    onClick={() => setHeroPeriod(p.key)}
                    className={`px-3 py-1 rounded-md text-[11px] font-medium transition-all ${
                      heroPeriod === p.key
                        ? "bg-cyan-500/20 text-cyan-300 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.4)]"
                        : "text-slate-500 hover:text-slate-200 hover:bg-slate-800/40"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div className="relative grid grid-cols-1 lg:grid-cols-12 gap-0">
                {/* Hero spend */}
                <div className="lg:col-span-4 p-6 md:p-7 lg:border-r lg:border-slate-800/60">
                  <div className="text-[10px] uppercase tracking-[0.25em] text-cyan-400/80 mb-2 flex items-center gap-1.5">
                    <Activity className="w-3 h-3" /> {active.label}
                  </div>
                  <div className="font-mono-num text-3xl sm:text-4xl md:text-5xl lg:text-5xl xl:text-6xl font-extrabold text-white leading-none mb-3 truncate">
                    {formatUSD(active.data.spend)}
                  </div>
                  {showDayCompare ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      {stats.dod !== null && !isNaN(stats.dod) ? (
                        <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${stats.dod >= 0 ? "bg-emerald-500/15 text-emerald-300" : "bg-pink-500/15 text-pink-300"}`}>
                          {stats.dod >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          <span className="font-mono-num">{stats.dod >= 0 ? "+" : ""}{stats.dod.toFixed(1)}%</span>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-600">—</span>
                      )}
                      <span className="text-[11px] text-slate-500 font-mono-num">{active.compareLabel}</span>
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-500 font-mono-num">
                      {active.data.tax > 0 && `Incl. ${formatUSDCompact(active.data.tax)} tax`}
                    </div>
                  )}
                </div>

                {/* Secondary metrics — 5 columns to give Deposit Amount its own tile */}
                <div className="lg:col-span-5 grid grid-cols-2 lg:grid-cols-5 border-t lg:border-t-0 border-slate-800/60">
                  <HeroStat label={t("Leads")} value={formatNumCompact(active.data.leads)} icon={<Users className="w-3 h-3" />} accent="emerald" />
                  <HeroStat label={t("Deposits")} value={formatNumCompact(active.data.deposits)} icon={<Banknote className="w-3 h-3" />} accent="amber" />
                  <HeroStat
                    label="Dep $"
                    value={active.data.depositAmount > 0 ? formatUSDCompact(active.data.depositAmount) : "—"}
                    sublabel={active.data.deposits > 0 && active.data.depositAmount > 0 ? `avg ${formatUSDCompact(active.data.depositAmount / active.data.deposits)}` : null}
                    icon={<DollarSign className="w-3 h-3" />}
                    accent="emerald"
                  />
                  <HeroStat label={t("CPL")} value={active.data.cpl != null ? formatUSDCompact(active.data.cpl) : "—"} icon={<Target className="w-3 h-3" />} accent="violet" />
                  <HeroStat label={t("CPD")} value={active.data.cpd != null ? formatUSDCompact(active.data.cpd) : "—"} icon={<Wallet className="w-3 h-3" />} accent="cyan" />
                </div>

                {/* Right column: Daily target (today) OR period-specific extra info */}
                <div className="lg:col-span-3 p-6 md:p-7 border-t lg:border-t-0 lg:border-l border-slate-800/60">
                  {showTargetPacing ? (
                    <>
                      <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-2 flex items-center gap-1.5">
                        <Target className="w-3 h-3" /> {t("Daily Target")}
                      </div>
                      <div className="flex items-baseline gap-2 mb-2">
                        <span className="font-mono-num text-xl font-bold text-white">{formatUSDCompact(active.data.spend)}</span>
                        <span className="text-slate-500 font-mono-num text-xs">/ {formatUSDCompact(config.dailyBudget)}</span>
                      </div>
                      <div className="h-1.5 bg-slate-800/60 rounded-full overflow-hidden mb-2">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{
                            width: `${Math.min(budgetPct, 100)}%`,
                            background: budgetStatus === "over" ? "#f472b6" : budgetStatus === "on" ? "#facc15" : "#22d3ee",
                            boxShadow: `0 0 12px ${budgetStatus === "over" ? "#f472b680" : budgetStatus === "on" ? "#facc1580" : "#22d3ee80"}`,
                          }}
                        />
                      </div>
                      <div className={`text-[11px] font-medium flex items-center gap-1 ${budgetStatus === "over" ? "text-pink-400" : budgetStatus === "on" ? "text-amber-400" : "text-cyan-400"}`}>
                        <span className="w-1 h-1 rounded-full" style={{ background: "currentColor" }} />
                        {budgetStatus === "over" ? `${(budgetPct - 100).toFixed(0)}% over` : budgetStatus === "on" ? "On pace" : `${(100 - budgetPct).toFixed(0)}% under`}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-2 flex items-center gap-1.5">
                        <Activity className="w-3 h-3" /> {t("Period Detail")}
                      </div>
                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between">
                          <span className="text-slate-500">{t("Impressions")}</span>
                          <span className="font-mono-num text-slate-200">{active.data.impressions ? formatNumCompact(active.data.impressions) : "—"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">{t("Clicks")}</span>
                          <span className="font-mono-num text-slate-200">{active.data.clicks ? formatNumCompact(active.data.clicks) : "—"}</span>
                        </div>
                        {active.data.l2d != null && (
                          <div className="flex justify-between">
                            <span className="text-slate-500">{t("Lead → Dep")}</span>
                            <span className="font-mono-num text-slate-200">{formatPct(active.data.l2d)}</span>
                          </div>
                        )}
                        {active.data.tax > 0 && (
                          <div className="flex justify-between border-t border-slate-800/60 pt-1.5 mt-1.5">
                            <span className="text-slate-500">{t("Tax incl.")}</span>
                            <span className="font-mono-num text-amber-300">{formatUSDCompact(active.data.tax)}</span>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Performance Summary — multi-period numbers at a glance */}
        <div className="glass rounded-2xl overflow-hidden mb-8">
          <div className="px-5 md:px-6 py-4 border-b border-slate-800/60 flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="font-display text-lg font-bold text-white">{t("Performance Summary")}</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                All periods at a glance
                {accountFilter !== "all" || geoFilter !== "all"
                  ? ` · Filtered${accountFilter !== "all" ? ` to ${accountFilter}` : ""}${geoFilter !== "all" ? ` · ${geoFilter}` : ""}`
                  : " · All accounts & countries"}
              </p>
            </div>
          </div>
          <div className="overflow-x-auto scroll-x">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.15em] text-slate-500 border-b border-slate-800/60">
                  <th className="text-left px-4 py-3 font-medium">Period</th>
                  <th className="text-right px-4 py-3 font-medium">Spend</th>
                  <th className="text-right px-4 py-3 font-medium">Impressions</th>
                  <th className="text-right px-4 py-3 font-medium">Clicks</th>
                  <th className="text-right px-4 py-3 font-medium">Leads</th>
                  <th className="text-right px-4 py-3 font-medium">Deposits</th>
                  <th className="text-right px-4 py-3 font-medium">Dep $</th>
                  <th className="text-right px-4 py-3 font-medium">CPL</th>
                  <th className="text-right px-4 py-3 font-medium">CPD</th>
                  <th className="text-right px-4 py-3 font-medium">L→D %</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: t("Today"), data: summaryStats.today },
                  { label: t("Yesterday"), data: summaryStats.yesterday },
                  { label: t("Last 7 days"), data: summaryStats.last7 },
                  { label: t("Last 30 days"), data: summaryStats.last30 },
                  { label: t("Month to date"), data: summaryStats.mtd },
                  { label: t("All-time"), data: summaryStats.allTime, emphasize: true },
                ].map((row) => (
                  <tr
                    key={row.label}
                    className={
                      row.emphasize
                        ? "bg-cyan-500/5 border-t-2 border-cyan-500/30"
                        : "border-b border-slate-800/40 hover:bg-slate-800/20"
                    }
                  >
                    <td className={`px-4 py-3 ${row.emphasize ? "text-cyan-300 font-bold" : "text-slate-200 font-medium"}`}>
                      {row.label}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono-num font-semibold ${row.emphasize ? "text-cyan-300" : "text-slate-100"}`}>
                      {formatUSD(row.data.spend)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono-num text-slate-300 text-xs">
                      {row.data.impressions ? formatNumCompact(row.data.impressions) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono-num text-slate-300 text-xs">
                      {row.data.clicks ? formatNumCompact(row.data.clicks) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono-num text-emerald-300 font-semibold">
                      {row.data.leads ? formatNumCompact(row.data.leads) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono-num text-amber-300 font-semibold">
                      {row.data.deposits ? formatNumCompact(row.data.deposits) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono-num text-emerald-300 font-semibold">
                      {row.data.depositAmount > 0 ? formatUSDCompact(row.data.depositAmount) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono-num text-slate-300 text-xs">
                      {row.data.cpl != null ? formatUSDCompact(row.data.cpl) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono-num text-slate-300 text-xs">
                      {row.data.cpd != null ? formatUSDCompact(row.data.cpd) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono-num text-slate-400 text-xs">
                      {formatPct(row.data.l2d)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Budget Status — top-ups vs spend, remaining */}
        {(topups.length > 0 || entries.length > 0) && (
          <div className="glass rounded-2xl p-5 md:p-6 mb-8">
            <div className="flex items-center gap-2 mb-1">
              <Wallet className="w-4 h-4 text-emerald-400" />
              <h2 className="font-display text-lg font-bold text-white">Budget Status</h2>
            </div>
            <p className="text-xs text-slate-500 mb-5">
              Total loaded vs spent across all time
              {accountFilter !== "all" || geoFilter !== "all"
                ? ` · Filtered${accountFilter !== "all" ? ` to ${accountFilter}` : ""}${geoFilter !== "all" ? ` · ${geoFilter}` : ""}`
                : ""}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 mb-5">
              <div className="border-l-2 border-emerald-500/40 pl-3 sm:border-l-0 sm:pl-0">
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-1.5">Loaded</div>
                <div className="font-mono-num text-2xl md:text-3xl font-bold text-emerald-300">
                  {formatUSD(budgetStats.totalLoaded)}
                </div>
              </div>
              <div className="border-l-2 border-cyan-500/40 pl-3 sm:border-l-0 sm:pl-0">
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-1.5">Spent</div>
                <div className="font-mono-num text-2xl md:text-3xl font-bold text-cyan-300">
                  {formatUSD(budgetStats.totalSpent)}
                </div>
              </div>
              <div className={`border-l-2 pl-3 sm:border-l-0 sm:pl-0 ${
                budgetStats.remaining < 0 ? "border-pink-500/40"
                : budgetStats.utilizationPct > 80 ? "border-amber-500/40"
                : "border-slate-500/40"
              }`}>
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-1.5">Remaining</div>
                <div
                  className={`font-mono-num text-2xl md:text-3xl font-bold ${
                    budgetStats.remaining < 0
                      ? "text-pink-400"
                      : budgetStats.utilizationPct > 80
                      ? "text-amber-300"
                      : "text-white"
                  }`}
                >
                  {formatUSD(budgetStats.remaining)}
                </div>
              </div>
            </div>

            {budgetStats.totalLoaded > 0 && (
              <>
                <div className="h-2 bg-slate-800/60 rounded-full overflow-hidden mb-1.5">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(budgetStats.utilizationPct, 100)}%`,
                      background:
                        budgetStats.utilizationPct > 100
                          ? "#f472b6"
                          : budgetStats.utilizationPct > 80
                          ? "#fbbf24"
                          : "#22d3ee",
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs mb-5">
                  <span className="text-slate-500">{budgetStats.utilizationPct.toFixed(1)}% used</span>
                  {budgetStats.remaining < 0 && (
                    <span className="text-pink-400 font-medium">⚠ Spent more than loaded</span>
                  )}
                  {budgetStats.remaining >= 0 && budgetStats.utilizationPct > 80 && (
                    <span className="text-amber-400 font-medium">⚠ Top-up soon — under 20% left</span>
                  )}
                </div>
              </>
            )}

            {budgetStats.byAccount.length > 0 && (
              <div className="pt-4 border-t border-slate-800/60">
                <div className="text-xs uppercase tracking-wider text-slate-500 mb-3">By Account</div>
                <div className="overflow-x-auto scroll-x">
                  <table className="w-full text-sm min-w-[600px]">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800/60">
                        <th className="text-left px-3 py-2 font-medium">Account</th>
                        <th className="text-right px-3 py-2 font-medium">Loaded</th>
                        <th className="text-right px-3 py-2 font-medium">Spent</th>
                        <th className="text-right px-3 py-2 font-medium">Remaining</th>
                        <th className="text-right px-3 py-2 font-medium">Used</th>
                      </tr>
                    </thead>
                    <tbody>
                      {budgetStats.byAccount.map((a) => (
                        <tr key={a.name} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                          <td className="px-3 py-2.5 text-slate-200 text-sm">{a.name}</td>
                          <td className="px-3 py-2.5 text-right font-mono-num text-emerald-300 text-xs">
                            {a.loaded > 0 ? formatUSD(a.loaded) : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono-num text-cyan-300 text-xs">
                            {formatUSD(a.spent)}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-right font-mono-num text-xs font-semibold ${
                              a.remaining < 0
                                ? "text-pink-400"
                                : a.utilizationPct > 80
                                ? "text-amber-300"
                                : "text-white"
                            }`}
                          >
                            {a.loaded > 0 ? formatUSD(a.remaining) : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            {a.loaded > 0 ? (
                              <div className="inline-flex items-center gap-2 justify-end w-full">
                                <div className="w-12 h-1 bg-slate-800 rounded-full overflow-hidden">
                                  <div
                                    className="h-full rounded-full"
                                    style={{
                                      width: `${Math.min(a.utilizationPct, 100)}%`,
                                      background:
                                        a.utilizationPct > 100
                                          ? "#f472b6"
                                          : a.utilizationPct > 80
                                          ? "#fbbf24"
                                          : "#22d3ee",
                                    }}
                                  />
                                </div>
                                <span className="font-mono-num text-slate-400 text-xs">
                                  {a.utilizationPct.toFixed(0)}%
                                </span>
                              </div>
                            ) : (
                              <span className="text-slate-600 text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Filters — sticky on scroll, designed for non-technical viewers
            to drill into data with one click. Includes view presets, custom
            date range picker, active-filter chips, and a quick search box. */}
        <div className="sticky top-0 z-30 -mx-4 md:-mx-8 px-4 md:px-8 py-3 mb-5 backdrop-blur-xl bg-[#0a0e1a]/85 border-y border-slate-800/40 shadow-lg shadow-black/20">
          <div className="max-w-7xl mx-auto space-y-2.5">

            {/* Row 1: View presets — one-click answers to common questions */}
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-slate-500 mr-1 shrink-0">
                <Sparkles className="w-3 h-3" /> {t("Quick view")}
              </div>
              {[
                { label: t("Today"), onClick: () => { setRangeFilter("1"); setCustomStart(""); setCustomEnd(""); setAccountFilter("all"); setGeoFilter("all"); }, active: rangeFilter === "1" && !customStart && accountFilter === "all" && geoFilter === "all" },
                { label: t("Yesterday"), onClick: () => { const y = daysAgoISO(1); setCustomStart(y); setCustomEnd(y); setAccountFilter("all"); setGeoFilter("all"); }, active: customStart === daysAgoISO(1) && customEnd === daysAgoISO(1) },
                { label: t("This week"), onClick: () => { setRangeFilter("7"); setCustomStart(""); setCustomEnd(""); }, active: rangeFilter === "7" && !customStart },
                { label: t("This month"), onClick: () => { const monthStart = todayISO().slice(0, 7) + "-01"; setCustomStart(monthStart); setCustomEnd(todayISO()); }, active: customStart === (todayISO().slice(0, 7) + "-01") && customEnd === todayISO() },
                { label: t("Last 30d"), onClick: () => { setRangeFilter("30"); setCustomStart(""); setCustomEnd(""); }, active: rangeFilter === "30" && !customStart },
                { label: t("All time"), onClick: () => { setRangeFilter("all"); setCustomStart(""); setCustomEnd(""); }, active: rangeFilter === "all" && !customStart },
              ].map((preset) => (
                <button
                  key={preset.label}
                  onClick={preset.onClick}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all whitespace-nowrap ${
                    preset.active
                      ? "bg-cyan-500/20 text-cyan-300 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.4)]"
                      : "bg-slate-900/40 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
              <button
                onClick={() => setShowCustomRange(!showCustomRange)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all whitespace-nowrap flex items-center gap-1 ${
                  showCustomRange || (customStart && customEnd)
                    ? "bg-violet-500/20 text-violet-300 shadow-[inset_0_0_0_1px_rgba(167,139,250,0.4)]"
                    : "bg-slate-900/40 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                }`}
              >
                <Calendar className="w-3 h-3" /> {t("Custom")}
              </button>
            </div>

            {/* Custom date range picker — collapsible */}
            {showCustomRange && (
              <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-lg bg-violet-500/5 border border-violet-500/20">
                <span className="text-[10px] uppercase tracking-[0.2em] text-violet-400 mr-1">Range:</span>
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="px-2.5 py-1 rounded-md text-xs bg-slate-900/60 border border-slate-800/60 text-slate-200 focus:border-violet-500/50 outline-none"
                />
                <span className="text-slate-500 text-xs">→</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="px-2.5 py-1 rounded-md text-xs bg-slate-900/60 border border-slate-800/60 text-slate-200 focus:border-violet-500/50 outline-none"
                />
                {(customStart || customEnd) && (
                  <button
                    onClick={() => { setCustomStart(""); setCustomEnd(""); }}
                    className="text-[11px] text-slate-500 hover:text-slate-200 px-2"
                  >{t("Clear range")}</button>
                )}
              </div>
            )}

            {/* Row 2: Account + Country dropdowns + active filter chips */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-slate-500 mr-1 shrink-0">
                <Filter className="w-3 h-3" /> {t("Filter")}
              </div>
              {allAccounts.length > 0 && (
                <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} className="px-3 py-1.5 rounded-md text-xs bg-slate-900/60 border border-slate-800/60 text-slate-200 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 outline-none transition-colors">
                  <option value="all">{t("All accounts")}</option>
                  {allAccounts.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              )}
              {allCampaigns.length > 0 && (
                <select
                  value={campaignFilter}
                  onChange={(e) => setCampaignFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-md text-xs bg-slate-900/60 border border-slate-800/60 text-slate-200 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 outline-none transition-colors max-w-[260px]"
                  title={campaignFilter !== "all" ? campaignFilter : "All campaigns"}
                >
                  <option value="all">{t("All campaigns")}</option>
                  {allCampaigns.map((c) => <option key={c} value={c}>{c.length > 50 ? c.slice(0, 50) + "…" : c}</option>)}
                </select>
              )}
              {allGeos.length > 0 && (
                <select value={geoFilter} onChange={(e) => setGeoFilter(e.target.value)} className="px-3 py-1.5 rounded-md text-xs bg-slate-900/60 border border-slate-800/60 text-slate-200 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 outline-none transition-colors">
                  <option value="all">{t("All countries")}</option>
                  {allGeos.map((g) => <option key={g} value={g}>{flagFor(g)} {g}</option>)}
                </select>
              )}

              {/* Active filter chips — visual confirmation of what's applied */}
              <div className="flex flex-wrap items-center gap-1.5 ml-1">
                {accountFilter !== "all" && (
                  <FilterChip label={accountFilter} onClear={() => setAccountFilter("all")} color="cyan" />
                )}
                {campaignFilter !== "all" && (
                  <FilterChip label={campaignFilter} onClear={() => setCampaignFilter("all")} color="violet" />
                )}
                {geoFilter !== "all" && (
                  <FilterChip label={`${flagFor(geoFilter)} ${geoFilter}`} onClear={() => setGeoFilter("all")} color="emerald" />
                )}
                {customStart && customEnd && (
                  <FilterChip
                    label={customStart === customEnd ? `📅 ${formatShortDate(customStart)}` : `📅 ${formatShortDate(customStart)} → ${formatShortDate(customEnd)}`}
                    onClear={() => { setCustomStart(""); setCustomEnd(""); }}
                    color="violet"
                  />
                )}
              </div>

              {(accountFilter !== "all" || campaignFilter !== "all" || geoFilter !== "all" || rangeFilter !== "30" || customStart || customEnd) && (
                <button
                  onClick={() => { setAccountFilter("all"); setCampaignFilter("all"); setGeoFilter("all"); setRangeFilter("30"); setCustomStart(""); setCustomEnd(""); }}
                  className="ml-auto px-2.5 py-1.5 rounded-md text-[11px] text-slate-500 hover:text-pink-300 hover:bg-pink-500/10 transition-colors flex items-center gap-1"
                  title="Reset everything"
                >
                  <X className="w-3 h-3" /> {t("Reset all")}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Chart */}
        <div className="glass rounded-2xl p-4 md:p-6 mb-6">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div>
              <h2 className="font-display text-lg font-bold text-white">Daily {chartMetricMeta[chartMetric].label} Trend</h2>
              <p className="text-xs text-slate-500 mt-0.5">{rangeFilter === "all" ? "Last 60 days" : `Last ${rangeFilter} days`}</p>
            </div>
            <div className="flex gap-1 bg-slate-900/60 rounded-lg p-1 flex-wrap">
              {Object.entries(chartMetricMeta).map(([key, m]) => (
                <button key={key} onClick={() => setChartMetric(key)} className={`px-2.5 py-1 rounded text-xs font-medium ${chartMetric === key ? "bg-slate-800 text-white" : "text-slate-500 hover:text-slate-300"}`}>{m.label}</button>
              ))}
            </div>
          </div>
          <div className="h-64 md:h-72 -ml-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailySeries}>
                <defs>
                  <linearGradient id="metricGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartMetricMeta[chartMetric].color} stopOpacity={0.5} />
                    <stop offset="100%" stopColor={chartMetricMeta[chartMetric].color} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.08)" />
                <XAxis dataKey="label" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={30} />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false}
                  tickFormatter={(v) => {
                    if (chartMetric === "spend" || chartMetric === "cpl" || chartMetric === "cpd") return v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`;
                    return formatNumCompact(v);
                  }}
                />
                <Tooltip contentStyle={{ background: "rgba(15,23,42,0.95)", border: "1px solid rgba(148,163,184,0.2)", borderRadius: "8px", fontSize: "12px" }} labelStyle={{ color: "#cbd5e1" }} formatter={(v) => [chartMetricMeta[chartMetric].format(v), chartMetricMeta[chartMetric].label]} />
                <Area type="monotone" dataKey={chartMetric} stroke={chartMetricMeta[chartMetric].color} strokeWidth={2} fill="url(#metricGrad)" />
                {chartMetric === "spend" && config.dailyBudget > 0 && (
                  <ReferenceLine
                    y={config.dailyBudget}
                    stroke="#facc15"
                    strokeDasharray="4 4"
                    strokeOpacity={0.6}
                    label={{
                      value: `Target ${formatUSDCompact(config.dailyBudget)}`,
                      position: "insideTopRight",
                      fill: "#facc15",
                      fontSize: 10,
                      fontFamily: "JetBrains Mono, monospace",
                    }}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Funnel */}
        {(stats.total.impressions > 0 || stats.total.clicks > 0 || stats.total.leads > 0 || stats.total.deposits > 0) && (
          <div className="glass rounded-2xl p-5 md:p-6 mb-6">
            <h2 className="font-display text-lg font-bold text-white mb-1">Conversion Funnel</h2>
            <p className="text-xs text-slate-500 mb-5">{rangeFilter === "all" ? "All-time totals" : `Last ${rangeFilter} days`}</p>
            <Funnel impressions={stats.total.impressions} clicks={stats.total.clicks} leads={stats.total.leads} deposits={stats.total.deposits} ctr={stats.total.ctr} cvr={stats.total.cvr} l2d={stats.total.l2d} />
          </div>
        )}

        {/* By Geo (full width — most important breakdown) */}
        <div className="glass rounded-2xl p-5 md:p-6 mb-6">
          <div className="flex items-center gap-2 mb-1">
            <Globe className="w-4 h-4 text-emerald-400" />
            <h2 className="font-display text-lg font-bold text-white">{t("Performance by Country")}</h2>
          </div>
          <p className="text-xs text-slate-500 mb-4 flex items-center gap-1.5">
            Spend, leads, and deposits per market
            <span className="hidden sm:inline text-slate-600">·</span>
            <span className="hidden sm:inline text-cyan-400/70">💡 Click any row to filter</span>
          </p>
          {byGeo.length === 0 ? (
            <p className="text-sm text-slate-500 py-8 text-center">No geo data yet</p>
          ) : (
            <GeoTable
              items={byGeo}
              colors={geoColors}
              totalSpend={stats.total.spend}
              activeGeo={geoFilter !== "all" ? geoFilter : null}
              onRowClick={(name) => setGeoFilter(geoFilter === name ? "all" : name)}
            />
          )}
        </div>

        {/* By Account */}
        <div className="glass rounded-2xl p-5 md:p-6 mb-6">
          <h2 className="font-display text-lg font-bold text-white mb-1">{t("By Account")}</h2>
          <p className="text-xs text-slate-500 mb-4 flex items-center gap-1.5">
            Account-level split
            <span className="hidden sm:inline text-slate-600">·</span>
            <span className="hidden sm:inline text-cyan-400/70">💡 Click to filter</span>
          </p>
          {byAccount.length === 0 ? (
            <p className="text-sm text-slate-500 py-8 text-center">No data yet</p>
          ) : (
            <BreakdownList
              items={byAccount}
              colors={accountColors}
              totalSpend={stats.total.spend}
              activeItem={accountFilter !== "all" ? accountFilter : null}
              onItemClick={(name) => setAccountFilter(accountFilter === name ? "all" : name)}
            />
          )}
        </div>

        {/* Admin tools — collapsible to reduce clutter for daily monitoring */}
        {isAdmin && (
          <div className="mb-6">
            <button
              onClick={() => setShowAdminPanels(!showAdminPanels)}
              className="w-full glass rounded-xl px-5 py-3 flex items-center justify-between hover:bg-slate-900/60 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-cyan-500/15 flex items-center justify-center">
                  <Lock className="w-4 h-4 text-cyan-400" />
                </div>
                <div className="text-left">
                  <div className="text-sm font-semibold text-white">Admin Input</div>
                  <div className="text-[11px] text-slate-500">Add daily entries · deposits · settings</div>
                </div>
              </div>
              <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${showAdminPanels ? "rotate-180" : ""}`} />
            </button>
          </div>
        )}

        {/* Admin: campaign entry form */}
        {isAdmin && showAdminPanels && (
          <div className="glass rounded-2xl p-5 md:p-6 mb-6 border-cyan-500/20">
            <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
              <div>
                <h2 className="font-display text-lg font-bold text-white flex items-center gap-2"><Lock className="w-4 h-4 text-cyan-400" />{editId ? "Edit Campaign Entry" : "Add Campaign Entry"}</h2>
                <p className="text-xs text-cyan-400/80 mt-0.5">Per campaign · Spend required, others optional</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowImportModal(true)} className="text-xs px-3 py-1.5 rounded-md bg-violet-500/20 border border-violet-500/30 text-violet-300 flex items-center gap-1.5 hover:bg-violet-500/30">
                  <Upload className="w-3.5 h-3.5" />Bulk import
                </button>
                {editId && (
                  <button onClick={resetEntryForm} className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1"><X className="w-3.5 h-3.5" /> Cancel</button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input-base" /></Field>
              <Field label="Account">
                <select value={account} onChange={(e) => setAccount(e.target.value)} className="input-base">
                  {DEFAULT_ACCOUNTS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </Field>
              {account === "Other" && <Field label="Custom account"><input type="text" value={customAccount} onChange={(e) => setCustomAccount(e.target.value)} placeholder="e.g. WeTrade BR" className="input-base" /></Field>}
              <Field label="Geo">
                <select value={geo} onChange={(e) => setGeo(e.target.value)} className="input-base">
                  {COMMON_GEOS.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </Field>
              {geo === "Other" && <Field label="Custom geo"><input type="text" value={customGeo} onChange={(e) => setCustomGeo(e.target.value)} placeholder="e.g. UAE" className="input-base" /></Field>}
              <Field label="Spend (USD) *">
                <div className="relative">
                  <DollarSign className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="input-base pl-11 font-mono-num" />
                </div>
              </Field>
              <Field label="Impressions"><input type="number" min="0" value={impressions} onChange={(e) => setImpressions(e.target.value)} placeholder="0" className="input-base font-mono-num" /></Field>
              <Field label="Clicks"><input type="number" min="0" value={clicks} onChange={(e) => setClicks(e.target.value)} placeholder="0" className="input-base font-mono-num" /></Field>
              <Field label={t("Leads")}><input type="number" min="0" value={leads} onChange={(e) => setLeads(e.target.value)} placeholder="0" className="input-base font-mono-num" /></Field>
              <div className="md:col-span-2 lg:col-span-4">
                <Field label="Notes (optional)"><input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Campaign name or context" className="input-base" /></Field>
              </div>
            </div>

            {amount && parseFloat(amount) > 0 && (
              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <PreviewMetric label="CTR" value={impressions && parseFloat(impressions) > 0 ? formatPct((parseFloat(clicks || 0) / parseFloat(impressions)) * 100) : "—"} />
                <PreviewMetric label="CPC" value={clicks && parseFloat(clicks) > 0 ? formatUSD(parseFloat(amount) / parseFloat(clicks)) : "—"} />
                <PreviewMetric label={t("CPL")} value={leads && parseFloat(leads) > 0 ? formatUSD(parseFloat(amount) / parseFloat(leads)) : "—"} />
                <PreviewMetric label="CPM" value={impressions && parseFloat(impressions) > 0 ? formatUSD((parseFloat(amount) / parseFloat(impressions)) * 1000) : "—"} />
              </div>
            )}

            <button onClick={handleSubmitEntry} disabled={!amount || isNaN(parseFloat(amount))} className="mt-5 w-full md:w-auto px-6 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-40">
              {editId ? <><Check className="w-4 h-4" /> Save changes</> : <><Plus className="w-4 h-4" /> Add entry</>}
            </button>

            <div className="mt-6 pt-5 border-t border-slate-800/60 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="text-xs uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5"><Target className="w-3.5 h-3.5" />Daily Target (USD)</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <DollarSign className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input type="number" step="0.01" min="0" value={budgetInput} onChange={(e) => setBudgetInput(e.target.value)} placeholder="e.g. 5000" className="input-base pl-11 font-mono-num" />
                  </div>
                  <button onClick={saveBudget} className="px-4 py-2.5 rounded-lg glass glass-hover text-sm text-slate-200">Save</button>
                </div>
              </div>

              <div>
                <label className="text-xs uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5">
                  <span className="text-amber-400">%</span>Tax Rate (applied to all spend)
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={taxInput}
                      onChange={(e) => setTaxInput(e.target.value)}
                      placeholder="7"
                      className="input-base pr-8 font-mono-num"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">%</span>
                  </div>
                  <button onClick={saveTax} className="px-4 py-2.5 rounded-lg glass glass-hover text-sm text-slate-200">Save</button>
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5">
                  Currently {((config.taxRate || 0) * 100).toFixed(0)}% · Applied to all displayed spend, CPL, CPC, CPM, CPD
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Admin: deposits form (multi-row by country) */}
        {isAdmin && showAdminPanels && (
          <div className="glass rounded-2xl p-5 md:p-6 mb-6 border-amber-500/20">
            <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
              <div>
                <h2 className="font-display text-lg font-bold text-white flex items-center gap-2">
                  <Banknote className="w-4 h-4 text-amber-400" />Daily Deposits by Country
                </h2>
                <p className="text-xs text-amber-400/80 mt-0.5">Total deposits per country for the selected date</p>
              </div>
            </div>

            <div className="mb-4 max-w-xs">
              <Field label="Date">
                <input type="date" value={depositDate} onChange={(e) => setDepositDate(e.target.value)} className="input-base" />
              </Field>
            </div>

            <div className="space-y-2 mb-4">
              {activeGeos.map((g) => (
                <div key={g} className="flex items-center gap-3 bg-slate-900/40 rounded-lg p-3">
                  <span className="text-sm text-slate-200 w-32 shrink-0">{g}</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={depositCounts[g] || ""}
                    onChange={(e) => setDepositCounts({ ...depositCounts, [g]: e.target.value })}
                    placeholder="0"
                    className="input-base font-mono-num flex-1 max-w-xs"
                  />
                  <span className="text-xs text-slate-500 hidden md:inline">deposits</span>
                  <button onClick={() => handleRemoveGeoFromDepositForm(g)} className="text-slate-500 hover:text-pink-400 p-1">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex gap-2 mb-4 flex-wrap">
              <select value={addGeoSelect} onChange={(e) => setAddGeoSelect(e.target.value)} className="input-base max-w-xs flex-1">
                <option value="">+ Add a country…</option>
                {COMMON_GEOS.filter((g) => !activeGeos.includes(g) && g !== "Other").map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
              <button onClick={handleAddGeoToDepositForm} disabled={!addGeoSelect} className="px-4 py-2.5 rounded-lg glass glass-hover text-sm text-slate-200 disabled:opacity-40">Add</button>
            </div>

            <button onClick={handleSaveDeposits} className="w-full md:w-auto px-6 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-semibold flex items-center justify-center gap-2">
              <Check className="w-4 h-4" /> Save deposits for {formatDate(depositDate)}
            </button>

            <p className="text-[11px] text-slate-500 mt-3">
              Empty or zero values won't save · existing entries for this date are replaced when you save
            </p>
          </div>
        )}

        {/* Admin: top-up form */}
        {isAdmin && (
          <div className="glass rounded-2xl p-5 md:p-6 mb-6 border-emerald-500/20">
            <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
              <div>
                <h2 className="font-display text-lg font-bold text-white flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-emerald-400" />
                  Account Top-up
                </h2>
                <p className="text-xs text-emerald-400/80 mt-0.5">
                  Record budget added to ad accounts
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Field label="Date">
                <input type="date" value={topupDate} onChange={(e) => setTopupDate(e.target.value)} className="input-base" />
              </Field>
              <Field label="Account">
                <select value={topupAccount} onChange={(e) => setTopupAccount(e.target.value)} className="input-base">
                  {DEFAULT_ACCOUNTS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </Field>
              {topupAccount === "Other" && (
                <Field label="Custom account">
                  <input type="text" value={topupCustomAccount} onChange={(e) => setTopupCustomAccount(e.target.value)} placeholder="e.g. WeTrade BR" className="input-base" />
                </Field>
              )}
              <Field label="Amount (USD)">
                <div className="relative">
                  <DollarSign className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input type="number" step="0.01" min="0" value={topupAmount} onChange={(e) => setTopupAmount(e.target.value)} placeholder="5000.00" className="input-base pl-11 font-mono-num" />
                </div>
              </Field>
              <div className={topupAccount === "Other" ? "md:col-span-2 lg:col-span-4" : "md:col-span-2 lg:col-span-1"}>
                <Field label="Notes (optional)">
                  <input type="text" value={topupNotes} onChange={(e) => setTopupNotes(e.target.value)} placeholder="e.g. Wire transfer, ref #12345" className="input-base" />
                </Field>
              </div>
            </div>

            <button
              onClick={handleAddTopup}
              disabled={!topupAmount || isNaN(parseFloat(topupAmount)) || parseFloat(topupAmount) <= 0}
              className="mt-5 w-full md:w-auto px-6 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-40"
            >
              <Plus className="w-4 h-4" /> Add top-up
            </button>
          </div>
        )}

        {/* Recent entries table */}
        <div className="glass rounded-2xl overflow-hidden mb-6">
          <div className="px-5 md:px-6 py-4 border-b border-slate-800/60">
            <h2 className="font-display text-lg font-bold text-white">Campaign Entries</h2>
            <p className="text-xs text-slate-500 mt-0.5">{filteredEntries.length} {filteredEntries.length === 1 ? "entry" : "entries"}</p>
          </div>
          {filteredEntries.length === 0 ? (
            <div className="p-12 text-center">
              <Calendar className="w-10 h-10 mx-auto text-slate-700 mb-3" />
              <p className="text-slate-400 text-sm">{entries.length === 0 ? (isAdmin ? "No entries yet. Add daily data above or use Bulk Import." : "No data yet.") : "No entries match the current filter."}</p>
            </div>
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto scroll-x">
                <table className="w-full text-sm min-w-[900px]">
                  <thead>
                    <tr className="text-xs uppercase tracking-wider text-slate-500 border-b border-slate-800/60">
                      <th className="text-left px-4 py-3 font-medium">Date</th>
                      <th className="text-left px-4 py-3 font-medium">Account</th>
                      <th className="text-left px-4 py-3 font-medium">Campaign</th>
                      <th className="text-left px-4 py-3 font-medium">Geo</th>
                      <th className="text-right px-4 py-3 font-medium">Spend</th>
                      <th className="text-right px-4 py-3 font-medium">Impr.</th>
                      <th className="text-right px-4 py-3 font-medium">Clicks</th>
                      <th className="text-right px-4 py-3 font-medium">Leads</th>
                      <th className="text-right px-4 py-3 font-medium">CTR</th>
                      <th className="text-right px-4 py-3 font-medium">CPL</th>
                      {isAdmin && <th className="px-4 py-3"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEntries.map((e) => {
                      const taxedAmount = e.amount * (1 + (config.taxRate || 0));
                      const ctr = e.impressions > 0 ? ((e.clicks || 0) / e.impressions) * 100 : null;
                      const cpl = e.leads > 0 ? taxedAmount / e.leads : null;
                      return (
                        <tr key={e.id} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                          <td className="px-4 py-3 text-slate-200 font-mono-num text-xs whitespace-nowrap">{formatDate(e.date)}</td>
                          <td className="px-4 py-3 text-slate-200 text-xs whitespace-nowrap">{e.account}</td>
                          <td className="px-4 py-3 text-slate-400 text-xs max-w-[280px] truncate" title={e.campaign || ""}>
                            {e.campaign || <span className="text-slate-700">—</span>}
                          </td>
                          <td className="px-4 py-3 text-slate-300 text-xs whitespace-nowrap">
                            {e.geo ? <span><span className="mr-1">{flagFor(e.geo)}</span>{e.geo}</span> : "—"}
                          </td>
                          <td className="px-4 py-3 text-right font-mono-num text-slate-100 font-semibold text-xs">{formatUSD(taxedAmount)}</td>
                          <td className="px-4 py-3 text-right font-mono-num text-slate-300 text-xs">{e.impressions ? formatNumCompact(e.impressions) : "—"}</td>
                          <td className="px-4 py-3 text-right font-mono-num text-slate-300 text-xs">{e.clicks ? formatNumCompact(e.clicks) : "—"}</td>
                          <td className="px-4 py-3 text-right font-mono-num text-emerald-300 text-xs font-semibold">{e.leads ? formatNumCompact(e.leads) : "—"}</td>
                          <td className="px-4 py-3 text-right font-mono-num text-slate-400 text-xs">{formatPct(ctr)}</td>
                          <td className="px-4 py-3 text-right font-mono-num text-slate-300 text-xs">{cpl != null ? formatUSD(cpl) : "—"}</td>
                          {isAdmin && (
                            <td className="px-4 py-3"><div className="flex items-center justify-end gap-1">
                              <button onClick={() => handleEditEntry(e)} className="p-1.5 rounded hover:bg-slate-700/50 text-slate-400 hover:text-cyan-400"><Pencil className="w-3.5 h-3.5" /></button>
                              <button onClick={() => handleDeleteEntry(e.id)} className="p-1.5 rounded hover:bg-slate-700/50 text-slate-400 hover:text-pink-400"><Trash2 className="w-3.5 h-3.5" /></button>
                            </div></td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-900/40">
                      <td colSpan={4} className="px-4 py-3 text-xs uppercase tracking-wider text-slate-400">Period total</td>
                      <td className="px-4 py-3 text-right font-mono-num text-cyan-300 font-bold text-xs">{formatUSD(stats.total.spend)}</td>
                      <td className="px-4 py-3 text-right font-mono-num text-slate-300 text-xs">{formatNumCompact(stats.total.impressions)}</td>
                      <td className="px-4 py-3 text-right font-mono-num text-slate-300 text-xs">{formatNumCompact(stats.total.clicks)}</td>
                      <td className="px-4 py-3 text-right font-mono-num text-emerald-300 font-bold text-xs">{formatNumCompact(stats.total.leads)}</td>
                      <td className="px-4 py-3 text-right font-mono-num text-slate-400 text-xs">{formatPct(stats.total.ctr)}</td>
                      <td className="px-4 py-3 text-right font-mono-num text-slate-300 text-xs">{stats.total.cpl != null ? formatUSD(stats.total.cpl) : "—"}</td>
                      {isAdmin && <td></td>}
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="md:hidden divide-y divide-slate-800/40">
                {filteredEntries.map((e) => {
                  const taxedAmount = e.amount * (1 + (config.taxRate || 0));
                  const cpl = e.leads > 0 ? taxedAmount / e.leads : null;
                  return (
                    <div key={e.id} className="px-5 py-3">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <span className="text-xs text-slate-400 font-mono-num">{formatShortDate(e.date)}</span>
                            <span className="text-xs text-slate-200 truncate">{e.account}</span>
                            {e.geo && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800/60 text-slate-300"><span className="mr-1">{flagFor(e.geo)}</span>{e.geo}</span>}
                          </div>
                          {e.notes && <p className="text-xs text-slate-500 truncate">{e.notes}</p>}
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-mono-num text-slate-100 font-semibold text-sm">{formatUSD(taxedAmount)}</div>
                          {isAdmin && (
                            <div className="flex items-center gap-1 mt-1 justify-end">
                              <button onClick={() => handleEditEntry(e)} className="p-1 rounded text-slate-500"><Pencil className="w-3.5 h-3.5" /></button>
                              <button onClick={() => handleDeleteEntry(e.id)} className="p-1 rounded text-slate-500"><Trash2 className="w-3.5 h-3.5" /></button>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-[10px]">
                        <div className="bg-slate-900/40 rounded px-2 py-1.5"><div className="text-slate-500 uppercase tracking-wider mb-0.5">Clicks</div><div className="font-mono-num text-slate-200">{e.clicks ? formatNumCompact(e.clicks) : "—"}</div></div>
                        <div className="bg-slate-900/40 rounded px-2 py-1.5"><div className="text-slate-500 uppercase tracking-wider mb-0.5">Leads</div><div className="font-mono-num text-emerald-300 font-semibold">{e.leads ? formatNumCompact(e.leads) : "—"}</div></div>
                        <div className="bg-slate-900/40 rounded px-2 py-1.5"><div className="text-slate-500 uppercase tracking-wider mb-0.5">CPL</div><div className="font-mono-num text-slate-200">{cpl != null ? formatUSD(cpl) : "—"}</div></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Recent deposits table */}
        <div className="glass rounded-2xl overflow-hidden">
          <div className="px-5 md:px-6 py-4 border-b border-slate-800/60 flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="font-display text-lg font-bold text-white flex items-center gap-2">
                <Banknote className="w-4 h-4 text-amber-400" /> {t("Daily Deposits")}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">{filteredDeposits.length} entries</p>
            </div>
          </div>

          {/* Quick-add deposit row — admin only, always visible */}
          {isAdmin && (
            <div className="px-5 md:px-6 py-4 bg-amber-500/[0.04] border-b border-amber-500/15">
              <div className="flex items-center gap-2 mb-3">
                <Plus className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-[11px] uppercase tracking-[0.18em] text-amber-300/80 font-medium">
                  Quick add deposit
                </span>
                {qFlash && (
                  <span className={`text-[11px] px-2 py-0.5 rounded ${
                    qFlash.type === "ok" ? "bg-emerald-500/15 text-emerald-300" : "bg-pink-500/15 text-pink-300"
                  }`}>
                    {qFlash.text}
                  </span>
                )}
              </div>
              <div className="space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr_110px_140px_auto] gap-2">
                  <input
                    type="date"
                    value={qDate}
                    onChange={(e) => setQDate(e.target.value)}
                    className="input-base text-sm"
                  />
                  <select
                    value={qGeo}
                    onChange={(e) => setQGeo(e.target.value)}
                    className="input-base text-sm"
                  >
                    <option value="">Select country…</option>
                    {COMMON_GEOS.filter((g) => g !== "Other").map((g) => (
                      <option key={g} value={g}>{flagFor(g)} {g}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={qCount}
                    onChange={(e) => setQCount(e.target.value)}
                    placeholder="Count"
                    className="input-base text-sm font-mono-num"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={qAmount}
                    onChange={(e) => setQAmount(e.target.value)}
                    placeholder="USD amount (opt)"
                    className="input-base text-sm font-mono-num"
                  />
                  <button
                    onClick={async () => {
                      setQBusy(true);
                      const ok = await handleQuickAddDeposit(qDate, qGeo, qCount, qAmount, qSource, qCrmId);
                      if (ok) {
                        setQFlash({ type: "ok", text: "Saved" });
                        setQGeo(""); setQCount(""); setQAmount(""); setQSource(""); setQCrmId("");
                      } else {
                        setQFlash({ type: "err", text: "Pick country & count > 0" });
                      }
                      setTimeout(() => setQFlash(null), 2000);
                      setQBusy(false);
                    }}
                    disabled={qBusy || !qGeo || !qCount}
                    className="px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Check className="w-4 h-4" /> Add
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={qSource}
                    onChange={(e) => setQSource(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const ok = await handleQuickAddDeposit(qDate, qGeo, qCount, qAmount, qSource, qCrmId);
                        if (ok) {
                          setQFlash({ type: "ok", text: "Saved" });
                          setQGeo(""); setQCount(""); setQAmount(""); setQSource(""); setQCrmId("");
                        } else {
                          setQFlash({ type: "err", text: "Pick country & count > 0" });
                        }
                        setTimeout(() => setQFlash(null), 2000);
                      }
                    }}
                    placeholder="Source — e.g. TH_LP_DC2_2026 (opt)"
                    className="input-base text-sm font-mono"
                  />
                  <input
                    type="text"
                    value={qCrmId}
                    onChange={(e) => setQCrmId(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const ok = await handleQuickAddDeposit(qDate, qGeo, qCount, qAmount, qSource, qCrmId);
                        if (ok) {
                          setQFlash({ type: "ok", text: "Saved" });
                          setQGeo(""); setQCount(""); setQAmount(""); setQSource(""); setQCrmId("");
                        } else {
                          setQFlash({ type: "err", text: "Pick country & count > 0" });
                        }
                        setTimeout(() => setQFlash(null), 2000);
                      }
                    }}
                    placeholder="CRM ID — e.g. 106252 (opt)"
                    className="input-base text-sm font-mono"
                  />
                </div>
              </div>
              {qDate && qGeo && (() => {
                const existing = deposits.find((d) => d.date === qDate && d.geo === qGeo);
                if (!existing) return null;
                return (
                  <p className="text-[11px] text-amber-400/70 mt-2 flex items-center gap-1.5">
                    <AlertCircle className="w-3 h-3" />
                    Existing record: <span className="font-mono-num font-semibold">{existing.count}</span> deposits{existing.amount ? ` · ${formatUSD(existing.amount)}` : ""} — saving will overwrite
                  </p>
                );
              })()}
            </div>
          )}

          {filteredDeposits.length === 0 ? (
            <div className="p-12 text-center">
              <Banknote className="w-10 h-10 mx-auto text-slate-700 mb-3" />
              <p className="text-slate-400 text-sm">{deposits.length === 0 ? (isAdmin ? "No deposit data yet — use the quick-add above to add daily counts." : "No deposit data yet.") : "No deposits match the current filter."}</p>
            </div>
          ) : (
            <div className="overflow-x-auto scroll-x">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wider text-slate-500 border-b border-slate-800/60">
                    <th className="text-left px-4 py-3 font-medium">Date</th>
                    <th className="text-left px-4 py-3 font-medium">Country</th>
                    <th className="text-left px-4 py-3 font-medium">Source</th>
                    <th className="text-left px-4 py-3 font-medium">CRM ID</th>
                    <th className="text-right px-4 py-3 font-medium">Deposits</th>
                    <th className="text-right px-4 py-3 font-medium">Amount (USD)</th>
                    {isAdmin && <th className="px-4 py-3"></th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredDeposits.map((d) => {
                    const isEditing = editingDepositId === d.id;
                    const startEditing = () => {
                      if (!isAdmin) return;
                      setEditingDepositId(d.id);
                      setEditDepCount(String(d.count || ""));
                      setEditDepAmount(String(d.amount || ""));
                      setEditDepSource(String(d.source || ""));
                      setEditDepCrmId(String(d.crmId || ""));
                    };
                    const saveEdit = async () => {
                      await handleEditDeposit(d.id, {
                        count: editDepCount,
                        amount: editDepAmount,
                        source: editDepSource,
                        crmId: editDepCrmId,
                      });
                      setEditingDepositId(null);
                    };
                    const cancelEdit = () => {
                      setEditingDepositId(null);
                      setEditDepCount("");
                      setEditDepAmount("");
                      setEditDepSource("");
                      setEditDepCrmId("");
                    };
                    return (
                      <tr
                        key={d.id}
                        className={`border-b border-slate-800/40 transition-colors ${
                          isEditing ? "bg-cyan-500/5" : "hover:bg-slate-800/20"
                        }`}
                      >
                        <td className="px-4 py-3 text-slate-200 font-mono-num text-xs whitespace-nowrap">{formatDate(d.date)}</td>
                        <td className="px-4 py-3 text-slate-200 text-xs">
                          <span className="mr-1.5">{flagFor(d.geo)}</span>{d.geo}
                        </td>
                        <td className="px-4 py-3 text-xs font-mono max-w-[200px]">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editDepSource}
                              onChange={(e) => setEditDepSource(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveEdit();
                                if (e.key === "Escape") cancelEdit();
                              }}
                              placeholder="TH_LP_DC2_2026"
                              className="w-full px-2 py-1 rounded bg-slate-900/80 border border-cyan-500/40 text-slate-200 text-xs font-mono focus:outline-none focus:border-cyan-500"
                            />
                          ) : (
                            <span
                              onClick={startEditing}
                              className={`block truncate ${
                                isAdmin ? "cursor-pointer hover:bg-slate-800/40 px-2 py-1 -mx-2 -my-1 rounded transition-colors" : ""
                              }`}
                              title={d.source || (isAdmin ? "Click to add source" : `Auto: ${displaySource(d)}`)}
                            >
                              {d.source ? <span className="text-slate-300">{d.source}</span> : <span className="text-slate-600">{isAdmin ? "add…" : displaySource(d)}</span>}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs font-mono max-w-[140px]">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editDepCrmId}
                              onChange={(e) => setEditDepCrmId(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveEdit();
                                if (e.key === "Escape") cancelEdit();
                              }}
                              placeholder="106252"
                              className="w-full px-2 py-1 rounded bg-slate-900/80 border border-cyan-500/40 text-slate-200 text-xs font-mono focus:outline-none focus:border-cyan-500"
                            />
                          ) : (
                            <span
                              onClick={startEditing}
                              className={`block truncate ${
                                isAdmin ? "cursor-pointer hover:bg-slate-800/40 px-2 py-1 -mx-2 -my-1 rounded transition-colors" : ""
                              }`}
                              title={d.crmId || (isAdmin ? "Click to add CRM ID" : "")}
                            >
                              {d.crmId ? <span className="text-slate-300">{d.crmId}</span> : <span className="text-slate-700">{isAdmin ? "add…" : "—"}</span>}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {isEditing ? (
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={editDepCount}
                              onChange={(e) => setEditDepCount(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveEdit();
                                if (e.key === "Escape") cancelEdit();
                              }}
                              autoFocus
                              className="w-20 px-2 py-1 text-right rounded bg-slate-900/80 border border-cyan-500/40 text-amber-300 text-xs font-mono-num focus:outline-none focus:border-cyan-500"
                            />
                          ) : (
                            <span
                              onClick={startEditing}
                              className={`font-mono-num text-amber-300 text-xs font-semibold ${
                                isAdmin ? "cursor-pointer hover:bg-slate-800/40 px-2 py-1 -mx-2 -my-1 rounded transition-colors" : ""
                              }`}
                              title={isAdmin ? "Click to edit" : undefined}
                            >
                              {formatNum(d.count)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {isEditing ? (
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={editDepAmount}
                              onChange={(e) => setEditDepAmount(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveEdit();
                                if (e.key === "Escape") cancelEdit();
                              }}
                              placeholder="0.00"
                              className="w-24 px-2 py-1 text-right rounded bg-slate-900/80 border border-cyan-500/40 text-emerald-300 text-xs font-mono-num focus:outline-none focus:border-cyan-500"
                            />
                          ) : (
                            <span
                              onClick={startEditing}
                              className={`font-mono-num text-emerald-300 text-xs font-semibold ${
                                isAdmin ? "cursor-pointer hover:bg-slate-800/40 px-2 py-1 -mx-2 -my-1 rounded transition-colors" : ""
                              }`}
                              title={isAdmin ? "Click to edit" : undefined}
                            >
                              {d.amount ? formatUSD(d.amount) : (isAdmin ? <span className="text-slate-600">add…</span> : "—")}
                            </span>
                          )}
                        </td>
                        {isAdmin && (
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              {isEditing ? (
                                <>
                                  <button
                                    onClick={saveEdit}
                                    className="p-1.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300"
                                    title="Save (Enter)"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={cancelEdit}
                                    className="p-1.5 rounded hover:bg-slate-700/50 text-slate-400"
                                    title="Cancel (Esc)"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    onClick={startEditing}
                                    className="p-1.5 rounded hover:bg-slate-700/50 text-slate-400 hover:text-cyan-300"
                                    title="Edit"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteDeposit(d.id)}
                                    className="p-1.5 rounded hover:bg-slate-700/50 text-slate-400 hover:text-pink-400"
                                    title="Delete"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-900/40">
                    <td colSpan={4} className="px-4 py-3 text-xs uppercase tracking-wider text-slate-400">Period total</td>
                    <td className="px-4 py-3 text-right font-mono-num text-amber-300 font-bold text-xs">{formatNum(stats.total.deposits)}</td>
                    <td className="px-4 py-3 text-right font-mono-num text-emerald-300 font-bold text-xs">{stats.total.depositAmount ? formatUSD(stats.total.depositAmount) : "—"}</td>
                    {isAdmin && <td></td>}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* Top-ups table */}
        <div className="glass rounded-2xl overflow-hidden">
          <div className="px-5 md:px-6 py-4 border-b border-slate-800/60 flex items-center justify-between">
            <div>
              <h2 className="font-display text-lg font-bold text-white flex items-center gap-2">
                <Wallet className="w-4 h-4 text-emerald-400" /> Top-ups History
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">{topups.length} top-up records</p>
            </div>
          </div>
          {topups.length === 0 ? (
            <div className="p-12 text-center">
              <Wallet className="w-10 h-10 mx-auto text-slate-700 mb-3" />
              <p className="text-slate-400 text-sm">
                {isAdmin ? "No top-ups recorded yet. Add one above when you fund an ad account." : "No top-up data yet."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto scroll-x">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wider text-slate-500 border-b border-slate-800/60">
                    <th className="text-left px-4 py-3 font-medium">Date</th>
                    <th className="text-left px-4 py-3 font-medium">Account</th>
                    <th className="text-left px-4 py-3 font-medium">Notes</th>
                    <th className="text-right px-4 py-3 font-medium">Amount</th>
                    {isAdmin && <th className="px-4 py-3"></th>}
                  </tr>
                </thead>
                <tbody>
                  {[...topups].sort((a, b) => b.date.localeCompare(a.date)).map((t) => (
                    <tr key={t.id} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                      <td className="px-4 py-3 text-slate-200 font-mono-num text-xs whitespace-nowrap">{formatDate(t.date)}</td>
                      <td className="px-4 py-3 text-slate-200 text-xs">{t.account}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs max-w-xs truncate">{t.notes || "—"}</td>
                      <td className="px-4 py-3 text-right font-mono-num text-emerald-300 text-xs font-semibold">
                        {formatUSD(t.amount)}
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end">
                            <button onClick={() => handleDeleteTopup(t.id)} className="p-1.5 rounded hover:bg-slate-700/50 text-slate-400 hover:text-pink-400">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-900/40">
                    <td colSpan={3} className="px-4 py-3 text-xs uppercase tracking-wider text-slate-400">
                      Total loaded
                    </td>
                    <td className="px-4 py-3 text-right font-mono-num text-emerald-300 font-bold text-xs">
                      {formatUSD(topups.reduce((s, t) => s + t.amount, 0))}
                    </td>
                    {isAdmin && <td></td>}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-slate-600 mt-8">
          {isAdmin ? t("Admin mode · Shared with all viewers") : t("Read-only view · Unlock admin to input data")}
        </p>
      </div>

      {/* Passcode modal */}
      {showPasscodeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="glass rounded-2xl p-6 md:p-8 max-w-sm w-full">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center"><Lock className="w-5 h-5 text-cyan-400" /></div>
              <div>
                <h3 className="font-display text-lg font-bold text-white">{isFirstSetup ? "Set Admin Passcode" : "Admin Access"}</h3>
                <p className="text-xs text-slate-400">{isFirstSetup ? "Create a passcode to protect data input" : "Enter passcode to unlock input"}</p>
              </div>
            </div>
            <input type="password" autoFocus value={passcodeInput} onChange={(e) => { setPasscodeInput(e.target.value); setPasscodeError(""); }} onKeyDown={(e) => { if (e.key === "Enter") submitPasscode(); }} placeholder={isFirstSetup ? "Choose a passcode" : "Passcode"} className="w-full px-4 py-3 rounded-lg bg-slate-900/80 border border-slate-700/50 text-slate-100 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 outline-none mb-2" />
            {passcodeError && <p className="text-xs text-pink-400 mb-2">{passcodeError}</p>}
            {isFirstSetup && <p className="text-[11px] text-slate-500 mb-4">You'll need this passcode every time you input data. Keep it safe — there's no recovery.</p>}
            <div className="flex gap-2 mt-2">
              <button onClick={() => setShowPasscodeModal(false)} className="flex-1 px-4 py-2.5 rounded-lg glass glass-hover text-sm text-slate-300">Cancel</button>
              <button onClick={submitPasscode} className="flex-1 px-4 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-sm font-semibold">{isFirstSetup ? "Set & unlock" : "Unlock"}</button>
            </div>
          </div>
        </div>
      )}

      {showImportModal && <ImportModal onClose={() => setShowImportModal(false)} onImport={handleBulkImport} />}
      {showDeleteModal && (
        <DeleteModal
          onClose={() => setShowDeleteModal(false)}
          onDelete={handleBulkDelete}
          entriesTotal={entries.length}
          depositsTotal={deposits.length}
          topupsTotal={topups.length}
          filteredEntriesCount={filteredEntries.length}
          filteredDepositsCount={filteredDeposits.length}
          rangeFilter={rangeFilter}
          accountFilter={accountFilter}
          geoFilter={geoFilter}
        />
      )}
    </div>
  );
}

// ===== IMPORT MODAL =====
function ImportModal({ onClose, onImport }) {
  const [dataType, setDataType] = useState("entries"); // entries | deposits
  const [tab, setTab] = useState("paste");
  const [pasteText, setPasteText] = useState("");
  const [parsedRows, setParsedRows] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [columnMapping, setColumnMapping] = useState([]);
  const [defaultAccount, setDefaultAccount] = useState("");
  const [defaultGeo, setDefaultGeo] = useState("");
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [autoExtractGeo, setAutoExtractGeo] = useState(true);
  const [error, setError] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [extractingImage, setExtractingImage] = useState(false);
  const [extractedFromImage, setExtractedFromImage] = useState(null);
  const fileInputRef = useRef(null);
  const csvInputRef = useRef(null);

  const fieldOptions = dataType === "entries" ? FIELD_OPTIONS
    : dataType === "crm_deposits" ? CRM_DEPOSIT_FIELD_OPTIONS
    : DEPOSIT_FIELD_OPTIONS;
  const patterns = dataType === "entries" ? COLUMN_PATTERNS
    : dataType === "crm_deposits" ? CRM_DEPOSIT_COLUMN_PATTERNS
    : DEPOSIT_COLUMN_PATTERNS;

  // Reset preview when data type changes
  useEffect(() => {
    setParsedRows(null);
    setHeaders([]);
    setColumnMapping([]);
    setExtractedFromImage(null);
    setError("");
  }, [dataType]);

  const parseTabular = (text) => {
    setError("");
    if (!text.trim()) { setError("Nothing to parse — paste some data first."); return; }
    const tabCount = (text.match(/\t/g) || []).length;
    const commaCount = (text.match(/,/g) || []).length;
    const delimiter = tabCount > commaCount / 2 ? "\t" : ",";
    const result = Papa.parse(text.trim(), { delimiter, skipEmptyLines: true });
    if (!result.data || result.data.length === 0) { setError("Couldn't parse any rows."); return; }
    const rows = result.data;
    const headerRow = rows[0].map((h) => String(h || "").trim());
    const dataRows = rows.slice(1);
    if (dataRows.length === 0) { setError("Found a header row but no data rows."); return; }
    const mapping = headerRow.map((h) => autoDetectField(h, patterns));

    // Dedup auto-detected mappings: if a field is matched on multiple columns,
    // keep only the FIRST occurrence and skip the rest. Prevents bugs like
    // "Reporting starts" and "Reporting ends" both mapping to Date (where the
    // last one wins and you get the wrong dates). Notes can still appear multiple times.
    const seen = new Set();
    const dedupedMapping = mapping.map((field) => {
      if (field === "skip" || field === "notes") return field;
      if (seen.has(field)) return "skip";
      seen.add(field);
      return field;
    });

    setHeaders(headerRow);
    setColumnMapping(dedupedMapping);
    setParsedRows(dataRows);
  };

  const handleCsvFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    // Detect if file is actually an Excel binary even with a .csv extension.
    // CRM exports (like the WeTrade Deposit Statistic) frequently do this.
    const isExcelByExt = /\.(xlsx|xls|xlsm)$/i.test(file.name);
    const tryAsExcel = (buffer) => {
      try {
        const wb = XLSX.read(buffer, { type: "array" });
        const sheetName = wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        // Convert to CSV, then run through the same parsing path
        const csv = XLSX.utils.sheet_to_csv(ws, { FS: "," });
        setPasteText(csv);
        setTab("paste");
        parseTabular(csv);
        return true;
      } catch (err) {
        return false;
      }
    };

    reader.onload = (e) => {
      const result = e.target.result;
      // Check first bytes for XLSX (PK zip signature) or older XLS (D0 CF)
      if (result instanceof ArrayBuffer) {
        const bytes = new Uint8Array(result.slice(0, 4));
        const isZip = bytes[0] === 0x50 && bytes[1] === 0x4B; // "PK"
        const isOldExcel = bytes[0] === 0xD0 && bytes[1] === 0xCF;
        if (isZip || isOldExcel || isExcelByExt) {
          if (tryAsExcel(result)) return;
        }
        // Fall back to text parsing
        const text = new TextDecoder().decode(result);
        setPasteText(text);
        setTab("paste");
        parseTabular(text);
      } else {
        setPasteText(result);
        setTab("paste");
        parseTabular(result);
      }
    };
    // Read as ArrayBuffer so we can sniff the file type
    reader.readAsArrayBuffer(file);
  };

  const handleImageDrop = (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("Please drop an image file."); return; }
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setImagePreview(e.target.result);
    reader.readAsDataURL(file);
    setError("");
    setExtractedFromImage(null);
  };

  const extractFromImage = async () => {
    if (!imageFile) return;
    setExtractingImage(true);
    setError("");
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result.split(",")[1]);
        r.onerror = () => rej(new Error("Failed to read image"));
        r.readAsDataURL(imageFile);
      });

      // Call our server-side API route — keeps the Anthropic key safe.
      // The route handles the prompt construction based on dataType.
      const response = await fetch("/api/extract-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base64,
          mediaType: imageFile.type,
          dataType, // "entries" or "deposits"
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Extraction failed");
      }

      const data = await response.json();
      const text = data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const cleaned = text.replace(/```json|```/g, "").trim();
      const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
      if (!arrayMatch) throw new Error("No JSON array found in response");
      const parsed = JSON.parse(arrayMatch[0]);
      if (!Array.isArray(parsed)) throw new Error("Response is not an array");

      if (dataType === "entries") {
        const valid = parsed.filter((e) => e && (e.amount != null || e.date != null));
        if (valid.length === 0) throw new Error("No valid rows extracted");
        setExtractedFromImage(valid.map((e) => ({
          date: e.date || todayISO(),
          account: e.account || "",
          geo: e.geo || "",
          amount: parseNumberLoose(e.amount) || 0,
          impressions: parseNumberLoose(e.impressions) || 0,
          clicks: parseNumberLoose(e.clicks) || 0,
          leads: parseNumberLoose(e.leads) || 0,
          notes: e.notes || "",
        })));
      } else {
        const valid = parsed.filter((d) => d && d.count != null && d.count > 0);
        if (valid.length === 0) throw new Error("No valid deposit rows extracted");
        setExtractedFromImage(valid.map((d) => ({
          date: d.date || todayISO(),
          geo: d.geo || "",
          count: parseNumberLoose(d.count) || 0,
        })));
      }
    } catch (err) {
      console.error(err);
      setError("Couldn't extract data from the image. Try a clearer screenshot, or paste the data instead.");
    } finally {
      setExtractingImage(false);
    }
  };

  const buildEntriesFromTabular = () => {
    if (!parsedRows) return [];
    const out = [];

    // CRM deposits special path: each row is one transaction. Aggregate
    // by date+country before emitting deposit records. Each output row gets:
    //   { date, geo, count: <#transactions>, amount: <sum of USD amounts> }
    // Country resolution priority: Source column prefix (TH_, ID_, etc.)
    //   → Currency code mapping (THB → Thailand) → defaultGeo fallback.
    if (dataType === "crm_deposits") {
      const buckets = new Map(); // key: `${date}|${country}` → { count, amount, sources, crmIds }
      parsedRows.forEach((row) => {
        let dateRaw = null, currency = null, sourceText = null, amount = 0, geo = null, crmId = null;
        columnMapping.forEach((field, i) => {
          if (field === "skip") return;
          const v = row[i];
          if (field === "datetime") {
            // Handle "29/04/2026 21:42:36" or "2026-04-29 21:42:36" or just date
            const s = String(v || "").trim();
            if (!s) return;
            const datePart = s.split(/[\sT]/)[0];
            // Try DD/MM/YYYY first (CRM is European-style), then ISO
            const ddmmyyyy = datePart.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
            if (ddmmyyyy) {
              const [, d, m, y] = ddmmyyyy;
              dateRaw = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
            } else {
              dateRaw = parseDate(datePart);
            }
          } else if (field === "currency") {
            currency = String(v || "").trim().toUpperCase();
          } else if (field === "source") {
            sourceText = String(v || "").trim();
          } else if (field === "crm_id") {
            crmId = String(v || "").trim();
          } else if (field === "amount_usd") {
            const n = parseNumberLoose(v);
            if (n != null) amount = n;
          }
        });

        // Country resolution: Source first (most reliable), then currency, then default
        if (sourceText) {
          // Try to extract country code from source string like "TH_LP_DC2_2026" or "ID_LP_DC1_2026"
          const codeMatch = sourceText.match(/^([A-Za-z]{2,6})[_\-\s]/);
          if (codeMatch) {
            const code = codeMatch[1].toUpperCase();
            if (COUNTRY_NORMALIZE[code]) geo = COUNTRY_NORMALIZE[code];
            else if (REGION_CODES[code]) geo = REGION_CODES[code];
          }
        }
        if (!geo && currency && CURRENCY_TO_COUNTRY[currency]) {
          geo = CURRENCY_TO_COUNTRY[currency];
        }
        if (!geo && defaultGeo) geo = defaultGeo;
        if (!dateRaw || !geo) return;

        const key = `${dateRaw}|${geo}`;
        const existing = buckets.get(key) || { count: 0, amount: 0, sources: new Set(), crmIds: new Set() };
        existing.count += 1;
        existing.amount += amount;
        if (sourceText) existing.sources.add(sourceText);
        if (crmId) existing.crmIds.add(crmId);
        buckets.set(key, existing);
      });
      buckets.forEach(({ count, amount, sources, crmIds }, key) => {
        const [date, geo] = key.split("|");
        const source = sources && sources.size > 0 ? Array.from(sources).join(", ") : "";
        const crmId = crmIds && crmIds.size > 0 ? Array.from(crmIds).join(", ") : "";
        out.push({ date, geo, count, amount: parseFloat(amount.toFixed(2)), source, crmId });
      });
      return out;
    }

    parsedRows.forEach((row) => {
      if (dataType === "entries") {
        const entry = { date: null, account: defaultAccount || "Other", campaign: "", geo: defaultGeo || "", amount: 0, impressions: 0, clicks: 0, leads: 0, notes: "" };
        columnMapping.forEach((field, i) => {
          if (field === "skip") return;
          const v = row[i];
          if (field === "date") entry.date = parseDate(v);
          else if (field === "account") entry.account = String(v || "").trim() || entry.account;
          else if (field === "campaign") entry.campaign = String(v || "").trim();
          else if (field === "geo") entry.geo = normalizeGeo(String(v || "").trim()) || entry.geo;
          else if (field === "notes") entry.notes = String(v || "").trim();
          else { const n = parseNumberLoose(v); if (n != null) entry[field] = n; }
        });
        // Auto-extract geo from campaign name if not already set.
        // Checks Campaign first, then Account, then Notes — so users can map
        // "Campaign name" to whichever field they prefer. The bracketed prefix
        // is stripped from whichever field actually contained it.
        if (autoExtractGeo && !entry.geo) {
          let source = null;
          if (entry.campaign) {
            const ext = extractGeoFromText(entry.campaign);
            if (ext) source = { ext, field: "campaign", value: entry.campaign };
          }
          if (!source && entry.account) {
            const ext = extractGeoFromText(entry.account);
            if (ext) source = { ext, field: "account", value: entry.account };
          }
          if (!source && entry.notes) {
            const ext = extractGeoFromText(entry.notes);
            if (ext) source = { ext, field: "notes", value: entry.notes };
          }
          if (source) {
            entry.geo = source.ext.geo;
            if (source.ext.codeToken) {
              entry[source.field] = stripCodeFromName(source.value, source.ext.codeToken);
            }
          }
        }
        if (entry.date && entry.amount > 0) out.push(entry);
      } else {
        const entry = { date: null, geo: defaultGeo || "", count: 0, amount: 0 };
        columnMapping.forEach((field, i) => {
          if (field === "skip") return;
          const v = row[i];
          if (field === "date") entry.date = parseDate(v);
          else if (field === "geo") entry.geo = normalizeGeo(String(v || "").trim()) || entry.geo;
          else if (field === "count") { const n = parseNumberLoose(v); if (n != null) entry.count = n; }
          else if (field === "amount") { const n = parseNumberLoose(v); if (n != null) entry.amount = n; }
        });
        if (entry.date && entry.count > 0 && entry.geo) out.push(entry);
      }
    });
    return out;
  };

  const handleConfirmTabular = async () => {
    const built = buildEntriesFromTabular();
    if (built.length === 0) {
      setError(dataType === "entries"
        ? "No valid rows. Make sure Date and Spend columns are mapped correctly."
        : dataType === "crm_deposits"
        ? "No valid rows. Make sure Submission Time and Payment Currency columns are mapped. Unrecognized currencies are skipped — set a default country if needed."
        : "No valid rows. Make sure Date, Geo, and Count columns are mapped correctly.");
      return;
    }
    // CRM deposits route through the "deposits" handler since they share data shape
    const importType = dataType === "crm_deposits" ? "deposits" : dataType;
    const added = await onImport(built, importType, { skipDuplicates });
    if (dataType === "crm_deposits") {
      const totalDeposits = built.reduce((s, b) => s + b.count, 0);
      const totalAmount = built.reduce((s, b) => s + (b.amount || 0), 0);
      alert(`Imported ${totalDeposits} deposits totaling $${totalAmount.toFixed(2)} across ${added} date×country buckets`);
    } else {
      alert(`Imported ${added} ${dataType === "entries" ? "entries" : "deposit records"}${skipDuplicates && added < built.length ? ` (${built.length - added} duplicates ${dataType === "deposits" ? "replaced" : "skipped"})` : ""}`);
    }
  };

  const handleConfirmImage = async () => {
    if (!extractedFromImage || extractedFromImage.length === 0) return;
    const valid = dataType === "entries"
      ? extractedFromImage.filter((e) => e.date && e.amount > 0)
      : extractedFromImage.filter((d) => d.date && d.geo && d.count > 0);
    if (valid.length === 0) { setError("No valid rows after extraction."); return; }
    const added = await onImport(valid, dataType, { skipDuplicates });
    alert(`Imported ${added} ${dataType === "entries" ? "entries" : "deposit records"}`);
  };

  const previewEntries = parsedRows ? buildEntriesFromTabular().slice(0, 10) : [];
  const validCount = parsedRows ? buildEntriesFromTabular().length : 0;
  const totalRows = parsedRows ? parsedRows.length : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 md:p-4 bg-black/70 backdrop-blur-sm">
      <div className="glass rounded-2xl max-w-5xl w-full max-h-[95vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-violet-500/20 flex items-center justify-center"><Upload className="w-5 h-5 text-violet-400" /></div>
            <div>
              <h3 className="font-display text-lg font-bold text-white">Bulk Import</h3>
              <p className="text-xs text-slate-400">Import data from spreadsheets, CSV files, or screenshots</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-800/60 text-slate-400"><X className="w-5 h-5" /></button>
        </div>

        {/* Data type toggle */}
        <div className="px-6 pt-4 pb-2 border-b border-slate-800/60">
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">What are you importing?</div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setDataType("entries")} className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors ${dataType === "entries" ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40" : "glass glass-hover text-slate-400"}`}>
              <Activity className="w-4 h-4" /> Campaign data <span className="text-[10px] opacity-70">(spend, clicks, leads)</span>
            </button>
            <button onClick={() => setDataType("deposits")} className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors ${dataType === "deposits" ? "bg-amber-500/20 text-amber-300 border border-amber-500/40" : "glass glass-hover text-slate-400"}`}>
              <Banknote className="w-4 h-4" /> Daily deposits <span className="text-[10px] opacity-70">(by country)</span>
            </button>
            <button onClick={() => setDataType("crm_deposits")} className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors ${dataType === "crm_deposits" ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : "glass glass-hover text-slate-400"}`}>
              <Wallet className="w-4 h-4" /> CRM deposits <span className="text-[10px] opacity-70">(transaction list)</span>
            </button>
          </div>
          {dataType === "crm_deposits" && (
            <p className="text-[11px] text-emerald-400/80 mt-2">
              Auto-aggregates transactions by date + country. Country detected from Source prefix (e.g. <span className="font-mono">TH_LP_DC2_2026</span> → Thailand). Amount uses <span className="font-mono">Actual Payment Amount(USD)</span>.
            </p>
          )}
        </div>

        {/* Source tabs */}
        <div className="px-6 pt-4 flex gap-1 border-b border-slate-800/60">
          {[
            { id: "paste", label: "Paste data", icon: <ClipboardPaste className="w-4 h-4" /> },
            { id: "csv", label: "Upload CSV", icon: <FileSpreadsheet className="w-4 h-4" /> },
            { id: "image", label: "Screenshot", icon: <ImageIcon className="w-4 h-4" /> },
          ].map((t) => (
            <button key={t.id} onClick={() => { setTab(t.id); setError(""); }} className={`flex items-center gap-2 px-4 py-2.5 text-sm rounded-t-lg ${tab === t.id ? "bg-slate-900/60 text-white border-b-2 border-violet-400" : "text-slate-400 hover:text-slate-200"}`}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 px-3 py-2 rounded-lg bg-pink-500/10 border border-pink-500/30 text-pink-300 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /><span>{error}</span>
            </div>
          )}

          {tab === "paste" && !parsedRows && (
            <div>
              <div className="text-sm text-slate-300 mb-3">
                {dataType === "entries"
                  ? <>Copy a block from <strong>Excel, Google Sheets, or a Meta Ads CSV export</strong> (with headers) and paste below.</>
                  : <>Copy daily deposit counts from your CRM or sheet — needs <strong>Date, Country, Count</strong> columns with headers.</>
                }
              </div>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={dataType === "entries"
                  ? "Date\tAmount Spent\tImpressions\tClicks\tLeads\n2025-04-20\t1234.56\t50000\t1200\t45"
                  : "Date\tCountry\tDeposits\n2025-04-20\tBrazil\t23\n2025-04-20\tMexico\t15"
                }
                className="input-base font-mono-num text-xs w-full h-48 resize-y"
              />
              <div className="flex justify-between items-center mt-3">
                <p className="text-xs text-slate-500">Tab-separated (from spreadsheet) or comma-separated both work.</p>
                <button onClick={() => parseTabular(pasteText)} disabled={!pasteText.trim()} className="px-4 py-2 rounded-lg bg-violet-500 hover:bg-violet-400 text-white text-sm font-semibold disabled:opacity-40">Parse data</button>
              </div>
            </div>
          )}

          {tab === "csv" && !parsedRows && (
            <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleCsvFile(f); }} onClick={() => csvInputRef.current?.click()} className="border-2 border-dashed border-slate-700 rounded-xl p-12 text-center cursor-pointer hover:border-violet-500/50 hover:bg-slate-900/40 transition-colors">
              <FileSpreadsheet className="w-12 h-12 mx-auto text-slate-600 mb-3" />
              <p className="text-sm text-slate-300 mb-1">Drop a CSV file here, or click to browse</p>
              <p className="text-xs text-slate-500">{dataType === "entries" ? "Works with Meta Ads Manager exports and standard CSVs" : "CSV with Date, Country, and Count columns"}</p>
              <input ref={csvInputRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm" onChange={(e) => handleCsvFile(e.target.files[0])} className="hidden" />
            </div>
          )}

          {tab === "image" && !extractedFromImage && (
            <div>
              <div className="bg-violet-500/10 border border-violet-500/30 rounded-lg p-3 mb-4 flex items-start gap-2">
                <Sparkles className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
                <div className="text-xs text-slate-300">
                  {dataType === "entries"
                    ? "Drop a screenshot of Ads Manager and AI will read the rows. Preview before importing."
                    : "Drop a screenshot showing daily deposits per country and AI will extract them. Preview before importing."}
                </div>
              </div>

              {imagePreview ? (
                <div className="space-y-4">
                  <div className="relative rounded-xl overflow-hidden border border-slate-700/50">
                    <img src={imagePreview} alt="Preview" className="w-full max-h-96 object-contain bg-slate-900" />
                    <button onClick={() => { setImageFile(null); setImagePreview(null); }} className="absolute top-2 right-2 p-1.5 rounded-full bg-slate-900/80 text-slate-300 hover:bg-slate-800"><X className="w-4 h-4" /></button>
                  </div>
                  <button onClick={extractFromImage} disabled={extractingImage} className="w-full px-4 py-3 rounded-lg bg-violet-500 hover:bg-violet-400 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-40">
                    {extractingImage ? <><RefreshCw className="w-4 h-4 animate-spin" />Reading screenshot…</> : <><Sparkles className="w-4 h-4" />Extract data with AI</>}
                  </button>
                </div>
              ) : (
                <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); handleImageDrop(e.dataTransfer.files[0]); }} onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed border-slate-700 rounded-xl p-12 text-center cursor-pointer hover:border-violet-500/50 hover:bg-slate-900/40 transition-colors">
                  <ImageIcon className="w-12 h-12 mx-auto text-slate-600 mb-3" />
                  <p className="text-sm text-slate-300 mb-1">Drop a screenshot here, or click to browse</p>
                  <p className="text-xs text-slate-500">PNG, JPG, WebP — clearer screenshots = better extraction</p>
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={(e) => handleImageDrop(e.target.files[0])} className="hidden" />
                </div>
              )}
            </div>
          )}

          {/* Tabular preview */}
          {parsedRows && (
            <div>
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div>
                  <h4 className="font-display text-base font-bold text-white">Preview & map columns</h4>
                  <p className="text-xs text-slate-500">{validCount} of {totalRows} rows ready to import</p>
                </div>
                <button onClick={() => { setParsedRows(null); setHeaders([]); setColumnMapping([]); }} className="text-xs text-slate-400 hover:text-slate-200">Start over</button>
              </div>

              {/* Aggregated-data warning — all rows share the same date */}
              {(() => {
                const dateColIdx = columnMapping.indexOf("date");
                if (dateColIdx === -1 || parsedRows.length < 2) return null;
                const dates = new Set(parsedRows.map((r) => parseDate(r[dateColIdx])).filter(Boolean));
                if (dates.size > 1) return null;
                return (
                  <div className="mb-4 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      All {parsedRows.length} rows share the same date. If this is from Meta Ads Manager, re-export with <strong>Breakdown → Time → Day</strong> to get one row per day per campaign.
                    </div>
                  </div>
                );
              })()}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                {dataType === "entries" && (
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Default account (if missing)</label>
                    <select value={defaultAccount} onChange={(e) => setDefaultAccount(e.target.value)} className="input-base text-xs">
                      <option value="">— None —</option>
                      {DEFAULT_ACCOUNTS.filter((a) => a !== "Other").map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Default geo (if missing)</label>
                  <select value={defaultGeo} onChange={(e) => setDefaultGeo(e.target.value)} className="input-base text-xs">
                    <option value="">— None —</option>
                    {COMMON_GEOS.filter((g) => g !== "Other").map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer pb-2">
                    <input type="checkbox" checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} className="w-4 h-4 accent-violet-500" />
                    {dataType === "entries" ? "Skip duplicates (date+account+geo)" : "Replace duplicates (date+geo)"}
                  </label>
                </div>
              </div>

              {dataType === "entries" && (
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer mb-4 -mt-1">
                  <input type="checkbox" checked={autoExtractGeo} onChange={(e) => setAutoExtractGeo(e.target.checked)} className="w-4 h-4 accent-violet-500" />
                  <span>
                    <span className="text-slate-200">Auto-extract country from campaign name</span>
                    <span className="text-slate-500 ml-1">(e.g. "[TH] Million Dollar..." → Geo: Thailand · Account name cleaned)</span>
                  </span>
                </label>
              )}


              <div className="overflow-x-auto scroll-x rounded-lg border border-slate-800/60 mb-4">
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-900/60">
                    {headers.map((h, i) => (
                      <th key={i} className="px-3 py-2 text-left">
                        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 truncate max-w-[150px]" title={h}>{h || `Column ${i + 1}`}</div>
                        <select value={columnMapping[i]} onChange={(e) => { const next = [...columnMapping]; next[i] = e.target.value; setColumnMapping(next); }}
                          className={`text-xs px-2 py-1 rounded border outline-none ${columnMapping[i] === "skip" ? "bg-slate-900/40 border-slate-700/50 text-slate-500" : "bg-violet-500/15 border-violet-500/40 text-violet-200"}`}>
                          {fieldOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {parsedRows.slice(0, 5).map((row, ri) => (
                      <tr key={ri} className="border-t border-slate-800/40">
                        {row.map((cell, ci) => <td key={ci} className="px-3 py-2 text-slate-300 max-w-[200px] truncate" title={String(cell)}>{String(cell || "")}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {parsedRows.length > 5 && <p className="text-xs text-slate-500 mb-4">Showing first 5 rows of {parsedRows.length}</p>}

              {previewEntries.length > 0 && (
                <div className="bg-slate-900/40 rounded-lg p-3 mb-4">
                  <div className="text-xs text-slate-400 mb-2">First 3 entries that will be imported:</div>
                  <div className="space-y-1.5 font-mono-num text-xs">
                    {previewEntries.slice(0, 3).map((e, i) => (
                      <div key={i} className="text-slate-300">
                        <span className="text-cyan-300">{e.date}</span>
                        {dataType === "entries" ? (
                          <>
                            {" · "}<span className="text-slate-200">{e.account}</span>
                            {e.geo && <span className="text-slate-500"> · {e.geo}</span>}
                            {" · "}<span className="text-emerald-300">{formatUSD(e.amount)}</span>
                            {e.leads > 0 && <span className="text-slate-500"> · {e.leads} leads</span>}
                          </>
                        ) : (
                          <>
                            {" · "}<span className="text-slate-200">{e.geo}</span>
                            {" · "}<span className="text-amber-300">{formatNum(e.count)} deposits</span>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button onClick={onClose} className="px-4 py-2.5 rounded-lg glass glass-hover text-sm text-slate-300">Cancel</button>
                <button onClick={handleConfirmTabular} disabled={validCount === 0} className="px-4 py-2.5 rounded-lg bg-violet-500 hover:bg-violet-400 text-white text-sm font-semibold disabled:opacity-40">
                  Import {validCount} {dataType === "entries" ? (validCount === 1 ? "entry" : "entries") : "deposit records"}
                </button>
              </div>
            </div>
          )}

          {/* Image extraction preview */}
          {extractedFromImage && (
            <div>
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div>
                  <h4 className="font-display text-base font-bold text-white flex items-center gap-2"><Sparkles className="w-4 h-4 text-violet-400" />Extracted from screenshot</h4>
                  <p className="text-xs text-slate-500">{extractedFromImage.length} entries detected — review before importing</p>
                </div>
                <button onClick={() => { setExtractedFromImage(null); setImageFile(null); setImagePreview(null); }} className="text-xs text-slate-400 hover:text-slate-200">Try another image</button>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-300 mb-4 cursor-pointer">
                <input type="checkbox" checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} className="w-4 h-4 accent-violet-500" />
                {dataType === "entries" ? "Skip duplicates (date+account+geo)" : "Replace duplicates (date+geo)"}
              </label>

              <div className="overflow-x-auto scroll-x rounded-lg border border-slate-800/60 mb-4 max-h-96 overflow-y-auto">
                <table className="w-full text-xs">
                  {dataType === "entries" ? (
                    <>
                      <thead className="bg-slate-900/60 sticky top-0"><tr className="text-[10px] uppercase tracking-wider text-slate-500">
                        <th className="px-3 py-2 text-left">Date</th>
                        <th className="px-3 py-2 text-left">Account</th>
                        <th className="px-3 py-2 text-left">Geo</th>
                        <th className="px-3 py-2 text-right">Spend</th>
                        <th className="px-3 py-2 text-right">Impr</th>
                        <th className="px-3 py-2 text-right">Clicks</th>
                        <th className="px-3 py-2 text-right">Leads</th>
                        <th className="px-3 py-2"></th>
                      </tr></thead>
                      <tbody>
                        {extractedFromImage.map((e, i) => (
                          <tr key={i} className="border-t border-slate-800/40">
                            <td className="px-3 py-2 text-cyan-300 font-mono-num whitespace-nowrap">{e.date}</td>
                            <td className="px-3 py-2"><input type="text" value={e.account} onChange={(ev) => { const next = [...extractedFromImage]; next[i] = { ...next[i], account: ev.target.value }; setExtractedFromImage(next); }} className="bg-transparent text-slate-200 w-full outline-none focus:bg-slate-900/40 px-1 rounded" /></td>
                            <td className="px-3 py-2"><input type="text" value={e.geo} onChange={(ev) => { const next = [...extractedFromImage]; next[i] = { ...next[i], geo: ev.target.value }; setExtractedFromImage(next); }} className="bg-transparent text-slate-300 w-full outline-none focus:bg-slate-900/40 px-1 rounded" /></td>
                            <td className="px-3 py-2 text-right text-emerald-300 font-mono-num">{formatUSD(e.amount)}</td>
                            <td className="px-3 py-2 text-right text-slate-300 font-mono-num">{e.impressions ? formatNumCompact(e.impressions) : "—"}</td>
                            <td className="px-3 py-2 text-right text-slate-300 font-mono-num">{e.clicks ? formatNumCompact(e.clicks) : "—"}</td>
                            <td className="px-3 py-2 text-right text-slate-300 font-mono-num">{e.leads ? formatNumCompact(e.leads) : "—"}</td>
                            <td className="px-3 py-2"><button onClick={() => setExtractedFromImage(extractedFromImage.filter((_, idx) => idx !== i))} className="p-1 rounded text-slate-500 hover:text-pink-400"><Trash2 className="w-3.5 h-3.5" /></button></td>
                          </tr>
                        ))}
                      </tbody>
                    </>
                  ) : (
                    <>
                      <thead className="bg-slate-900/60 sticky top-0"><tr className="text-[10px] uppercase tracking-wider text-slate-500">
                        <th className="px-3 py-2 text-left">Date</th>
                        <th className="px-3 py-2 text-left">Country</th>
                        <th className="px-3 py-2 text-right">Deposits</th>
                        <th className="px-3 py-2"></th>
                      </tr></thead>
                      <tbody>
                        {extractedFromImage.map((d, i) => (
                          <tr key={i} className="border-t border-slate-800/40">
                            <td className="px-3 py-2 text-cyan-300 font-mono-num whitespace-nowrap">{d.date}</td>
                            <td className="px-3 py-2"><input type="text" value={d.geo} onChange={(ev) => { const next = [...extractedFromImage]; next[i] = { ...next[i], geo: ev.target.value }; setExtractedFromImage(next); }} className="bg-transparent text-slate-200 w-full outline-none focus:bg-slate-900/40 px-1 rounded" /></td>
                            <td className="px-3 py-2 text-right text-amber-300 font-mono-num font-semibold">{formatNum(d.count)}</td>
                            <td className="px-3 py-2"><button onClick={() => setExtractedFromImage(extractedFromImage.filter((_, idx) => idx !== i))} className="p-1 rounded text-slate-500 hover:text-pink-400"><Trash2 className="w-3.5 h-3.5" /></button></td>
                          </tr>
                        ))}
                      </tbody>
                    </>
                  )}
                </table>
              </div>

              <div className="flex justify-end gap-2">
                <button onClick={onClose} className="px-4 py-2.5 rounded-lg glass glass-hover text-sm text-slate-300">Cancel</button>
                <button onClick={handleConfirmImage} disabled={extractedFromImage.length === 0} className="px-4 py-2.5 rounded-lg bg-violet-500 hover:bg-violet-400 text-white text-sm font-semibold disabled:opacity-40">Import {extractedFromImage.length} {dataType === "entries" ? "entries" : "records"}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ===== DELETE MODAL =====
function DeleteModal({
  onClose, onDelete,
  entriesTotal, depositsTotal, topupsTotal,
  filteredEntriesCount, filteredDepositsCount,
  rangeFilter, accountFilter, geoFilter,
}) {
  const [mode, setMode] = useState("filtered_entries");
  const [confirmText, setConfirmText] = useState("");

  const isFilterActive = rangeFilter !== "all" || accountFilter !== "all" || geoFilter !== "all";
  const filterLabel = [
    rangeFilter !== "all" ? `last ${rangeFilter} days` : null,
    accountFilter !== "all" ? `account: ${accountFilter}` : null,
    geoFilter !== "all" ? `geo: ${geoFilter}` : null,
  ].filter(Boolean).join(" · ");

  const counts = {
    filtered_entries: filteredEntriesCount,
    filtered_deposits: filteredDepositsCount,
    all_entries: entriesTotal,
    all_deposits: depositsTotal,
    all_topups: topupsTotal,
    everything: entriesTotal + depositsTotal + topupsTotal,
  };

  const isHighRisk = mode === "all_entries" || mode === "all_deposits" || mode === "all_topups" || mode === "everything";
  const targetCount = counts[mode] || 0;
  const canDelete = targetCount > 0 && (!isHighRisk || confirmText === "DELETE");

  const options = [
    { value: "filtered_entries", label: "Entries matching current filter", subtitle: isFilterActive ? `Filter: ${filterLabel}` : "No filter active — same as 'all entries'", count: filteredEntriesCount, color: "violet" },
    { value: "filtered_deposits", label: "Deposits matching current filter", subtitle: isFilterActive ? `Filter: ${filterLabel}` : "No filter active — same as 'all deposits'", count: filteredDepositsCount, color: "violet" },
    { value: "all_entries", label: "All campaign entries", subtitle: "Wipes every imported campaign entry", count: entriesTotal, color: "pink" },
    { value: "all_deposits", label: "All daily deposits", subtitle: "Wipes every deposit record", count: depositsTotal, color: "pink" },
    { value: "all_topups", label: "All top-ups", subtitle: "Wipes every top-up record", count: topupsTotal, color: "pink" },
    { value: "everything", label: "Everything", subtitle: "Wipes entries, deposits, and top-ups — full reset", count: entriesTotal + depositsTotal + topupsTotal, color: "pink" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 md:p-4 bg-black/70 backdrop-blur-sm">
      <div className="glass rounded-2xl max-w-2xl w-full max-h-[95vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-pink-500/20 flex items-center justify-center">
              <Trash2 className="w-5 h-5 text-pink-400" />
            </div>
            <div>
              <h3 className="font-display text-lg font-bold text-white">Bulk Delete</h3>
              <p className="text-xs text-slate-400">Permanently remove imported data — cannot be undone</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-800/60 text-slate-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-2">
          {options.map((opt) => {
            const selected = mode === opt.value;
            const disabled = opt.count === 0;
            return (
              <button
                key={opt.value}
                onClick={() => !disabled && setMode(opt.value)}
                disabled={disabled}
                className={`w-full text-left p-4 rounded-lg border transition-colors ${
                  selected
                    ? opt.color === "pink"
                      ? "bg-pink-500/15 border-pink-500/40"
                      : "bg-violet-500/15 border-violet-500/40"
                    : "bg-slate-900/40 border-slate-800/60 hover:border-slate-700/60"
                } ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-4 h-4 rounded-full border-2 mt-0.5 shrink-0 ${
                    selected
                      ? opt.color === "pink" ? "border-pink-400 bg-pink-400" : "border-violet-400 bg-violet-400"
                      : "border-slate-600"
                  }`}>
                    {selected && <div className="w-1.5 h-1.5 bg-slate-950 rounded-full m-auto mt-[3px]"></div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className={`text-sm font-medium ${selected ? "text-white" : "text-slate-200"}`}>{opt.label}</span>
                      <span className={`text-xs font-mono-num font-semibold ${
                        opt.count === 0 ? "text-slate-600" : opt.color === "pink" ? "text-pink-300" : "text-violet-300"
                      }`}>
                        {opt.count} {opt.count === 1 ? "record" : "records"}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{opt.subtitle}</p>
                  </div>
                </div>
              </button>
            );
          })}

          {isHighRisk && targetCount > 0 && (
            <div className="mt-4 p-3 rounded-lg bg-pink-500/10 border border-pink-500/30">
              <div className="flex items-start gap-2 mb-3">
                <AlertCircle className="w-4 h-4 text-pink-400 shrink-0 mt-0.5" />
                <div className="text-xs text-pink-200">
                  This will permanently delete <strong className="font-mono-num">{targetCount}</strong> {targetCount === 1 ? "record" : "records"}.
                  Type <strong className="font-mono-num">DELETE</strong> to confirm.
                </div>
              </div>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="Type DELETE"
                className="input-base font-mono-num"
                autoFocus
              />
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-800/60 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg glass glass-hover text-sm text-slate-300">
            Cancel
          </button>
          <button
            onClick={() => onDelete(mode)}
            disabled={!canDelete}
            className="px-4 py-2.5 rounded-lg bg-pink-500 hover:bg-pink-400 text-white text-sm font-semibold flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-4 h-4" />
            Delete {targetCount} {targetCount === 1 ? "record" : "records"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Helpers
function FilterChip({ label, onClear, color = "cyan" }) {
  const colors = {
    cyan: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30 hover:bg-cyan-500/25",
    emerald: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25",
    violet: "bg-violet-500/15 text-violet-300 border-violet-500/30 hover:bg-violet-500/25",
    amber: "bg-amber-500/15 text-amber-300 border-amber-500/30 hover:bg-amber-500/25",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${colors[color]} transition-colors`}>
      <span className="truncate max-w-[140px]">{label}</span>
      <button
        onClick={onClear}
        className="rounded-sm hover:bg-white/10 p-0.5 -mr-0.5"
        aria-label="Clear filter"
      >
        <X className="w-2.5 h-2.5" />
      </button>
    </span>
  );
}

function HeroStat({ label, value, sublabel, icon, accent }) {
  const accents = {
    emerald: { glow: "rgba(52,211,153,0.18)", text: "text-emerald-400" },
    amber: { glow: "rgba(251,191,36,0.18)", text: "text-amber-400" },
    violet: { glow: "rgba(167,139,250,0.18)", text: "text-violet-400" },
    cyan: { glow: "rgba(34,211,238,0.18)", text: "text-cyan-400" },
  };
  const ac = accents[accent] || accents.cyan;
  // Detect CJK characters — Chinese/Japanese/Korean labels need tighter
  // letter-spacing and no uppercase to avoid awkward wrapping.
  const labelStr = String(label || "");
  const hasCJK = /[\u3000-\u9fff\uac00-\ud7af]/.test(labelStr);
  const labelClass = hasCJK
    ? `relative text-[11px] tracking-normal whitespace-nowrap ${ac.text} mb-1.5 flex items-center gap-1.5 min-w-0`
    : `relative text-[10px] uppercase tracking-[0.2em] whitespace-nowrap ${ac.text} mb-1.5 flex items-center gap-1.5 min-w-0`;
  return (
    <div className="p-3 md:p-5 lg:p-4 xl:p-5 border-r last:border-r-0 lg:border-b-0 border-slate-800/60 relative group hover:bg-slate-900/30 transition-colors min-w-0 overflow-hidden">
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
        style={{ background: `radial-gradient(circle at 50% 50%, ${ac.glow}, transparent 70%)` }}
      />
      <div className={labelClass}>
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="relative font-mono-num text-xl md:text-2xl xl:text-3xl font-bold text-white leading-none truncate">
        {value}
      </div>
      {sublabel && (
        <div className="relative text-[10px] text-slate-400 font-mono-num mt-1 truncate">
          {sublabel}
        </div>
      )}
    </div>
  );
}

function MiniMetric({ label, value, icon, accent }) {
  const colors = { emerald: "text-emerald-400", violet: "text-violet-400", amber: "text-amber-400", cyan: "text-cyan-400" };
  return (
    <div>
      <div className={`flex items-center gap-1 text-[10px] uppercase tracking-wider mb-1 ${colors[accent] || "text-slate-400"}`}>{icon}{label}</div>
      <div className="font-mono-num text-base md:text-xl font-bold text-white">{value}</div>
    </div>
  );
}

function KpiCard({ label, value, change, sublabel, accent, higherIsBetter = true }) {
  const accents = {
    cyan: "from-cyan-500/30 to-transparent", violet: "from-violet-500/30 to-transparent",
    pink: "from-pink-500/30 to-transparent", emerald: "from-emerald-500/30 to-transparent",
    amber: "from-amber-500/30 to-transparent", blue: "from-blue-500/30 to-transparent",
  };
  const ac = accents[accent] || accents.cyan;
  const isPositive = higherIsBetter ? change >= 0 : change <= 0;
  return (
    <div className="glass rounded-xl p-3 md:p-4 relative overflow-hidden">
      <div className={`absolute top-0 left-0 right-0 h-px bg-gradient-to-r ${ac}`} />
      <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-1.5">{label}</div>
      <div className="font-mono-num text-lg md:text-2xl font-bold text-white mb-1">{value}</div>
      {change !== null && change !== undefined && !isNaN(change) ? (
        <div className={`flex items-center gap-1 text-[10px] ${isPositive ? "text-emerald-400" : "text-pink-400"}`}>
          {change >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          <span className="font-mono-num">{change >= 0 ? "+" : ""}{change.toFixed(1)}%</span>
        </div>
      ) : sublabel ? <div className="text-[10px] text-slate-500 truncate">{sublabel}</div> : <div className="text-[10px] text-slate-600">—</div>}
    </div>
  );
}

function Funnel({ impressions, clicks, leads, deposits, ctr, cvr, l2d }) {
  const max = Math.max(impressions || 0, clicks || 0, leads || 0, deposits || 0, 1);
  const allStages = [
    { label: "Impressions", value: impressions, color: "#60a5fa", icon: <Eye className="w-4 h-4" /> },
    { label: "Clicks", value: clicks, color: "#a78bfa", icon: <MousePointerClick className="w-4 h-4" /> },
    { label: "Leads", value: leads, color: "#34d399", icon: <Users className="w-4 h-4" /> },
    { label: "Deposits", value: deposits, color: "#fbbf24", icon: <Banknote className="w-4 h-4" /> },
  ].filter((s) => s.value > 0 || s.label === "Impressions");
  // Add transition labels
  const labels = ["CTR", "CVR (lead)", "Lead → Dep"];
  const rates = [ctr, cvr, l2d];

  return (
    <div className="space-y-3">
      {allStages.map((s, i) => (
        <div key={s.label}>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <span style={{ color: s.color }}>{s.icon}</span>{s.label}
            </div>
            <div className="font-mono-num text-sm font-semibold text-white">{formatNum(s.value)}</div>
          </div>
          <div className="h-8 bg-slate-900/40 rounded-md overflow-hidden relative">
            <div className="h-full rounded-md transition-all duration-700" style={{ width: `${Math.max((s.value / max) * 100, 0.5)}%`, background: `linear-gradient(90deg, ${s.color}40, ${s.color}80)`, borderRight: `2px solid ${s.color}` }} />
          </div>
          {i < allStages.length - 1 && (
            <div className="flex items-center gap-1 text-[10px] text-slate-500 mt-1 ml-2">
              <ChevronDown className="w-3 h-3" />
              <span>{labels[i]} {formatPct(rates[i])}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function GeoTable({ items, colors, totalSpend, onRowClick, activeGeo }) {
  return (
    <div className="overflow-x-auto scroll-x">
      <table className="w-full text-sm min-w-[700px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.15em] text-slate-500 border-b border-slate-800/60">
            <th className="text-left px-3 py-3 font-medium w-12">#</th>
            <th className="text-left px-3 py-3 font-medium">Country</th>
            <th className="text-right px-3 py-3 font-medium">Spend</th>
            <th className="text-left px-3 py-3 font-medium">Share</th>
            <th className="text-right px-3 py-3 font-medium">Leads</th>
            <th className="text-right px-3 py-3 font-medium">CPL</th>
            <th className="text-right px-3 py-3 font-medium">Deposits</th>
            <th className="text-right px-3 py-3 font-medium">Dep $</th>
            <th className="text-right px-3 py-3 font-medium">CPD</th>
            <th className="text-right px-3 py-3 font-medium">L→D</th>
          </tr>
        </thead>
        <tbody>
          {items.map((a, i) => {
            const pct = totalSpend > 0 ? (a.spend / totalSpend) * 100 : 0;
            const color = colors[i % colors.length];
            return (
              <tr
                key={a.name}
                onClick={() => onRowClick && onRowClick(a.name)}
                className={`border-b border-slate-800/40 transition-colors group ${
                  onRowClick ? "cursor-pointer" : ""
                } ${
                  activeGeo === a.name
                    ? "bg-cyan-500/10 hover:bg-cyan-500/15"
                    : "hover:bg-slate-800/30"
                }`}
                title={onRowClick ? `Click to filter dashboard to ${a.name}` : undefined}
              >
                <td className="px-3 py-3 text-xs font-mono-num text-slate-600 group-hover:text-slate-400 transition-colors">
                  {String(i + 1).padStart(2, "0")}
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="text-xl leading-none">{flagFor(a.name)}</span>
                    <span className="text-slate-100 text-sm font-medium">{a.name}</span>
                  </div>
                </td>
                <td className="px-3 py-3 text-right font-mono-num text-slate-100 font-bold">
                  {formatUSDCompact(a.spend)}
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2 min-w-[100px]">
                    <div className="flex-1 h-1.5 bg-slate-900/80 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${pct}%`, background: color, boxShadow: `0 0 8px ${color}40` }}
                      />
                    </div>
                    <span className="font-mono-num text-slate-400 text-[10px] w-10 text-right">
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                </td>
                <td className="px-3 py-3 text-right font-mono-num text-emerald-300 text-xs font-semibold">
                  {a.leads ? formatNumCompact(a.leads) : "—"}
                </td>
                <td className="px-3 py-3 text-right font-mono-num text-slate-300 text-xs">
                  {a.cpl != null ? formatUSDCompact(a.cpl) : "—"}
                </td>
                <td className="px-3 py-3 text-right font-mono-num text-amber-300 text-xs font-bold">
                  {a.deposits ? formatNumCompact(a.deposits) : "—"}
                </td>
                <td className="px-3 py-3 text-right font-mono-num text-emerald-300 text-xs font-semibold">
                  {a.depositAmount > 0 ? formatUSDCompact(a.depositAmount) : "—"}
                </td>
                <td className="px-3 py-3 text-right font-mono-num text-cyan-300 text-xs font-semibold">
                  {a.cpd != null ? formatUSDCompact(a.cpd) : "—"}
                </td>
                <td className="px-3 py-3 text-right font-mono-num text-slate-400 text-xs">
                  {formatPct(a.l2d)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BreakdownList({ items, colors, totalSpend, onItemClick, activeItem }) {
  return (
    <div className="space-y-3">
      {items.map((a, i) => {
        const pct = totalSpend > 0 ? (a.spend / totalSpend) * 100 : 0;
        const color = colors[i % colors.length];
        const isActive = activeItem === a.name;
        const isClickable = !!onItemClick;
        return (
          <div
            key={a.name}
            onClick={() => onItemClick && onItemClick(a.name)}
            className={`-mx-2 px-2 py-1.5 rounded-lg transition-colors ${
              isClickable ? "cursor-pointer hover:bg-slate-800/40" : ""
            } ${isActive ? "bg-cyan-500/10 ring-1 ring-cyan-500/30" : ""}`}
            title={isClickable ? `Click to filter to ${a.name}` : undefined}
          >
            <div className="flex items-center justify-between text-sm mb-1.5">
              <div className="flex items-center gap-2 min-w-0 pr-2">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                <span className="text-slate-200 truncate">{a.name}</span>
              </div>
              <span className="font-mono-num text-slate-300 text-xs whitespace-nowrap">{formatUSDCompact(a.spend)}</span>
            </div>
            <div className="h-1.5 bg-slate-800/60 rounded-full overflow-hidden mb-1.5">
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
            </div>
            <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono-num">
              <span>{pct.toFixed(1)}%</span>
              <div className="flex items-center gap-3">
                <span>Leads {formatNumCompact(a.leads)}</span>
                <span>CPL {a.cpl != null ? formatUSDCompact(a.cpl) : "—"}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Field({ label, children }) {
  return (<div><label className="block text-xs uppercase tracking-wider text-slate-400 mb-1.5">{label}</label>{children}</div>);
}

function PreviewMetric({ label, value }) {
  return (
    <div className="bg-slate-900/40 rounded px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">{label}</div>
      <div className="font-mono-num text-sm text-cyan-300 font-semibold">{value}</div>
    </div>
  );
}
