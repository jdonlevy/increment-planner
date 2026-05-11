"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AuthPage() {
  const [answer, setAnswer] = useState("");
  const [error, setError]   = useState(false);
  const [shaking, setShaking] = useState(false);
  const router = useRouter();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (answer.trim() === "42") {
      document.cookie = "planner_auth=true; path=/; max-age=2592000"; // 30 days
      router.push("/");
    } else {
      setError(true);
      setShaking(true);
      setTimeout(() => setShaking(false), 500);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className={`bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 ${shaking ? "animate-[shake_0.4s_ease]" : ""}`}>
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-indigo-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">🗓️</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900">Increment Planner</h1>
          <p className="text-sm text-slate-400 mt-1">Answer to enter</p>
        </div>

        <form onSubmit={submit} className="space-y-5">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2 text-center">
              What is the meaning of life?
            </label>
            <input
              autoFocus
              value={answer}
              onChange={e => { setAnswer(e.target.value); setError(false); }}
              placeholder="Your answer…"
              className={`w-full border rounded-xl px-4 py-3 text-sm text-slate-900 text-center focus:outline-none focus:ring-2 transition-colors ${
                error ? "border-red-400 focus:ring-red-300 bg-red-50" : "border-slate-300 focus:ring-indigo-400"
              }`}
            />
            {error && <p className="text-xs text-red-500 text-center mt-2">That&apos;s not quite right…</p>}
          </div>
          <button
            type="submit"
            className="w-full bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 active:scale-95 text-white font-semibold py-3 rounded-xl transition-all select-none"
          >
            Enter
          </button>
        </form>
      </div>

      <style>{`
        @keyframes shake {
          0%,100% { transform: translateX(0); }
          20%      { transform: translateX(-8px); }
          40%      { transform: translateX(8px); }
          60%      { transform: translateX(-5px); }
          80%      { transform: translateX(5px); }
        }
      `}</style>
    </div>
  );
}
