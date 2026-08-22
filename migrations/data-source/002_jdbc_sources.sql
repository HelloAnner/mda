ALTER TABLE data_sources DROP CONSTRAINT data_sources_kind_check;
ALTER TABLE data_sources
  ADD CONSTRAINT data_sources_kind_check CHECK (kind IN ('http', 'jdbc'));

CREATE TABLE IF NOT EXISTS mda_jdbc_sales_fixture (
  region text PRIMARY KEY,
  revenue numeric(18, 2) NOT NULL,
  orders integer NOT NULL,
  margin numeric(8, 2) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO mda_jdbc_sales_fixture (region, revenue, orders, margin)
VALUES
  ('North America', 1120000.00, 7420, 44.20),
  ('Europe', 780000.00, 4980, 43.10),
  ('Asia Pacific', 625000.00, 4010, 40.80),
  ('Latin America', 320000.00, 2010, 38.40)
ON CONFLICT (region) DO NOTHING;
