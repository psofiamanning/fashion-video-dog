// Server-only configuration. Every key comes from environment variables;
// nothing secret is ever sent to the browser.
import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return value;
}

export const env = {
  anthropicModel: () => process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
  minimaxApiKey: () => required("MINIMAX_API_KEY"),
  minimaxModel: () => process.env.MINIMAX_MODEL || "MiniMax-H3",
  minimaxResolution: () => process.env.MINIMAX_RESOLUTION || "768P",
  minimaxDuration: () => Number(process.env.MINIMAX_DURATION_SECONDS || 6),
  supabaseUrl: () => required("SUPABASE_URL"),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
};
