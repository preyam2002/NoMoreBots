import { useEffect, useState } from "react";

interface UserSettings {
  enabled: boolean;
  threshold: number;
  filterEngagement: boolean;
  filterRagebait: boolean;
  filterHateSpeech: boolean;
}

interface Stats {
  scanned: number;
  hidden: number;
  requestCount: number;
  dailyLimit: number;
}

interface Rule {
  id: string;
  type: "WHITELIST" | "BLACKLIST" | "KEYWORD";
  value: string;
}

type Provider = "openai" | "gemini" | "anthropic";

function App() {
  // Settings state
  const [settings, setSettings] = useState<UserSettings>({
    enabled: true,
    threshold: 0.75,
    filterEngagement: false,
    filterRagebait: false,
    filterHateSpeech: false,
  });
  
  // Stats and status
  const [stats, setStats] = useState<Stats>({
    scanned: 0,
    hidden: 0,
    requestCount: 0,
    dailyLimit: 100,
  });
  const [status, setStatus] = useState<"connected" | "error" | "loading">("loading");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  
  // API Key
  const [apiKey, setApiKey] = useState("");
  const [limitReached, setLimitReached] = useState(false);
  const [userId, setUserId] = useState<string>("");
  
  // Rules management
  const [rules, setRules] = useState<Rule[]>([]);
  const [newRuleType, setNewRuleType] = useState<"WHITELIST" | "BLACKLIST" | "KEYWORD">("WHITELIST");
  const [newRuleValue, setNewRuleValue] = useState("");
  const [activeTab, setActiveTab] = useState<"main" | "rules" | "settings">("main");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Provider
  const [provider, setProvider] = useState<Provider>("gemini");

  const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    loadAllData();
  }, []);

  const loadAllData = async () => {
    setIsLoading(true);
    setErrorMessage("");
    
    try {
      const result = await chrome.storage.local.get([
        "enabled", 
        "threshold", 
        "stats", 
        "userApiKey", 
        "userId", 
        "limitReached",
        "filterEngagement",
        "filterRagebait",
        "filterHateSpeech",
        "provider"
      ]);

      setSettings({
        enabled: result.enabled !== undefined ? result.enabled : true,
        threshold: result.threshold !== undefined ? result.threshold : 0.75,
        filterEngagement: result.filterEngagement || false,
        filterRagebait: result.filterRagebait || false,
        filterHateSpeech: result.filterHateSpeech || false,
      });
      
      if (result.stats) {
        setStats(prev => ({ ...prev, ...result.stats }));
      }
      if (result.userApiKey) setApiKey(result.userApiKey);
      if (result.userId) setUserId(result.userId);
      if (result.limitReached) setLimitReached(result.limitReached);
      if (result.provider) setProvider(result.provider as Provider);

      await checkApiHealth();
      
      if (result.userId) {
        await loadRules(result.userId);
      }
    } catch (error) {
      console.error("Error loading data:", error);
      setErrorMessage("Failed to load settings");
    } finally {
      setIsLoading(false);
    }
  };

  const saveProvider = async (newProvider: Provider) => {
    setProvider(newProvider);
    await chrome.storage.local.set({ provider: newProvider });
    showToast(`Provider changed to ${newProvider}`, "success");
  };

  const checkApiHealth = async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const res = await fetch(`${API_URL}/api/health`, { 
        method: "GET",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      setStatus(res.ok ? "connected" : "error");
    } catch {
      setStatus("error");
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (!userId) return;

    try {
      const res = await fetch(`${API_URL}/api/rules?id=${ruleId}&userId=${userId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setRules(rules.filter(r => r.id !== ruleId));
      } else {
        setErrorMessage("Failed to delete rule");
      }
    } catch (error) {
      console.error("Error deleting rule:", error);
      setErrorMessage("Failed to delete rule");
    }
  };

  const handleRefreshStats = async () => {
    if (!userId) return;
    
    try {
      const res = await fetch(`${API_URL}/api/stats?userId=${userId}`);
      if (res.ok) {
        const data = await res.json();
        setStats(prev => ({ 
          ...prev, 
          scanned: data.scanned || 0,
          hidden: data.hidden || 0,
          requestCount: data.requestCount || 0,
          dailyLimit: data.dailyLimit || 100,
          isPremium: data.isPremium || false,
        }));
        await chrome.storage.local.set({ 
          stats: { 
            scanned: data.scanned || 0, 
            hidden: data.hidden || 0 
          } 
        });
      }
    } catch (error) {
      console.error("Error refreshing stats:", error);
    }
  };

  const loadRules = async (uid: string) => {
    try {
      const res = await fetch(`${API_URL}/api/rules?userId=${uid}`);
      if (res.ok) {
        const data = await res.json();
        setRules(data.rules || []);
      }
    } catch (error) {
      console.error("Error loading rules:", error);
    }
  };

  const saveSettings = async (newSettings: Partial<UserSettings>) => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);
    
    await chrome.storage.local.set({
      enabled: updated.enabled,
      threshold: updated.threshold,
      filterEngagement: updated.filterEngagement,
      filterRagebait: updated.filterRagebait,
      filterHateSpeech: updated.filterHateSpeech,
    });

    // Sync to server if we have a userId
    if (userId) {
      try {
        await fetch(`${API_URL}/api/settings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            filterEngagement: updated.filterEngagement,
            filterRagebait: updated.filterRagebait,
            filterHateSpeech: updated.filterHateSpeech,
          }),
        });
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

    try {
      const res = await fetch(`${API_URL}/api/rules`, {
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
        setRules([...rules, data.rule]);
        setNewRuleValue("");
        showToast("Rule added successfully", "success");
      } else {
        setErrorMessage("Failed to add rule");
      }
    } catch (error) {
      console.error("Error adding rule:", error);
      setErrorMessage("Failed to add rule");
    }
  };

  const deleteRule = async (ruleId: string) => {
    await handleDeleteRule(ruleId);
  };

  const handleUpgrade = async () => {
    if (!userId) return;
    
    try {
      const res = await fetch(`${API_URL}/api/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });

      const data = await res.json();
      if (data.url) {
        chrome.tabs.create({ url: data.url });
      }
    } catch (error) {
      console.error("Checkout error:", error);
      setErrorMessage("Failed to start checkout");
    }
  };

  const openDashboard = () => {
    if (userId) {
      chrome.tabs.create({ url: `${API_URL}/dashboard?userId=${userId}` });
    }
  };

  const refreshStats = async () => {
    await handleRefreshStats();
  };

  if (isLoading) {
    return (
      <div className="w-80 h-96 flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="w-80 bg-slate-50 min-h-[400px] text-slate-800 font-sans">
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-2 left-2 right-2 px-4 py-2 rounded shadow-lg z-50 text-sm ${
          toast.type === "success" ? "bg-green-500 text-white" : "bg-red-500 text-white"
        }`}>
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="bg-white p-4 shadow-sm border-b border-slate-200 flex justify-between items-center">
        <h1 className="text-lg font-bold bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent">
          NoMoreBots
        </h1>
        <div className="flex items-center gap-2">
          <button 
            onClick={refreshStats}
            className="text-slate-400 hover:text-slate-600"
            title="Refresh stats"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <div
            className={`w-2 h-2 rounded-full ${
              status === "connected" ? "bg-green-500" : 
              status === "error" ? "bg-red-500" : "bg-yellow-500"
            }`}
            title={status === "connected" ? "Connected" : status === "error" ? "Error" : "Loading"}
          />
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-slate-200 bg-white">
        <button
          onClick={() => setActiveTab("main")}
          className={`flex-1 py-2 text-sm font-medium ${
            activeTab === "main" 
              ? "text-blue-600 border-b-2 border-blue-600" 
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          Main
        </button>
        <button
          onClick={() => setActiveTab("settings")}
          className={`flex-1 py-2 text-sm font-medium ${
            activeTab === "settings" 
              ? "text-blue-600 border-b-2 border-blue-600" 
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          Settings
        </button>
        <button
          onClick={() => setActiveTab("rules")}
          className={`flex-1 py-2 text-sm font-medium ${
            activeTab === "rules" 
              ? "text-blue-600 border-b-2 border-blue-600" 
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          Rules ({rules.length})
        </button>
      </div>

      {/* Error Message */}
      {errorMessage && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-3 py-2 m-4 rounded text-xs">
          {errorMessage}
          <button 
            onClick={() => setErrorMessage("")}
            className="ml-2 font-bold"
          >
            ×
          </button>
        </div>
      )}

      {/* Main Tab */}
      {activeTab === "main" && (
        <div className="p-4 space-y-4">
          {/* Limit Warning */}
          {limitReached && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-3 py-2 rounded text-xs">
              <strong>Daily Limit Reached!</strong>
              <br />
              Upgrade to Premium to continue blocking bots today.
            </div>
          )}

          {/* Premium Section */}
          <div className="bg-gradient-to-r from-purple-100 to-blue-100 p-3 rounded-lg border border-purple-200">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-bold text-purple-900">Free Plan</span>
              <span className="text-[10px] text-purple-700">
                {stats.requestCount}/{stats.dailyLimit} Used
              </span>
            </div>
            <div className="w-full bg-purple-200 rounded-full h-2 mb-3">
              <div 
                className="bg-purple-600 h-2 rounded-full transition-all"
                style={{ width: `${Math.min((stats.requestCount / stats.dailyLimit) * 100, 100)}%` }}
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={openDashboard}
                className="flex-1 bg-gray-800 text-white py-2 rounded text-sm font-medium hover:bg-gray-700"
              >
                Dashboard
              </button>
              <button
                onClick={handleUpgrade}
                className="flex-1 bg-gradient-to-r from-blue-600 to-purple-600 text-white py-2 rounded text-sm font-medium hover:opacity-90"
              >
                Upgrade
              </button>
            </div>
          </div>

          {/* Enable Toggle */}
          <div className="flex items-center justify-between bg-white p-3 rounded-lg shadow-sm border border-slate-100">
            <span className="font-medium">Filter Enabled</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => saveSettings({ enabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600" />
            </label>
          </div>

          {/* Sensitivity Slider */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="font-medium">AI Sensitivity</span>
              <span className="text-slate-500">{Math.round(settings.threshold * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="0.95"
              step="0.05"
              value={settings.threshold}
              onChange={(e) => saveSettings({ threshold: parseFloat(e.target.value) })}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
            <div className="flex justify-between text-xs text-slate-400">
              <span>Permissive</span>
              <span>Strict</span>
            </div>
          </div>

          {/* Content Filters */}
          <div className="bg-white p-3 rounded-lg shadow-sm border border-slate-100">
            <h3 className="text-sm font-semibold mb-3">Content Filters</h3>
            <div className="space-y-2">
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-sm">Engagement Farming</span>
                <input
                  type="checkbox"
                  checked={settings.filterEngagement}
                  onChange={(e) => saveSettings({ filterEngagement: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                />
              </label>
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-sm">Ragebait</span>
                <input
                  type="checkbox"
                  checked={settings.filterRagebait}
                  onChange={(e) => saveSettings({ filterRagebait: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                />
              </label>
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-sm">Hate Speech</span>
                <input
                  type="checkbox"
                  checked={settings.filterHateSpeech}
                  onChange={(e) => saveSettings({ filterHateSpeech: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                />
              </label>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white p-3 rounded-lg shadow-sm border border-slate-100 text-center">
              <div className="text-2xl font-bold text-slate-700">{stats.scanned}</div>
              <div className="text-xs text-slate-500 uppercase tracking-wide">Scanned</div>
            </div>
            <div className="bg-white p-3 rounded-lg shadow-sm border border-slate-100 text-center">
              <div className="text-2xl font-bold text-purple-600">{stats.hidden}</div>
              <div className="text-xs text-slate-500 uppercase tracking-wide">Hidden</div>
            </div>
          </div>
        </div>
      )}

      {/* Settings Tab */}
      {activeTab === "settings" && (
        <div className="p-4 space-y-4">
          {/* AI Provider Selection */}
          <div className="bg-white p-3 rounded-lg shadow-sm border border-slate-100">
            <h3 className="text-sm font-semibold mb-3">AI Provider</h3>
            <p className="text-xs text-slate-500 mb-3">
              Select which AI model to use for classification
            </p>
            <div className="space-y-2">
              {[
                { id: "gemini", name: "Google Gemini", desc: "Fast & capable" },
                { id: "openai", name: "OpenAI GPT-3.5", desc: "Reliable & accurate" },
                { id: "anthropic", name: "Anthropic Claude", desc: "Thoughtful analysis" },
              ].map((p) => (
                <label
                  key={p.id}
                  className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                    provider === p.id
                      ? "bg-blue-50 border-blue-300"
                      : "bg-slate-50 border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="provider"
                      value={p.id}
                      checked={provider === p.id}
                      onChange={() => saveProvider(p.id as Provider)}
                      className="w-4 h-4 text-blue-600"
                    />
                    <div>
                      <div className="text-sm font-medium">{p.name}</div>
                      <div className="text-xs text-slate-500">{p.desc}</div>
                    </div>
                  </div>
                  {provider === p.id && (
                    <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  )}
                </label>
              ))}
            </div>
          </div>

          {/* API Key */}
          <div className="bg-blue-50 p-3 rounded-lg border border-blue-100">
            <label className="block text-xs font-semibold text-blue-800 mb-1">
              API Key (Optional)
            </label>
            <input
              type="password"
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => saveApiKey(e.target.value)}
              className="w-full text-xs p-2 rounded border border-blue-200 focus:outline-none focus:border-blue-400"
            />
            <p className="text-[10px] text-blue-600 mt-1">
              Use your own key to avoid rate limits
            </p>
          </div>

          {/* Reset Extension */}
          <div className="bg-red-50 p-3 rounded-lg border border-red-100">
            <h3 className="text-sm font-semibold text-red-800 mb-2">Danger Zone</h3>
            <button
              onClick={() => {
                if (confirm("Reset all settings? This cannot be undone.")) {
                  chrome.storage.local.clear();
                  window.location.reload();
                }
              }}
              className="w-full bg-red-600 text-white py-2 rounded text-sm font-medium hover:bg-red-700"
            >
              Reset All Settings
            </button>
          </div>

          {/* Version Info */}
          <div className="text-center text-xs text-slate-400">
            NoMoreBots v1.0.0
          </div>
        </div>
      )}

      {/* Rules Tab */}
      {activeTab === "rules" && (
        <div className="p-4 space-y-4">
          {/* Add Rule */}
          <div className="bg-white p-3 rounded-lg shadow-sm border border-slate-100">
            <h3 className="text-sm font-semibold mb-3">Add Rule</h3>
            <div className="space-y-2">
              <select
                value={newRuleType}
                onChange={(e) => setNewRuleType(e.target.value as any)}
                className="w-full text-sm p-2 rounded border border-slate-200 focus:outline-none focus:border-blue-400"
              >
                <option value="WHITELIST">Whitelist (Always Show)</option>
                <option value="BLACKLIST">Blacklist (Always Hide)</option>
                <option value="KEYWORD">Keyword (Hide if Match)</option>
              </select>
              <input
                type="text"
                placeholder={newRuleType === "KEYWORD" ? "Enter keyword..." : "@username (without @)"}
                value={newRuleValue}
                onChange={(e) => setNewRuleValue(e.target.value)}
                className="w-full text-sm p-2 rounded border border-slate-200 focus:outline-none focus:border-blue-400"
              />
              <button
                onClick={addRule}
                disabled={!newRuleValue.trim()}
                className="w-full bg-blue-600 text-white py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
              >
                Add Rule
              </button>
            </div>
          </div>

          {/* Rules List */}
          <div className="space-y-2">
            {rules.length === 0 ? (
              <div className="text-center text-slate-400 py-4 text-sm">
                No rules yet. Add one above!
              </div>
            ) : (
              rules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex items-center justify-between bg-white p-2 rounded-lg border border-slate-100"
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-1 rounded ${
                      rule.type === "WHITELIST" ? "bg-green-100 text-green-700" :
                      rule.type === "BLACKLIST" ? "bg-red-100 text-red-700" :
                      "bg-yellow-100 text-yellow-700"
                    }`}>
                      {rule.type}
                    </span>
                    <span className="text-sm truncate max-w-[140px]">{rule.value}</span>
                  </div>
                  <button
                    onClick={() => deleteRule(rule.id)}
                    className="text-red-500 hover:text-red-700 p-1"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
