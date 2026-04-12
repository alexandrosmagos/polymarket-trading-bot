import { config } from "../config/index.js";

export async function sendPushoverNotification(title: string, message: string, priority: number = 0): Promise<void> {
  if (!config.pushoverApiToken || !config.pushoverUserKey) {
    return; // Don't send if not configured
  }

  try {
    const res = await fetch("https://api.pushover.net/1/messages.json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: config.pushoverApiToken,
        user: config.pushoverUserKey,
        title,
        message,
        priority,
      }),
    });

    if (!res.ok) {
      console.error(`Pushover error: ${res.status} ${await res.text()}`);
    }
  } catch (error) {
    console.error(`Failed to send Pushover notification:`, error);
  }
}
