import { describe, expect, it } from "vitest";
import {
  buildImpossibleDoorBeat,
  IMPOSSIBLE_DOOR_START_BEAT,
  resolveImpossibleDoorChoice,
  type DoorRoute,
  type DoorStoryState,
  type DoorTransition
} from "../src/impossible-door.js";

function play(choices:string[]):DoorTransition {
  let beat=IMPOSSIBLE_DOOR_START_BEAT;
  let route:DoorRoute|null=null;
  let state:DoorStoryState={};
  let last:DoorTransition|undefined;
  for(const choice of choices) {
    last=resolveImpossibleDoorChoice(beat,choice,route,state,"Piko");
    beat=last.nextBeat;
    route=last.route;
    state=last.state;
  }
  if(!last) throw new Error("path did not contain choices");
  return last;
}

describe("the impossible door",()=>{
  it("offers only two or three authored choices on every active beat",()=>{
    const beats:[string,DoorRoute|null,DoorStoryState][]=[
      ["dust_moved",null,{}],
      ["key_found",null,{discoveryMethod:"lifted_nest"}],
      ["key_hums",null,{discoveryMethod:"lifted_nest"}],
      ["numa_reads_clouds","numa",{}],
      ["sock_tests_key","sock",{}],
      ["secret_under_pillow","secret",{}],
      ["numa_preparation","numa",{}],
      ["sock_preparation","sock",{}],
      ["momo_bargain","secret",{}],
      ["door_found","numa",{}],
      ["door_reacts","numa",{doorAction:"open"}],
      ["crisis","numa",{doorAction:"open",crisisChoice:"pull_key_back"}],
      ["aftermath","numa",{doorAction:"open",finalChoice:"protect_friend"}]
    ];
    for(const [beat,route,state] of beats) {
      const count=buildImpossibleDoorBeat(beat,"Piko",route,state).story.choices.length;
      expect(count).toBeGreaterThanOrEqual(2);
      expect(count).toBeLessThanOrEqual(3);
    }
    expect(buildImpossibleDoorBeat("ending","Piko","numa",{doorAction:"open",finalChoice:"protect_friend",epilogue:"tell_truth"}).story.choices).toEqual([]);
  });

  it("completes the Numa route with an echo shard",()=>{
    const result=play(["lift_nest","ask_numa","follow_map","tie_cloud_thread","open_door","pull_key_back","protect_friend","tell_truth"]);
    expect(result.status).toBe("completed");
    expect(result.route).toBe("numa");
    expect(result.inventory).toEqual(expect.arrayContaining([
      expect.objectContaining({itemId:"bent_key",delta:-1}),
      expect.objectContaining({itemId:"echo_shard",delta:1})
    ]));
    expect(result.cliffhanger?.title).toContain("Numa");
  });

  it("completes the Dr. Sock route with a sealed key",()=>{
    const result=play(["ask_bloopy","ask_sock","follow_protocol","wear_goggles","seal_door","hold_seal","save_key","keep_secret"]);
    expect(result.status).toBe("completed");
    expect(result.route).toBe("sock");
    expect(result.inventory).toEqual(expect.arrayContaining([expect.objectContaining({itemId:"sealed_key",delta:1})]));
    expect(result.cliffhanger?.title).toContain("Sock");
  });

  it("completes the secret route while preserving the bent key",()=>{
    const result=play(["lift_nest","inspect_key","hide_key","listen_alone","refuse_trade","listen_door","stay_silent","follow_echo","keep_secret"]);
    expect(result.status).toBe("completed");
    expect(result.route).toBe("secret");
    expect(result.inventory).toEqual([expect.objectContaining({itemId:"whisper_thread",delta:1})]);
    expect(result.inventory.some((item)=>item.itemId==="bent_key"&&item.delta<0)).toBe(false);
    expect(result.cliffhanger?.title).toContain("Momo");
  });

  it("rejects choices that are not authored for the current beat",()=>{
    expect(()=>resolveImpossibleDoorChoice("dust_moved","open_door",null,{},"Piko")).toThrow("choice is not available");
  });
});
