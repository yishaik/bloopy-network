import { AppError } from "./errors.js";
import type { DoorBeatView, DoorRoute, DoorStoryState, DoorTransition } from "./impossible-door.js";
import type { StoryChoice, StoryCard } from "./types.js";

export const LETTER_ARC_ID="letter-from-tomorrow";
export const LETTER_ARC_VERSION=1;
export const LETTER_ARC_START_BEAT="envelope_arrives";

interface LetterState {
  approach?: "opened"|"light"|"ally";
  method?: "enter"|"chart"|"bargain";
  clue?: "sender"|"returns";
  spoiler?: "asked"|"refused";
  letterFinal?: "mail_warning"|"mail_snack"|"keep_stamp";
}

const choice=(id:string,label:string):StoryChoice=>({id,label,action:"story"});
const story=(title:string,body:string,choices:StoryChoice[],xp=0):StoryCard=>({title,body,choices,reward:xp?{xp}:undefined});

// The ally carried over from the impossible-door route keeps the cast continuous.
function allyName(route:DoorRoute|null):string {
  if(route==="numa") return "Numa";
  if(route==="sock") return "Dr. Sock";
  return "Momo";
}

export function buildLetterBeat(beatId:string,creatureName:string,route:DoorRoute|null,rawState:DoorStoryState):DoorBeatView {
  const state=rawState as unknown as LetterState;
  const ally=allyName(route);
  switch(beatId) {
    case "envelope_arrives": return {
      id:beatId,chapter:1,totalChapters:7,aiEligible:true,
      canonicalFacts:["A cream envelope sits inside the chalk outline where the impossible door used to be.",`It is addressed to ${creatureName} in ${creatureName}'s own handwriting.`,"The postmark is dated tomorrow."],
      allowedReferences:[creatureName,ally,"chalk outline","envelope","impossible door"],
      story:story("A letter with tomorrow's date",`Inside the chalk outline where the impossible door used to be, a cream envelope waits with unreasonable patience. It is addressed to ${creatureName} — in ${creatureName}'s own handwriting — and the postmark says tomorrow.`,[
        choice("open_now","Open it now"),
        choice("hold_to_light","Hold it up to the light"),
        choice("show_ally",`Show it to ${ally} first`)
      ])
    };
    case "thirteenth_hour": {
      const letterFact=state.approach==="opened"
        ?"The letter contained four words: DON'T FIX THE CLOCK."
        :state.approach==="light"
          ?"Held to the light, the watermark showed a clock with thirteen hours."
          :`${ally} recognized the handwriting immediately and refused to say whose it was.`;
      return {
        id:beatId,chapter:2,totalChapters:7,aiEligible:true,
        canonicalFacts:[letterFact,"The nest's kitchen clock has grown a thirteenth hour.","The hour hand is leaning toward it."],
        allowedReferences:[creatureName,ally,"Momo","kitchen clock","thirteenth hour"],
        story:story("The clock grew a new hour",`${letterFact} And now the kitchen clock has a thirteenth hour, wedged politely between twelve and one, and the hand is leaning toward it the way ${creatureName} leans toward unattended snacks.`,[
          choice("enter_hour","Step into the extra hour"),
          choice("chart_hour",`Chart it first with ${ally}`),
          choice("bargain_hour","Ask Momo what an hour costs")
        ],6)
      };
    }
    case "inside_hour": {
      const methodFact=state.method==="enter"
        ?`${creatureName} stepped straight in, which the hour seemed to respect.`
        :state.method==="chart"
          ?`${ally}'s chart shows the hour is exactly one hour wide in every direction.`
          :"Momo quoted a fair price, then waived it for a friend.";
      return {
        id:beatId,chapter:4,totalChapters:7,aiEligible:true,
        canonicalFacts:[methodFact,"Inside the thirteenth hour, everything lost yesterday is filed neatly on shelves.","The impossible door is filed under Y, folded like a deck chair."],
        allowedReferences:[creatureName,ally,"shelves","thirteenth hour","impossible door","single socks"],
        story:story("One hour wide, exactly",`${methodFact} Inside, yesterday's lost things sit on labelled shelves: single socks, unsent apologies, a sneeze someone saved for later. And filed under Y — folded like a deck chair — the impossible door.`,[
          choice("find_sender","Find whoever sends the letters"),
          choice("read_returns","Read the shelf of unsent replies")
        ],8)
      };
    }
    case "the_sender": {
      const clueFact=state.clue==="returns"
        ?"The unsent replies were all addressed to today, in the same handwriting as the letter."
        :"The mail trail led deeper between the shelves.";
      return {
        id:beatId,chapter:5,totalChapters:7,aiEligible:true,
        canonicalFacts:[clueFact,`At a small desk sits ${creatureName}'s echo from tomorrow, writing letters backward.`,"The echo sends warnings backward so they arrive in time."],
        allowedReferences:[creatureName,"echo","desk","letters","tomorrow"],
        story:story("The handwriting explains itself",`${clueFact} At a small desk at the end of the shelf sits a familiar silhouette: ${creatureName}'s own echo from tomorrow, writing carefully backward. "Warnings only work," it says without looking up, "if they arrive before they're needed."`,[
          choice("ask_what_happens","Ask what happens tomorrow"),
          choice("refuse_to_know","Refuse to know — some days deserve surprises")
        ],8)
      };
    }
    case "last_post": {
      const spoilerFact=state.spoiler==="asked"
        ?`The echo answered with one word: "snacks." It refused to elaborate.`
        :`The echo nodded, almost proud, and stamped the refusal into its ledger.`;
      return {
        id:beatId,chapter:6,totalChapters:7,aiEligible:true,
        canonicalFacts:[spoilerFact,"The echo offers exactly one stamp before the hour closes.","One thing may be mailed backward to yesterday."],
        allowedReferences:[creatureName,"echo","stamp","yesterday","thirteenth hour"],
        story:story("The outbox of the thirteenth hour",`${spoilerFact} Then it slides one stamp across the desk. "The hour closes soon. One thing goes backward. Choose like someone who has met yesterday."`,[
          choice("mail_warning","Mail a warning to yesterday's you"),
          choice("mail_snack","Mail a snack — morale also matters"),
          choice("keep_stamp","Keep the stamp for later")
        ],8)
      };
    }
    case "ending": {
      const body=state.letterFinal==="mail_warning"
        ?`${creatureName} mailed the warning, and somewhere behind everything, a first draft of yesterday quietly went better. The thirteenth hour folded itself away, satisfied. The kitchen clock keeps ordinary time now — though at midnight it still hums, once, out of habit.`
        :state.letterFinal==="mail_snack"
          ?`${creatureName} mailed the snack. History now contains one additional snack, delivered at the exact moment it was needed. The echo called this "the correct use of time travel" and closed the hour with visible approval.`
          :`${creatureName} kept the stamp. It sits in the satchel, humming faintly with unposted potential. The hour closed anyway — but a kept stamp, the echo noted, is a door that hasn't decided when.`;
      return {
        id:beatId,chapter:7,totalChapters:7,aiEligible:false,
        canonicalFacts:[`The letter arc ended with ${state.letterFinal??"keep_stamp"}.`,"The thirteenth hour has closed.","The kitchen clock keeps ordinary time again."],
        allowedReferences:[creatureName,"echo","kitchen clock","stamp"],
        story:story("The hour closes on time",body,[],20)
      };
    }
    default: throw new Error(`unknown letter arc beat: ${beatId}`);
  }
}

export function resolveLetterChoice(beatId:string,choiceId:string,route:DoorRoute|null,rawState:DoorStoryState,creatureName:string):DoorTransition {
  const beat=buildLetterBeat(beatId,creatureName,route,rawState);
  if(!beat.story.choices.some((candidate)=>candidate.id===choiceId)) throw new AppError("arc_invalid_choice",400,"That choice isn't on the table for this moment of the story.");
  const state={...(rawState as unknown as LetterState)};
  const next:DoorTransition={nextBeat:beatId,route,state:state as unknown as DoorStoryState,status:"active",xp:0,inventory:[],relationships:[],flags:[]};

  if(beatId==="envelope_arrives") {
    state.approach=choiceId==="open_now"?"opened":choiceId==="hold_to_light"?"light":"ally";
    next.nextBeat="thirteenth_hour";
    next.xp=6;
    next.flags.push({key:"letter_read",value:{approach:state.approach}});
    if(state.approach==="ally") next.relationships.push({targetSlug:route==="sock"?"dr-sock":route==="secret"?"momo-marketbot":"numa-cloudcartographer",trust:2,affection:1,rivalry:0,lastEvent:"shown_the_letter"});
    return next;
  }
  if(beatId==="thirteenth_hour") {
    state.method=choiceId==="enter_hour"?"enter":choiceId==="chart_hour"?"chart":"bargain";
    next.nextBeat="inside_hour";
    next.xp=8;
    if(state.method==="chart") next.relationships.push({targetSlug:route==="sock"?"dr-sock":route==="secret"?"momo-marketbot":"numa-cloudcartographer",trust:2,affection:1,rivalry:0,lastEvent:"charted_the_hour"});
    if(state.method==="bargain") next.relationships.push({targetSlug:"momo-marketbot",trust:2,affection:2,rivalry:0,lastEvent:"priced_an_hour"});
    return next;
  }
  if(beatId==="inside_hour") {
    state.clue=choiceId==="find_sender"?"sender":"returns";
    next.nextBeat="the_sender";
    next.xp=8;
    return next;
  }
  if(beatId==="the_sender") {
    state.spoiler=choiceId==="ask_what_happens"?"asked":"refused";
    next.nextBeat="last_post";
    next.xp=8;
    return next;
  }
  if(beatId==="last_post") {
    state.letterFinal=choiceId==="mail_warning"?"mail_warning":choiceId==="mail_snack"?"mail_snack":"keep_stamp";
    next.nextBeat="ending";
    next.status="completed";
    next.xp=20;
    if(state.letterFinal==="keep_stamp") next.inventory.push({itemId:"thirteenth_stamp",delta:1,reason:"kept_the_stamp"});
    if(state.letterFinal==="mail_snack") next.relationships.push({targetSlug:"momo-marketbot",trust:1,affection:2,rivalry:0,lastEvent:"snack_sent_backward"});
    next.flags.push({key:"letter_from_tomorrow_completed",value:{approach:state.approach??"opened",method:state.method??"enter",finalChoice:state.letterFinal}});
    next.cliffhanger={
      title:"A blank envelope",
      message:`${creatureName}: another envelope arrived. This one is blank. I checked twice — even the blank part is blank. I put it somewhere safe until it decides what it wants to say.`
    };
    return next;
  }
  throw new AppError("arc_beat_complete",409,"That part of the story is already finished.");
}
