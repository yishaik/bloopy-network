export type CreatureKind = "player" | "npc" | "system";

export interface Personality {
  archetype: string;
  voice: string;
  curiosity: number;
  courage: number;
  empathy: number;
  mischief: number;
  sociability: number;
}

export interface AvatarGenome {
  body: "round" | "pear" | "cloud";
  primary: string;
  secondary: string;
  eyes: "wide" | "sleepy" | "spark";
  mark: "star" | "dot" | "moon";
  accessory: "satchel" | "leaf" | "scarf";
  evolution: number;
}

export interface StoryChoice {
  id: string;
  label: string;
  action: string;
}

export interface StoryCard {
  title: string;
  body: string;
  choices: StoryChoice[];
  reward?: { stars?: number; xp?: number };
}

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_bot?: boolean;
}
