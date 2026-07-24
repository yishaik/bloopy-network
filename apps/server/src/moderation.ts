const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" };

const SUBSTRING_BLOCKED = ["fuck", "shit", "bitch", "cunt", "whore", "slut", "faggot", "nigg", "kike", "retard", "hitler", "nazi", "porn", "penis", "vagina", "jizz", "dildo", "blowjob", "handjob"];
const WORD_BLOCKED_RE = /\b(ass|asses|asshole|dick|dicks|cock|cocks|sex|rape|rapist|cum|tit|tits|anal|nude|nudes|hoe|fag)\b/;
const IMPERSONATION_RE = /\b(admin|administrator|moderator|support|telegram|official)\b/;

function normalizeForModeration(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[013457@$!]/g, (ch) => LEET[ch] ?? ch);
}

export function isBlockedText(text: string): boolean {
  const norm = normalizeForModeration(text);
  return SUBSTRING_BLOCKED.some((word) => norm.includes(word)) || WORD_BLOCKED_RE.test(norm);
}

// Names are short and shareable (deep links, bot usernames), so also catch spaced-out evasion and impersonation.
export function isBlockedName(name: string): boolean {
  const norm = normalizeForModeration(name);
  const squashed = norm.replace(/[^\p{L}\p{N}]+/gu, "");
  return isBlockedText(name) || SUBSTRING_BLOCKED.some((word) => squashed.includes(word)) || IMPERSONATION_RE.test(norm);
}
