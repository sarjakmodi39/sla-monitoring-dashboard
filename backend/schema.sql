create table if not exists checks (
  id                bigserial primary key,
  service_id        text not null,
  service_name      text not null,
  ts                timestamptz not null,
  status_code       int not null,
  latency_ms        numeric,
  agent             text not null,
  region            text not null,
  data_quality_flag text,
  raw_line          text not null,
  unique (service_id, ts, agent)
);

create index if not exists checks_ts_idx on checks (ts);
create index if not exists checks_service_ts_idx on checks (service_id, ts);
