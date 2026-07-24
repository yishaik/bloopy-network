INSERT INTO quests (id,title,description,trigger_type,reward) VALUES
  ('letter-from-tomorrow','The letter from tomorrow','Follow a letter written in your own handwriting into the hour that is not on any other clock.','story_arc','{"xp":58,"story":"letter-from-tomorrow"}')
ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,reward=EXCLUDED.reward,active=true;

INSERT INTO item_catalog (id,name,description,icon,stackable) VALUES
  ('thirteenth_stamp','Thirteenth stamp','A stamp from the hour that never happened. Hums faintly with unposted potential.','📮',false)
ON CONFLICT (id) DO NOTHING;
