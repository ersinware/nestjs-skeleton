-- Custom SQL migration file, put your code below! --

CREATE OR REPLACE FUNCTION notify_outbox_event() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('outbox_channel', '1');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS outbox_insert_trigger ON outbox;

CREATE TRIGGER outbox_insert_trigger
AFTER INSERT ON outbox
FOR EACH STATEMENT EXECUTE FUNCTION notify_outbox_event();