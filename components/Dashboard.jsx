import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Plus, Trash2, Pencil, Download, Upload, TrendingUp, TrendingDown,
  Calendar, X, Check, Filter, DollarSign, Lock, LogOut, Target,
  Activity, RefreshCw, Globe, MousePointerClick, Eye, Users,
  ChevronDown, ClipboardPaste, FileSpreadsheet, ImageIcon, Sparkles,
  AlertCircle, Wallet, Banknote,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import Papa from "papaparse";
import { storage } from "@/lib/storage";

const ENTRIES_KEY = "meta_spend_entries_v3";
const CONFIG_KEY = "meta_spend_config_v3";
const DEPOSITS_KEY = "meta_spend_deposits_v1";

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
];

const COLUMN_PATTERNS = [
  { field: "date", pattern: /^(date|day|reporting[\s_.-]*start|reporting[\s_.-]*end|date[\s_.-]*range)/i },
  { field: "amount", pattern: /^(amount[\s_.-]*spent|spend|total[\s_.-]*spent)\b/i },
  { field: "impressions", pattern: /^(impressions|imp\b)/i },
  { field: "clicks", pattern: /^(link[\s_.-]*clicks|clicks|all[\s_.-]*clicks)/i },
  { field: "leads", pattern: /^(leads|results|conversions|registrations|complete[\s_.-]*registration|sign[\s_.-]*ups?)/i },
  { field: "account", pattern: /^(account|campaign|ad[\s_.-]*set|ad[\s_.-]*name|campaign[\s_.-]*name)/i },
  { field: "geo", pattern: /^(country|geo|region|location|market)/i },
  { field: "notes", pattern: /^(notes?|description|comment)/i },
];

const DEPOSIT_COLUMN_PATTERNS = [
  { field: "date", pattern: /^(date|day)/i },
  { field: "geo", pattern: /^(country|geo|region|location|market)/i },
  { field: "count", pattern: /^(deposits?|count|deposit[\s_.-]*count|total[\s_.-]*deposits?|ftd|first[\s_.-]*deposit)/i },
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

function normalizeGeo(input) {
  if (input == null) return input;
  const trimmed = String(input).trim();
  if (!trimmed) return trimmed;
  const upper = trimmed.toUpperCase();
  if (COUNTRY_NORMALIZE[upper]) return COUNTRY_NORMALIZE[upper];
  return trimmed;
}

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
const timeAgo = (iso) => {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
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

const aggregate = (entryList, depositList = []) => {
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
  const [config, setConfig] = useState({ passcode: null, dailyBudget: 0, lastUpdated: null });
  const [loaded, setLoaded] = useState(false);

  const [isAdmin, setIsAdmin] = useState(false);
  const [showPasscodeModal, setShowPasscodeModal] = useState(false);
  const [passcodeInput, setPasscodeInput] = useState("");
  const [passcodeError, setPasscodeError] = useState("");
  const [isFirstSetup, setIsFirstSetup] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

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
  const [activeGeos, setActiveGeos] = useState(["Brazil", "Mexico", "Indonesia", "Thailand"]);
  const [addGeoSelect, setAddGeoSelect] = useState("");

  const [budgetInput, setBudgetInput] = useState("");

  // Filters
  const [rangeFilter, setRangeFilter] = useState("30");
  const [accountFilter, setAccountFilter] = useState("all");
  const [geoFilter, setGeoFilter] = useState("all");
  const [chartMetric, setChartMetric] = useState("spend");

  const [, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(i);
  }, []);

  const loadAll = async () => {
    try {
      const [e, c, d] = await Promise.all([
        storage.get(ENTRIES_KEY, true).catch(() => null),
        storage.get(CONFIG_KEY, true).catch(() => null),
        storage.get(DEPOSITS_KEY, true).catch(() => null),
      ]);
      if (e?.value) setEntries(JSON.parse(e.value));
      if (d?.value) setDeposits(JSON.parse(d.value));
      if (c?.value) {
        const parsed = JSON.parse(c.value);
        setConfig(parsed);
        setBudgetInput(parsed.dailyBudget ? String(parsed.dailyBudget) : "");
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
      if (!isNaN(n) && n > 0) {
        next.push({
          id: Date.now().toString() + Math.random().toString(36).slice(2, 7) + g,
          date: depositDate, geo: g, count: n,
          createdAt: new Date().toISOString(),
        });
      }
    });
    setDeposits(next);
    await persistDeposits(next);
  };

  const handleDeleteDeposit = async (id) => {
    const next = deposits.filter((d) => d.id !== id);
    setDeposits(next);
    await persistDeposits(next);
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

  // Bulk import
  const handleBulkImport = async (data, dataType, options = {}) => {
    const { skipDuplicates = true } = options;
    if (dataType === "entries") {
      let toAdd = data.map((e) => ({
        id: Date.now().toString() + Math.random().toString(36).slice(2, 9),
        date: e.date, account: e.account || "Other", geo: e.geo || "",
        amount: e.amount || 0, impressions: e.impressions || 0,
        clicks: e.clicks || 0, leads: e.leads || 0, notes: e.notes || "",
        createdAt: new Date().toISOString(),
      }));
      if (skipDuplicates) {
        const existing = new Set(entries.map((e) => `${e.date}__${e.account}__${e.geo}`));
        toAdd = toAdd.filter((e) => !existing.has(`${e.date}__${e.account}__${e.geo}`));
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

  const exportCSV = () => {
    const header = ["Date", "Account", "Geo", "Spend (USD)", "Impressions", "Clicks", "Leads", "CTR (%)", "CPC (USD)", "CPL (USD)", "Notes"];
    const rows = [...entries].sort((a, b) => a.date.localeCompare(b.date)).map((e) => {
      const ctr = e.impressions > 0 ? ((e.clicks || 0) / e.impressions) * 100 : "";
      const cpc = e.clicks > 0 ? e.amount / e.clicks : "";
      const cpl = e.leads > 0 ? e.amount / e.leads : "";
      return [
        e.date, `"${(e.account || "").replace(/"/g, '""')}"`, `"${(e.geo || "").replace(/"/g, '""')}"`,
        e.amount.toFixed(2), e.impressions || 0, e.clicks || 0, e.leads || 0,
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
  const allGeos = useMemo(() => {
    const s = new Set();
    entries.forEach((e) => { if (e.geo) s.add(e.geo); });
    deposits.forEach((d) => { if (d.geo) s.add(d.geo); });
    return Array.from(s);
  }, [entries, deposits]);

  // Filtered campaign entries — respects account + geo + range
  const filteredEntries = useMemo(() => {
    let list = [...entries];
    if (rangeFilter !== "all") {
      const cutoff = daysAgoISO(parseInt(rangeFilter, 10));
      list = list.filter((e) => e.date >= cutoff);
    }
    if (accountFilter !== "all") list = list.filter((e) => e.account === accountFilter);
    if (geoFilter !== "all") list = list.filter((e) => e.geo === geoFilter);
    return list.sort((a, b) => b.date.localeCompare(a.date));
  }, [entries, rangeFilter, accountFilter, geoFilter]);

  // Filtered deposits — respects geo + range only (deposits aren't tied to accounts)
  const filteredDeposits = useMemo(() => {
    let list = [...deposits];
    if (rangeFilter !== "all") {
      const cutoff = daysAgoISO(parseInt(rangeFilter, 10));
      list = list.filter((d) => d.date >= cutoff);
    }
    if (geoFilter !== "all") list = list.filter((d) => d.geo === geoFilter);
    return list.sort((a, b) => b.date.localeCompare(a.date));
  }, [deposits, rangeFilter, geoFilter]);

  // Multi-period summary stats — independent of the date range filter so the
  // summary table can show Today / 7D / 30D / MTD / All-time side by side.
  // Respects account+geo filter for drill-down (e.g. "show all periods for Brazil").
  const summaryStats = useMemo(() => {
    let entriesScoped = entries;
    let depositsScoped = deposits;
    if (accountFilter !== "all") {
      entriesScoped = entriesScoped.filter((e) => e.account === accountFilter);
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
        depositsScoped.filter((d) => d.date === today)
      ),
      yesterday: aggregate(
        entriesScoped.filter((e) => e.date === yesterday),
        depositsScoped.filter((d) => d.date === yesterday)
      ),
      last7: aggregate(
        filterRange(entriesScoped, weekAgo),
        filterRange(depositsScoped, weekAgo)
      ),
      last30: aggregate(
        filterRange(entriesScoped, monthAgo),
        filterRange(depositsScoped, monthAgo)
      ),
      mtd: aggregate(
        filterRange(entriesScoped, monthStart),
        filterRange(depositsScoped, monthStart)
      ),
      allTime: aggregate(entriesScoped, depositsScoped),
    };
  }, [entries, deposits, accountFilter, geoFilter]);

  const stats = useMemo(() => {
    const today = todayISO();
    const yesterday = daysAgoISO(1);
    const weekAgo = daysAgoISO(7);
    const twoWeeksAgo = daysAgoISO(14);
    const monthAgo = daysAgoISO(30);

    const todayData = aggregate(
      filteredEntries.filter((e) => e.date === today),
      filteredDeposits.filter((d) => d.date === today)
    );
    const yesterdayData = aggregate(
      filteredEntries.filter((e) => e.date === yesterday),
      filteredDeposits.filter((d) => d.date === yesterday)
    );
    const weekData = aggregate(
      filteredEntries.filter((e) => e.date >= weekAgo),
      filteredDeposits.filter((d) => d.date >= weekAgo)
    );
    const lastWeekData = aggregate(
      filteredEntries.filter((e) => e.date >= twoWeeksAgo && e.date < weekAgo),
      filteredDeposits.filter((d) => d.date >= twoWeeksAgo && d.date < weekAgo)
    );
    const monthData = aggregate(
      filteredEntries.filter((e) => e.date >= monthAgo),
      filteredDeposits.filter((d) => d.date >= monthAgo)
    );
    const total = aggregate(filteredEntries, filteredDeposits);

    const dod = yesterdayData.spend > 0 ? ((todayData.spend - yesterdayData.spend) / yesterdayData.spend) * 100 : null;
    const wow = lastWeekData.spend > 0 ? ((weekData.spend - lastWeekData.spend) / lastWeekData.spend) * 100 : null;
    const leadsWow = lastWeekData.leads > 0 ? ((weekData.leads - lastWeekData.leads) / lastWeekData.leads) * 100 : null;
    const cplWow = lastWeekData.cpl != null && weekData.cpl != null ? ((weekData.cpl - lastWeekData.cpl) / lastWeekData.cpl) * 100 : null;
    const depositsWow = lastWeekData.deposits > 0 ? ((weekData.deposits - lastWeekData.deposits) / lastWeekData.deposits) * 100 : null;
    const cpdWow = lastWeekData.cpd != null && weekData.cpd != null ? ((weekData.cpd - lastWeekData.cpd) / lastWeekData.cpd) * 100 : null;

    const days = new Set(filteredEntries.map((e) => e.date));
    const avgDaily = days.size > 0 ? total.spend / days.size : 0;

    return { today: todayData, yesterday: yesterdayData, week: weekData, lastWeek: lastWeekData, month: monthData, total, dod, wow, leadsWow, cplWow, depositsWow, cpdWow, avgDaily, activeDays: days.size };
  }, [filteredEntries, filteredDeposits]);

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
      const cpl = d.leads > 0 ? d.spend / d.leads : 0;
      const cpd = d.deposits > 0 ? d.spend / d.deposits : 0;
      return {
        date, label: formatShortDate(date),
        spend: parseFloat(d.spend.toFixed(2)),
        impressions: d.impressions, clicks: d.clicks, leads: d.leads, deposits: d.deposits,
        cpl: parseFloat(cpl.toFixed(2)), cpd: parseFloat(cpd.toFixed(2)),
      };
    });
  }, [filteredEntries, filteredDeposits, rangeFilter]);

  const byAccount = useMemo(() => {
    const map = new Map();
    filteredEntries.forEach((e) => {
      if (!map.has(e.account)) map.set(e.account, []);
      map.get(e.account).push(e);
    });
    return Array.from(map.entries())
      .map(([name, list]) => ({ name, ...aggregate(list) }))
      .sort((a, b) => b.spend - a.spend);
  }, [filteredEntries]);

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
      .map((k) => ({ name: k, ...aggregate(eMap.get(k) || [], dMap.get(k) || []) }))
      .sort((a, b) => b.spend - a.spend);
  }, [filteredEntries, filteredDeposits]);

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
              Live · Meta Ads Performance
            </div>
            <h1 className="font-display text-3xl md:text-5xl font-extrabold text-white">Daily Performance Dashboard</h1>
            <p className="text-slate-400 mt-2 text-sm flex items-center gap-3 flex-wrap">
              <span>{new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-500">Updated {timeAgo(config.lastUpdated)}</span>
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={loadAll} className="flex items-center gap-2 px-3 py-2.5 rounded-lg glass glass-hover text-sm text-slate-300" title="Refresh"><RefreshCw className="w-4 h-4" /></button>
            <button onClick={exportCSV} disabled={entries.length === 0 && deposits.length === 0} className="flex items-center gap-2 px-4 py-2.5 rounded-lg glass glass-hover text-sm text-slate-200 disabled:opacity-40">
              <Download className="w-4 h-4" /><span className="hidden md:inline">Export</span>
            </button>
            {isAdmin && (
              <button onClick={() => setShowImportModal(true)} className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-violet-500/20 border border-violet-500/40 text-violet-300 text-sm font-medium hover:bg-violet-500/30">
                <Upload className="w-4 h-4" /><span className="hidden md:inline">Import</span>
              </button>
            )}
            {isAdmin ? (
              <button onClick={exitAdmin} className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-sm font-medium hover:bg-cyan-500/30">
                <LogOut className="w-4 h-4" /><span className="hidden md:inline">Exit Admin</span>
              </button>
            ) : (
              <button onClick={openAdminModal} className="flex items-center gap-2 px-4 py-2.5 rounded-lg glass glass-hover text-sm text-slate-300">
                <Lock className="w-4 h-4" /><span className="hidden md:inline">Admin</span>
              </button>
            )}
          </div>
        </header>

        {/* Hero today */}
        <div className="glass rounded-2xl p-6 md:p-8 mb-6 relative overflow-hidden">
          <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full" style={{ background: "radial-gradient(circle, rgba(34,211,238,0.15), transparent 70%)" }} />
          <div className="relative grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2">
              <div className="text-xs uppercase tracking-[0.25em] text-slate-400 mb-3 flex items-center gap-2">
                <Activity className="w-3.5 h-3.5" />Today's Spend
              </div>
              <div className="font-mono-num text-5xl md:text-7xl font-extrabold text-white leading-none mb-3">
                {formatUSD(stats.today.spend)}
              </div>
              <div className="flex items-center gap-3 flex-wrap mb-4">
                {stats.dod !== null && !isNaN(stats.dod) ? (
                  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${stats.dod >= 0 ? "bg-emerald-500/15 text-emerald-300" : "bg-pink-500/15 text-pink-300"}`}>
                    {stats.dod >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                    <span className="font-mono-num">{stats.dod >= 0 ? "+" : ""}{stats.dod.toFixed(1)}% vs yesterday</span>
                  </div>
                ) : <span className="text-xs text-slate-500">No prior-day comparison</span>}
                <span className="text-xs text-slate-500 font-mono-num">Yesterday: {formatUSD(stats.yesterday.spend)}</span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4 pt-4 border-t border-slate-800/60">
                <MiniMetric label="Leads" value={formatNumCompact(stats.today.leads)} icon={<Users className="w-3.5 h-3.5" />} accent="emerald" />
                <MiniMetric label="Deposits" value={formatNumCompact(stats.today.deposits)} icon={<Banknote className="w-3.5 h-3.5" />} accent="amber" />
                <MiniMetric label="CPL" value={stats.today.cpl != null ? formatUSDCompact(stats.today.cpl) : "—"} icon={<Target className="w-3.5 h-3.5" />} accent="violet" />
                <MiniMetric label="CPD" value={stats.today.cpd != null ? formatUSDCompact(stats.today.cpd) : "—"} icon={<Wallet className="w-3.5 h-3.5" />} accent="cyan" />
              </div>
            </div>

            {config.dailyBudget > 0 ? (
              <div className="md:border-l md:border-slate-800/60 md:pl-6">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400 mb-2 flex items-center gap-1.5"><Target className="w-3.5 h-3.5" />Daily Target</div>
                <div className="flex items-baseline gap-2 mb-2">
                  <span className="font-mono-num text-2xl font-bold text-white">{formatUSDCompact(stats.today.spend)}</span>
                  <span className="text-slate-500 font-mono-num text-sm">/ {formatUSDCompact(config.dailyBudget)}</span>
                </div>
                <div className="h-2 bg-slate-800/60 rounded-full overflow-hidden mb-2">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(budgetPct, 100)}%`, background: budgetStatus === "over" ? "#f472b6" : budgetStatus === "on" ? "#facc15" : "#22d3ee" }} />
                </div>
                <div className={`text-xs font-medium ${budgetStatus === "over" ? "text-pink-400" : budgetStatus === "on" ? "text-amber-400" : "text-cyan-400"}`}>
                  {budgetStatus === "over" ? `${(budgetPct - 100).toFixed(0)}% over target` : budgetStatus === "on" ? "On pace" : `${(100 - budgetPct).toFixed(0)}% under target`}
                </div>
              </div>
            ) : isAdmin && (
              <div className="md:border-l md:border-slate-800/60 md:pl-6 text-xs text-slate-500 italic">Set a daily target below to enable pacing</div>
            )}
          </div>
        </div>

        {/* Performance Summary — multi-period numbers at a glance */}
        <div className="glass rounded-2xl overflow-hidden mb-8">
          <div className="px-5 md:px-6 py-4 border-b border-slate-800/60 flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="font-display text-lg font-bold text-white">Performance Summary</h2>
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
                <tr className="text-xs uppercase tracking-wider text-slate-500 border-b border-slate-800/60">
                  <th className="text-left px-4 py-3 font-medium">Period</th>
                  <th className="text-right px-4 py-3 font-medium">Spend</th>
                  <th className="text-right px-4 py-3 font-medium">Impressions</th>
                  <th className="text-right px-4 py-3 font-medium">Clicks</th>
                  <th className="text-right px-4 py-3 font-medium">Leads</th>
                  <th className="text-right px-4 py-3 font-medium">Deposits</th>
                  <th className="text-right px-4 py-3 font-medium">CPL</th>
                  <th className="text-right px-4 py-3 font-medium">CPD</th>
                  <th className="text-right px-4 py-3 font-medium">L→D %</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: "Today", data: summaryStats.today },
                  { label: "Yesterday", data: summaryStats.yesterday },
                  { label: "Last 7 days", data: summaryStats.last7 },
                  { label: "Last 30 days", data: summaryStats.last30 },
                  { label: "Month to date", data: summaryStats.mtd },
                  { label: "All-time", data: summaryStats.allTime, emphasize: true },
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


        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-slate-400 mr-1">
            <Filter className="w-3.5 h-3.5" />View
          </div>
          {[["7", "7D"], ["30", "30D"], ["90", "90D"], ["all", "All"]].map(([val, label]) => (
            <button key={val} onClick={() => setRangeFilter(val)} className={`px-3 py-1.5 rounded-md text-xs font-medium ${rangeFilter === val ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40" : "glass glass-hover text-slate-400"}`}>
              {label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            {allAccounts.length > 0 && (
              <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} className="px-3 py-1.5 rounded-md text-xs glass text-slate-200 border-none focus:ring-1 focus:ring-cyan-500/50 outline-none">
                <option value="all">All accounts</option>
                {allAccounts.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            )}
            {allGeos.length > 0 && (
              <select value={geoFilter} onChange={(e) => setGeoFilter(e.target.value)} className="px-3 py-1.5 rounded-md text-xs glass text-slate-200 border-none focus:ring-1 focus:ring-cyan-500/50 outline-none">
                <option value="all">All geos</option>
                {allGeos.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            )}
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
            <h2 className="font-display text-lg font-bold text-white">Performance by Country</h2>
          </div>
          <p className="text-xs text-slate-500 mb-4">Spend, leads, and deposits per market</p>
          {byGeo.length === 0 ? (
            <p className="text-sm text-slate-500 py-8 text-center">No geo data yet</p>
          ) : (
            <GeoTable items={byGeo} colors={geoColors} totalSpend={stats.total.spend} />
          )}
        </div>

        {/* By Account */}
        <div className="glass rounded-2xl p-5 md:p-6 mb-6">
          <h2 className="font-display text-lg font-bold text-white mb-1">By Account</h2>
          <p className="text-xs text-slate-500 mb-4">Account-level split</p>
          {byAccount.length === 0 ? (
            <p className="text-sm text-slate-500 py-8 text-center">No data yet</p>
          ) : (
            <BreakdownList items={byAccount} colors={accountColors} totalSpend={stats.total.spend} />
          )}
        </div>

        {/* Admin: campaign entry form */}
        {isAdmin && (
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
                  <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="input-base pl-9 font-mono-num" />
                </div>
              </Field>
              <Field label="Impressions"><input type="number" min="0" value={impressions} onChange={(e) => setImpressions(e.target.value)} placeholder="0" className="input-base font-mono-num" /></Field>
              <Field label="Clicks"><input type="number" min="0" value={clicks} onChange={(e) => setClicks(e.target.value)} placeholder="0" className="input-base font-mono-num" /></Field>
              <Field label="Leads"><input type="number" min="0" value={leads} onChange={(e) => setLeads(e.target.value)} placeholder="0" className="input-base font-mono-num" /></Field>
              <div className="md:col-span-2 lg:col-span-4">
                <Field label="Notes (optional)"><input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Campaign name or context" className="input-base" /></Field>
              </div>
            </div>

            {amount && parseFloat(amount) > 0 && (
              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <PreviewMetric label="CTR" value={impressions && parseFloat(impressions) > 0 ? formatPct((parseFloat(clicks || 0) / parseFloat(impressions)) * 100) : "—"} />
                <PreviewMetric label="CPC" value={clicks && parseFloat(clicks) > 0 ? formatUSD(parseFloat(amount) / parseFloat(clicks)) : "—"} />
                <PreviewMetric label="CPL" value={leads && parseFloat(leads) > 0 ? formatUSD(parseFloat(amount) / parseFloat(leads)) : "—"} />
                <PreviewMetric label="CPM" value={impressions && parseFloat(impressions) > 0 ? formatUSD((parseFloat(amount) / parseFloat(impressions)) * 1000) : "—"} />
              </div>
            )}

            <button onClick={handleSubmitEntry} disabled={!amount || isNaN(parseFloat(amount))} className="mt-5 w-full md:w-auto px-6 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-40">
              {editId ? <><Check className="w-4 h-4" /> Save changes</> : <><Plus className="w-4 h-4" /> Add entry</>}
            </button>

            <div className="mt-6 pt-5 border-t border-slate-800/60">
              <label className="text-xs uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5"><Target className="w-3.5 h-3.5" />Daily Target (USD)</label>
              <div className="flex gap-2 max-w-md">
                <div className="relative flex-1">
                  <DollarSign className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input type="number" step="0.01" min="0" value={budgetInput} onChange={(e) => setBudgetInput(e.target.value)} placeholder="e.g. 5000" className="input-base pl-9 font-mono-num" />
                </div>
                <button onClick={saveBudget} className="px-4 py-2.5 rounded-lg glass glass-hover text-sm text-slate-200">Save</button>
              </div>
            </div>
          </div>
        )}

        {/* Admin: deposits form (multi-row by country) */}
        {isAdmin && (
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
                      const ctr = e.impressions > 0 ? ((e.clicks || 0) / e.impressions) * 100 : null;
                      const cpl = e.leads > 0 ? e.amount / e.leads : null;
                      return (
                        <tr key={e.id} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                          <td className="px-4 py-3 text-slate-200 font-mono-num text-xs whitespace-nowrap">{formatDate(e.date)}</td>
                          <td className="px-4 py-3 text-slate-200 text-xs whitespace-nowrap">{e.account}</td>
                          <td className="px-4 py-3 text-slate-300 text-xs whitespace-nowrap">{e.geo || "—"}</td>
                          <td className="px-4 py-3 text-right font-mono-num text-slate-100 font-semibold text-xs">{formatUSD(e.amount)}</td>
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
                      <td colSpan={3} className="px-4 py-3 text-xs uppercase tracking-wider text-slate-400">Period total</td>
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
                  const cpl = e.leads > 0 ? e.amount / e.leads : null;
                  return (
                    <div key={e.id} className="px-5 py-3">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <span className="text-xs text-slate-400 font-mono-num">{formatShortDate(e.date)}</span>
                            <span className="text-xs text-slate-200 truncate">{e.account}</span>
                            {e.geo && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800/60 text-slate-400">{e.geo}</span>}
                          </div>
                          {e.notes && <p className="text-xs text-slate-500 truncate">{e.notes}</p>}
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-mono-num text-slate-100 font-semibold text-sm">{formatUSD(e.amount)}</div>
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
          <div className="px-5 md:px-6 py-4 border-b border-slate-800/60 flex items-center justify-between">
            <div>
              <h2 className="font-display text-lg font-bold text-white flex items-center gap-2">
                <Banknote className="w-4 h-4 text-amber-400" /> Daily Deposits
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">{filteredDeposits.length} entries</p>
            </div>
          </div>
          {filteredDeposits.length === 0 ? (
            <div className="p-12 text-center">
              <Banknote className="w-10 h-10 mx-auto text-slate-700 mb-3" />
              <p className="text-slate-400 text-sm">{deposits.length === 0 ? (isAdmin ? "No deposit data yet. Use the form above to add daily counts." : "No deposit data yet.") : "No deposits match the current filter."}</p>
            </div>
          ) : (
            <div className="overflow-x-auto scroll-x">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wider text-slate-500 border-b border-slate-800/60">
                    <th className="text-left px-4 py-3 font-medium">Date</th>
                    <th className="text-left px-4 py-3 font-medium">Country</th>
                    <th className="text-right px-4 py-3 font-medium">Deposits</th>
                    {isAdmin && <th className="px-4 py-3"></th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredDeposits.map((d) => (
                    <tr key={d.id} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                      <td className="px-4 py-3 text-slate-200 font-mono-num text-xs whitespace-nowrap">{formatDate(d.date)}</td>
                      <td className="px-4 py-3 text-slate-200 text-xs">{d.geo}</td>
                      <td className="px-4 py-3 text-right font-mono-num text-amber-300 text-xs font-semibold">{formatNum(d.count)}</td>
                      {isAdmin && (
                        <td className="px-4 py-3"><div className="flex items-center justify-end">
                          <button onClick={() => handleDeleteDeposit(d.id)} className="p-1.5 rounded hover:bg-slate-700/50 text-slate-400 hover:text-pink-400"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div></td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-900/40">
                    <td colSpan={2} className="px-4 py-3 text-xs uppercase tracking-wider text-slate-400">Period total</td>
                    <td className="px-4 py-3 text-right font-mono-num text-amber-300 font-bold text-xs">{formatNum(stats.total.deposits)}</td>
                    {isAdmin && <td></td>}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-slate-600 mt-8">
          {isAdmin ? "Admin mode · Shared with all viewers" : "Read-only view · Unlock admin to input data"}
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

  const fieldOptions = dataType === "entries" ? FIELD_OPTIONS : DEPOSIT_FIELD_OPTIONS;
  const patterns = dataType === "entries" ? COLUMN_PATTERNS : DEPOSIT_COLUMN_PATTERNS;

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
    reader.onload = (e) => {
      const text = e.target.result;
      setPasteText(text);
      setTab("paste");
      parseTabular(text);
    };
    reader.readAsText(file);
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
    parsedRows.forEach((row) => {
      if (dataType === "entries") {
        const entry = { date: null, account: defaultAccount || "Other", geo: defaultGeo || "", amount: 0, impressions: 0, clicks: 0, leads: 0, notes: "" };
        columnMapping.forEach((field, i) => {
          if (field === "skip") return;
          const v = row[i];
          if (field === "date") entry.date = parseDate(v);
          else if (field === "account") entry.account = String(v || "").trim() || entry.account;
          else if (field === "geo") entry.geo = normalizeGeo(String(v || "").trim()) || entry.geo;
          else if (field === "notes") entry.notes = String(v || "").trim();
          else { const n = parseNumberLoose(v); if (n != null) entry[field] = n; }
        });
        // Auto-extract geo from campaign name if not already set.
        // Checks Account first, then Notes — so users can map "Campaign name"
        // to either field. The bracketed prefix is stripped from whichever
        // field actually contained it.
        if (autoExtractGeo && !entry.geo) {
          let source = null;
          if (entry.account) {
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
        const entry = { date: null, geo: defaultGeo || "", count: 0 };
        columnMapping.forEach((field, i) => {
          if (field === "skip") return;
          const v = row[i];
          if (field === "date") entry.date = parseDate(v);
          else if (field === "geo") entry.geo = normalizeGeo(String(v || "").trim()) || entry.geo;
          else if (field === "count") { const n = parseNumberLoose(v); if (n != null) entry.count = n; }
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
        : "No valid rows. Make sure Date, Geo, and Count columns are mapped correctly.");
      return;
    }
    const added = await onImport(built, dataType, { skipDuplicates });
    alert(`Imported ${added} ${dataType === "entries" ? "entries" : "deposit records"}${skipDuplicates && added < built.length ? ` (${built.length - added} duplicates ${dataType === "deposits" ? "replaced" : "skipped"})` : ""}`);
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
          </div>
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
              <input ref={csvInputRef} type="file" accept=".csv,.tsv,.txt" onChange={(e) => handleCsvFile(e.target.files[0])} className="hidden" />
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

// Helpers
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

function GeoTable({ items, colors, totalSpend }) {
  return (
    <div className="overflow-x-auto scroll-x">
      <table className="w-full text-sm min-w-[700px]">
        <thead>
          <tr className="text-xs uppercase tracking-wider text-slate-500 border-b border-slate-800/60">
            <th className="text-left px-3 py-2 font-medium">Country</th>
            <th className="text-right px-3 py-2 font-medium">Spend</th>
            <th className="text-right px-3 py-2 font-medium">% of total</th>
            <th className="text-right px-3 py-2 font-medium">Leads</th>
            <th className="text-right px-3 py-2 font-medium">CPL</th>
            <th className="text-right px-3 py-2 font-medium">Deposits</th>
            <th className="text-right px-3 py-2 font-medium">CPD</th>
            <th className="text-right px-3 py-2 font-medium">L→D %</th>
          </tr>
        </thead>
        <tbody>
          {items.map((a, i) => {
            const pct = totalSpend > 0 ? (a.spend / totalSpend) * 100 : 0;
            const color = colors[i % colors.length];
            return (
              <tr key={a.name} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                    <span className="text-slate-200 text-sm">{a.name}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right font-mono-num text-slate-100 font-semibold">{formatUSDCompact(a.spend)}</td>
                <td className="px-3 py-2.5 text-right">
                  <div className="inline-flex items-center gap-2 justify-end w-full">
                    <div className="w-12 h-1 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full" style={{ width: `${pct}%`, background: color }} />
                    </div>
                    <span className="font-mono-num text-slate-400 text-xs">{pct.toFixed(1)}%</span>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right font-mono-num text-emerald-300 text-xs">{a.leads ? formatNumCompact(a.leads) : "—"}</td>
                <td className="px-3 py-2.5 text-right font-mono-num text-slate-300 text-xs">{a.cpl != null ? formatUSDCompact(a.cpl) : "—"}</td>
                <td className="px-3 py-2.5 text-right font-mono-num text-amber-300 text-xs font-semibold">{a.deposits ? formatNumCompact(a.deposits) : "—"}</td>
                <td className="px-3 py-2.5 text-right font-mono-num text-cyan-300 text-xs">{a.cpd != null ? formatUSDCompact(a.cpd) : "—"}</td>
                <td className="px-3 py-2.5 text-right font-mono-num text-slate-400 text-xs">{formatPct(a.l2d)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BreakdownList({ items, colors, totalSpend }) {
  return (
    <div className="space-y-3">
      {items.map((a, i) => {
        const pct = totalSpend > 0 ? (a.spend / totalSpend) * 100 : 0;
        const color = colors[i % colors.length];
        return (
          <div key={a.name}>
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
