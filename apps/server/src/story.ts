import type { Personality, StoryCard } from "./types.js";

export type GameAction = "explore" | "rest" | "talk" | "help" | "social";
const pick = <T>(items: readonly T[], seed: number): T => items[Math.abs(seed) % items.length] as T;

export function buildStory(action: GameAction, creatureName: string, personality: Personality, seed = Date.now(), socialPartner?: string): StoryCard {
  const tone = personality.mischief > 0.65 ? "with a suspiciously innocent smile" : "with bright, serious eyes";
  if (action === "rest") return { title: `${creatureName} built a blanket fort`, body: `${creatureName} disappeared under three blankets and announced that the floor is now an independent kingdom. Energy restored — diplomacy remains uncertain.`, choices: [{id:"inspect",label:"Inspect the kingdom",action:"talk"},{id:"snack",label:"Send a royal snack",action:"help"}], reward:{xp:4} };
  if (action === "talk") {
    const questions = ["Do doors dream about being windows?","Why do humans keep receipts for things they already own?","Would you still trust a cloud if it wore tiny shoes?"] as const;
    return { title:"An urgent philosophical matter", body:`${creatureName} looks at you ${tone}. “${pick(questions,seed)}”`, choices:[{id:"serious",label:"Answer seriously",action:"help"},{id:"strange",label:"Make it stranger",action:"explore"}], reward:{xp:3} };
  }
  if (action === "social") {
    const partner = socialPartner ?? "Numa";
    const plots: Record<string,{title:string;body:string}> = {
      "Numa": { title:"A message from Numa", body:`Numa claims to have found a staircase that only appears when two creatures disagree politely. ${creatureName} has volunteered both of you.` },
      "Dr. Sock": { title:"Dr. Sock requests a witness", body:`Dr. Sock has invented a machine that folds fog. It works perfectly, except for the folding. ${creatureName} has been recruited as chief witness.` },
      "Momo": { title:"Market day with Momo", body:`Momo is running a two-for-one sale on things nobody has ever needed. ${creatureName} is already negotiating for a jar of yesterday's echoes.` }
    };
    const plot = plots[partner] ?? { title:`A visit to ${partner}`, body:`${creatureName} and ${partner} spent the afternoon comparing notes about doors, snacks and the ethics of borrowing compasses.` };
    return { title:plot.title, body:plot.body, choices:[{id:"join",label:"Join the expedition",action:"explore"},{id:"negotiate",label:"Ask for details",action:"talk"}], reward:{stars:2,xp:8} };
  }
  if (action === "help") return { title:"The apology problem", body:`${creatureName} borrowed Dr. Sock's compass and used it to stir soup. Help choose an apology before the compass points permanently toward lunch.`, choices:[{id:"honest",label:"Tell the truth",action:"talk"},{id:"gift",label:"Craft a replacement",action:"explore"}], reward:{xp:6,stars:1} };
  const places = [["The Drawer Between Worlds","a warm button that hums when nobody is listening"],["The Crumb Observatory","a map drawn by ants with excellent handwriting"],["The Quiet Side of the Moon Mug","a silver teaspoon that remembers tomorrow"]] as const;
  const [place, discovery] = pick(places, seed);
  return { title:`Expedition: ${place}`, body:`${creatureName} returned from ${place} carrying ${discovery}. Something followed at a respectful distance.`, choices:[{id:"open",label:"Investigate it",action:"explore"},{id:"friend",label:"Introduce it to an NPC",action:"social"}], reward:{xp:10,stars:2} };
}

export function parseBotConversation(text: string): { interactionId: string; depth: number } | null {
  const match = text.match(/^\/bloopy_story\s+([a-zA-Z0-9_-]{8,80})\s+(\d{1,2})$/);
  if (!match) return null;
  const depth = Number(match[2]);
  if (!Number.isInteger(depth) || depth < 0 || depth > 12) return null;
  return { interactionId: match[1] as string, depth };
}
