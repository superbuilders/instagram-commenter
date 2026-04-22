import { Resource } from "sst";

function getSecret(resourceName: string, envFallback: string): string {
  try {
    const val = (Resource as any)[resourceName]?.value;
    if (val) return val;
  } catch {}
  const env = process.env[envFallback];
  if (env) return env;
  throw new Error(`${resourceName} secret not available`);
}

export const getAnthropicKey = () => getSecret("AnthropicApiKey", "ANTHROPIC_API_KEY");
export const getOpenaiKey = () => getSecret("OpenaiApiKey", "OPENAI_API_KEY");
export const getSlackBotToken = () => getSecret("SlackBotToken", "SLACK_BOT_TOKEN");
export const getSlackSigningSecret = () => getSecret("SlackSigningSecret", "SLACK_SIGNING_SECRET");
export const getSlackChannelId = () => getSecret("SlackChannelId", "SLACK_CHANNEL_ID");
