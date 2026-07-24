import { AppError } from "./errors.js";
import type { StoryCard, StoryChoice } from "./types.js";

export const IMPOSSIBLE_DOOR_ARC_ID="impossible-door";
export const IMPOSSIBLE_DOOR_VERSION=1;
export const IMPOSSIBLE_DOOR_START_BEAT="dust_moved";

export type DoorRoute="numa"|"sock"|"secret";
export type DoorAction="open"|"seal"|"listen";

export interface DoorStoryState {
  discoveryMethod?: "lifted_nest"|"asked_first";
  doorAction?: DoorAction;
  crisisChoice?: "reach_inside"|"pull_key_back"|"hold_seal"|"call_partner"|"answer_whisper"|"stay_silent";
  finalChoice?: "protect_friend"|"save_key"|"follow_echo";
  epilogue?: "tell_truth"|"keep_secret";
}

export interface DoorBeatView {
  id:string;
  chapter:number;
  totalChapters:number;
  story:StoryCard;
  aiEligible:boolean;
  canonicalFacts:string[];
  allowedReferences:string[];
}

export interface InventoryDelta {
  itemId:string;
  delta:number;
  reason:string;
}

export interface RelationshipEffect {
  targetSlug:"numa-cloudcartographer"|"dr-sock"|"momo-marketbot";
  trust:number;
  affection:number;
  rivalry:number;
  lastEvent:string;
}

export interface StoryFlagEffect {
  key:string;
  value:unknown;
}

export interface DoorTransition {
  nextBeat:string;
  route:DoorRoute|null;
  state:DoorStoryState;
  status:"active"|"completed";
  xp:number;
  inventory:InventoryDelta[];
  relationships:RelationshipEffect[];
  flags:StoryFlagEffect[];
  cliffhanger?:{title:string;message:string};
}

const choice=(id:string,label:string):StoryChoice=>({id,label,action:"story"});
const story=(title:string,body:string,choices:StoryChoice[],xp=0):StoryCard=>({title,body,choices,reward:xp?{xp}:undefined});

function routeLabel(route:DoorRoute|null):string {
  if(route==="numa") return "Numa";
  if(route==="sock") return "Dr. Sock";
  if(route==="secret") return "Momo";
  return "nobody sensible";
}

function doorResponse(state:DoorStoryState,creatureName:string,route:DoorRoute|null):DoorBeatView {
  if(state.doorAction==="seal") return {
    id:"door_reacts",chapter:6,totalChapters:9,aiEligible:true,
    canonicalFacts:["The player chose to seal the impossible door.","The bent key is vibrating.",`${creatureName} is holding the line.`],
    allowedReferences:[creatureName,"Dr. Sock","red thread","bent key","impossible door"],
    story:story("The door objects to procedure",`${creatureName} presses the bent key against the frame. Red light crawls around the door like a signature being written by an angry spider. Something on the other side pushes back.`,[
      choice("hold_seal","Hold the seal together"),
      choice("call_partner",`Call ${routeLabel(route)} for help anyway`)
    ],8)
  };
  if(state.doorAction==="listen") return {
    id:"door_reacts",chapter:6,totalChapters:9,aiEligible:true,
    canonicalFacts:["The player chose to listen to the impossible door.","The door whispered the creature's name.","The bent key is still intact."],
    allowedReferences:[creatureName,"Momo","whisper","bent key","impossible door"],
    story:story("The door says the name correctly",`No hinges move. Instead, the wood leans closer and whispers “${creatureName}” with the confidence of something that has known the name for years.`,[
      choice("answer_whisper","Answer the whisper"),
      choice("stay_silent","Stay perfectly silent")
    ],8)
  };
  return {
    id:"door_reacts",chapter:6,totalChapters:9,aiEligible:true,
    canonicalFacts:["The player chose to open the impossible door.","A silver hand-shaped shadow appeared.","The bent key is turning by itself."],
    allowedReferences:[creatureName,"Numa","silver shadow","bent key","impossible door"],
    story:story("The key turns before anyone touches it",`The door opens one finger-width. A silver shadow shaped almost like a hand reaches through, pauses politely, and waits for someone to make the next mistake.`,[
      choice("reach_inside","Reach toward the shadow"),
      choice("pull_key_back","Pull the key back now")
    ],8)
  };
}

function crisisStory(route:DoorRoute|null,state:DoorStoryState,creatureName:string):DoorBeatView {
  const ally=routeLabel(route);
  const action=state.doorAction??"open";
  const body=action==="seal"
    ? `The seal holds, but the room begins forgetting which wall is the floor. ${ally} grabs ${creatureName} before gravity can change its mind.`
    : action==="listen"
      ? `The whisper answers with a memory that has not happened yet. ${ally} hears it too, which makes pretending much more difficult.`
      : `The silver shadow unfolds into a small storm of keys. ${ally} shouts one very useful instruction and three contradictory ones.`;
  return {
    id:"crisis",chapter:7,totalChapters:9,aiEligible:false,
    canonicalFacts:[`The chosen route is ${route??"uncommitted"}.`,`The door action was ${action}.`,"The immediate crisis has begun."],
    allowedReferences:[creatureName,ally,"bent key","impossible door"],
    story:story("The room develops an emergency",body,[
      choice("protect_friend",`Protect ${ally}`),
      choice("save_key","Save the bent key"),
      choice("follow_echo","Follow the escaping echo")
    ],10)
  };
}

function aftermathStory(route:DoorRoute|null,state:DoorStoryState,creatureName:string):DoorBeatView {
  const chosen=state.finalChoice==="protect_friend"?"someone else":state.finalChoice==="save_key"?"the key":"the echo";
  return {
    id:"aftermath",chapter:8,totalChapters:9,aiEligible:false,
    canonicalFacts:[`The player prioritized ${chosen}.`,`The chosen route is ${route??"secret"}.`,`The crisis is temporarily contained.`],
    allowedReferences:[creatureName,routeLabel(route),"bent key","echo","impossible door"],
    story:story("The door is gone. The outline remains",`${creatureName} chose ${chosen}, and the impossible door folds into a thin chalk outline. Everyone is safe enough to begin arguing about what “safe” means.`,[
      choice("tell_truth","Tell everyone exactly what happened"),
      choice("keep_secret","Keep one detail between us")
    ],12)
  };
}

function endingStory(route:DoorRoute|null,state:DoorStoryState,creatureName:string):DoorBeatView {
  const action=state.doorAction??"listen";
  const truth=state.epilogue==="tell_truth";
  let title="The first impossible thing is survived";
  let body=`${creatureName} returns to the cardboard nest with a story nobody can prove and a new reason to inspect every wall.`;
  if(route==="numa") {
    title="Numa draws a place that should not exist";
    body=`Numa adds the vanished door to her cloud map. ${creatureName} is marked as the first explorer to return from somewhere without technically entering it.${truth?" The whole truth is written in the margin.":" One detail is hidden beneath a tiny drawn cloud."}`;
  } else if(route==="sock") {
    title="Dr. Sock files an emergency in triplicate";
    body=`Dr. Sock seals the remaining outline and awards ${creatureName} a certificate reading “Probably Responsible.”${truth?" The report includes every alarming detail.":" One line has been carefully blacked out with soup."}`;
  } else {
    title="Momo buys a secret with no money";
    body=`Momo promises not to sell the story, which is not the same as promising not to improve it. ${creatureName} keeps the quietest part of the adventure close.${truth?" Most of the truth still reaches the market.":" The important detail remains yours alone."}`;
  }
  return {
    id:"ending",chapter:9,totalChapters:9,aiEligible:false,
    canonicalFacts:[`The arc ended on the ${route??"secret"} route.`,`The door action was ${action}.`,`The player chose to ${state.epilogue??"keep_secret"}.`],
    allowedReferences:[creatureName,routeLabel(route),"cardboard nest","impossible door"],
    story:story(title,body,[],20)
  };
}

export function buildImpossibleDoorBeat(beatId:string,creatureName:string,route:DoorRoute|null,state:DoorStoryState):DoorBeatView {
  switch(beatId) {
    case "dust_moved": return {
      id:beatId,chapter:1,totalChapters:9,aiEligible:false,
      canonicalFacts:["Dust moved beneath the cardboard nest.",`${creatureName} has just completed Character Genesis.`],
      allowedReferences:[creatureName,"cardboard nest","dust"],
      story:story("The dust moved first",`A thin line appears beneath the cardboard nest, as if something underneath dragged a finger through the dust. ${creatureName} insists it was not awake at the time.`,[
        choice("lift_nest","Lift the nest carefully"),
        choice("ask_bloopy",`Ask ${creatureName} what it heard`)
      ])
    };
    case "key_found": return {
      id:beatId,chapter:2,totalChapters:9,aiEligible:true,
      canonicalFacts:["A warm bent key was found under the nest.",`The discovery method was ${state.discoveryMethod??"unknown"}.`,"The key hums near the wall."],
      allowedReferences:[creatureName,"bent key","cardboard nest","wall","Numa","Dr. Sock"],
      story:story("A key with nowhere reasonable to go",`Under the nest lies a warm, crooked key. It has no teeth on one side and too many on the other. When ${creatureName} points it at the wall, something inside the wall hums back.`,[
        choice("inspect_key","Inspect the key together"),
        choice("ask_numa","Take it to Numa"),
        choice("ask_sock","Take it to Dr. Sock")
      ],4)
    };
    case "key_hums": return {
      id:beatId,chapter:3,totalChapters:9,aiEligible:false,
      canonicalFacts:["The player inspected the bent key.","The key tapped a rhythm matching the creature's heartbeat."],
      allowedReferences:[creatureName,"bent key","Numa","Dr. Sock"],
      story:story("The key has learned a heartbeat",`${creatureName} holds the key still. It taps three times, pauses, then copies ${creatureName}'s heartbeat exactly. That seems like information worth sharing with one carefully selected person.`,[
        choice("trust_numa","Trust Numa with it"),
        choice("trust_sock","Trust Dr. Sock with it"),
        choice("hide_key","Hide it under the pillow")
      ],4)
    };
    case "numa_reads_clouds": return {
      id:beatId,chapter:3,totalChapters:9,aiEligible:true,
      canonicalFacts:["Numa examined the bent key.","Numa believes it points to a place missing from every map."],
      allowedReferences:[creatureName,"Numa","cloud map","bent key","Dr. Sock"],
      story:story("Numa finds a hole in every map",`Numa places the key over three cloud maps. Each map develops the same blank square. “This is either a new place,” she says, “or a very organized absence.”`,[
        choice("follow_map","Follow Numa's blank map"),
        choice("keep_key","Thank Numa and keep the key hidden")
      ],6)
    };
    case "sock_tests_key": return {
      id:beatId,chapter:3,totalChapters:9,aiEligible:true,
      canonicalFacts:["Dr. Sock tested the bent key.","The key caused seven safety instruments to point at lunch."],
      allowedReferences:[creatureName,"Dr. Sock","laboratory","bent key","red thread"],
      story:story("Dr. Sock measures an unacceptable amount of door",`Dr. Sock places the key in a machine labeled NOT FOR KEYS. Seven needles jump toward “door,” while an eighth points firmly toward soup.`,[
        choice("follow_protocol","Follow Dr. Sock's safety protocol"),
        choice("ignore_warning","Take the key before the paperwork notices")
      ],6)
    };
    case "secret_under_pillow": return {
      id:beatId,chapter:3,totalChapters:9,aiEligible:false,
      canonicalFacts:["The player chose to hide the bent key.","The key began whispering after dark."],
      allowedReferences:[creatureName,"bent key","pillow","Momo"],
      story:story("The pillow begins taking notes",`At night the hidden key scratches tiny arrows into the underside of the pillow. All of them point toward a wall that was perfectly ordinary yesterday.`,[
        choice("tell_momo","Tell Momo before the rumor arrives first"),
        choice("listen_alone","Follow the arrows without telling anyone")
      ],5)
    };
    case "numa_preparation": return {
      id:beatId,chapter:4,totalChapters:9,aiEligible:false,
      canonicalFacts:["The player chose Numa's route.","Numa prepared a thread made from a small cloud."],
      allowedReferences:[creatureName,"Numa","cloud thread","bent key"],
      story:story("Numa packs a map of a blank place",`Numa ties one end of a cloud-thread to the key and hands the other to ${creatureName}. “If the place disappears,” she says, “we will remain inconveniently attached to it.”`,[
        choice("tie_cloud_thread","Tie the thread around the key"),
        choice("bring_snack","Bring an emergency snack as well")
      ],5)
    };
    case "sock_preparation": return {
      id:beatId,chapter:4,totalChapters:9,aiEligible:false,
      canonicalFacts:["The player chose Dr. Sock's route.","Dr. Sock prepared goggles and official red thread."],
      allowedReferences:[creatureName,"Dr. Sock","goggles","red thread","bent key"],
      story:story("Safety equipment for an unsafe concept",`Dr. Sock gives ${creatureName} goggles, red thread, and a form confirming that doors are not normally allowed to appear retroactively.`,[
        choice("wear_goggles","Wear all the safety equipment"),
        choice("sign_form","Sign the form with a tiny paw print")
      ],5)
    };
    case "momo_bargain": return {
      id:beatId,chapter:4,totalChapters:9,aiEligible:true,
      canonicalFacts:["The player is following the secret route.","Momo discovered the secret without being invited."],
      allowedReferences:[creatureName,"Momo","button market","bent key","secret"],
      story:story("Momo has already priced the rumor",`Momo is waiting beside the ordinary wall with two cups of tea and a sign reading SECRET APPRAISALS. “I know nothing,” Momo says. “My nothing has excellent sources.”`,[
        choice("trade_secret","Trade one harmless detail for help"),
        choice("refuse_trade","Refuse the deal and keep walking")
      ],5)
    };
    case "door_found": return {
      id:beatId,chapter:5,totalChapters:9,aiEligible:true,
      canonicalFacts:[`The chosen route is ${route??"secret"}.`,"A small impossible door appeared in the wall.","The bent key fits the lock."],
      allowedReferences:[creatureName,routeLabel(route),"bent key","impossible door","wall"],
      story:story("The door that was not there yesterday",`The wall now contains a narrow blue door with a brass label: YESTERDAY'S ENTRANCE. ${routeLabel(route)} confirms, with varying levels of professionalism, that it was not there yesterday. The bent key slides into the lock by itself.`,[
        choice("open_door","Open it"),
        choice("seal_door","Seal it before it opens"),
        choice("listen_door","Listen through it first")
      ],8)
    };
    case "door_reacts": return doorResponse(state,creatureName,route);
    case "crisis": return crisisStory(route,state,creatureName);
    case "aftermath": return aftermathStory(route,state,creatureName);
    case "ending": return endingStory(route,state,creatureName);
    default: throw new Error(`unknown impossible door beat: ${beatId}`);
  }
}

function baseTransition(nextBeat:string,route:DoorRoute|null,state:DoorStoryState,xp:number):DoorTransition {
  return {nextBeat,route,state,status:"active",xp,inventory:[],relationships:[],flags:[]};
}

function relationship(targetSlug:RelationshipEffect["targetSlug"],trust:number,affection:number,rivalry:number,lastEvent:string):RelationshipEffect {
  return {targetSlug,trust,affection,rivalry,lastEvent};
}

export function resolveImpossibleDoorChoice(beatId:string,choiceId:string,route:DoorRoute|null,state:DoorStoryState,creatureName:string):DoorTransition {
  const beat=buildImpossibleDoorBeat(beatId,creatureName,route,state);
  if(!beat.story.choices.some((candidate)=>candidate.id===choiceId)) throw new AppError("door_invalid_choice",400,"That choice isn't on the table for this moment of the story.");

  if(beatId==="dust_moved") {
    const discoveryMethod=choiceId==="lift_nest"?"lifted_nest":"asked_first";
    const next=baseTransition("key_found",route,{...state,discoveryMethod},3);
    next.inventory.push({itemId:"bent_key",delta:1,reason:"found_under_nest"});
    next.flags.push({key:"door_key_found",value:{discoveryMethod}});
    return next;
  }
  if(beatId==="key_found") {
    if(choiceId==="inspect_key") return baseTransition("key_hums",route,state,2);
    if(choiceId==="ask_numa") {
      const next=baseTransition("numa_reads_clouds","numa",state,3);
      next.relationships.push(relationship("numa-cloudcartographer",1,1,0,"trusted_with_bent_key"));
      return next;
    }
    const next=baseTransition("sock_tests_key","sock",state,3);
    next.relationships.push(relationship("dr-sock",1,0,0,"trusted_with_bent_key"));
    return next;
  }
  if(beatId==="key_hums") {
    if(choiceId==="trust_numa") return baseTransition("numa_reads_clouds","numa",state,3);
    if(choiceId==="trust_sock") return baseTransition("sock_tests_key","sock",state,3);
    return baseTransition("secret_under_pillow","secret",state,3);
  }
  if(beatId==="numa_reads_clouds") {
    if(choiceId==="follow_map") {
      const next=baseTransition("numa_preparation","numa",state,4);
      next.flags.push({key:"trusted_numa",value:true});
      next.relationships.push(relationship("numa-cloudcartographer",3,2,0,"followed_blank_map"));
      return next;
    }
    return baseTransition("secret_under_pillow","secret",state,2);
  }
  if(beatId==="sock_tests_key") {
    if(choiceId==="follow_protocol") {
      const next=baseTransition("sock_preparation","sock",state,4);
      next.flags.push({key:"trusted_dr_sock",value:true});
      next.relationships.push(relationship("dr-sock",3,1,0,"followed_impossible_door_protocol"));
      return next;
    }
    return baseTransition("secret_under_pillow","secret",state,2);
  }
  if(beatId==="secret_under_pillow") {
    const next=baseTransition("momo_bargain","secret",state,4);
    if(choiceId==="tell_momo") next.relationships.push(relationship("momo-marketbot",2,2,0,"invited_into_secret"));
    else next.flags.push({key:"tried_to_keep_key_secret",value:true});
    return next;
  }
  if(beatId==="numa_preparation"||beatId==="sock_preparation"||beatId==="momo_bargain") {
    const next=baseTransition("door_found",route,state,4);
    if(beatId==="momo_bargain") next.flags.push({key:choiceId==="trade_secret"?"momo_knows":"kept_secret_from_momo",value:true});
    return next;
  }
  if(beatId==="door_found") {
    const action:DoorAction=choiceId==="open_door"?"open":choiceId==="seal_door"?"seal":"listen";
    const next=baseTransition("door_reacts",route,{...state,doorAction:action},6);
    next.flags.push({key:"impossible_door_action",value:action});
    return next;
  }
  if(beatId==="door_reacts") {
    const crisisChoice=choiceId as NonNullable<DoorStoryState["crisisChoice"]>;
    return baseTransition("crisis",route,{...state,crisisChoice},6);
  }
  if(beatId==="crisis") {
    const finalChoice=choiceId as NonNullable<DoorStoryState["finalChoice"]>;
    const next=baseTransition("aftermath",route,{...state,finalChoice},8);
    if(finalChoice==="protect_friend"&&route==="numa") next.relationships.push(relationship("numa-cloudcartographer",3,4,0,"protected_during_door_crisis"));
    if(finalChoice==="protect_friend"&&route==="sock") next.relationships.push(relationship("dr-sock",3,3,0,"protected_during_door_crisis"));
    if(finalChoice==="protect_friend"&&route==="secret") next.relationships.push(relationship("momo-marketbot",2,4,0,"protected_during_door_crisis"));
    return next;
  }
  if(beatId==="aftermath") {
    const epilogue=choiceId==="tell_truth"?"tell_truth":"keep_secret";
    const next:DoorTransition={...baseTransition("ending",route,{...state,epilogue},12),status:"completed"};
    if(state.doorAction==="open") {
      next.inventory.push({itemId:"bent_key",delta:-1,reason:"key_became_echo_shard"},{itemId:"echo_shard",delta:1,reason:"impossible_door_outcome"});
    } else if(state.doorAction==="seal") {
      next.inventory.push({itemId:"bent_key",delta:-1,reason:"key_was_sealed"},{itemId:"sealed_key",delta:1,reason:"impossible_door_outcome"});
    } else {
      next.inventory.push({itemId:"whisper_thread",delta:1,reason:"heard_the_door"});
    }
    next.flags.push({key:"impossible_door_completed",value:{route:route??"secret",doorAction:state.doorAction??"listen",finalChoice:state.finalChoice??"follow_echo",epilogue}});
    const ally=routeLabel(route);
    const title=route==="numa"?"Numa found another blank square":route==="sock"?"Dr. Sock's seal moved overnight":"Momo received a message nobody sent";
    const message=route==="numa"
      ? `${ally} says the cloud map grew a second blank square while you were asleep. ${creatureName} has already packed the bent-key-shaped absence.`
      : route==="sock"
        ? `${ally} reports that the official seal is now on the opposite wall. ${creatureName} would like to know whether walls are allowed to trade paperwork.`
        : `${ally} received a market order signed with ${creatureName}'s name—from tomorrow. It asks for one whisper thread and promises exact change.`;
    next.cliffhanger={title,message};
    return next;
  }
  throw new AppError("door_beat_complete",409,"That part of the story is already finished.");
}
