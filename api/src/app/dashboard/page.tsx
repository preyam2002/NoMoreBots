"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";

interface UserStats {
  scanned: number;
  hidden: number;
  requestCount: number;
  dailyLimit: number;
  isPremium: boolean;
  sessions: number;
  filterEngagement: boolean;
  filterRagebait: boolean;
  filterHateSpeech: boolean;
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
      { label: "Human", value: humanCount, color: "#22c55e" },
      { label: "AI/Bot", value: safeHidden, color: "#ef4444" },
    ]);
  }, [scanned, hidden]);

  const total = data.reduce((sum, d) => sum + d.value, 0) || 1;

  return (
    <div className="w-full">
      <div className="flex items-end justify-center gap-2 h-48 mb-4">
        {data.map((item, index) => {
          const height = total > 0 ? (item.value / total) * 100 : 0;
          return (
            <div key={index} className="flex flex-col items-center gap-2">
              <div
                className="w-16 rounded-t-lg transition-all duration-500 flex items-end justify-center pb-2"
                style={{
                  height: `${Math.max(height, 5)}%`,
                  backgroundColor: item.color,
                  minHeight: "20px",
                }}
              >
                {item.value > 0 && (
                  <span className="text-white font-bold text-sm">{item.value}</span>
                )}
              </div>
              <span className="text-sm font-medium text-gray-600">{item.label}</span>
            </div>
          );
        })}
      </div>
      <div className="text-center text-sm text-gray-500">
        {total} total tweets analyzed
      </div>
    </div>
  );
}

interface Rule {
  id: string;
  type: "WHITELIST" | "BLACKLIST" | "KEYWORD";
  value: string;
  createdAt: string;
}

export default function Dashboard() {
  const searchParams = useSearchParams();
  const [userId, setUserId] = useState<string>("");
  const [stats, setStats] = useState<UserStats | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "filters" | "rules" | "analytics">("overview");
  const [newRuleValue, setNewRuleValue] = useState("");
  const [newRuleType, setNewRuleType] = useState<"WHITELIST" | "BLACKLIST" | "KEYWORD">("WHITELIST");
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    const queryUserId = searchParams.get("userId");
    if (queryUserId) {
      setUserId(queryUserId);
    }
  }, [searchParams]);

  useEffect(() => {
    if (userId) {
      fetchAllData();
    }
  }, [userId]);

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

  const fetchStats = async () => {
    try {
      const res = await fetch(`/api/stats?userId=${userId}`);
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
      const rulesRes = await fetch(`/api/rules?userId=${userId}`);
      const rulesData = await rulesRes.json();
      setRules(rulesData.rules || []);
    } catch (e) {
      console.error("Error fetching rules:", e);
    }
  };

  const showNotification = (type: "success" | "error", message: string) => {
    setNotification({ type, message });
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (userId) {
      fetchAllData();
    }
  };

  const addRule = async () => {
    if (!userId || !newRuleValue.trim()) return;
    try {
      const res = await fetch("/api/rules", {
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
        showNotification("error", "Failed to add rule");
      }
    } catch (e) {
      showNotification("error", "Error adding rule");
    }
  };

  const deleteRule = async (ruleId: string) => {
    try {
      const res = await fetch(`/api/rules?ruleId=${ruleId}&userId=${userId}`, {
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

  const updateFilter = async (filter: string, value: boolean) => {
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, [filter]: value }),
      });
      if (res.ok) {
        await fetchStats();
        showNotification("success", "Settings updated");
      } else {
        showNotification("error", "Failed to update settings");
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
          await fetch("/api/rules", {
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

  if (!userId && !loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <form onSubmit={handleLogin} className="bg-white p-8 rounded-lg shadow-md max-w-md w-full">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-gray-800 mb-2">NoMoreBots</h1>
            <p className="text-gray-500">Enter your User ID to access the dashboard</p>
          </div>
          <input
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="Enter your User ID"
            className="border border-gray-300 p-3 rounded-lg w-full mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            className="w-full bg-gradient-to-r from-blue-500 to-purple-600 text-white p-3 rounded-lg font-medium hover:opacity-90 transition-opacity"
          >
            Access Dashboard
          </button>
          <p className="text-sm text-gray-500 mt-4 text-center">
            Find your User ID in the extension popup settings
          </p>
        </form>
      </div>
    );
  }

  const blockedPercentage = stats && stats.scanned > 0 ? Math.round((stats.hidden / stats.scanned) * 100) : 0;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Notification */}
      {notification && (
        <div className={`fixed top-4 right-4 px-6 py-3 rounded-lg shadow-lg z-50 ${
          notification.type === "success" ? "bg-green-500" : "bg-red-500"
        } text-white`}>
          {notification.message}
        </div>
      )}

      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-lg">🤖</span>
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-800">NoMoreBots Dashboard</h1>
                <p className="text-sm text-gray-500">AI-Powered Tweet Filter</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-500">User ID: {userId.slice(0, 8)}...</span>
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                stats?.isPremium 
                  ? "bg-gradient-to-r from-yellow-400 to-orange-500 text-white" 
                  : "bg-gray-200 text-gray-600"
              }`}>
                {stats?.isPremium ? "Premium" : "Free"}
              </span>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex gap-6 mt-4 border-t pt-4">
            {[
              { id: "overview", label: "Overview", icon: "📊" },
              { id: "filters", label: "Filters", icon: "⚙️" },
              { id: "rules", label: "Rules", icon: "📋" },
              { id: "analytics", label: "Analytics", icon: "📈" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                  activeTab === tab.id
                    ? "bg-blue-50 text-blue-600"
                    : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                <span>{tab.icon}</span>
                <span className="font-medium">{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-8">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : (
          <>
            {/* Overview Tab */}
            {activeTab === "overview" && (
              <div className="space-y-6">
                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-white p-6 rounded-xl shadow-sm">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500 uppercase tracking-wide">Tweets Scanned</p>
                        <p className="text-3xl font-bold text-blue-600 mt-1">{stats?.scanned || 0}</p>
                      </div>
                      <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                        <span className="text-2xl">🔍</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white p-6 rounded-xl shadow-sm">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500 uppercase tracking-wide">Content Hidden</p>
                        <p className="text-3xl font-bold text-red-600 mt-1">{stats?.hidden || 0}</p>
                      </div>
                      <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                        <span className="text-2xl">🚫</span>
                      </div>
                    </div>
                    <div className="mt-4">
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>Block Rate</span>
                        <span>{blockedPercentage}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-gradient-to-r from-red-500 to-orange-500 h-2 rounded-full transition-all"
                          style={{ width: `${blockedPercentage}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="bg-white p-6 rounded-xl shadow-sm">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500 uppercase tracking-wide">API Requests</p>
                        <p className="text-3xl font-bold text-purple-600 mt-1">{stats?.requestCount || 0}</p>
                      </div>
                      <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center">
                        <span className="text-2xl">🔑</span>
                      </div>
                    </div>
                    <div className="mt-4">
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>Daily Limit</span>
                        <span>{stats?.requestCount || 0}/{stats?.dailyLimit || 100}</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-gradient-to-r from-purple-500 to-pink-500 h-2 rounded-full transition-all"
                          style={{ width: `${((stats?.requestCount || 0) / (stats?.dailyLimit || 100)) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="bg-white p-6 rounded-xl shadow-sm">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500 uppercase tracking-wide">Time Saved</p>
                        <p className="text-3xl font-bold text-green-600 mt-1">
                          {Math.round((stats?.hidden || 0) * 0.5)} min
                        </p>
                      </div>
                      <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                        <span className="text-2xl">⏱️</span>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">Estimated at 30 seconds per blocked tweet</p>
                  </div>
                </div>

                {/* Quick Actions */}
                <div className="bg-white p-6 rounded-xl shadow-sm">
                  <h2 className="text-lg font-bold mb-4">Quick Actions</h2>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <button
                      onClick={() => setActiveTab("filters")}
                      className="p-4 border rounded-lg hover:bg-gray-50 transition-colors text-left"
                    >
                      <span className="text-2xl">⚙️</span>
                      <p className="font-medium mt-2">Configure Filters</p>
                    </button>
                    <button
                      onClick={() => setActiveTab("rules")}
                      className="p-4 border rounded-lg hover:bg-gray-50 transition-colors text-left"
                    >
                      <span className="text-2xl">📋</span>
                      <p className="font-medium mt-2">Manage Rules</p>
                    </button>
                    <button
                      onClick={() => setActiveTab("analytics")}
                      className="p-4 border rounded-lg hover:bg-gray-50 transition-colors text-left"
                    >
                      <span className="text-2xl">📈</span>
                      <p className="font-medium mt-2">View Analytics</p>
                    </button>
                    {!stats?.isPremium && (
                      <button className="p-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg hover:opacity-90 transition-opacity text-left">
                        <span className="text-2xl">⭐</span>
                        <p className="font-medium mt-2">Upgrade to Premium</p>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Filters Tab */}
            {activeTab === "filters" && (
              <div className="bg-white p-6 rounded-xl shadow-sm">
                <h2 className="text-lg font-bold mb-6">Content Filters</h2>
                <div className="space-y-4">
                  <label className="flex items-start justify-between p-4 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">🎣</span>
                        <span className="font-medium">Engagement Farming</span>
                      </div>
                      <p className="text-sm text-gray-500 mt-1">
                        Hide tweets that explicitly ask for likes, retweets, replies, or followers
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={stats?.filterEngagement || false}
                      onChange={(e) => updateFilter("filterEngagement", e.target.checked)}
                      className="w-6 h-6 mt-1 accent-blue-600"
                    />
                  </label>

                  <label className="flex items-start justify-between p-4 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">😠</span>
                        <span className="font-medium">Ragebait</span>
                      </div>
                      <p className="text-sm text-gray-500 mt-1">
                        Hide intentionally provocative content designed to cause anger and engagement
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={stats?.filterRagebait || false}
                      onChange={(e) => updateFilter("filterRagebait", e.target.checked)}
                      className="w-6 h-6 mt-1 accent-orange-600"
                    />
                  </label>

                  <label className="flex items-start justify-between p-4 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">🚫</span>
                        <span className="font-medium">Hate Speech</span>
                      </div>
                      <p className="text-sm text-gray-500 mt-1">
                        Hide content that attacks or promotes hatred toward protected groups
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={stats?.filterHateSpeech || false}
                      onChange={(e) => updateFilter("filterHateSpeech", e.target.checked)}
                      className="w-6 h-6 mt-1 accent-red-600"
                    />
                  </label>
                </div>
              </div>
            )}

            {/* Rules Tab */}
            {activeTab === "rules" && (
              <div className="space-y-6">
                {/* Add Rule */}
                <div className="bg-white p-6 rounded-xl shadow-sm">
                  <h2 className="text-lg font-bold mb-4">Add New Rule</h2>
                  <div className="flex flex-wrap gap-4">
                    <select
                      value={newRuleType}
                      onChange={(e) => setNewRuleType(e.target.value as typeof newRuleType)}
                      className="border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="WHITELIST">✅ Whitelist (Always Show)</option>
                      <option value="BLACKLIST">🚫 Blacklist (Always Hide)</option>
                      <option value="KEYWORD">🔍 Keyword (Hide if Match)</option>
                    </select>
                    <input
                      type="text"
                      value={newRuleValue}
                      onChange={(e) => setNewRuleValue(e.target.value)}
                      placeholder={newRuleType === "KEYWORD" ? "Enter keyword..." : "Username (without @)"}
                      className="flex-1 border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={addRule}
                      disabled={!newRuleValue.trim()}
                      className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-6 py-3 rounded-lg font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                    >
                      Add Rule
                    </button>
                  </div>
                </div>

                {/* Rules List */}
                <div className="bg-white p-6 rounded-xl shadow-sm">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold">Your Rules ({rules.length})</h2>
                    <div className="flex gap-2">
                      <button
                        onClick={exportRules}
                        className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm"
                      >
                        Export
                      </button>
                      <label className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm cursor-pointer">
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
                    <div className="text-center py-12 text-gray-500">
                      <span className="text-4xl">📭</span>
                      <p className="mt-2">No rules defined yet</p>
                      <p className="text-sm">Add your first rule above to start filtering</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {rules.map((rule) => (
                        <div
                          key={rule.id}
                          className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
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
                            <span className="font-medium">{rule.value}</span>
                          </div>
                          <button
                            onClick={() => deleteRule(rule.id)}
                            className="text-red-500 hover:text-red-700 p-2"
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
                <div className="bg-white p-6 rounded-xl shadow-sm">
                  <h2 className="text-lg font-bold mb-4">Usage Over Time</h2>
                  <div className="h-64 flex items-center justify-center bg-gray-50 rounded-lg">
                    <UsageChart scanned={stats?.scanned || 0} hidden={stats?.hidden || 0} />
                  </div>
                </div>

                <div className="bg-white p-6 rounded-xl shadow-sm">
                  <h2 className="text-lg font-bold mb-4">Usage Statistics</h2>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="text-center p-4 bg-blue-50 rounded-lg">
                      <p className="text-3xl font-bold text-blue-600">{stats?.scanned || 0}</p>
                      <p className="text-sm text-gray-600">Total Tweets Scanned</p>
                    </div>
                    <div className="text-center p-4 bg-red-50 rounded-lg">
                      <p className="text-3xl font-bold text-red-600">{stats?.hidden || 0}</p>
                      <p className="text-sm text-gray-600">Total Content Hidden</p>
                    </div>
                    <div className="text-center p-4 bg-purple-50 rounded-lg">
                      <p className="text-3xl font-bold text-purple-600">{blockedPercentage}%</p>
                      <p className="text-sm text-gray-600">Block Rate</p>
                    </div>
                  </div>
                </div>

                <div className="bg-white p-6 rounded-xl shadow-sm">
                  <h2 className="text-lg font-bold mb-4">Filter Configuration</h2>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className={`p-4 rounded-lg ${stats?.filterEngagement ? "bg-green-50 border border-green-200" : "bg-gray-50 border border-gray-200"}`}>
                      <div className="flex items-center gap-2">
                        <span>{stats?.filterEngagement ? "✅" : "❌"}</span>
                        <span className="font-medium">Engagement Farming Filter</span>
                      </div>
                    </div>
                    <div className={`p-4 rounded-lg ${stats?.filterRagebait ? "bg-green-50 border border-green-200" : "bg-gray-50 border border-gray-200"}`}>
                      <div className="flex items-center gap-2">
                        <span>{stats?.filterRagebait ? "✅" : "❌"}</span>
                        <span className="font-medium">Ragebait Filter</span>
                      </div>
                    </div>
                    <div className={`p-4 rounded-lg ${stats?.filterHateSpeech ? "bg-green-50 border border-green-200" : "bg-gray-50 border border-gray-200"}`}>
                      <div className="flex items-center gap-2">
                        <span>{stats?.filterHateSpeech ? "✅" : "❌"}</span>
                        <span className="font-medium">Hate Speech Filter</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white p-6 rounded-xl shadow-sm">
                  <h2 className="text-lg font-bold mb-4">Your Rules Summary</h2>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center p-4 bg-green-50 rounded-lg">
                      <p className="text-2xl font-bold text-green-600">
                        {rules.filter(r => r.type === "WHITELIST").length}
                      </p>
                      <p className="text-sm text-gray-600">Whitelist</p>
                    </div>
                    <div className="text-center p-4 bg-red-50 rounded-lg">
                      <p className="text-2xl font-bold text-red-600">
                        {rules.filter(r => r.type === "BLACKLIST").length}
                      </p>
                      <p className="text-sm text-gray-600">Blacklist</p>
                    </div>
                    <div className="text-center p-4 bg-yellow-50 rounded-lg">
                      <p className="text-2xl font-bold text-yellow-600">
                        {rules.filter(r => r.type === "KEYWORD").length}
                      </p>
                      <p className="text-sm text-gray-600">Keywords</p>
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
