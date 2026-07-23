CREATE TABLE story_arc_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creature_id uuid NOT NULL REFERENCES creatures(id) ON DELETE CASCADE,
  arc_id text NOT NULL,
  arc_version integer NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','paused')),
  current_beat text NOT NULL,
  route text,
  state jsonb NOT NULL DEFAULT '{}',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (creature_id, arc_id)
);
CREATE INDEX story_arc_instances_creature_idx ON story_arc_instances(creature_id,status);

CREATE TABLE story_arc_choices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL REFERENCES story_arc_instances(id) ON DELETE CASCADE,
  beat_id text NOT NULL,
  choice_id text NOT NULL,
  result_beat text NOT NULL,
  choice_payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instance_id, beat_id)
);

CREATE TABLE item_catalog (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  icon text NOT NULL,
  stackable boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE inventory_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creature_id uuid NOT NULL REFERENCES creatures(id) ON DELETE CASCADE,
  item_id text NOT NULL REFERENCES item_catalog(id),
  delta integer NOT NULL CHECK (delta <> 0),
  source_key text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (creature_id, source_key)
);
CREATE INDEX inventory_ledger_creature_idx ON inventory_ledger(creature_id,item_id,created_at);

ALTER TABLE story_entries ADD COLUMN arc_instance_id uuid REFERENCES story_arc_instances(id) ON DELETE SET NULL;
ALTER TABLE story_entries ADD COLUMN beat_id text;
CREATE INDEX story_entries_arc_idx ON story_entries(arc_instance_id,beat_id,created_at DESC);

INSERT INTO item_catalog (id,name,description,icon,stackable) VALUES
  ('bent_key','Bent key','A warm, crooked key that hums when pointed at walls.','🗝️',false),
  ('echo_shard','Echo shard','A silver fragment that repeats tomorrow in a very quiet voice.','◇',true),
  ('sealed_key','Sealed key','The impossible key wrapped in Dr. Sock''s extremely official red thread.','🔐',false),
  ('whisper_thread','Whisper thread','A thread of sound that can only be held while nobody is speaking.','〰️',true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO quests (id,title,description,trigger_type,reward) VALUES
  ('impossible-door','The door that was not there yesterday','Follow the bent key, decide whom to trust, and survive whatever is waiting behind the impossible door.','story_arc','{"xp":60,"story":"impossible-door"}')
ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,reward=EXCLUDED.reward,active=true;
