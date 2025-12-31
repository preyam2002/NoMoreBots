import React, { useEffect, useState } from "react";

function App() {
  const [enabled, setEnabled] = useState(true);
  const [threshold, setThreshold] = useState(0.75);
  const [stats, setStats] = useState({ scanned: 0, hidden: 0 });
  const [status, setStatus] = useState<"connected" | "error">("connected");
  const [apiKey, setApiKey] = useState("");

  const [showRules, setShowRules] = useState(false);
  const [rules, setRules] = useState<any[]>([]);
  const [newRuleValue, setNewRuleValue] = useState("");
  const [newRuleType, setNewRuleType] = useState("WHITELIST");

  const fetchRules = async (userId: string) => {
    try {
      const res = await fetch(
        `http://localhost:3000/api/rules?userId=${userId}`
      );
      const data = await res.json();
      if (data.rules) setRules(data.rules);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    // Load settings from storage
    chrome.storage.local.get(
      ["enabled", "threshold", "stats", "userApiKey", "userId"],
      (result) => {
        if (result.enabled !== undefined) setEnabled(result.enabled);
        if (result.threshold !== undefined) setThreshold(result.threshold);
        if (result.stats) setStats(result.stats);
        if (result.userApiKey) setApiKey(result.userApiKey);
        if (result.userId) fetchRules(result.userId);
      }
    );

    // Simple health check
    fetch("http://localhost:3000/api/health") // Assuming we add a health endpoint or just check classify
      .then((res) => {
        if (!res.ok) setStatus("error");
      })
      .catch(() => setStatus("error"));
  }, []);

  const saveSettings = (newEnabled: boolean, newThreshold: number) => {
    chrome.storage.local.set({ enabled: newEnabled, threshold: newThreshold });
    setEnabled(newEnabled);
    setThreshold(newThreshold);
  };

  const saveApiKey = (key: string) => {
    setApiKey(key);
    chrome.storage.local.set({ userApiKey: key });
  };

  const handleUpgrade = async () => {
    try {
      // Get userId from storage
      const { userId } = await chrome.storage.local.get(["userId"]);
      if (!userId) return;

      const res = await fetch("http://localhost:3000/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });

      const data = await res.json();
      if (data.url) {
        // Open Stripe checkout in new tab
        chrome.tabs.create({ url: data.url });
      }
    } catch (error) {
      console.error("Checkout error:", error);
    }
  };

  return (
    <div className="w-72 bg-slate-50 min-h-[300px] text-slate-800 font-sans">
      <div className="bg-white p-4 shadow-sm border-b border-slate-200 flex justify-between items-center">
        <h1 className="text-lg font-bold bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent">
          AI Tweet Filter
        </h1>
        <div
          className={`w-2 h-2 rounded-full ${
            status === "connected" ? "bg-green-500" : "bg-red-500"
          }`}
          title={status === "connected" ? "Backend Connected" : "Backend Error"}
        ></div>
      </div>

      <div className="p-4 space-y-6">
        {limitReached && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-3 py-2 rounded mb-4 text-xs">
            <strong>Daily Limit Reached!</strong>
            <br />
            Upgrade to Premium to continue blocking bots today.
          </div>
        )}
        {/* Premium Upgrade Section */}
        <div className="bg-gradient-to-r from-purple-100 to-blue-100 p-3 rounded-lg border border-purple-200">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold text-purple-900">Free Plan</span>
            <span className="text-[10px] text-purple-700">
              {stats.scanned}/100 Used
            </span>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={() =>
                chrome.tabs.create({
                  url: `http://localhost:3000/dashboard?userId=${stats.userId}`,
                })
              }
              className="flex-1 bg-gray-800 text-white py-2 rounded text-sm font-medium hover:bg-gray-700"
            >
              Open Dashboard
            </button>
            <button
              onClick={handlePayment}
              className="flex-1 bg-gradient-to-r from-blue-600 to-purple-600 text-white py-2 rounded text-sm font-medium hover:opacity-90"
            >
              Upgrade to Premium
            </button>
          </div>
        </div>

        {/* API Key Section */}
        <div className="bg-blue-50 p-3 rounded-lg border border-blue-100">
          <label className="block text-xs font-semibold text-blue-800 mb-1">
            OpenAI API Key (Optional)
          </label>
          <input
            type="password"
            placeholder="sk-..."
            value={apiKey}
            onChange={(e) => saveApiKey(e.target.value)}
            className="w-full text-xs p-2 rounded border border-blue-200 focus:outline-none focus:border-blue-400"
          />
          <p className="text-[10px] text-blue-600 mt-1">
            Required after 100 free requests.
          </p>
        </div>

        <div className="flex items-center justify-between bg-white p-3 rounded-lg shadow-sm border border-slate-100">
          <span className="font-medium">Filter Enabled</span>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => saveSettings(e.target.checked, threshold)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="font-medium">Sensitivity</span>
            <span className="text-slate-500">
              {Math.round(threshold * 100)}%
            </span>
          </div>
          <input
            type="range"
            min="0.5"
            max="0.95"
            step="0.05"
            value={threshold}
            onChange={(e) => saveSettings(enabled, parseFloat(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
          />
          <div className="flex justify-between text-xs text-slate-400">
            <span>Permissive</span>
            <span>Strict</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white p-3 rounded-lg shadow-sm border border-slate-100 text-center">
            <div className="text-2xl font-bold text-slate-700">
              {stats.scanned}
            </div>
            <div className="text-xs text-slate-500 uppercase tracking-wide">
              Scanned
            </div>
          </div>
          <div className="bg-white p-3 rounded-lg shadow-sm border border-slate-100 text-center">
            <div className="text-2xl font-bold text-purple-600">
              {stats.hidden}
            </div>
            <div className="text-xs text-slate-500 uppercase tracking-wide">
              Hidden
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
