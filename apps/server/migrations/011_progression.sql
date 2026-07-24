ALTER TABLE creatures ADD COLUMN IF NOT EXISTS stars integer NOT NULL DEFAULT 0;
ALTER TABLE creatures ADD COLUMN IF NOT EXISTS energy_updated_at timestamptz NOT NULL DEFAULT now();

INSERT INTO item_catalog (id,name,description,icon,stackable) VALUES
  ('warm_button','Warm button','A button that hums when nobody is listening. Dr. Sock insists it is scientifically significant.','🔘',false)
ON CONFLICT (id) DO NOTHING;
