import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "dotenv";
config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY not found in env");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

async function listModels() {
  try {
    // Note: The Node SDK might not expose listModels directly easily in this version,
    // but usually it's genAI.getGenerativeModel... wait, checking docs logic.
    // Actually typically it's specific to the endpoint.
    // Let's just try to instantiate the model and run a simple prompt.
    // If list is not available, we iterate common ones.

    const models = [
      "gemini-1.5-flash",
      "gemini-1.5-flash-001",
      "gemini-1.5-pro",
      "gemini-pro",
    ];

    console.log("Testing Gemini Models...");

    for (const modelName of models) {
      process.stdout.write(`Testing ${modelName}: `);
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent("Hello");
        const response = await result.response;
        console.log("OK");
      } catch (e: any) {
        console.log("FAILED", e.message.split("\n")[0]);
      }
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

listModels();
