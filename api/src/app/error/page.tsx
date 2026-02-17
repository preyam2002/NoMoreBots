"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

export default function ErrorPage() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const message = searchParams.get("message");

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full text-center">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-3xl">❌</span>
        </div>
        
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Something went wrong</h1>
        
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
            <p className="text-red-800 font-medium">{error}</p>
          </div>
        )}
        
        {message && (
          <p className="text-gray-600 mb-6">{message}</p>
        )}
        
        <div className="space-y-3">
          <a
            href="/dashboard"
            className="block w-full bg-gradient-to-r from-blue-500 to-purple-600 text-white py-3 rounded-lg font-medium hover:opacity-90 transition-opacity"
          >
            Go to Dashboard
          </a>
          
          <a
            href="https://github.com/preyam2002/NoMoreBots/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full border border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 transition-colors"
          >
            Report Issue
          </a>
        </div>
        
        <p className="text-sm text-gray-500 mt-6">
          NoMoreBots v1.1.0
        </p>
      </div>
    </div>
  );
}
