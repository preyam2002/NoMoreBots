"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import {
  ADVANCED_FILTERS,
  type AdvancedFilterState,
  type FilterSettingKey,
} from "@shared/filters";
import { PLAN_DEFINITIONS, type PlanFeatureAccess, type PlanId } from "@shared/plans";
import type { AvailablePlanSummary } from "@shared/types";

interface UserStats extends AdvancedFilterState {
  scanned: number;
  hidden: number;
  requestCount: number;
  dailyLimit: number;
  isPremium: boolean;
  plan: PlanId;
  featureAccess: PlanFeatureAccess;
  aiUsage: readonly string[];
  availablePlans: AvailablePlanSummary[];
}

interface Rule {
  id: string;
  type: string;
  value: string;
  createdAt: string;
}

function UsageChart({ scanned, hidden }: { scanned: number; hidden: number }) {
  const [data, setData] = useState<{ label: string; value: number; color: string }[]>([]);

  useEffect(() => {
    const safeScanned = Math.max(scanned, 0);
    const safeHidden = Math.max(hidden, 0);
    const humanCount = Math.max(safeScanned - safeHidden, 0);

    setData([
      { label: "Human", value: humanCount, color: "#74826b" },
      { label: "Blocked", value: safeHidden, color: "#bf623d" },
    ]);
  }, [scanned, hidden]);

  const total = data.reduce((sum, d) => sum + d.value, 0) || 1;

  return (
    <div className="w-full">
      <div className="flex items-end justify-center gap-4 h-48 mb-4">
        {data.map((item, index) => {
          const height = total > 0 ? (item.value / total) * 100 : 0;
          return (
            <div key={index} className="flex flex-col items-center gap-2">
              <div
                className="w-20 rounded-t-[22px] transition-all duration-500 flex items-end justify-center pb-2 shadow-[6px_6px_0_rgba(27,23,19,0.1)]"
                style={{
                  height: `${Math.max(height, 5)}%`,
                  backgroundColor: item.color,
                  minHeight: "20px",
                }}
              >
                {item.value > 0 && (
                  <span className="text-[#fff8ef] font-bold text-sm">{item.value}</span>
                )}
              </div>
              <span className="text-sm font-medium text-[#5f564d]">{item.label}</span>
            </div>
          );
        })}
      </div>
      <div className="text-center text-sm text-[#7b7065]">
        {total} total tweets analyzed
      </div>
    </div>
  );
}

export default function Dashboard() {
  const searchParams = useSearchParams();
  const [userId, setUserId] = useState<string>("");
  const [clientToken, setClientToken] = useState<string>("");
  const [stats, setStats] = useState<UserStats | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "filters" | "rules" | "analytics">("overview");
  const [newRuleValue, setNewRuleValue] = useState("");
  const [newRuleType, setNewRuleType] = useState<"WHITELIST" | "BLACKLIST" | "KEYWORD" | "GEO_BLOCK">("WHITELIST");
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    const queryUserId = searchParams.get("userId");
    const queryClientToken = searchParams.get("clientToken");
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const hashClientToken = hashParams.get("clientToken");
    const resolvedClientToken = queryClientToken || hashClientToken;
    if (queryUserId) {
      setUserId(queryUserId);
    }
    if (resolvedClientToken) {
      setClientToken(resolvedClientToken);

      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.delete("clientToken");
      nextUrl.hash = "";
      window.history.replaceState({}, "", nextUrl.toString());
    }
    if (!queryUserId || !resolvedClientToken) {
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => {
    const paymentStatus = searchParams.get("payment");
    if (paymentStatus === "success") {
      showNotification("success", "Pro unlocked successfully");
    } else if (paymentStatus === "cancelled") {
      showNotification("error", "Checkout cancelled");
    }
  }, [searchParams]);

  useEffect(() => {
    if (userId && clientToken) {
      fetchAllData();
    }
  }, [userId, clientToken]);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  const fetchAllData = async () => {
    setLoading(true);
    try {
      await Promise.all([fetchStats(), fetchRules()]);
    } finally {
      setLoading(false);
    }
  };

  const authenticatedFetch = (input: string, init: RequestInit = {}) => {
    if (!clientToken) {
      throw new Error("Missing access token");
    }

    const headers = new Headers(init.headers || {});
    headers.set("x-client-token", clientToken);

    return fetch(input, {
      ...init,
      headers,
    });
  };

  const fetchStats = async () => {
    try {
      const res = await authenticatedFetch(`/api/stats?userId=${encodeURIComponent(userId)}`);
      const data = await res.json();
      if (!data.error) {
        setStats(data);
      }
    } catch (e) {
      console.error("Error fetching stats:", e);
    }
  };

  const fetchRules = async () => {
    try {
      const rulesRes = await authenticatedFetch(`/api/rules?userId=${encodeURIComponent(userId)}`);
      const rulesData = await rulesRes.json();
      setRules(rulesData.rules || []);
    } catch (e) {
      console.error("Error fetching rules:", e);
    }
  };

  const showNotification = (type: "success" | "error", message: string) => {
    setNotification({ type, message });
  };

  const getFilterAccent = (filterKey: FilterSettingKey) => {
    switch (filterKey) {
      case "filterEngagement":
        return { icon: "🎣", accent: "accent-blue-600" };
      case "filterRagebait":
        return { icon: "😠", accent: "accent-orange-600" };
      case "filterHateSpeech":
        return { icon: "🚫", accent: "accent-red-600" };
      case "filterRacism":
        return { icon: "🧱", accent: "accent-rose-600" };
      case "filterVaguePosting":
        return { icon: "🫥", accent: "accent-cyan-600" };
      case "filterFearmongering":
        return { icon: "🚨", accent: "accent-amber-600" };
      default:
        return { icon: "🛡️", accent: "accent-blue-600" };
    }
  };

  const handleUpgrade = async () => {
    if (!userId) return;

    try {
      const res = await authenticatedFetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, plan: "PRO" }),
      });
      const data = await res.json();

      if (data.url) {
        window.open(data.url, "_blank", "noopener,noreferrer");
      } else {
        showNotification("error", data.error || "Failed to start checkout");
      }
    } catch (e) {
      showNotification("error", "Failed to start checkout");
    }
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (userId && clientToken) {
      fetchAllData();
    }
  };

  const addRule = async () => {
    if (!userId || !newRuleValue.trim()) return;
    if (newRuleType === "GEO_BLOCK" && !stats?.featureAccess.geoRules) {
      showNotification("error", "Geo-blocking is available on Pro");
      return;
    }

    if (stats && rules.length >= stats.featureAccess.maxRules) {
      showNotification("error", `Your ${PLAN_DEFINITIONS[stats.plan].name} plan supports up to ${stats.featureAccess.maxRules} rules.`);
      return;
    }

    try {
      const res = await authenticatedFetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          type: newRuleType,
          value: newRuleValue.trim(),
        }),
      });
      if (res.ok) {
        setNewRuleValue("");
        await fetchRules();
        showNotification("success", "Rule added successfully");
      } else {
        const data = await res.json().catch(() => ({}));
        showNotification("error", data.error || "Failed to add rule");
      }
    } catch (e) {
      showNotification("error", "Error adding rule");
    }
  };

  const deleteRule = async (ruleId: string) => {
    try {
      const res = await authenticatedFetch(`/api/rules?ruleId=${encodeURIComponent(ruleId)}&userId=${encodeURIComponent(userId)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await fetchRules();
        showNotification("success", "Rule deleted");
      } else {
        showNotification("error", "Failed to delete rule");
      }
    } catch (e) {
      showNotification("error", "Error deleting rule");
    }
  };

  const updateFilter = async (filter: FilterSettingKey, value: boolean) => {
    try {
      const res = await authenticatedFetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, [filter]: value }),
      });
      if (res.ok) {
        await fetchStats();
        showNotification("success", "Settings updated");
      } else {
        const data = await res.json().catch(() => ({}));
        showNotification("error", data.error || "Failed to update settings");
      }
    } catch (e) {
      showNotification("error", "Error updating settings");
    }
  };

  const exportRules = () => {
    const data = JSON.stringify(rules, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nomorebots-rules-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showNotification("success", "Rules exported");
  };

  const importRules = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const importedRules = JSON.parse(text);
      
      if (!Array.isArray(importedRules)) {
        showNotification("error", "Invalid file format");
        return;
      }

      for (const rule of importedRules) {
        if (rule.type && rule.value) {
          await authenticatedFetch("/api/rules", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userId,
              type: rule.type,
              value: rule.value,
            }),
          });
        }
      }

      await fetchRules();
      showNotification("success", `${importedRules.length} rules imported`);
    } catch (e) {
      showNotification("error", "Failed to import rules");
    }
  };

  if ((!userId || !clientToken) && !loading) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <form onSubmit={handleLogin} className="nmb-login">
          <div className="text-center mb-6">
            <div className="nmb-kicker">Signal dossier</div>
            <h1 className="nmb-display text-4xl mt-3">NoMoreBots</h1>
            <p className="text-[#6f665d] mt-3 leading-relaxed">
              Use your device token to open the editorial dashboard for filters, rules, and usage.
            </p>
          </div>
          <input
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="Enter your User ID"
            className="nmb-input mb-4"
          />
          <input
            type="password"
            value={clientToken}
            onChange={(e) => setClientToken(e.target.value)}
            placeholder="Enter your access token"
            className="nmb-input mb-4"
          />
          <button
            type="submit"
            className="nmb-button-primary w-full"
          >
            Access Dashboard
          </button>
          <p className="text-sm text-[#7b7065] mt-4 text-center">
            Find both values in the extension popup settings or open this page from the extension checkout flow
          </p>
        </form>
      </div>
    );
  }

  const blockedPercentage = stats && stats.scanned > 0 ? Math.round((stats.hidden / stats.scanned) * 100) : 0;
  const currentPlan = stats ? PLAN_DEFINITIONS[stats.plan] : PLAN_DEFINITIONS.FREE;

  return (
    <div className="min-h-screen nmb-shell">
      {/* Notification */}
      {notification && (
        <div className={`nmb-toast ${notification.type === "success" ? "nmb-toast-success" : "nmb-toast-error"}`}>
          {notification.message}
        </div>
      )}

      {/* Header */}
      <header className="px-4 pt-4 md:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="nmb-card-dark relative overflow-hidden">
            <div className="absolute -right-12 top-0 h-44 w-44 rounded-full bg-[#cfaa63]/10" />
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <div className="nmb-kicker text-[#d8c6a6]">Signal dossier</div>
                <h1 className="nmb-display mt-3 text-4xl md:text-5xl">NoMoreBots Dashboard</h1>
                <p className="mt-4 max-w-xl text-sm leading-relaxed text-[#d7cabd]">
                  A calmer control room for feed filtering. Tune moderation, inspect usage, and shape the timeline with intent.
                </p>
              </div>
              <div className="flex flex-col items-start gap-3 lg:items-end">
                <span className="nmb-chip bg-[#fff8ef] text-[#1b1713]">{currentPlan.name}</span>
                <div className="text-sm text-[#d7cabd]">
                  User ID: <span className="font-semibold text-[#fff8ef]">{userId.slice(0, 8)}...</span>
                </div>
                <div className="nmb-kicker text-[#d8c6a6]">
                  {stats?.requestCount || 0}/{stats?.dailyLimit || 0} daily requests
                </div>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="mt-5 flex flex-wrap gap-3">
            {[
              { id: "overview", label: "Overview", icon: "01" },
              { id: "filters", label: "Filters", icon: "02" },
              { id: "rules", label: "Rules", icon: "03" },
              { id: "analytics", label: "Analytics", icon: "04" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`nmb-tab ${activeTab === tab.id ? "nmb-tab-active" : ""}`}
              >
                <span className="nmb-micro text-[10px]">{tab.icon}</span>
                <span className="font-medium">{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-8 md:px-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="nmb-card-dark px-8 py-6 text-center">
              <div className="nmb-kicker text-[#d8c6a6]">Loading dossier</div>
              <div className="mt-4 animate-spin rounded-full h-12 w-12 border-b-2 border-[#cfaa63] mx-auto"></div>
            </div>
          </div>
        ) : (
          <>
            {/* Overview Tab */}
            {activeTab === "overview" && (
              <div className="space-y-6">
                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="nmb-card">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="nmb-kicker">Tweets scanned</p>
                        <p className="nmb-display text-4xl mt-2">{stats?.scanned || 0}</p>
                      </div>
                      <div className="h-14 w-14 rounded-full bg-[#fff2e8] border border-[#bf623d]/15 flex items-center justify-center text-2xl">
                        ◌
                      </div>
                    </div>
                  </div>

                  <div className="nmb-card">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="nmb-kicker">Content hidden</p>
                        <p className="nmb-display text-4xl mt-2 text-[#8f4326]">{stats?.hidden || 0}</p>
                      </div>
                      <div className="h-14 w-14 rounded-full bg-[#fff2ec] border border-[#bf623d]/15 flex items-center justify-center text-2xl">
                        ✕
                      </div>
                    </div>
                    <div className="mt-5">
                      <div className="flex justify-between text-xs text-[#7b7065] mb-2">
                        <span>Block rate</span>
                        <span>{blockedPercentage}%</span>
                      </div>
                      <div className="nmb-meter">
                        <span style={{ width: `${blockedPercentage}%` }} />
                      </div>
                    </div>
                  </div>

                  <div className="nmb-card">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="nmb-kicker">API requests</p>
                        <p className="nmb-display text-4xl mt-2">{stats?.requestCount || 0}</p>
                      </div>
                      <div className="h-14 w-14 rounded-full bg-[#eef1e8] border border-[#74826b]/15 flex items-center justify-center text-2xl">
                        ↗
                      </div>
                    </div>
                    <div className="mt-5">
                      <div className="flex justify-between text-xs text-[#7b7065] mb-2">
                        <span>Daily limit</span>
                        <span>{stats?.requestCount || 0}/{stats?.dailyLimit || 100}</span>
                      </div>
                      <div className="nmb-meter">
                        <span style={{ width: `${((stats?.requestCount || 0) / (stats?.dailyLimit || 100)) * 100}%` }} />
                      </div>
                    </div>
                  </div>

                  <div className="nmb-card">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="nmb-kicker">Time saved</p>
                        <p className="nmb-display text-4xl mt-2 text-[#56644e]">
                          {Math.round((stats?.hidden || 0) * 0.5)} min
                        </p>
                      </div>
                      <div className="h-14 w-14 rounded-full bg-[#eef1e8] border border-[#74826b]/15 flex items-center justify-center text-2xl">
                        ⧖
                      </div>
                    </div>
                    <p className="text-xs text-[#7b7065] mt-4">Estimated at 30 seconds per blocked tweet.</p>
                  </div>
                </div>

                {/* Quick Actions */}
                <div className="nmb-card">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <div className="nmb-kicker">Quick actions</div>
                      <h2 className="nmb-display text-3xl mt-2">Editorial controls</h2>
                    </div>
                    {!stats?.isPremium && (
                      <button
                        onClick={handleUpgrade}
                        className="nmb-button-primary"
                      >
                        Unlock Pro
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                    <button
                      onClick={() => setActiveTab("filters")}
                      className="nmb-panel text-left hover:bg-[#fffef8] transition-colors"
                    >
                      <div className="nmb-kicker">Filters</div>
                      <p className="nmb-display text-xl mt-3">Tune the shield</p>
                    </button>
                    <button
                      onClick={() => setActiveTab("rules")}
                      className="nmb-panel text-left hover:bg-[#fffef8] transition-colors"
                    >
                      <div className="nmb-kicker">Rules</div>
                      <p className="nmb-display text-xl mt-3">Edit the list</p>
                    </button>
                    <button
                      onClick={() => setActiveTab("analytics")}
                      className="nmb-panel text-left hover:bg-[#fffef8] transition-colors"
                    >
                      <div className="nmb-kicker">Analytics</div>
                      <p className="nmb-display text-xl mt-3">Read the pattern</p>
                    </button>
                    <div className="nmb-panel text-left bg-[#1f1915] text-[#fff8ef] border-[#1f1915]">
                      <div className="nmb-kicker text-[#d8c6a6]">Active plan</div>
                      <p className="nmb-display text-xl mt-3">{currentPlan.name}</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="nmb-card">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="nmb-kicker">Current plan</div>
                        <h2 className="nmb-display text-3xl mt-2">{currentPlan.name}</h2>
                        <p className="text-sm text-[#7b7065] mt-2">
                          {currentPlan.priceLabel} {currentPlan.billingLabel}
                        </p>
                      </div>
                      {!stats?.isPremium && (
                        <button
                          onClick={handleUpgrade}
                          className="nmb-button-primary"
                        >
                          Upgrade
                        </button>
                      )}
                    </div>
                    <p className="text-sm text-[#5c544b] mt-4">{currentPlan.description}</p>
                    <div className="mt-4 space-y-2 text-sm text-[#5c544b]">
                      {currentPlan.bullets.map((bullet) => (
                        <div key={bullet}>- {bullet}</div>
                      ))}
                    </div>
                  </div>

                  <div className="nmb-card">
                    <div className="nmb-kicker">AI usage</div>
                    <h2 className="nmb-display text-3xl mt-2">Where models intervene</h2>
                    <div className="mt-4 space-y-2 text-sm text-[#5c544b]">
                      {stats?.aiUsage?.map((item) => (
                        <div key={item}>- {item}</div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Filters Tab */}
            {activeTab === "filters" && (
              <div className="nmb-card">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <div className="nmb-kicker">Content filters</div>
                    <h2 className="nmb-display text-3xl mt-2">Signal categories</h2>
                  </div>
                  {!stats?.featureAccess.advancedFilters && (
                    <button
                      onClick={handleUpgrade}
                      className="nmb-button-primary"
                    >
                      Unlock on Pro
                    </button>
                  )}
                </div>
                <div className="space-y-4">
                  {ADVANCED_FILTERS.map((filter) => {
                    const filterAccent = getFilterAccent(filter.key);

                    return (
                      <label
                        key={filter.key}
                        className="flex items-start justify-between p-4 rounded-[22px] border border-[#1b1713]/10 bg-[#fff8ef] cursor-pointer hover:bg-[#fffef8] transition-colors"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">{filterAccent.icon}</span>
                            <span className="font-medium text-[#1b1713]">{filter.label}</span>
                          </div>
                          <p className="text-sm text-[#6f665d] mt-1">{filter.description}</p>
                        </div>
                        <input
                          type="checkbox"
                          checked={stats?.[filter.key] || false}
                          onChange={(e) => updateFilter(filter.key, e.target.checked)}
                          disabled={!stats?.featureAccess.advancedFilters}
                          className={`w-6 h-6 mt-1 ${filterAccent.accent}`}
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Rules Tab */}
            {activeTab === "rules" && (
              <div className="space-y-6">
                {/* Add Rule */}
                <div className="nmb-card">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <div className="nmb-kicker">Add rule</div>
                      <h2 className="nmb-display text-3xl mt-2">Build a custom list</h2>
                    </div>
                    <span className="text-sm text-[#7b7065]">
                      {rules.length}/{stats?.featureAccess.maxRules || 0} rules used
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-4">
                    <select
                      value={newRuleType}
                      onChange={(e) => setNewRuleType(e.target.value as typeof newRuleType)}
                      className="nmb-input max-w-[240px]"
                    >
                      <option value="WHITELIST">✅ Whitelist (Always Show)</option>
                      <option value="BLACKLIST">🚫 Blacklist (Always Hide)</option>
                      <option value="KEYWORD">🔍 Keyword (Hide if Match)</option>
                      <option value="GEO_BLOCK">🌍 Geo Block (Pro)</option>
                    </select>
                    <input
                      type="text"
                      value={newRuleValue}
                      onChange={(e) => setNewRuleValue(e.target.value)}
                      placeholder={
                        newRuleType === "KEYWORD"
                          ? "Enter keyword..."
                          : newRuleType === "GEO_BLOCK"
                          ? "Region name..."
                          : "Username (without @)"
                      }
                      className="nmb-input flex-1"
                    />
                    <button
                      onClick={addRule}
                      disabled={!newRuleValue.trim()}
                      className="nmb-button-primary disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Add Rule
                    </button>
                  </div>
                </div>

                {/* Rules List */}
                <div className="nmb-card">
                  <div className="flex justify-between items-center mb-4">
                    <div>
                      <div className="nmb-kicker">Rulebook</div>
                      <h2 className="nmb-display text-3xl mt-2">Your rules ({rules.length})</h2>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={exportRules}
                        className="nmb-button-secondary"
                      >
                        Export
                      </button>
                      <label className="nmb-button-secondary cursor-pointer">
                        Import
                        <input
                          type="file"
                          accept=".json"
                          onChange={importRules}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>

                  {rules.length === 0 ? (
                    <div className="text-center py-12 text-[#7b7065]">
                      <div className="nmb-kicker">Empty rulebook</div>
                      <p className="nmb-display text-3xl mt-3 text-[#1b1713]">No rules defined yet</p>
                      <p className="text-sm mt-3">Add your first rule above to start filtering.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {rules.map((rule) => (
                        <div
                          key={rule.id}
                          className="flex items-center justify-between p-4 rounded-[22px] border border-[#1b1713]/10 bg-[#fff8ef]"
                        >
                          <div className="flex items-center gap-3">
                            <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                              rule.type === "WHITELIST"
                                ? "bg-green-100 text-green-700"
                                : rule.type === "BLACKLIST"
                                ? "bg-red-100 text-red-700"
                                : "bg-yellow-100 text-yellow-700"
                              }`}>
                              {rule.type}
                            </span>
                            <span className="font-medium text-[#1b1713]">{rule.value}</span>
                          </div>
                          <button
                            onClick={() => deleteRule(rule.id)}
                            className="text-[#b65d42] hover:text-[#8c432d] p-2"
                          >
                            🗑️
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Analytics Tab */}
            {activeTab === "analytics" && (
              <div className="space-y-6">
                <div className="nmb-card">
                  <div className="nmb-kicker">Usage pattern</div>
                  <h2 className="nmb-display text-3xl mt-2 mb-4">Usage over time</h2>
                  <div className="h-64 flex items-center justify-center rounded-[22px] border border-[#1b1713]/10 bg-[#fff8ef]">
                    <UsageChart scanned={stats?.scanned || 0} hidden={stats?.hidden || 0} />
                  </div>
                </div>

                <div className="nmb-card">
                  <div className="nmb-kicker">Usage statistics</div>
                  <h2 className="nmb-display text-3xl mt-2 mb-4">Ledger view</h2>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="text-center p-4 rounded-[22px] bg-[#fff2e8]">
                      <p className="nmb-display text-4xl text-[#1b1713]">{stats?.scanned || 0}</p>
                      <p className="text-sm text-[#6f665d] mt-2">Total Tweets Scanned</p>
                    </div>
                    <div className="text-center p-4 rounded-[22px] bg-[#fff2ec]">
                      <p className="nmb-display text-4xl text-[#8f4326]">{stats?.hidden || 0}</p>
                      <p className="text-sm text-[#6f665d] mt-2">Total Content Hidden</p>
                    </div>
                    <div className="text-center p-4 rounded-[22px] bg-[#eef1e8]">
                      <p className="nmb-display text-4xl text-[#56644e]">{blockedPercentage}%</p>
                      <p className="text-sm text-[#6f665d] mt-2">Block Rate</p>
                    </div>
                  </div>
                </div>

                <div className="nmb-card">
                  <div className="nmb-kicker">Filter configuration</div>
                  <h2 className="nmb-display text-3xl mt-2 mb-4">Moderation map</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {ADVANCED_FILTERS.map((filter) => (
                      <div
                        key={filter.key}
                        className={`p-4 rounded-[22px] ${
                          stats?.[filter.key]
                            ? "bg-[#eef1e8] border border-[#74826b]/20"
                            : "bg-[#fff8ef] border border-[#1b1713]/10"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span>{stats?.[filter.key] ? "✅" : "❌"}</span>
                          <span className="font-medium text-[#1b1713]">{filter.label} Filter</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="nmb-card">
                  <div className="nmb-kicker">Rules summary</div>
                  <h2 className="nmb-display text-3xl mt-2 mb-4">Rule distribution</h2>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center p-4 rounded-[22px] bg-[#eef1e8]">
                      <p className="nmb-display text-3xl text-[#56644e]">
                        {rules.filter(r => r.type === "WHITELIST").length}
                      </p>
                      <p className="text-sm text-[#6f665d] mt-2">Whitelist</p>
                    </div>
                    <div className="text-center p-4 rounded-[22px] bg-[#fff2ec]">
                      <p className="nmb-display text-3xl text-[#8f4326]">
                        {rules.filter(r => r.type === "BLACKLIST").length}
                      </p>
                      <p className="text-sm text-[#6f665d] mt-2">Blacklist</p>
                    </div>
                    <div className="text-center p-4 rounded-[22px] bg-[#fff3dd]">
                      <p className="nmb-display text-3xl text-[#8a6a2a]">
                        {rules.filter(r => r.type === "KEYWORD").length}
                      </p>
                      <p className="text-sm text-[#6f665d] mt-2">Keywords</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
