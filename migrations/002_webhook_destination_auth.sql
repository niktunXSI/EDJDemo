-- Optional bearer token sent as `Authorization: Bearer <token>` to external webhook destinations
-- that require their own authentication (for example an automation platform's webhook trigger).
alter table webhook_config add column if not exists destination_bearer text;
