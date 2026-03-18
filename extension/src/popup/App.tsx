import { useEffect, useState } from "react";
import type { AvailablePlanSummary, StatsResponse } from "../../../shared/types";
import {
  ADVANCED_FILTERS,
  ADVANCED_FILTER_DEFAULTS,
  type AdvancedFilterState,
  type ClassificationLabel,
} from "../../../shared/filters";
import {
  AI_USAGE_SUMMARY,
  DEFAULT_PLAN_ID,
  PLAN_DEFINITIONS,
  PLAN_ORDER,
  type AIProvider,
  type DetectionMode,
  type PlanFeatureAccess,
  type PlanId,
} from "../../../shared/plans";
import {
  ensureClientIdentity,
  getClientAuthHeaders,
  getDefaultApiBaseUrl,
} from "../lib/identity";
import { fetchWithTimeout } from "../lib/network";

interface UserSettings extends AdvancedFilterState {
  enabled: boolean;
  threshold: number;
  detectionMode: DetectionMode;
  activeOnTwitter: boolean;
  activeOnLinkedin: boolean;
}

interface Stats {
  scanned: number;
  hidden: number;
  todayHidden: number;
  todayDate: string;
  requestCount: number;
  dailyLimit: number;
  plan: PlanId;
  featureAccess: PlanFeatureAccess;
  availablePlans: AvailablePlanSummary[];
  aiUsage: readonly string[];
}

interface Rule {
  id: string;
  type: "WHITELIST" | "BLACKLIST" | "KEYWORD" | "GEO_BLOCK";
  value: string;
}

interface HistoryEntry {
  tweetId: string;
  authorHandle: string;
  text: string;
  label: ClassificationLabel;
  reason: string;
  confidence: number;
  timestamp: number;
  url: string;
}

type Provider = AIProvider;
type GateableFeature =
  | "linkedinScanning"
  | "providerSelection"
  | "advancedFilters"
  | "geoRules"
  | "advancedAnalytics";

const defaultPlan = PLAN_DEFINITIONS[DEFAULT_PLAN_ID];
const defaultAvailablePlans = PLAN_ORDER.map((planId) => {
  const plan = PLAN_DEFINITIONS[planId];

  return {
    id: plan.id,
    name: plan.name,
    priceLabel: plan.priceLabel,
    billingLabel: plan.billingLabel,
    description: plan.description,
    bullets: plan.bullets,
  };
});
const POPUP_REQUEST_TIMEOUT_MS = 10000;

function App() {
  const [settings, setSettings] = useState<UserSettings>({
    enabled: true,
    threshold: 0.75,
    ...ADVANCED_FILTER_DEFAULTS,
    detectionMode: "blur",
    activeOnTwitter: true,
    activeOnLinkedin: true,
  });

  const [stats, setStats] = useState<Stats>({
    scanned: 0,
    hidden: 0,
    todayHidden: 0,
    todayDate: "",
    requestCount: 0,
    dailyLimit: defaultPlan.dailyRequestLimit,
    plan: DEFAULT_PLAN_ID,
    featureAccess: defaultPlan.features,
    availablePlans: defaultAvailablePlans,
    aiUsage: AI_USAGE_SUMMARY,
  });
  const [pageHidden, setPageHidden] = useState(0);
  const [status, setStatus] = useState<"connected" | "error" | "loading">("loading");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const [apiKey, setApiKey] = useState("");
  const [limitReached, setLimitReached] = useState(false);
  const [featureBlocked, setFeatureBlocked] = useState("");
  const [userId, setUserId] = useState<string>("");
  const [clientToken, setClientToken] = useState<string>("");

  const [rules, setRules] = useState<Rule[]>([]);
  const [newRuleType, setNewRuleType] = useState<Rule["type"]>("WHITELIST");
  const [newRuleValue, setNewRuleValue] = useState("");
  const [activeTab, setActiveTab] = useState<"main" | "history" | "settings">("main");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const [provider, setProvider] = useState<Provider>("gemini");
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const API_BASE_URL = getDefaultApiBaseUrl();

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const isFeatureEnabled = (feature: GateableFeature) => {
    return stats.featureAccess[feature];
  };

  const requireFeature = (feature: GateableFeature, message: string) => {
    if (isFeatureEnabled(feature)) {
      return true;
    }

    showToast(message, "error");
    setActiveTab("settings");
    return false;
  };

  const authenticatedFetch = (
    input: string,
    init: RequestInit = {},
    tokenOverride?: string
  ) => {
    const effectiveClientToken = tokenOverride || clientToken;
    if (!effectiveClientToken) {
      throw new Error("Missing client token");
    }

    const headers = new Headers(init.headers || {});
    Object.entries(getClientAuthHeaders(effectiveClientToken)).forEach(([key, value]) => {
      headers.set(key, value);
    });

    return fetchWithTimeout(input, {
      ...init,
      headers,
    }, POPUP_REQUEST_TIMEOUT_MS);
  };

  useEffect(() => {
    loadAllData();
  }, []);

  const syncRemoteStats = async (uid: string, tokenOverride?: string) => {
    const res = await authenticatedFetch(
      `${API_BASE_URL}/api/stats?userId=${encodeURIComponent(uid)}`,
      {},
      tokenOverride
    );
    if (!res.ok) {
      return;
    }

    const data = (await res.json()) as StatsResponse;
    const nextFeatureAccess = data.featureAccess || defaultPlan.features;
    const nextDetectionMode = nextFeatureAccess.detectionModes.includes(settings.detectionMode)
      ? settings.detectionMode
      : "blur";
    const nextProvider = nextFeatureAccess.providerSelection ? provider : "gemini";
    const nextAdvancedFilterSettings = Object.fromEntries(
      ADVANCED_FILTERS.map((filter) => [
        filter.key,
        nextFeatureAccess.advancedFilters ? data[filter.key] : false,
      ])
    ) as AdvancedFilterState;
    const nextSettings = {
      ...nextAdvancedFilterSettings,
      detectionMode: nextDetectionMode,
      activeOnLinkedin: nextFeatureAccess.linkedinScanning ? settings.activeOnLinkedin : false,
    };

    setStats((prev) => ({
      ...prev,
      scanned: data.scanned,
      hidden: data.hidden,
      requestCount: data.requestCount,
      dailyLimit: data.dailyLimit,
      plan: data.plan,
      featureAccess: nextFeatureAccess,
      availablePlans: data.availablePlans || prev.availablePlans,
      aiUsage: data.aiUsage || prev.aiUsage,
    }));
    setFeatureBlocked("");
    setProvider(nextProvider);
    setSettings((prev) => ({
      ...prev,
      ...nextSettings,
    }));

    const stored = await chrome.storage.local.get(["stats"]);
    await chrome.storage.local.set({
      plan: data.plan,
      planFeatures: nextFeatureAccess,
      ...nextAdvancedFilterSettings,
      detectionMode: nextDetectionMode,
      activeOnLinkedin: nextSettings.activeOnLinkedin,
      provider: nextProvider,
      stats: {
        ...(stored.stats || {}),
        requestCount: data.requestCount,
        dailyLimit: data.dailyLimit,
      },
    });
  };

  const loadAllData = async () => {
    setIsLoading(true);
    setErrorMessage("");

    try {
      const identity = await ensureClientIdentity(API_BASE_URL);
      setUserId(identity.userId);
      setClientToken(identity.clientToken);

      const result = await chrome.storage.local.get([
        "enabled", "threshold", "stats", "userApiKey", "userId", "clientToken",
        "limitReached",
        ...ADVANCED_FILTERS.map((filter) => filter.key),
        "provider", "detectionMode", "activeOnTwitter", "activeOnLinkedin", "history",
        "plan", "planFeatures", "featureBlocked",
      ]);
      const planFeatures = (result.planFeatures || defaultPlan.features) as PlanFeatureAccess;
      const detectionMode = planFeatures.detectionModes.includes((result.detectionMode || "blur") as DetectionMode)
        ? (result.detectionMode || "blur")
        : "blur";
      const nextProvider = planFeatures.providerSelection ? (result.provider || "gemini") : "gemini";

      const storedAdvancedFilterSettings = Object.fromEntries(
        ADVANCED_FILTERS.map((filter) => [
          filter.key,
          planFeatures.advancedFilters ? result[filter.key] || false : false,
        ])
      ) as AdvancedFilterState;

      setSettings({
        enabled: result.enabled !== undefined ? result.enabled : true,
        threshold: result.threshold !== undefined ? result.threshold : 0.75,
        ...storedAdvancedFilterSettings,
        detectionMode: detectionMode as DetectionMode,
        activeOnTwitter: result.activeOnTwitter !== false,
        activeOnLinkedin: planFeatures.linkedinScanning && result.activeOnLinkedin !== false,
      });

      if (result.stats) {
        setStats((prev) => ({
          ...prev,
          ...result.stats,
          plan: (result.plan || DEFAULT_PLAN_ID) as PlanId,
          featureAccess: planFeatures,
        }));
      }
      if (result.userApiKey) setApiKey(result.userApiKey);
      if (result.userId) setUserId(result.userId);
      if (result.clientToken) setClientToken(result.clientToken);
      if (result.limitReached) setLimitReached(result.limitReached);
      if (result.featureBlocked) setFeatureBlocked(result.featureBlocked);
      setProvider(nextProvider as Provider);
      if (result.history) setHistory(result.history);

      // Get page-specific stats from content script
      chrome.runtime.sendMessage({ type: "GET_PAGE_STATS_FROM_TAB" }, (response) => {
        if (response?.pageHidden !== undefined) {
          setPageHidden(response.pageHidden);
        }
      });

      await checkApiHealth();

      const activeUserId = (result.userId as string | undefined) || identity.userId;
      if (activeUserId) {
        await syncRemoteStats(activeUserId, identity.clientToken);
        await loadRules(activeUserId, identity.clientToken);
      }
    } catch (error) {
      console.error("Error loading data:", error);
      setErrorMessage("Failed to load settings");
    } finally {
      setIsLoading(false);
    }
  };

  const saveProvider = async (newProvider: Provider) => {
    if (newProvider !== "gemini" && !requireFeature("providerSelection", "Provider switching is available on Pro.")) {
      return;
    }

    setProvider(newProvider);
    await chrome.storage.local.set({ provider: newProvider });
    showToast(`Provider: ${newProvider}`, "success");
  };

  const checkApiHealth = async () => {
    try {
      const res = await fetchWithTimeout(`${API_BASE_URL}/api/health`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      }, 5000);
      setStatus(res.ok ? "connected" : "error");
    } catch {
      setStatus("error");
    }
  };

  const loadRules = async (uid: string, tokenOverride?: string) => {
    try {
      const res = await authenticatedFetch(
        `${API_BASE_URL}/api/rules?userId=${encodeURIComponent(uid)}`,
        {},
        tokenOverride
      );
      if (res.ok) {
        const data = await res.json();
        setRules(data.rules || []);
        if (data.featureAccess) {
          setStats((prev) => ({
            ...prev,
            featureAccess: data.featureAccess,
          }));
        }
      }
    } catch (error) {
      console.error("Error loading rules:", error);
    }
  };

  const saveSettings = async (newSettings: Partial<UserSettings>) => {
    const wantsAdvancedFilter = ADVANCED_FILTERS.some(
      (filter) => newSettings[filter.key] === true
    );
    if (wantsAdvancedFilter && !requireFeature("advancedFilters", "Advanced content filters are available on Pro.")) {
      return;
    }

    if (
      newSettings.detectionMode &&
      !stats.featureAccess.detectionModes.includes(newSettings.detectionMode)
    ) {
      showToast("This detection mode is available on Pro.", "error");
      return;
    }

    if (newSettings.activeOnLinkedin && !requireFeature("linkedinScanning", "LinkedIn scanning is available on Pro.")) {
      return;
    }

    const updated = { ...settings, ...newSettings };
    setSettings(updated);

    await chrome.storage.local.set({
      enabled: updated.enabled,
      threshold: updated.threshold,
      ...Object.fromEntries(
        ADVANCED_FILTERS.map((filter) => [filter.key, updated[filter.key]])
      ),
      detectionMode: updated.detectionMode,
      activeOnTwitter: updated.activeOnTwitter,
      activeOnLinkedin: updated.activeOnLinkedin,
    });

    if (userId) {
      try {
        const res = await authenticatedFetch(`${API_BASE_URL}/api/settings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            ...Object.fromEntries(
              ADVANCED_FILTERS.map((filter) => [filter.key, updated[filter.key]])
            ),
          }),
        });

        if (res.status === 403) {
          const data = await res.json();
          showToast(data.error || "This setting requires Pro.", "error");
          await syncRemoteStats(userId);
          return;
        }
      } catch (error) {
        console.error("Error syncing settings:", error);
      }
    }
  };

  const saveApiKey = async (key: string) => {
    setApiKey(key);
    await chrome.storage.local.set({ userApiKey: key });
    showToast("API key saved", "success");
  };

  const addRule = async () => {
    if (!newRuleValue.trim() || !userId) return;
    if (newRuleType === "GEO_BLOCK" && !requireFeature("geoRules", "Geo-blocking is available on Pro.")) {
      return;
    }

    if (rules.length >= stats.featureAccess.maxRules) {
      showToast(`Your ${PLAN_DEFINITIONS[stats.plan].name} plan supports up to ${stats.featureAccess.maxRules} rules.`, "error");
      return;
    }

    try {
      const res = await authenticatedFetch(`${API_BASE_URL}/api/rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          type: newRuleType,
          value: newRuleValue.trim(),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (!data.duplicate) {
          setRules([...rules, data.rule]);
        }
        setNewRuleValue("");
        showToast(data.duplicate ? "Rule already exists" : "Rule added", "success");
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || "Failed to add rule", "error");
      }
    } catch (error) {
      console.error("Error adding rule:", error);
      setErrorMessage("Failed to add rule");
    }
  };

  const deleteRule = async (ruleId: string) => {
    if (!userId) return;
    try {
      const res = await authenticatedFetch(
        `${API_BASE_URL}/api/rules?id=${encodeURIComponent(ruleId)}&userId=${encodeURIComponent(userId)}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setRules(rules.filter(r => r.id !== ruleId));
      }
    } catch (error) {
      console.error("Error deleting rule:", error);
    }
  };

  const clearHistory = async () => {
    setHistory([]);
    await chrome.storage.local.set({ history: [] });
    // Also tell content script
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: "CLEAR_HISTORY" });
    }
    showToast("History cleared", "success");
  };

  const handleUpgrade = async (plan: PlanId = "PRO") => {
    if (!userId) return;
    try {
      const res = await authenticatedFetch(`${API_BASE_URL}/api/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, plan }),
      });
      const data = await res.json();
      if (data.url) chrome.tabs.create({ url: data.url });
      else if (data.error) showToast(data.error, "error");
    } catch (error) {
      setErrorMessage("Failed to start checkout");
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return `${Math.floor(diffHr / 24)}d ago`;
  };

  const copyToClipboard = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showToast(`${label} copied`, "success");
    } catch {
      showToast(`Failed to copy ${label.toLowerCase()}`, "error");
    }
  };

  const openDashboard = () => {
    if (!userId || !clientToken) {
      showToast("Dashboard access is still syncing", "error");
      return;
    }

    chrome.tabs.create({
      url: `${API_BASE_URL}/dashboard?userId=${encodeURIComponent(userId)}#clientToken=${encodeURIComponent(clientToken)}`,
    });
  };

  const getLabelColor = (label: ClassificationLabel) => {
    switch (label) {
      case "ai": return "bg-purple-500/20 text-purple-300";
      case "engagement": return "bg-yellow-500/20 text-yellow-300";
      case "ragebait": return "bg-orange-500/20 text-orange-300";
      case "hate_speech": return "bg-red-500/20 text-red-300";
      case "racism": return "bg-rose-500/20 text-rose-300";
      case "vague_posting": return "bg-cyan-500/20 text-cyan-300";
      case "fearmongering": return "bg-amber-500/20 text-amber-300";
      case "geo_blocked": return "bg-blue-500/20 text-blue-300";
      default: return "bg-gray-500/20 text-gray-300";
    }
  };

  const getLabelText = (label: ClassificationLabel) => {
    switch (label) {
      case "ai": return "AI";
      case "engagement": return "Engagement";
      case "ragebait": return "Ragebait";
      case "hate_speech": return "Hate Speech";
      case "racism": return "Racism";
      case "vague_posting": return "Vague Post";
      case "fearmongering": return "Fearmongering";
      case "geo_blocked": return "Geo-Blocked";
      default: return label;
    }
  };

  const currentPlan = PLAN_DEFINITIONS[stats.plan];
  const canUseLinkedin = stats.featureAccess.linkedinScanning;
  const historyLimit = stats.featureAccess.historyLimit;

  if (isLoading) {
    return (
      <div className="popup-shell w-80 h-96 flex items-center justify-center">
        <div className="nmb-card-dark px-6 py-5 text-center">
          <div className="nmb-micro text-[10px] text-[#d8c6a6]">Signal desk</div>
          <div className="mt-3 animate-spin rounded-full h-8 w-8 border-b-2 border-[#cfaa63] mx-auto"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="popup-shell w-80 min-h-[520px] text-[#1b1713]">
      {/* Toast */}
      {toast && (
        <div className={`nmb-toast ${
          toast.type === "success" ? "nmb-toast-success" : "nmb-toast-error"
        }`}>
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <div className="nmb-card-dark p-4 relative overflow-hidden">
          <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-[#cfaa63]/10" />
          <div className="flex justify-between items-start gap-4">
            <div>
              <div className="nmb-micro text-[10px] text-[#d8c6a6]">Signal desk</div>
              <h1 className="nmb-display text-[28px] leading-none mt-2">NoMoreBots</h1>
              <p className="text-[12px] text-[#d6c7b7] mt-2 max-w-[180px] leading-relaxed">
                Curate the feed like a human editor, not a default chrome popup.
              </p>
            </div>
            <div className="flex flex-col items-end gap-3">
              <span className="nmb-chip bg-[#fff8ef] text-[#1b1713]">{currentPlan.name}</span>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="nmb-micro text-[9px] text-[#d8c6a6]">Status</div>
                  <div className="text-xs font-semibold text-[#fff8ef] mt-1">
                    {status === "connected" ? "Linked" : status === "error" ? "Offline" : "Syncing"}
                  </div>
                </div>
                <div
                  className={`w-2.5 h-2.5 rounded-full ${
                    status === "connected" ? "bg-[#8fb17c]" :
                    status === "error" ? "bg-[#db7f5f] animate-pulse" : "bg-[#cfaa63]"
                  }`}
                  title={status}
                />
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.enabled}
                  onChange={(e) => saveSettings({ enabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-12 h-7 rounded-full bg-[#3a2e27] peer peer-checked:bg-[#bf623d] after:content-[''] after:absolute after:top-[3px] after:left-[3px] after:h-5 after:w-5 after:rounded-full after:bg-[#f6ecda] after:transition-all peer-checked:after:translate-x-5" />
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex px-4 gap-2 mb-3">
        {(["main", "history", "settings"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`nmb-tab ${
              activeTab === tab
                ? "nmb-tab-active"
                : ""
            }`}
          >
            {tab === "main" ? "Control" : tab === "history" ? "Archive" : "Workbench"}
          </button>
        ))}
      </div>

      {/* Error */}
      {errorMessage && (
        <div className="nmb-card mx-4 mb-3 px-3 py-2 text-xs flex justify-between items-center border-[#b65d42]/25 text-[#8c432d] bg-[#fff2ec]">
          <span>{errorMessage}</span>
          <button onClick={() => setErrorMessage("")} className="ml-2 font-bold text-[#b65d42]">×</button>
        </div>
      )}

      {featureBlocked && activeTab === "main" && (
        <div className="nmb-card mx-4 mb-3 px-3 py-2 text-xs border-[#cfaa63]/35 bg-[#fff5de] text-[#6e5727]">
          <strong>Plan limit:</strong> {featureBlocked}
        </div>
      )}

      {/* Limit Warning */}
      {limitReached && activeTab === "main" && (
        <div className="nmb-card mx-4 mb-3 px-3 py-2 text-xs border-[#b65d42]/25 bg-[#fff2ec] text-[#8c432d]">
          <strong>Daily Limit Reached!</strong>
          <button onClick={() => handleUpgrade("PRO")} className="ml-2 text-[#bf623d] underline">Upgrade</button>
        </div>
      )}

      {/* ===== MAIN TAB ===== */}
      {activeTab === "main" && (
        <div className="px-4 pb-4 space-y-4">
          {/* Stats Counters: THIS PAGE / TODAY / TOTAL */}
          <div className="grid grid-cols-3 gap-2">
            <div className="nmb-card p-3 text-center">
              <div className="nmb-micro text-[9px] text-[#7e7163]">This page</div>
              <div className="nmb-display text-3xl text-[#1b1713] mt-2">{pageHidden}</div>
            </div>
            <div className="nmb-card p-3 text-center">
              <div className="nmb-micro text-[9px] text-[#7e7163]">Today</div>
              <div className="nmb-display text-3xl text-[#1b1713] mt-2">{stats.todayHidden || 0}</div>
            </div>
            <div className="nmb-card p-3 text-center">
              <div className="nmb-micro text-[9px] text-[#7e7163]">Total</div>
              <div className="nmb-display text-3xl text-[#1b1713] mt-2">{stats.hidden}</div>
            </div>
          </div>

          {/* Detection Mode */}
          <div className="nmb-card p-4">
            <div className="nmb-micro text-[10px] text-[#7e7163] mb-3">Treatment</div>
            <div className="grid grid-cols-3 gap-2">
              {(["blur", "hide", "label"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => saveSettings({ detectionMode: mode })}
                  className={`rounded-[18px] border px-2 py-2.5 text-sm font-semibold transition-all ${
                    settings.detectionMode === mode
                      ? "border-[#bf623d] bg-[#bf623d] text-[#fff8ef] shadow-[6px_6px_0_rgba(143,67,38,0.18)]"
                      : "border-[#1b1713]/10 bg-[#fff8ef] text-[#6f665d] hover:text-[#1b1713]"
                  } ${stats.featureAccess.detectionModes.includes(mode) ? "" : "opacity-60"}`}
                >
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                  {!stats.featureAccess.detectionModes.includes(mode) ? " Pro" : ""}
                </button>
              ))}
            </div>
          </div>

          {/* AI Confidence Threshold */}
          <div className="nmb-card p-4">
            <div className="flex justify-between items-center mb-2">
              <span className="nmb-micro text-[10px] text-[#7e7163]">AI Threshold</span>
              <span className="nmb-display text-xl text-[#1b1713]">{Math.round(settings.threshold * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.3"
              max="0.95"
              step="0.05"
              value={settings.threshold}
              onChange={(e) => saveSettings({ threshold: parseFloat(e.target.value) })}
              className="w-full h-2 appearance-none cursor-pointer accent-[#bf623d]"
            />
            <div className="flex justify-between text-[10px] text-[#8b7d6e] mt-1">
              <span>Show more</span>
              <span>Show less</span>
            </div>
          </div>

          {/* Active On */}
          <div className="nmb-card p-4">
            <div className="nmb-micro text-[10px] text-[#7e7163] mb-3">Platforms</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => saveSettings({ activeOnTwitter: !settings.activeOnTwitter })}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-[18px] text-sm font-medium transition-all border ${
                  settings.activeOnTwitter
                    ? "bg-[#1f1915] border-[#1f1915] text-[#fff8ef]"
                    : "bg-[#fff8ef] border-[#1b1713]/10 text-[#6f665d]"
                }`}
              >
                <span className="text-base">𝕏</span>
                <span>Twitter / X</span>
              </button>
              <button
                onClick={() => saveSettings({ activeOnLinkedin: !settings.activeOnLinkedin })}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-[18px] text-sm font-medium transition-all border ${
                  settings.activeOnLinkedin
                    ? "bg-[#1f1915] border-[#1f1915] text-[#fff8ef]"
                    : "bg-[#fff8ef] border-[#1b1713]/10 text-[#6f665d]"
                }`}
              >
                <span className="text-base">in</span>
                <span>LinkedIn</span>
                {!canUseLinkedin && <span className="nmb-chip px-2 py-0.5">Pro</span>}
              </button>
            </div>
          </div>

          {/* Content Filters */}
          <div className="nmb-card p-3">
            <div className="flex items-center justify-between mb-3">
              <div className="nmb-micro text-[10px] text-[#7e7163]">Content Filters</div>
              {!stats.featureAccess.advancedFilters && (
                <button
                  onClick={() => handleUpgrade("PRO")}
                  className="text-[10px] nmb-micro text-[#bf623d]"
                >
                  Pro only
                </button>
              )}
            </div>
            <div className="space-y-2.5">
              {ADVANCED_FILTERS.map((filter) => (
                <label key={filter.key} className="flex items-center justify-between cursor-pointer gap-3 rounded-[18px] border border-[#1b1713]/8 bg-[#fff8ef]/70 px-3 py-2.5">
                  <div>
                    <span className="text-sm font-semibold text-[#1b1713]">{filter.label}</span>
                    <div className="text-[10px] text-[#817466] mt-0.5">{filter.description}</div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings[filter.key]}
                      onChange={(e) =>
                        saveSettings({ [filter.key]: e.target.checked } as Partial<UserSettings>)
                      }
                      disabled={!stats.featureAccess.advancedFilters}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 rounded-full bg-[#d9ccb8] peer peer-checked:bg-[#bf623d] after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-[#fff8ef] after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
                  </label>
                </label>
              ))}
            </div>
          </div>

          {/* Usage Bar */}
          <div className="nmb-card p-4">
            <div className="flex justify-between items-center mb-2">
              <span className="nmb-micro text-[10px] text-[#7e7163]">Daily Usage</span>
              <span className="text-[10px] text-[#7e7163]">
                {stats.requestCount}/{stats.dailyLimit}
              </span>
            </div>
            <div className="nmb-meter">
              <span style={{ width: `${Math.min((stats.requestCount / stats.dailyLimit) * 100, 100)}%` }} />
            </div>
          </div>

          <div className="nmb-card-dark p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="nmb-micro text-[10px] text-[#d8c6a6]">Plan</div>
                <div className="nmb-display text-2xl mt-1">{currentPlan.name}</div>
                <div className="text-xs text-[#d6c7b7] mt-1">
                  {currentPlan.priceLabel} {currentPlan.billingLabel}
                </div>
              </div>
              {stats.plan !== "PRO" && (
                <button
                  onClick={() => handleUpgrade("PRO")}
                  className="nmb-button-primary"
                >
                  Upgrade
                </button>
              )}
            </div>
            <div className="mt-3 space-y-1 text-xs text-[#e5dacb]">
              {currentPlan.bullets.slice(0, 3).map((bullet) => (
                <div key={bullet}>- {bullet}</div>
              ))}
            </div>
          </div>

          <div className="nmb-card p-4">
            <div className="nmb-micro text-[10px] text-[#7e7163] mb-2">Where AI Is Used</div>
            <div className="space-y-1.5 text-xs text-[#5c544b]">
              {stats.aiUsage.map((item) => (
                <div key={item}>- {item}</div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===== HISTORY TAB ===== */}
      {activeTab === "history" && (
        <div className="px-4 pb-4">
          <div className="flex justify-between items-center mb-3">
            <span className="nmb-micro text-[10px] text-[#7e7163]">{history.length}/{historyLimit} kept</span>
            {history.length > 0 && (
              <button
                onClick={clearHistory}
                className="text-xs text-[#b65d42] hover:text-[#8c432d]"
              >
                Clear All
              </button>
            )}
          </div>

          {history.length === 0 ? (
            <div className="nmb-card p-8 text-center">
              <div className="nmb-micro text-[10px] text-[#7e7163]">Archive empty</div>
              <div className="nmb-display text-3xl mt-3">Nothing filed yet</div>
              <div className="text-xs text-[#817466] mt-3">Browse Twitter or LinkedIn to start collecting blocked posts.</div>
            </div>
          ) : (
            <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
              {history.map((entry, i) => (
                <div
                  key={`${entry.tweetId}-${i}`}
                  className="nmb-card p-3"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${getLabelColor(entry.label)}`}>
                        {getLabelText(entry.label)}
                      </span>
                      <span className="text-xs text-[#5f574d]">@{entry.authorHandle}</span>
                    </div>
                    <span className="text-[10px] text-[#817466]">{formatTime(entry.timestamp)}</span>
                  </div>
                  <p className="text-xs text-[#5c544b] line-clamp-2 leading-relaxed">
                    {entry.text}
                  </p>
                  <div className="flex justify-between items-center mt-2">
                    <span className="text-[10px] text-[#817466]">
                      {Math.round(entry.confidence * 100)}% confidence
                    </span>
                    <span className="text-[10px] text-[#817466] italic truncate max-w-[150px]">
                      {entry.reason}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== SETTINGS TAB ===== */}
      {activeTab === "settings" && (
        <div className="px-4 pb-4 space-y-4">
          <div className="nmb-card p-3">
            <div className="nmb-micro text-[10px] text-[#7e7163] mb-3">Plans</div>
            <div className="space-y-2">
              {stats.availablePlans.map((plan) => (
                <div
                  key={plan.id}
                  className={`rounded-[20px] border p-3 ${
                    stats.plan === plan.id
                      ? "border-[#bf623d]/40 bg-[#fff1e7]"
                      : "border-[#1b1713]/10 bg-[#fff8ef]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[#1b1713]">{plan.name}</div>
                      <div className="nmb-micro text-[10px] text-[#7e7163]">
                        {plan.priceLabel} {plan.billingLabel}
                      </div>
                    </div>
                    {plan.id !== stats.plan && plan.id === "PRO" && (
                      <button
                        onClick={() => handleUpgrade(plan.id)}
                        className="nmb-button-primary"
                      >
                        Upgrade
                      </button>
                    )}
                  </div>
                  <div className="text-[11px] text-[#5c544b] mt-2">{plan.description}</div>
                  <div className="space-y-1 mt-2 text-[11px] text-[#5c544b]">
                    {plan.bullets.map((bullet) => (
                      <div key={bullet}>- {bullet}</div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* AI Provider */}
          <div className="nmb-card p-3">
            <div className="flex items-center justify-between mb-3">
              <div className="nmb-micro text-[10px] text-[#7e7163]">AI Provider</div>
              {!stats.featureAccess.providerSelection && (
                <span className="nmb-chip">Pro only</span>
              )}
            </div>
            <div className="space-y-2">
              {[
                { id: "gemini", name: "Google Gemini", desc: "Fast & capable" },
                { id: "openai", name: "OpenAI GPT-3.5", desc: "Reliable & accurate" },
                { id: "anthropic", name: "Anthropic Claude", desc: "Thoughtful analysis" },
              ].map((p) => (
                <button
                  key={p.id}
                  onClick={() => saveProvider(p.id as Provider)}
                  className={`w-full flex items-center justify-between p-3 rounded-[18px] border transition-colors text-left ${
                    provider === p.id
                      ? "bg-[#fff1e7] border-[#bf623d]/45"
                      : "bg-[#fff8ef] border-[#1b1713]/10 hover:border-[#1b1713]/20"
                  } ${p.id !== "gemini" && !stats.featureAccess.providerSelection ? "opacity-60" : ""}`}
                >
                  <div>
                    <div className="text-sm font-medium text-[#1b1713]">{p.name}</div>
                    <div className="text-[10px] text-[#817466]">{p.desc}</div>
                  </div>
                  {provider === p.id && (
                    <div className="w-2.5 h-2.5 rounded-full bg-[#bf623d]" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* API Key */}
          <div className="nmb-card p-3">
            <label className="block nmb-micro text-[10px] text-[#7e7163] mb-2">
              API Key (Optional)
            </label>
            <input
              type="password"
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => saveApiKey(e.target.value)}
              className="nmb-field text-xs"
            />
            <p className="text-[10px] text-[#817466] mt-1">Use your own key for unlimited requests</p>
          </div>

          <div className="nmb-card p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="nmb-micro text-[10px] text-[#7e7163]">Dashboard Access</div>
              <button
                onClick={openDashboard}
                className="nmb-button-primary"
              >
                Open
              </button>
            </div>
            <div className="space-y-1.5">
              <div className="rounded-[18px] bg-[#fff8ef] border border-[#1b1713]/10 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="nmb-micro text-[10px] text-[#7e7163]">User ID</span>
                  <button
                    onClick={() => copyToClipboard(userId, "User ID")}
                    className="text-[10px] text-[#bf623d]"
                  >
                    Copy
                  </button>
                </div>
                <div className="mt-1 text-[11px] text-[#1b1713] break-all">{userId || "Registering..."}</div>
              </div>
              <div className="rounded-[18px] bg-[#fff8ef] border border-[#1b1713]/10 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="nmb-micro text-[10px] text-[#7e7163]">Access Token</span>
                  <button
                    onClick={() => copyToClipboard(clientToken, "Access token")}
                    className="text-[10px] text-[#bf623d]"
                  >
                    Copy
                  </button>
                </div>
                <div className="mt-1 text-[11px] text-[#1b1713] break-all">
                  {clientToken ? `${clientToken.slice(0, 12)}...${clientToken.slice(-6)}` : "Registering..."}
                </div>
              </div>
            </div>
          </div>

          {/* Rules */}
          <div className="nmb-card p-3">
            <div className="flex items-center justify-between mb-3">
              <div className="nmb-micro text-[10px] text-[#7e7163]">
                Rules ({rules.length}/{stats.featureAccess.maxRules})
              </div>
              {!stats.featureAccess.geoRules && (
                <span className="nmb-chip">Geo = Pro</span>
              )}
            </div>
            <div className="space-y-2 mb-3">
              <select
                value={newRuleType}
                onChange={(e) => setNewRuleType(e.target.value as any)}
                className="nmb-field text-xs"
              >
                <option value="WHITELIST">Whitelist (Always Show)</option>
                <option value="BLACKLIST">Blacklist (Always Hide)</option>
                <option value="KEYWORD">Keyword (Hide if Match)</option>
                <option value="GEO_BLOCK">
                  Geo-Block (Hide by Region){stats.featureAccess.geoRules ? "" : " - Pro"}
                </option>
              </select>
              <input
                type="text"
                placeholder={
                  newRuleType === "KEYWORD" ? "Enter keyword..." :
                  newRuleType === "GEO_BLOCK" ? "Region (e.g. India, UK)" :
                  "@username (without @)"
                }
                value={newRuleValue}
                onChange={(e) => setNewRuleValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addRule()}
                className="nmb-field text-xs"
              />
              <button
                onClick={addRule}
                disabled={!newRuleValue.trim()}
                className="nmb-button-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add Rule
              </button>
            </div>

            {rules.length > 0 && (
              <div className="space-y-1.5 max-h-[140px] overflow-y-auto">
                {rules.map((rule) => (
                  <div
                    key={rule.id}
                    className="flex items-center justify-between bg-[#fff8ef] border border-[#1b1713]/8 p-2.5 rounded-[18px]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold whitespace-nowrap ${
                        rule.type === "WHITELIST" ? "bg-green-500/20 text-green-300" :
                        rule.type === "BLACKLIST" ? "bg-red-500/20 text-red-300" :
                        rule.type === "GEO_BLOCK" ? "bg-blue-500/20 text-blue-300" :
                        "bg-yellow-500/20 text-yellow-300"
                      }`}>
                        {rule.type === "GEO_BLOCK" ? "GEO" : rule.type.slice(0, 5)}
                      </span>
                      <span className="text-xs text-[#5c544b] truncate">{rule.value}</span>
                    </div>
                    <button
                      onClick={() => deleteRule(rule.id)}
                      className="text-[#817466] hover:text-[#b65d42] p-0.5 flex-shrink-0"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Danger Zone */}
          <div className="nmb-card p-3 border-[#b65d42]/20 bg-[#fff2ec]">
            <button
              onClick={() => {
                if (confirm("Reset all settings? This cannot be undone.")) {
                  chrome.storage.local.clear();
                  window.location.reload();
                }
              }}
              className="w-full rounded-full border border-[#b65d42]/30 bg-[#fff6f2] py-2 text-xs font-semibold text-[#8c432d] transition-colors hover:bg-[#ffe7db]"
            >
              Reset All Settings
            </button>
          </div>

          {/* Version */}
          <div className="text-center text-[10px] text-[#817466] nmb-micro">
            NoMoreBots v1.3.1
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
