function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`${name} env var not set`);
  return val;
}

export const getAnthropicKey = () => requireEnv("ANTHROPIC_API_KEY");
export const getOpenaiKey = () => requireEnv("OPENAI_API_KEY");
export const getSlackBotToken = () => requireEnv("SLACK_BOT_TOKEN");
export const getSlackSigningSecret = () => requireEnv("SLACK_SIGNING_SECRET");
export const getSlackChannelId = () => requireEnv("SLACK_CHANNEL_ID");
