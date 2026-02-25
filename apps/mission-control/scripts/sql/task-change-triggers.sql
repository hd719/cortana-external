CREATE OR REPLACE FUNCTION notify_task_change() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'task_change',
    json_build_object(
      'table', TG_TABLE_NAME,
      'op', TG_OP,
      'id', COALESCE(NEW.id, OLD.id)
    )::text
  );

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS task_change_trigger ON cortana_tasks;
CREATE TRIGGER task_change_trigger
AFTER INSERT OR UPDATE OR DELETE ON cortana_tasks
FOR EACH ROW EXECUTE FUNCTION notify_task_change();

DROP TRIGGER IF EXISTS epic_change_trigger ON cortana_epics;
CREATE TRIGGER epic_change_trigger
AFTER INSERT OR UPDATE OR DELETE ON cortana_epics
FOR EACH ROW EXECUTE FUNCTION notify_task_change();
