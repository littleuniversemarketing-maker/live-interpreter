import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`
    );
  }
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  openaiApiKey: required("OPENAI_API_KEY"),
  openaiRealtimeModel: process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime",
  // How many prior translated turns to keep as rolling context (section 13).
  rollingContextTurns: Number(process.env.ROLLING_CONTEXT_TURNS ?? 6),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173").split(","),
};
