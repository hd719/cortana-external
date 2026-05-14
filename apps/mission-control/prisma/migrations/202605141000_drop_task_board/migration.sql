DROP TRIGGER IF EXISTS task_change_trigger ON cortana_tasks;
DROP TRIGGER IF EXISTS epic_change_trigger ON cortana_epics;
DROP FUNCTION IF EXISTS notify_task_change();
DROP TABLE IF EXISTS cortana_tasks CASCADE;
DROP TABLE IF EXISTS cortana_epics CASCADE;
