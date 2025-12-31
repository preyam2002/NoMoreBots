"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";

export default function Dashboard() {
  const searchParams = useSearchParams();
  const [userId, setUserId] = useState<string>("");
  const [stats, setStats] = useState({ scanned: 0, bots: 0, saved: "-- min" });
  const [isPremium, setIsPremium] = useState(false);
  const [rules, setRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [newRuleValue, setNewRuleValue] = useState("");
  const [newRuleType, setNewRuleType] = useState("WHITELIST");
  const [filters, setFilters] = useState({
    engagement: false,
    ragebait: false,
    hateSpeech: false,
  });

  useEffect(() => {
    const queryUserId = searchParams.get("userId");
    if (queryUserId) {
      setUserId(queryUserId);
    }
  }, [searchParams]);

  useEffect(() => {
    if (userId) {
      fetchStats();
      fetchRules();
    }
  }, [userId]);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/stats?userId=${userId}`);
      const data = await res.json();
      if (data.stats) {
        setStats({
          scanned: data.stats.tweetsScanned,
          bots: data.stats.botsBlocked,
          saved: Math.round(data.stats.botsBlocked * 0.5) + " min", // Est. 30s per bot
        });
        setIsPremium(data.stats.isPremium);
        setFilters({
          engagement: data.stats.filterEngagement,
          ragebait: data.stats.filterRagebait,
          hateSpeech: data.stats.filterHateSpeech,
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const fetchRules = async () => {
    setLoading(true);
    try {
      const rulesRes = await fetch(`/api/rules?userId=${userId}`);
      const rulesData = await rulesRes.json();
      setRules(rulesData.rules || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (userId) {
      fetchStats();
      fetchRules();
    }
  };

  const addRule = async () => {
    if (!userId || !newRuleValue) return;
    try {
      const res = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          type: newRuleType,
          value: newRuleValue,
        }),
      });
      if (res.ok) {
        setNewRuleValue("");
        fetchRules();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const deleteRule = async (ruleId: string) => {
    try {
      const res = await fetch(`/api/rules?id=${ruleId}&userId=${userId}`, {
        method: "DELETE",
      });
      if (res.ok) fetchRules();
    } catch (e) {
      console.error(e);
    }
  };

  if (!userId && !loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <form onSubmit={handleLogin} className="bg-white p-8 rounded shadow-md">
          <h1 className="text-2xl font-bold mb-4">Login to Dashboard</h1>
          <input
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="Enter your User ID"
            className="border p-2 rounded w-full mb-4"
          />
          <button
            type="submit"
            className="bg-blue-600 text-white p-2 rounded w-full"
          >
            Access Dashboard
          </button>
          <p className="text-sm text-gray-500 mt-2">
            Find your User ID in the extension settings.
          </p>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto">
        <header className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800">
            NoMoreBots Dashboard
          </h1>
          <div className="text-sm text-gray-600">User ID: {userId}</div>
        </header>

        {/* Stats Section */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-white p-6 rounded shadow">
            <h3 className="text-gray-500 text-sm uppercase">Tweets Scanned</h3>
            <p className="text-3xl font-bold text-blue-600">{stats.scanned}</p>
          </div>
          <div className="bg-white p-6 rounded shadow">
            <h3 className="text-gray-500 text-sm uppercase">Bots Blocked</h3>
            <p className="text-3xl font-bold text-red-600">{stats.bots}</p>
          </div>
          <div className="bg-white p-6 rounded shadow">
            <h3 className="text-gray-500 text-sm uppercase">Premium Status</h3>
            <p
              className={`text-3xl font-bold ${
                isPremium ? "text-green-600" : "text-gray-400"
              }`}
            >
              {isPremium ? "Active" : "Free"}
            </p>
          </div>
        </section>

        {/* Rules Section */}
        <section className="bg-white p-6 rounded shadow mb-8">
          <h2 className="text-xl font-bold mb-4">Filtering Rules</h2>
          <div className="flex gap-4 mb-4">
            <select
              value={newRuleType}
              onChange={(e) => setNewRuleType(e.target.value)}
              className="border p-2 rounded"
            >
              <option value="WHITELIST">Whitelist (Trust @)</option>
              <option value="BLACKLIST">Blacklist (Block @)</option>
              <option value="KEYWORD">Keyword (Block Word)</option>
            </select>
            <input
              type="text"
              value={newRuleValue}
              onChange={(e) => setNewRuleValue(e.target.value)}
              placeholder="Enter handle or keyword..."
              className="border p-2 rounded flex-1"
            />
            <button
              onClick={addRule}
              className="bg-blue-600 text-white px-4 rounded"
            >
              Add Rule
            </button>
          </div>

          <div className="space-y-2">
            {rules.length === 0 && (
              <p className="text-gray-500">No rules defined yet.</p>
            )}
            {rules.map((rule) => (
              <div
                key={rule.id}
                className="flex justify-between items-center p-3 bg-gray-50 rounded border"
              >
                <div>
                  <span
                    className={`text-xs font-bold px-2 py-1 rounded mr-3 ${
                      rule.type === "WHITELIST"
                        ? "bg-green-100 text-green-800"
                        : rule.type === "BLACKLIST"
                        ? "bg-red-100 text-red-800"
                        : "bg-yellow-100 text-yellow-800"
                    }`}
                  >
                    {rule.type}
                  </span>
                  <span className="font-medium">{rule.value}</span>
                </div>
                <button
                  onClick={() => deleteRule(rule.id)}
                  className="text-red-500 hover:text-red-700"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
