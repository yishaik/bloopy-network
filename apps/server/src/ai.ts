import { open } from "./crypto.js";
import type { StoryCard } from "./types.js";

interface AIProfile { base_url: string; model: string; encrypted_api_key: string }

export async function enrichStory(profile: AIProfile | null, story: StoryCard, voice: string): Promise<StoryCard> {
  if (!profile) return story;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6_000);
  try {
    const response = await fetch(`${profile.base_url.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${open(profile.encrypted_api_key)}` },
      body: JSON.stringify({
        model: profile.model,
        temperature: 0.7,
        max_tokens: 180,
        messages: [
          { role: "system", content: "Rewrite the game story in the requested voice. Preserve all facts, rewards and choices. Return JSON with title and body only." },
          { role: "user", content: JSON.stringify({ voice, title: story.title, body: story.body }) }
        ],
        response_format: { type: "json_object" }
      }),
      signal: controller.signal
    });
    if (!response.ok) return story;
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return story;
    const parsed = JSON.parse(content) as { title?: string; body?: string };
    return parsed.title && parsed.body ? { ...story, title: parsed.title, body: parsed.body } : story;
  } catch { return story; }
  finally { clearTimeout(timeout); }
}
