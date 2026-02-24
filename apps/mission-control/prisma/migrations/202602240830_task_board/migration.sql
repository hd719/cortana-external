-- Add Cortana task board tables (adapter/read-model for mission control)

-- Epics table mirrors upstream cortana_epics
CREATE TABLE IF NOT EXISTS "cortana_epics" (
    "id" SERIAL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "source" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "deadline" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "metadata" JSONB
);

-- Tasks table mirrors upstream cortana_tasks
CREATE TABLE IF NOT EXISTS "cortana_tasks" (
    "id" SERIAL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 3,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "due_at" TIMESTAMP(3),
    "remind_at" TIMESTAMP(3),
    "execute_at" TIMESTAMP(3),
    "auto_executable" BOOLEAN NOT NULL DEFAULT false,
    "execution_plan" TEXT,
    "depends_on" INTEGER[] NOT NULL DEFAULT '{}',
    "completed_at" TIMESTAMP(3),
    "outcome" TEXT,
    "metadata" JSONB,
    "epic_id" INTEGER REFERENCES "cortana_epics"("id") ON DELETE SET NULL,
    "parent_id" INTEGER REFERENCES "cortana_tasks"("id") ON DELETE SET NULL,
    "assigned_to" TEXT,
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "cortana_tasks_status_idx" ON "cortana_tasks" ("status");
CREATE INDEX IF NOT EXISTS "cortana_tasks_due_idx" ON "cortana_tasks" ("due_at");
CREATE INDEX IF NOT EXISTS "cortana_tasks_epic_idx" ON "cortana_tasks" ("epic_id");
