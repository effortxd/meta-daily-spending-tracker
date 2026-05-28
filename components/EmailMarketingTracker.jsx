"use client";
import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Plus, Trash2, Pencil, X, Check, ChevronLeft, Mail, Send, Clock, Eye,
  MousePointerClick, MessageSquare, AlertTriangle, UserMinus, Search,
  Download, Upload, Users, Calendar, ArrowLeft,
} from "lucide-react";
import Papa from "papaparse";
import { storage } from "@/lib/storage";

const STORAGE_KEY = "email_marketing_v1";

const CAMPAIGN_STATUS = [
  { value: "draft", label: "Draft", color: "neutral" },
  { value: "scheduled", label: "Scheduled", color: "warn" },
  { value: "sending", label: "Sending", color: "warn" },
  { value: "sent", label: "Sent", color: "good" },
  { value: "paused", label: "Paused", color: "neutral" },
];

const RECIPIENT_STATUS = [
  { value: "pending", label: "Pending", color: "neutral", icon: Clock },
  { value: "sent", label: "Sent", color: "good", icon: Send },
  { value: "opened", label: "Opened", color: "good", icon: Eye },
  { value: "clicked", label: "Clicked", color: "good", icon: MousePointerClick },
  { value: "replied", label: "Replied", color: "good", icon: MessageSquare },
  { value: "bounced", label: "Bounced", color: "danger", icon: AlertTriangle },
  { value: "failed", label: "Failed", color: "danger", icon: AlertTriangle },
  { value: "unsubscribed", label: "Unsubscribed", color: "warn", icon: UserMinus },
];

const STATUS_LABEL = Object.fromEntries(RECIPIENT_STATUS.map((s) => [s.value, s.label]));
const STATUS_COLOR = Object.fromEntries(RECIPIENT_STATUS.map((s) => [s.value, s.color]));
const CAMPAIGN_STATUS_COLOR = Object.fromEntries(CAMPAIGN_STATUS.map((s) => [s.value, s.color]));

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const todayISO = () => new Date().toISOString().slice(0, 10);
const nowISO = () => new Date().toISOString();

function fmtDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}
function fmtDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function EmailMarketingTracker() {
  const [campaigns, setCampaigns] = useState([]);
  const [recipients, setRecipients] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  const [showCampaignForm, setShowCampaignForm] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState(null);
  const [showRecipientForm, setShowRecipientForm] = useState(false);
  const [editingRecipient, setEditingRecipient] = useState(null);
  const [showBulkAdd, setShowBulkAdd] = useState(false);

  const [recipientFilter, setRecipientFilter] = useState("all");
  const [recipientSearch, setRecipientSearch] = useState("");
  const [campaignSearch, setCampaignSearch] = useState("");

  // ─── Load + persist ─────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get(STORAGE_KEY);
        if (res?.value) {
          const parsed = typeof res.value === "string" ? JSON.parse(res.value) : res.value;
          setCampaigns(Array.isArray(parsed.campaigns) ? parsed.campaigns : []);
          setRecipients(Array.isArray(parsed.recipients) ? parsed.recipients : []);
        }
      } catch (e) {
        console.error("Failed to load email tracker state:", e);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const payload = JSON.stringify({ campaigns, recipients });
    storage.set(STORAGE_KEY, payload).catch((e) => console.error("Save failed:", e));
  }, [campaigns, recipients, loaded]);

  // ─── Derived stats ──────────────────────────────────────────────
  const selectedCampaign = useMemo(
    () => campaigns.find((c) => c.id === selectedId) || null,
    [campaigns, selectedId]
  );

  const campaignRecipients = useMemo(
    () => recipients.filter((r) => r.campaignId === selectedId),
    [recipients, selectedId]
  );

  const statsByCampaign = useMemo(() => {
    const map = new Map();
    for (const c of campaigns) {
      map.set(c.id, {
        total: 0, pending: 0, sent: 0, opened: 0, clicked: 0,
        replied: 0, bounced: 0, failed: 0, unsubscribed: 0,
      });
    }
    for (const r of recipients) {
      const s = map.get(r.campaignId);
      if (!s) continue;
      s.total += 1;
      if (s[r.status] !== undefined) s[r.status] += 1;
    }
    return map;
  }, [campaigns, recipients]);

  const globalStats = useMemo(() => {
    const s = {
      campaigns: campaigns.length,
      total: recipients.length,
      pending: 0, sent: 0, opened: 0, clicked: 0,
      replied: 0, bounced: 0, failed: 0, unsubscribed: 0,
    };
    for (const r of recipients) {
      if (s[r.status] !== undefined) s[r.status] += 1;
    }
    // "delivered" = anything past pending/failed/bounced
    s.delivered = s.sent + s.opened + s.clicked + s.replied + s.unsubscribed;
    return s;
  }, [campaigns, recipients]);

  const filteredCampaigns = useMemo(() => {
    const q = campaignSearch.trim().toLowerCase();
    if (!q) return campaigns;
    return campaigns.filter(
      (c) =>
        (c.name || "").toLowerCase().includes(q) ||
        (c.subject || "").toLowerCase().includes(q) ||
        (c.audience || "").toLowerCase().includes(q) ||
        (c.template || "").toLowerCase().includes(q)
    );
  }, [campaigns, campaignSearch]);

  const filteredRecipients = useMemo(() => {
    let list = campaignRecipients;
    if (recipientFilter !== "all") list = list.filter((r) => r.status === recipientFilter);
    const q = recipientSearch.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          (r.name || "").toLowerCase().includes(q) ||
          (r.email || "").toLowerCase().includes(q) ||
          (r.notes || "").toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  }, [campaignRecipients, recipientFilter, recipientSearch]);

  // ─── Mutations ──────────────────────────────────────────────────
  function saveCampaign(data) {
    if (editingCampaign) {
      setCampaigns((cs) =>
        cs.map((c) => (c.id === editingCampaign.id ? { ...c, ...data, updatedAt: nowISO() } : c))
      );
    } else {
      const c = { id: newId(), createdAt: nowISO(), updatedAt: nowISO(), ...data };
      setCampaigns((cs) => [c, ...cs]);
    }
    setShowCampaignForm(false);
    setEditingCampaign(null);
  }

  function deleteCampaign(id) {
    if (!confirm("Delete this campaign and all its recipients?")) return;
    setCampaigns((cs) => cs.filter((c) => c.id !== id));
    setRecipients((rs) => rs.filter((r) => r.campaignId !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function saveRecipient(data) {
    if (editingRecipient) {
      setRecipients((rs) =>
        rs.map((r) =>
          r.id === editingRecipient.id ? { ...r, ...data, updatedAt: nowISO() } : r
        )
      );
    } else {
      const r = {
        id: newId(),
        campaignId: selectedId,
        createdAt: nowISO(),
        updatedAt: nowISO(),
        status: "pending",
        ...data,
      };
      setRecipients((rs) => [r, ...rs]);
    }
    setShowRecipientForm(false);
    setEditingRecipient(null);
  }

  function deleteRecipient(id) {
    setRecipients((rs) => rs.filter((r) => r.id !== id));
  }

  function setRecipientStatus(id, status) {
    setRecipients((rs) =>
      rs.map((r) => {
        if (r.id !== id) return r;
        const patch = { status, updatedAt: nowISO() };
        if (status === "sent" && !r.sentAt) patch.sentAt = nowISO();
        return { ...r, ...patch };
      })
    );
  }

  function bulkAddRecipients(rawText) {
    if (!selectedId) return 0;
    const lines = rawText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const added = [];
    for (const line of lines) {
      // Accept "name,email" / "email,name" / "email" — comma or tab separated
      const parts = line.split(/[,\t]/).map((s) => s.trim()).filter(Boolean);
      let name = "";
      let email = "";
      if (parts.length === 1) {
        email = parts[0];
      } else if (/@/.test(parts[0])) {
        email = parts[0];
        name = parts.slice(1).join(" ");
      } else {
        name = parts[0];
        email = parts[1] || "";
      }
      if (!email) continue;
      added.push({
        id: newId(),
        campaignId: selectedId,
        name,
        email,
        status: "pending",
        notes: "",
        createdAt: nowISO(),
        updatedAt: nowISO(),
      });
    }
    if (added.length) setRecipients((rs) => [...added, ...rs]);
    return added.length;
  }

  function markAllPendingAsSent() {
    if (!selectedId) return;
    setRecipients((rs) =>
      rs.map((r) =>
        r.campaignId === selectedId && r.status === "pending"
          ? { ...r, status: "sent", sentAt: r.sentAt || nowISO(), updatedAt: nowISO() }
          : r
      )
    );
  }

  function exportRecipientsCSV() {
    if (!selectedCampaign) return;
    const rows = campaignRecipients.map((r) => ({
      name: r.name || "",
      email: r.email || "",
      status: r.status,
      sent_at: r.sentAt || "",
      last_update: r.updatedAt || "",
      notes: r.notes || "",
    }));
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeName = (selectedCampaign.name || "campaign").replace(/[^a-z0-9-_]+/gi, "_");
    a.download = `${safeName}_recipients.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ─── Render ─────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--fg)" }}>
      <header className="topbar">
        <div className="crumb">
          <span className="live-dot" aria-hidden="true"></span>
          <span>LIVE</span>
          <span className="sep">▸</span>
          <a href="/" style={{ color: "var(--muted)", textDecoration: "none" }}>Dashboard</a>
          <span className="sep">▸</span>
          <span className="crumb-on">Email Marketing</span>
        </div>
        <div className="topbar-spacer" />
        <div className="topbar-actions">
          <a href="/" className="proto-btn" style={{ textDecoration: "none" }}>
            <ArrowLeft className="ic" />
            <span>Back</span>
          </a>
        </div>
      </header>

      <div className="wrap">
        <div className="page-head">
          <div>
            <h1 className="title">Email Marketing Tracker</h1>
            <div className="title-meta">
              <span className="pip">
                <Mail style={{ width: 13, height: 13 }} />
                {globalStats.campaigns} campaign{globalStats.campaigns === 1 ? "" : "s"}
              </span>
              <span className="pip">
                <Users style={{ width: 13, height: 13 }} />
                {globalStats.total} recipient{globalStats.total === 1 ? "" : "s"} tracked
              </span>
            </div>
          </div>
          {!selectedCampaign && (
            <button
              className="proto-btn proto-btn-primary"
              onClick={() => { setEditingCampaign(null); setShowCampaignForm(true); }}
            >
              <Plus className="ic" />
              <span>New Campaign</span>
            </button>
          )}
        </div>

        {/* KPI strip */}
        <div className="kpi-strip">
          <Kpi label="Campaigns" value={globalStats.campaigns} />
          <Kpi label="Pending" value={globalStats.pending} accent="warn" />
          <Kpi label="Sent" value={globalStats.delivered} accent="good" />
          <Kpi label="Opened" value={globalStats.opened} />
          <Kpi label="Clicked" value={globalStats.clicked} />
          <Kpi label="Replied" value={globalStats.replied} accent="good" />
        </div>

        {!selectedCampaign ? (
          // ─── Campaign list view ───────────────────────────────
          <section className="proto-card">
            <div className="card-head">
              <div>
                <h2>Campaigns</h2>
                <div className="sub">Click a row to manage recipients</div>
              </div>
              <div className="right">
                <label className="glob-search" style={{ maxWidth: 240 }}>
                  <Search className="ic" />
                  <input
                    type="text"
                    value={campaignSearch}
                    onChange={(e) => setCampaignSearch(e.target.value)}
                    placeholder="Search campaigns…"
                  />
                </label>
              </div>
            </div>

            {filteredCampaigns.length === 0 ? (
              <EmptyState
                title={campaigns.length === 0 ? "No campaigns yet" : "No matches"}
                hint={
                  campaigns.length === 0
                    ? "Create your first email campaign to start tracking who has been sent to and who is still pending."
                    : "Try a different search term."
                }
                action={
                  campaigns.length === 0 ? (
                    <button
                      className="proto-btn proto-btn-primary"
                      onClick={() => { setEditingCampaign(null); setShowCampaignForm(true); }}
                    >
                      <Plus className="ic" /> New Campaign
                    </button>
                  ) : null
                }
              />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="proto-table">
                  <thead>
                    <tr>
                      <th>Campaign</th>
                      <th>Status</th>
                      <th>Send Date</th>
                      <th>Recipients</th>
                      <th>Pending</th>
                      <th>Sent</th>
                      <th>Opened</th>
                      <th>Clicked</th>
                      <th>Replied</th>
                      <th style={{ width: 90 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCampaigns.map((c) => {
                      const s = statsByCampaign.get(c.id) || {};
                      return (
                        <tr
                          key={c.id}
                          onClick={() => setSelectedId(c.id)}
                          style={{ cursor: "pointer" }}
                        >
                          <td>
                            <div className="camp-name">
                              <span className="nm">{c.name || "(untitled)"}</span>
                              <span className="id">{c.subject || "—"}</span>
                            </div>
                          </td>
                          <td>
                            <span className={`pill pill-${CAMPAIGN_STATUS_COLOR[c.status] || "neutral"}`}>
                              {CAMPAIGN_STATUS.find((x) => x.value === c.status)?.label || c.status || "—"}
                            </span>
                          </td>
                          <td className="num">{fmtDate(c.sendDate)}</td>
                          <td className="num">{s.total || 0}</td>
                          <td className="num" style={{ color: s.pending ? "var(--warn)" : "var(--muted)" }}>
                            {s.pending || 0}
                          </td>
                          <td className="num">
                            {(s.sent || 0) + (s.opened || 0) + (s.clicked || 0) + (s.replied || 0)}
                          </td>
                          <td className="num">{s.opened || 0}</td>
                          <td className="num">{s.clicked || 0}</td>
                          <td className="num">{s.replied || 0}</td>
                          <td onClick={(e) => e.stopPropagation()} style={{ textAlign: "right" }}>
                            <button
                              className="icon-btn"
                              title="Edit campaign"
                              onClick={() => { setEditingCampaign(c); setShowCampaignForm(true); }}
                            >
                              <Pencil className="ic" />
                            </button>
                            <button
                              className="icon-btn"
                              title="Delete campaign"
                              style={{ marginLeft: 4 }}
                              onClick={() => deleteCampaign(c.id)}
                            >
                              <Trash2 className="ic" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : (
          // ─── Campaign detail view (recipients) ────────────────
          <CampaignDetail
            campaign={selectedCampaign}
            stats={statsByCampaign.get(selectedCampaign.id) || {}}
            recipients={filteredRecipients}
            totalCount={campaignRecipients.length}
            filter={recipientFilter}
            search={recipientSearch}
            onBack={() => setSelectedId(null)}
            onEditCampaign={() => { setEditingCampaign(selectedCampaign); setShowCampaignForm(true); }}
            onAddRecipient={() => { setEditingRecipient(null); setShowRecipientForm(true); }}
            onBulkAdd={() => setShowBulkAdd(true)}
            onMarkAllSent={markAllPendingAsSent}
            onExport={exportRecipientsCSV}
            onFilterChange={setRecipientFilter}
            onSearchChange={setRecipientSearch}
            onStatusChange={setRecipientStatus}
            onEditRecipient={(r) => { setEditingRecipient(r); setShowRecipientForm(true); }}
            onDeleteRecipient={deleteRecipient}
          />
        )}

        <div className="proto-footer">
          <span>Data is stored in your shared workspace. Anyone with the link can read &amp; write.</span>
        </div>
      </div>

      {showCampaignForm && (
        <CampaignForm
          initial={editingCampaign}
          onCancel={() => { setShowCampaignForm(false); setEditingCampaign(null); }}
          onSave={saveCampaign}
        />
      )}
      {showRecipientForm && (
        <RecipientForm
          initial={editingRecipient}
          onCancel={() => { setShowRecipientForm(false); setEditingRecipient(null); }}
          onSave={saveRecipient}
        />
      )}
      {showBulkAdd && (
        <BulkAddModal
          onCancel={() => setShowBulkAdd(false)}
          onSubmit={(txt) => {
            const n = bulkAddRecipients(txt);
            setShowBulkAdd(false);
            if (n === 0) alert("No valid emails found.");
          }}
        />
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────
function Kpi({ label, value, accent }) {
  const color =
    accent === "good" ? "var(--good)" :
    accent === "warn" ? "var(--warn)" :
    accent === "danger" ? "var(--danger)" :
    "var(--fg)";
  return (
    <div className="kpi">
      <div className="kpi-label"><span className="dot" />{label}</div>
      <div className="kpi-value" style={{ color }}>{value}</div>
      <div className="kpi-foot" />
    </div>
  );
}

function EmptyState({ title, hint, action }) {
  return (
    <div style={{
      padding: "48px 24px", textAlign: "center", color: "var(--muted)",
    }}>
      <Mail style={{ width: 32, height: 32, margin: "0 auto 12px", opacity: 0.5 }} />
      <div style={{ fontSize: 14, color: "var(--fg-2)", fontWeight: 600 }}>{title}</div>
      {hint && <div style={{ marginTop: 6, fontSize: 12, maxWidth: 420, marginInline: "auto" }}>{hint}</div>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

function CampaignDetail({
  campaign, stats, recipients, totalCount, filter, search,
  onBack, onEditCampaign, onAddRecipient, onBulkAdd, onMarkAllSent,
  onExport, onFilterChange, onSearchChange, onStatusChange,
  onEditRecipient, onDeleteRecipient,
}) {
  const sentCount = (stats.sent || 0) + (stats.opened || 0) + (stats.clicked || 0) + (stats.replied || 0);
  const openRate = sentCount > 0 ? ((stats.opened || 0) + (stats.clicked || 0) + (stats.replied || 0)) / sentCount : 0;
  const clickRate = sentCount > 0 ? ((stats.clicked || 0) + (stats.replied || 0)) / sentCount : 0;

  return (
    <>
      <section className="proto-card">
        <div className="card-head">
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <button className="icon-btn" onClick={onBack} title="Back to campaigns">
              <ChevronLeft className="ic" />
            </button>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {campaign.name || "(untitled)"}
              </h2>
              <div className="sub">
                {campaign.subject || "—"} · {fmtDate(campaign.sendDate)}
                {campaign.audience ? ` · ${campaign.audience}` : ""}
              </div>
            </div>
          </div>
          <div className="right">
            <span className={`pill pill-${CAMPAIGN_STATUS_COLOR[campaign.status] || "neutral"}`}>
              {CAMPAIGN_STATUS.find((x) => x.value === campaign.status)?.label || campaign.status || "—"}
            </span>
            <button className="proto-btn" onClick={onEditCampaign}>
              <Pencil className="ic" />
              <span>Edit</span>
            </button>
          </div>
        </div>

        {campaign.notes && (
          <div style={{
            padding: "12px 18px", borderBottom: "1px solid var(--border)",
            color: "var(--muted)", fontSize: 12.5, background: "var(--surface-2)",
          }}>
            {campaign.notes}
          </div>
        )}

        <div className="gauge">
          <div className="gauge-row">
            <div className="gauge-stat">
              <div className="gauge-label">Recipients</div>
              <div className="gauge-value">{stats.total || 0}</div>
            </div>
            <div className="gauge-stat">
              <div className="gauge-label">Sent</div>
              <div className="gauge-value accent">{sentCount}</div>
            </div>
            <div className="gauge-stat">
              <div className="gauge-label">Pending</div>
              <div className="gauge-value" style={{ color: stats.pending ? "var(--warn)" : "var(--muted)" }}>
                {stats.pending || 0}
              </div>
            </div>
            <div className="gauge-stat">
              <div className="gauge-label">Open Rate</div>
              <div className="gauge-value">{(openRate * 100).toFixed(1)}%</div>
            </div>
            <div className="gauge-stat">
              <div className="gauge-label">Click Rate</div>
              <div className="gauge-value">{(clickRate * 100).toFixed(1)}%</div>
            </div>
          </div>
          {stats.total > 0 && (
            <>
              <div className="gauge-bar" style={{ marginTop: 18 }}>
                <div
                  className="gauge-fill"
                  style={{ width: `${Math.min(100, (sentCount / stats.total) * 100)}%` }}
                />
              </div>
              <div className="gauge-marks">
                <span>0</span>
                <span>{sentCount} / {stats.total} sent</span>
                <span>{stats.total}</span>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="proto-card">
        <div className="card-head">
          <div>
            <h2>Recipients</h2>
            <div className="sub">
              {totalCount === 0 ? "Add recipients to start tracking" : `${recipients.length} of ${totalCount} shown`}
            </div>
          </div>
          <div className="right">
            <button className="proto-btn" onClick={onAddRecipient}>
              <Plus className="ic" /><span>Add</span>
            </button>
            <button className="proto-btn" onClick={onBulkAdd}>
              <Upload className="ic" /><span>Bulk add</span>
            </button>
            {(stats.pending || 0) > 0 && (
              <button className="proto-btn" onClick={onMarkAllSent} title="Mark all pending as sent">
                <Send className="ic" /><span>Mark all sent</span>
              </button>
            )}
            <button className="proto-btn" onClick={onExport} disabled={totalCount === 0}>
              <Download className="ic" /><span>Export</span>
            </button>
          </div>
        </div>

        <div className="filter-row">
          <span className="fr-label">Status</span>
          <select value={filter} onChange={(e) => onFilterChange(e.target.value)}>
            <option value="all">All ({totalCount})</option>
            {RECIPIENT_STATUS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label} ({stats[s.value] || 0})
              </option>
            ))}
          </select>
          <label className="glob-search" style={{ marginLeft: "auto", maxWidth: 260 }}>
            <Search className="ic" />
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search recipients…"
            />
          </label>
        </div>

        {recipients.length === 0 ? (
          <EmptyState
            title={totalCount === 0 ? "No recipients yet" : "No matches"}
            hint={
              totalCount === 0
                ? "Add recipients one by one or paste a list from a spreadsheet."
                : "Try a different status or search term."
            }
            action={
              totalCount === 0 ? (
                <div style={{ display: "inline-flex", gap: 8 }}>
                  <button className="proto-btn proto-btn-primary" onClick={onAddRecipient}>
                    <Plus className="ic" /> Add Recipient
                  </button>
                  <button className="proto-btn" onClick={onBulkAdd}>
                    <Upload className="ic" /> Bulk Add
                  </button>
                </div>
              ) : null
            }
          />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="proto-table compact-table">
              <thead>
                <tr>
                  <th>Recipient</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Sent At</th>
                  <th>Last Update</th>
                  <th>Notes</th>
                  <th style={{ width: 90 }}></th>
                </tr>
              </thead>
              <tbody>
                {recipients.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name || <span style={{ color: "var(--muted-2)" }}>—</span>}</td>
                    <td style={{ textAlign: "left", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                      {r.email}
                    </td>
                    <td>
                      <select
                        value={r.status}
                        onChange={(e) => onStatusChange(r.id, e.target.value)}
                        style={{
                          background: "var(--surface)",
                          color: "var(--fg)",
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          padding: "3px 22px 3px 8px",
                          fontSize: 11.5,
                          fontFamily: "inherit",
                          appearance: "none",
                          cursor: "pointer",
                          backgroundImage:
                            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'><path d='M2 4l3 3 3-3' stroke='%2362747e' stroke-width='1.4' fill='none' stroke-linecap='round'/></svg>\")",
                          backgroundRepeat: "no-repeat",
                          backgroundPosition: "right 6px center",
                        }}
                      >
                        {RECIPIENT_STATUS.map((s) => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="num" style={{ fontSize: 11.5, color: "var(--muted)" }}>
                      {r.sentAt ? fmtDateTime(r.sentAt) : "—"}
                    </td>
                    <td className="num" style={{ fontSize: 11.5, color: "var(--muted)" }}>
                      {fmtDateTime(r.updatedAt)}
                    </td>
                    <td style={{
                      textAlign: "left", color: "var(--muted)", fontSize: 11.5,
                      maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {r.notes || ""}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button className="icon-btn" title="Edit" onClick={() => onEditRecipient(r)}>
                        <Pencil className="ic" />
                      </button>
                      <button
                        className="icon-btn"
                        title="Delete"
                        style={{ marginLeft: 4 }}
                        onClick={() => onDeleteRecipient(r.id)}
                      >
                        <Trash2 className="ic" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

// ─── Forms / Modals ─────────────────────────────────────────────────
function Modal({ children, onCancel, title, width = 520 }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, background: "oklch(0% 0 0 / 0.55)",
        zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "60px 16px", overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 12, width: "100%", maxWidth: width, overflow: "hidden",
          boxShadow: "0 20px 60px oklch(0% 0 0 / 0.5)",
        }}
      >
        <div style={{
          padding: "13px 18px", borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
          <button className="icon-btn" onClick={onCancel} title="Close">
            <X className="ic" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FormField({ label, children, hint }) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <div style={{
        fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase",
        color: "var(--muted-2)", fontWeight: 500, marginBottom: 6,
      }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 11, color: "var(--muted-2)", marginTop: 4 }}>{hint}</div>}
    </label>
  );
}

function CampaignForm({ initial, onCancel, onSave }) {
  const [name, setName] = useState(initial?.name || "");
  const [subject, setSubject] = useState(initial?.subject || "");
  const [sendDate, setSendDate] = useState(initial?.sendDate || todayISO());
  const [audience, setAudience] = useState(initial?.audience || "");
  const [template, setTemplate] = useState(initial?.template || "");
  const [status, setStatus] = useState(initial?.status || "draft");
  const [notes, setNotes] = useState(initial?.notes || "");

  function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({
      name: name.trim(), subject: subject.trim(), sendDate,
      audience: audience.trim(), template: template.trim(),
      status, notes: notes.trim(),
    });
  }

  return (
    <Modal title={initial ? "Edit Campaign" : "New Campaign"} onCancel={onCancel}>
      <form onSubmit={submit} style={{ padding: 18 }}>
        <FormField label="Campaign Name">
          <input
            className="input-base"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. November Newsletter"
            autoFocus
            required
          />
        </FormField>
        <FormField label="Email Subject">
          <input
            className="input-base"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. New features this month"
          />
        </FormField>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <FormField label="Send Date">
            <input
              type="date"
              className="input-base"
              value={sendDate}
              onChange={(e) => setSendDate(e.target.value)}
            />
          </FormField>
          <FormField label="Status">
            <select
              className="input-base"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {CAMPAIGN_STATUS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </FormField>
        </div>
        <FormField label="Audience / Segment">
          <input
            className="input-base"
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            placeholder="e.g. SEA active traders"
          />
        </FormField>
        <FormField label="Template">
          <input
            className="input-base"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            placeholder="e.g. promo-v2.html"
          />
        </FormField>
        <FormField label="Notes">
          <textarea
            className="input-base"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{ resize: "vertical", fontFamily: "inherit" }}
          />
        </FormField>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
          <button type="button" className="proto-btn" onClick={onCancel}>Cancel</button>
          <button type="submit" className="proto-btn proto-btn-primary">
            <Check className="ic" />
            <span>{initial ? "Save" : "Create"}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RecipientForm({ initial, onCancel, onSave }) {
  const [name, setName] = useState(initial?.name || "");
  const [email, setEmail] = useState(initial?.email || "");
  const [status, setStatus] = useState(initial?.status || "pending");
  const [sentAt, setSentAt] = useState(initial?.sentAt ? initial.sentAt.slice(0, 16) : "");
  const [notes, setNotes] = useState(initial?.notes || "");

  function submit(e) {
    e.preventDefault();
    if (!email.trim()) return;
    onSave({
      name: name.trim(), email: email.trim(), status,
      sentAt: sentAt ? new Date(sentAt).toISOString() : (status === "sent" ? nowISO() : (initial?.sentAt || null)),
      notes: notes.trim(),
    });
  }

  return (
    <Modal title={initial ? "Edit Recipient" : "Add Recipient"} onCancel={onCancel}>
      <form onSubmit={submit} style={{ padding: 18 }}>
        <FormField label="Customer Name">
          <input
            className="input-base"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Jane Doe"
            autoFocus
          />
        </FormField>
        <FormField label="Email">
          <input
            className="input-base"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="customer@example.com"
            required
          />
        </FormField>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <FormField label="Status">
            <select
              className="input-base"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {RECIPIENT_STATUS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Sent At" hint="Optional — set when email was sent">
            <input
              type="datetime-local"
              className="input-base"
              value={sentAt}
              onChange={(e) => setSentAt(e.target.value)}
            />
          </FormField>
        </div>
        <FormField label="Notes">
          <textarea
            className="input-base"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{ resize: "vertical", fontFamily: "inherit" }}
          />
        </FormField>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
          <button type="button" className="proto-btn" onClick={onCancel}>Cancel</button>
          <button type="submit" className="proto-btn proto-btn-primary">
            <Check className="ic" />
            <span>{initial ? "Save" : "Add"}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}

function BulkAddModal({ onCancel, onSubmit }) {
  const [text, setText] = useState("");
  return (
    <Modal title="Bulk Add Recipients" onCancel={onCancel} width={600}>
      <form
        onSubmit={(e) => { e.preventDefault(); onSubmit(text); }}
        style={{ padding: 18 }}
      >
        <FormField
          label="Paste Recipients"
          hint="One per line. Formats accepted: email · email,name · name,email · pasted from a spreadsheet (tab-separated)."
        >
          <textarea
            className="input-base"
            rows={12}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"jane@example.com\nJohn Doe, john@example.com\nalice@example.com, Alice Smith"}
            style={{ resize: "vertical", fontFamily: "var(--font-mono)", fontSize: 12 }}
            autoFocus
          />
        </FormField>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="proto-btn" onClick={onCancel}>Cancel</button>
          <button type="submit" className="proto-btn proto-btn-primary" disabled={!text.trim()}>
            <Check className="ic" /><span>Add All</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}
