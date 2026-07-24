import type pg from "pg";
import { renderAvatar } from "./avatar.js";
import { config } from "./config.js";
import type { AvatarGenome } from "./types.js";

/** Small, fixed and authored. Sharing is a courtesy, never a progression requirement. */
export const REFERRAL_REWARD = { referrerStars: 3, referredStars: 2 } as const;

export interface ShareCardView {
  shareToken: string;
  meetRef: string;
  name: string;
  level: number;
  evolution: number;
  genome: AvatarGenome;
  headline: string;
  latestStoryTitle: string | null;
}

const escapeXml = (value: string): string => value.replace(/[<>&'"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[char] ?? char));

/** Trims to a whole word so a truncated card never ends mid-syllable. */
function clamp(value: string, limit: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= limit) return collapsed;
  const cut = collapsed.slice(0, limit - 1);
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > limit * 0.6 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

function evolutionLabel(evolution: number): string {
  return evolution >= 3 ? "Third evolution" : evolution === 2 ? "Second evolution" : "First evolution";
}

/**
 * Loads only what is safe to put on a page anyone can open.
 *
 * Private memories, hidden story state, the owner's Telegram identity and the slug that encodes it
 * are all excluded by never selecting them. Story titles are authored or engine-constrained; story
 * bodies are not published because narration can quote the player back to themselves.
 */
export async function loadShareCard(client: pg.PoolClient, shareToken: string): Promise<ShareCardView | null> {
  if (!/^[a-f0-9]{8,40}$/.test(shareToken)) return null;
  const result = await client.query(
    `SELECT c.share_token,c.name,c.level,c.genome,
            (SELECT s.title FROM story_entries s WHERE s.creature_id=c.id ORDER BY s.created_at DESC LIMIT 1) AS latest_title
     FROM creatures c
     JOIN onboarding_states o ON o.creature_id=c.id AND o.status='complete'
     WHERE c.share_token=$1 AND c.kind='player'`,
    [shareToken]
  );
  const row = result.rows[0];
  if (!row) return null;
  const genome = row.genome as AvatarGenome;
  const evolution = Number(genome.evolution ?? 1);
  const name = clamp(String(row.name), 32);
  return {
    shareToken: String(row.share_token),
    meetRef: String(row.share_token),
    name,
    level: Number(row.level),
    evolution,
    genome,
    headline: `${name} is level ${Number(row.level)} in the Bloopy Network`,
    latestStoryTitle: row.latest_title ? clamp(String(row.latest_title), 90) : null
  };
}

/** The text-only representation. Everything visual is a rendering of exactly this. */
export function shareSummary(view: ShareCardView): string {
  const parts = [`${view.name} · Level ${view.level} · ${evolutionLabel(view.evolution)}`];
  if (view.latestStoryTitle) parts.push(`Latest chapter: ${view.latestStoryTitle}`);
  parts.push("A small creature living a continuing story in Telegram.");
  return parts.join("\n");
}

/** The `?start=` payload another player follows to meet this creature. */
export function meetLink(view: ShareCardView, managerBotUsername?: string): string {
  return managerBotUsername
    ? `https://t.me/${managerBotUsername}?start=meet_${view.meetRef}`
    : `${config.PUBLIC_BASE_URL}/?startapp=meet_${view.meetRef}`;
}

export function shareUrl(view: ShareCardView): string {
  return `${config.PUBLIC_BASE_URL}/share/c/${view.shareToken}`;
}

/** Inlines the deterministic avatar so a card never depends on a second request or a remote host. */
function embeddedAvatar(view: ShareCardView, x: number, y: number, size: number): string {
  return renderAvatar(view.genome, view.name)
    .replace(/^<\?xml[^?]*\?>/, "")
    // The avatar's own width/height and role are replaced rather than shadowed: a nested <svg> with
    // two width attributes is malformed, and the card already carries the accessible label.
    .replace(/^<svg [^>]*?viewBox="([^"]+)"[^>]*>/, `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="$1" aria-hidden="true">`);
}

function cardFrame(view: ShareCardView, kind: string, lines: Array<{ text: string; y: number; size: number; weight: number; fill: string }>): string {
  const alt = `${view.name}, level ${view.level}, ${evolutionLabel(view.evolution).toLowerCase()}${view.latestStoryTitle ? `. Latest chapter: ${view.latestStoryTitle}` : ""}`;
  // Ink on paper at roughly 11:1 contrast, and the muted tone at 4.9:1, so both stay readable
  // against the card background at social-preview sizes.
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${escapeXml(alt)}"><title>${escapeXml(alt)}</title><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fffdf8"/><stop offset="1" stop-color="#ece5da"/></linearGradient></defs><rect width="1200" height="630" fill="url(#bg)"/><rect x="28" y="28" width="1144" height="574" rx="44" fill="#fffdf8" stroke="#d9d0c4" stroke-width="3"/><g font-family="Inter,ui-rounded,system-ui,sans-serif">${lines.map((line) => `<text x="96" y="${line.y}" font-size="${line.size}" font-weight="${line.weight}" fill="${line.fill}">${escapeXml(line.text)}</text>`).join("")}<text x="96" y="546" font-size="26" font-weight="700" fill="#6d62e8">BLOOPY NETWORK</text><text x="96" y="580" font-size="22" fill="#65616c">${escapeXml(kind)}</text></g>${embeddedAvatar(view, 760, 130, 370)}</svg>`;
}

export function renderProfileCard(view: ShareCardView): string {
  return cardFrame(view, "A continuing creature story in Telegram", [
    { text: "A CREATURE YOU CAN MEET", y: 138, size: 26, weight: 800, fill: "#6d62e8" },
    { text: view.name, y: 232, size: 82, weight: 800, fill: "#252636" },
    { text: `Level ${view.level}`, y: 302, size: 38, weight: 700, fill: "#4a4757" },
    { text: evolutionLabel(view.evolution), y: 352, size: 32, weight: 500, fill: "#65616c" }
  ]);
}

export function renderStoryCard(view: ShareCardView): string {
  const title = view.latestStoryTitle ?? "A quiet chapter, not yet written down";
  // Wrapping by measured width would need font metrics we do not have, so the title is split on a
  // conservative character budget that holds at the rendered size.
  const words = title.split(" ");
  const rows: string[] = [];
  for (const word of words) {
    const current = rows[rows.length - 1];
    if (current !== undefined && `${current} ${word}`.length <= 26) rows[rows.length - 1] = `${current} ${word}`;
    else rows.push(word);
  }
  const titleLines = rows.slice(0, 3).map((text, index) => ({ text, y: 236 + index * 62, size: 52, weight: 800, fill: "#252636" }));
  return cardFrame(view, "A continuing creature story in Telegram", [
    { text: "LATEST CHAPTER", y: 150, size: 26, weight: 800, fill: "#6d62e8" },
    ...titleLines,
    { text: `${view.name} · Level ${view.level}`, y: 236 + titleLines.length * 62 + 34, size: 32, weight: 600, fill: "#65616c" }
  ]);
}

/** A self-contained preview page. No scripts, no remote assets, nothing personal beyond the card. */
export function renderSharePage(view: ShareCardView, managerBotUsername?: string): string {
  const image = `${shareUrl(view)}/${view.latestStoryTitle ? "story" : "profile"}.svg`;
  const description = shareSummary(view).split("\n").join(" · ");
  const destination = meetLink(view, managerBotUsername);
  const alt = `${view.name}, level ${view.level}, ${evolutionLabel(view.evolution).toLowerCase()}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeXml(view.headline)}</title>
<meta name="description" content="${escapeXml(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Bloopy Network">
<meta property="og:title" content="${escapeXml(view.headline)}">
<meta property="og:description" content="${escapeXml(description)}">
<meta property="og:url" content="${escapeXml(shareUrl(view))}">
<meta property="og:image" content="${escapeXml(image)}">
<meta property="og:image:type" content="image/svg+xml">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${escapeXml(alt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeXml(view.headline)}">
<meta name="twitter:description" content="${escapeXml(description)}">
<meta name="twitter:image" content="${escapeXml(image)}">
<style>
:root{color-scheme:light;font-family:Inter,ui-rounded,system-ui,sans-serif;color:#252636}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:linear-gradient(#f3eee5,#e9e2d8)}
main{max-width:560px;width:100%;background:#fffdf8;border:1px solid rgba(64,49,80,.12);border-radius:28px;padding:26px;box-shadow:0 12px 40px rgba(63,47,65,.1)}
img{display:block;width:100%;height:auto;border-radius:20px;background:#f0ecff}
h1{font-size:1.7rem;margin:20px 0 6px}
p{color:#5d5e6c;line-height:1.55;margin:0 0 10px}
.facts{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 0;padding:0;list-style:none}
.facts li{background:#f0ece5;border-radius:999px;padding:7px 12px;font-size:.84rem}
a.cta{display:block;margin-top:22px;text-align:center;background:#252636;color:#fffdf8;text-decoration:none;border-radius:16px;padding:15px;font-weight:750}
small{display:block;margin-top:16px;color:#7b7883;line-height:1.5}
</style>
</head>
<body>
<main>
<img src="${escapeXml(image)}" alt="${escapeXml(alt)}" width="1200" height="630">
<h1>${escapeXml(view.headline)}</h1>
${view.latestStoryTitle ? `<p>Latest chapter: ${escapeXml(view.latestStoryTitle)}</p>` : ""}
<p>Bloopy creatures live a continuing story inside Telegram. They remember what happened, and they keep going while you are away.</p>
<ul class="facts"><li>Level ${view.level}</li><li>${escapeXml(evolutionLabel(view.evolution))}</li></ul>
<a class="cta" href="${escapeXml(destination)}">Meet ${escapeXml(view.name)}</a>
<small>Opening this link starts your own creature. Nothing is shared back to ${escapeXml(view.name)}'s owner beyond the fact that the two creatures met.</small>
</main>
</body>
</html>`;
}

export interface ReferralAttribution { referrerCreatureId: string; referrerName: string }

/**
 * Records who introduced a player, once and only for a player who has not started yet.
 *
 * The unique constraint on `referred_player_id` is the real guard: it survives creature resets, so a
 * player cannot reset their way to a second first-invite reward.
 */
export async function attributeReferral(client: pg.PoolClient, input: { referredPlayerId: string; referrerRef: string }): Promise<boolean> {
  const referrer = await client.query(
    `SELECT c.id,c.player_id FROM creatures c WHERE (c.share_token=$1 OR c.slug=$1) AND c.kind='player' AND c.player_id IS NOT NULL`,
    [input.referrerRef.toLowerCase()]
  );
  const row = referrer.rows[0];
  if (!row || String(row.player_id) === input.referredPlayerId) return false;
  // Only an account that has not finished onboarding can be attributed, so an established player
  // following a link is treated as a meeting rather than as someone's new recruit.
  const started = await client.query(
    `SELECT 1 FROM creatures c JOIN onboarding_states o ON o.creature_id=c.id AND o.status='complete' WHERE c.player_id=$1 LIMIT 1`,
    [input.referredPlayerId]
  );
  if (started.rowCount) return false;
  const inserted = await client.query(
    `INSERT INTO referrals (referrer_creature_id,referred_player_id,source) VALUES ($1,$2,'meet_link') ON CONFLICT (referred_player_id) DO NOTHING RETURNING id`,
    [row.id, input.referredPlayerId]
  );
  return Boolean(inserted.rowCount);
}

/**
 * Pays the one authored referral reward, at the moment the referred creature is actually alive.
 *
 * The `rewarded=false` predicate makes the payout atomic under concurrent onboarding completions:
 * the second caller updates zero rows and returns null.
 */
export async function rewardPendingReferral(client: pg.PoolClient, referredPlayerId: string, referredCreatureId: string): Promise<ReferralAttribution | null> {
  const claimed = await client.query(
    `UPDATE referrals SET rewarded=true,rewarded_at=now() WHERE referred_player_id=$1 AND rewarded=false RETURNING referrer_creature_id`,
    [referredPlayerId]
  );
  if (!claimed.rowCount) return null;
  // The referrer's creature may have been reset or deleted in the meantime. The claim still stands
  // so the attribution cannot be re-earned, but there is nobody left to pay.
  if (claimed.rows[0].referrer_creature_id === null) return null;
  const referrerCreatureId = String(claimed.rows[0].referrer_creature_id);
  const referrer = await client.query("SELECT name FROM creatures WHERE id=$1 FOR UPDATE", [referrerCreatureId]);
  if (!referrer.rowCount) return null;
  const referrerName = String(referrer.rows[0].name);
  const referred = await client.query("SELECT name FROM creatures WHERE id=$1", [referredCreatureId]);
  const referredName = referred.rowCount ? String(referred.rows[0].name) : "a new creature";
  await client.query("UPDATE creatures SET stars=stars+$2,updated_at=now() WHERE id=$1", [referrerCreatureId, REFERRAL_REWARD.referrerStars]);
  await client.query("UPDATE creatures SET stars=stars+$2,updated_at=now() WHERE id=$1", [referredCreatureId, REFERRAL_REWARD.referredStars]);
  await client.query(
    `INSERT INTO story_entries (creature_id,title,body,choices,reward) VALUES ($1,$2,$3,'[]',$4)`,
    [referrerCreatureId, `Someone followed ${referrerName}'s story here`, `${referredName} arrived through a link ${referrerName} left behind, and has just finished waking up. Momo, who notices these things, has quietly added ${REFERRAL_REWARD.referrerStars} stars to the usual pocket.`, JSON.stringify({ stars: REFERRAL_REWARD.referrerStars })]
  );
  await client.query(
    `INSERT INTO story_entries (creature_id,title,body,choices,reward) VALUES ($1,$2,$3,'[]',$4)`,
    [referredCreatureId, "An introduction that came with a gift", `${referredName} arrived on ${referrerName}'s recommendation. The button market gives newcomers ${REFERRAL_REWARD.referredStars} stars and no advice whatsoever.`, JSON.stringify({ stars: REFERRAL_REWARD.referredStars })]
  );
  await client.query(
    `INSERT INTO analytics_events (creature_id,event_name,properties) VALUES ($1,'referral_rewarded',$2)`,
    [referrerCreatureId, JSON.stringify({ referrerStars: REFERRAL_REWARD.referrerStars, referredStars: REFERRAL_REWARD.referredStars })]
  );
  return { referrerCreatureId, referrerName };
}
