"use client";

export default function LoadingPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <h1 className="text-xl font-semibold text-gray-800 mb-2">Loading NoMoreBots</h1>
        <p className="text-gray-500">Please wait...</p>
      </div>
    </div>
  );
}
