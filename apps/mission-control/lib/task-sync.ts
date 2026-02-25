import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getTaskPrisma } from "@/lib/task-prisma";

export type TaskSyncSource = NonNullable<ReturnType<typeof getTaskPrisma>>;

const toJson = (value: Prisma.JsonValue | null) =>
  value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);

export const upsertEpicFromSource = async (source: TaskSyncSource, epicId: number) => {
  const epic = await source.cortanaEpic.findUnique({ where: { id: epicId } });
  if (!epic) return false;

  await prisma.cortanaEpic.upsert({
    where: { id: epic.id },
    create: {
      id: epic.id,
      title: epic.title,
      source: epic.source,
      status: epic.status,
      deadline: epic.deadline,
      createdAt: epic.createdAt,
      completedAt: epic.completedAt,
      metadata: toJson(epic.metadata),
    },
    update: {
      title: epic.title,
      source: epic.source,
      status: epic.status,
      deadline: epic.deadline,
      createdAt: epic.createdAt,
      completedAt: epic.completedAt,
      metadata: toJson(epic.metadata),
    },
  });

  return true;
};

export const upsertTaskFromSource = async (source: TaskSyncSource, taskId: number) => {
  const task = await source.cortanaTask.findUnique({ where: { id: taskId } });
  if (!task) return false;

  if (task.epicId) {
    await upsertEpicFromSource(source, task.epicId);
  }

  await prisma.cortanaTask.upsert({
    where: { id: task.id },
    create: {
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      status: task.status,
      dueAt: task.dueAt,
      remindAt: task.remindAt,
      executeAt: task.executeAt,
      autoExecutable: task.autoExecutable,
      executionPlan: task.executionPlan,
      dependsOn: task.dependsOn ?? [],
      completedAt: task.completedAt,
      outcome: task.outcome,
      metadata: toJson(task.metadata),
      epicId: task.epicId,
      parentId: task.parentId,
      assignedTo: task.assignedTo,
      source: task.source,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    },
    update: {
      title: task.title,
      description: task.description,
      priority: task.priority,
      status: task.status,
      dueAt: task.dueAt,
      remindAt: task.remindAt,
      executeAt: task.executeAt,
      autoExecutable: task.autoExecutable,
      executionPlan: task.executionPlan,
      dependsOn: task.dependsOn ?? [],
      completedAt: task.completedAt,
      outcome: task.outcome,
      metadata: toJson(task.metadata),
      epicId: task.epicId,
      parentId: task.parentId,
      assignedTo: task.assignedTo,
      source: task.source,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    },
  });

  return true;
};

export const deleteTaskFromApp = async (taskId: number) => {
  await prisma.cortanaTask.deleteMany({ where: { id: taskId } });
};

export const deleteEpicFromApp = async (epicId: number) => {
  await prisma.$transaction(async (tx) => {
    await tx.cortanaTask.updateMany({ where: { epicId }, data: { epicId: null } });
    await tx.cortanaEpic.deleteMany({ where: { id: epicId } });
  });
};
