import type { AvatarGenome, Personality, StoryCard } from "./types.js";

export type WakeChoice = "gentle" | "noise" | "snack";
export type VisualMarker = AvatarGenome["mark"];
export type OnboardingStatus = "wake_choice" | "identity" | "complete";

export const wakeChoiceOptions = [
  { id:"gentle" as const, label:"Wake it gently", hint:"A calm hello and a careful tap." },
  { id:"noise" as const, label:"Make a tiny racket", hint:"Improvised percussion. Questionable rhythm." },
  { id:"snack" as const, label:"Offer a snack", hint:"Diplomacy, but edible." }
] as const;

export const visualMarkerOptions = [
  { id:"moon" as const, label:"Moon mark", symbol:"☾" },
  { id:"star" as const, label:"Star mark", symbol:"✦" },
  { id:"dot" as const, label:"Mystery dot", symbol:"●" }
] as const;

const clampTrait = (value:number) => Math.max(0.05,Math.min(0.95,Number(value.toFixed(2))));

export function applyWakeChoice(personality:Personality, choice:WakeChoice):Personality {
  const next={...personality};
  if(choice==="gentle") { next.empathy=clampTrait(next.empathy+0.1); next.courage=clampTrait(next.courage-0.02); }
  if(choice==="noise") { next.courage=clampTrait(next.courage+0.09); next.mischief=clampTrait(next.mischief+0.08); }
  if(choice==="snack") { next.sociability=clampTrait(next.sociability+0.09); next.curiosity=clampTrait(next.curiosity+0.06); }
  return next;
}

export function wakeFlag(choice:WakeChoice):string {
  return `genesis_woken_${choice}`;
}

export function normalizeCreatureName(input:string):string {
  const value=input.normalize("NFKC").replace(/\s+/g," ").trim();
  if(value.length<2||value.length>24) throw new Error("name must be 2 to 24 characters");
  if(!/^[\p{L}\p{N}][\p{L}\p{N} '\-]{0,22}[\p{L}\p{N}]$/u.test(value)) throw new Error("name contains unsupported characters");
  return value;
}

export function wakeStory(choice:WakeChoice):StoryCard {
  if(choice==="gentle") return {title:"One eye opens",body:"The creature wakes slowly, studies your face, and places one tiny paw on your finger as if signing a very serious agreement.",choices:[],reward:{}};
  if(choice==="noise") return {title:"An extremely small emergency",body:"The creature launches upright, salutes a cardboard flap, and decides the noise was probably a parade held in its honor.",choices:[],reward:{}};
  return {title:"Negotiations begin",body:"A nose appears first. Then two eyes. The creature accepts the snack and immediately begins reviewing the terms of your friendship.",choices:[],reward:{}};
}

export function identityStory(name:string,choice:WakeChoice,marker:VisualMarker):StoryCard {
  const callback=choice==="gentle"?"You woke me like I was something worth being careful with.":choice==="noise"?"You woke me with a parade, so I assume I am important.":"You brought food before questions. Strong opening strategy.";
  const mark=marker==="moon"?"a moon":marker==="star"?"a star":"one suspiciously meaningful dot";
  return {title:`${name} is officially awake`,body:`“${callback} I am ${name}, I have ${mark} on my face, and I think the wall moved while you were naming me.”`,choices:[{id:"inspect_wall",label:"Inspect the wall",action:"explore"},{id:"ask_question",label:"Ask what it saw",action:"talk"}],reward:{xp:5}};
}

export function proactiveGenesisText(name:string,choice:WakeChoice):string {
  if(choice==="gentle") return `${name}: I found something under the nest. I am telling you first because you seem careful with small things.`;
  if(choice==="noise") return `${name}: Good news: the noise did not wake the thing under the floor. Less good news: it was already awake.`;
  return `${name}: I found a key beside the snack crumbs. This may prove that snacks are a legitimate research method.`;
}
