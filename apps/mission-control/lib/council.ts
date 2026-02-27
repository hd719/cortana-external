import prisma from "@/lib/prisma";
import { getTaskPrisma } from "./task-prisma";

export type CouncilSession = {
  id: string;
  taskId: string | null;
  topic: string;
  objective: string | null;
  mode: string;
  status: string;
  createdBy: string | null;
  createdAt: string;
  decidedAt: string | null;
  finalDecision: Record<string, unknown> | null;
  confidence: number | null;
  rationale: string | null;
  members?: CouncilMember[];
  messages?: CouncilMessage[];
};

export type CouncilMember = {
  id: number;
  sessionId: string;
  agentId: string;
  role: string | null;
  weight: number;
  stance: string | null;
  vote: string | null;
  voteScore: number | null;
  reasoning: string | null;
  respondedAt: string | null;
};

export type CouncilMessage = {
  id: number;
  sessionId: string;
  turnNo: number;
  speakerId: string;
  messageType: string;
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export type CouncilFilters = {
  status?: string;
  mode?: string;
  rangeHours?: number;
  limit?: number;
};

type CouncilSessionRow = {
  id: string;
  task_id: string | null;
  topic: string;
  objective: string | null;
  mode: string;
  status: string;
  created_by: string | null;
  created_at: Date;
  decided_at: Date | null;
  final_decision: unknown;
  confidence: number | null;
  rationale: string | null;
};

type CouncilMemberRow = {
  id: number;
  session_id: string;
  agent_id: string;
  role: string | null;
  weight: number;
  stance: string | null;
  vote: string | null;
  vote_score: number | null;
  reasoning: string | null;
  responded_at: Date | null;
};

type CouncilMessageRow = {
  id: number;
  session_id: string;
  turn_no: number;
  speaker_id: string;
  message_type: string;
  content: string;
  metadata: unknown;
  created_at: Date;
};

const escapeLiteral = (value: string) => value.replaceAll("'", "''");

const asRecordOrNull = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
};

const mapSession = (row: CouncilSessionRow): CouncilSession => ({
  id: row.id,
  taskId: row.task_id,
  topic: row.topic,
  objective: row.objective,
  mode: row.mode,
  status: row.status,
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
  decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
  finalDecision: asRecordOrNull(row.final_decision),
  confidence: row.confidence,
  rationale: row.rationale,
});

const mapMember = (row: CouncilMemberRow): CouncilMember => ({
  id: row.id,
  sessionId: row.session_id,
  agentId: row.agent_id,
  role: row.role,
  weight: row.weight,
  stance: row.stance,
  vote: row.vote,
  voteScore: row.vote_score,
  reasoning: row.reasoning,
  respondedAt: row.responded_at ? row.responded_at.toISOString() : null,
});

const mapMessage = (row: CouncilMessageRow): CouncilMessage => ({
  id: row.id,
  sessionId: row.session_id,
  turnNo: row.turn_no,
  speakerId: row.speaker_id,
  messageType: row.message_type,
  content: row.content,
  metadata: asRecordOrNull(row.metadata),
  createdAt: row.created_at.toISOString(),
});

export async function getCouncilSessions(filters: CouncilFilters = {}): Promise<CouncilSession[]> {
  const taskPrisma = getTaskPrisma();
  const preferred = taskPrisma ?? prisma;

  const limit = Math.max(1, Math.min(filters.limit ?? 100, 500));
  const rangeHours = Math.max(1, Math.min(filters.rangeHours ?? 168, 24 * 30));

  const conditions: string[] = [
    `created_at >= NOW() - INTERVAL '${rangeHours} hours'`,
  ];

  if (filters.status) {
    conditions.push(`status = '${escapeLiteral(filters.status)}'`);
  }

  if (filters.mode) {
    conditions.push(`mode = '${escapeLiteral(filters.mode)}'`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const query = `
    SELECT
      id,
      task_id,
      topic,
      objective,
      mode,
      status,
      created_by,
      created_at,
      decided_at,
      final_decision,
      confidence,
      rationale
    FROM mc_council_sessions
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  const runQuery = async (client: typeof prisma) =>
    client.$queryRawUnsafe<CouncilSessionRow[]>(query);

  try {
    const rows = await runQuery(preferred);
    return rows.map(mapSession);
  } catch (error) {
    if (!taskPrisma) throw error;
    const rows = await runQuery(prisma);
    return rows.map(mapSession);
  }
}

export async function getCouncilSessionById(id: string): Promise<CouncilSession | null> {
  const safeId = escapeLiteral(id);
  const taskPrisma = getTaskPrisma();
  const preferred = taskPrisma ?? prisma;

  const sessionAndMembersQuery = `
    SELECT
      s.id,
      s.task_id,
      s.topic,
      s.objective,
      s.mode,
      s.status,
      s.created_by,
      s.created_at,
      s.decided_at,
      s.final_decision,
      s.confidence,
      s.rationale,
      m.id AS member_id,
      m.session_id,
      m.agent_id,
      m.role,
      m.weight,
      m.stance,
      m.vote,
      m.vote_score,
      m.reasoning,
      m.responded_at
    FROM mc_council_sessions s
    LEFT JOIN mc_council_members m ON m.session_id = s.id
    WHERE s.id = '${safeId}'
    ORDER BY m.id ASC
  `;

  const messagesQuery = `
    SELECT id, session_id, turn_no, speaker_id, message_type, content, metadata, created_at
    FROM mc_council_messages
    WHERE session_id = '${safeId}'
    ORDER BY turn_no ASC, created_at ASC
  `;

  type SessionWithMemberRow = CouncilSessionRow & {
    member_id: number | null;
    session_id: string | null;
    agent_id: string | null;
    role: string | null;
    weight: number | null;
    stance: string | null;
    vote: string | null;
    vote_score: number | null;
    reasoning: string | null;
    responded_at: Date | null;
  };

  const run = async (client: typeof prisma) => {
    const [sessionRows, messageRows] = await Promise.all([
      client.$queryRawUnsafe<SessionWithMemberRow[]>(sessionAndMembersQuery),
      client.$queryRawUnsafe<CouncilMessageRow[]>(messagesQuery),
    ]);
    return { sessionRows, messageRows };
  };

  try {
    const { sessionRows, messageRows } = await run(preferred);
    if (sessionRows.length === 0) return null;

    const session = mapSession(sessionRows[0]);
    const members = sessionRows
      .filter((row) => row.member_id !== null)
      .map((row) => mapMember({
        id: row.member_id as number,
        session_id: row.session_id as string,
        agent_id: row.agent_id as string,
        role: row.role,
        weight: row.weight as number,
        stance: row.stance,
        vote: row.vote,
        vote_score: row.vote_score,
        reasoning: row.reasoning,
        responded_at: row.responded_at,
      }));

    return {
      ...session,
      members,
      messages: messageRows.map(mapMessage),
    };
  } catch (error) {
    if (!taskPrisma) throw error;

    const { sessionRows, messageRows } = await run(prisma);
    if (sessionRows.length === 0) return null;

    const session = mapSession(sessionRows[0]);
    const members = sessionRows
      .filter((row) => row.member_id !== null)
      .map((row) => mapMember({
        id: row.member_id as number,
        session_id: row.session_id as string,
        agent_id: row.agent_id as string,
        role: row.role,
        weight: row.weight as number,
        stance: row.stance,
        vote: row.vote,
        vote_score: row.vote_score,
        reasoning: row.reasoning,
        responded_at: row.responded_at,
      }));

    return {
      ...session,
      members,
      messages: messageRows.map(mapMessage),
    };
  }
}

export async function createCouncilSession(data: {
  taskId?: string | null;
  topic: string;
  objective?: string | null;
  mode: string;
  createdBy?: string | null;
}): Promise<CouncilSession> {
  const taskId = data.taskId ? `'${escapeLiteral(data.taskId)}'` : "NULL";
  const topic = escapeLiteral(data.topic);
  const objective = data.objective ? `'${escapeLiteral(data.objective)}'` : "NULL";
  const mode = escapeLiteral(data.mode);
  const createdBy = data.createdBy ? `'${escapeLiteral(data.createdBy)}'` : "NULL";

  const sql = `
    INSERT INTO mc_council_sessions (task_id, topic, objective, mode, created_by)
    VALUES (${taskId}, '${topic}', ${objective}, '${mode}', ${createdBy})
    RETURNING
      id,
      task_id,
      topic,
      objective,
      mode,
      status,
      created_by,
      created_at,
      decided_at,
      final_decision,
      confidence,
      rationale
  `;

  const taskPrisma = getTaskPrisma();
  const preferred = taskPrisma ?? prisma;

  const run = async (client: typeof prisma) =>
    client.$queryRawUnsafe<CouncilSessionRow[]>(sql);

  try {
    const rows = await run(preferred);
    return mapSession(rows[0]);
  } catch (error) {
    if (!taskPrisma) throw error;
    const rows = await run(prisma);
    return mapSession(rows[0]);
  }
}

export async function submitVote(
  sessionId: string,
  memberId: number,
  vote: string,
  reasoning: string,
  voteScore?: number,
): Promise<void> {
  const safeSessionId = escapeLiteral(sessionId);
  const safeVote = escapeLiteral(vote);
  const safeReasoning = escapeLiteral(reasoning);
  const safeVoteScore = typeof voteScore === "number" ? `${voteScore}` : "NULL";

  const sql = `
    UPDATE mc_council_members
    SET
      vote = '${safeVote}',
      reasoning = '${safeReasoning}',
      vote_score = ${safeVoteScore},
      responded_at = NOW()
    WHERE id = ${memberId} AND session_id = '${safeSessionId}'
  `;

  const taskPrisma = getTaskPrisma();
  const preferred = taskPrisma ?? prisma;

  const run = async (client: typeof prisma) => {
    await client.$executeRawUnsafe(sql);
  };

  try {
    await run(preferred);
  } catch (error) {
    if (!taskPrisma) throw error;
    await run(prisma);
  }
}

export async function finalizeDecision(
  sessionId: string,
  decision: Record<string, unknown>,
  confidence: number,
  rationale: string,
): Promise<void> {
  const safeSessionId = escapeLiteral(sessionId);
  const safeDecision = `'${JSON.stringify(decision).replaceAll("'", "''")}'::jsonb`;
  const safeRationale = escapeLiteral(rationale);

  const sql = `
    UPDATE mc_council_sessions
    SET
      final_decision = ${safeDecision},
      confidence = ${confidence},
      rationale = '${safeRationale}',
      status = 'decided',
      decided_at = NOW()
    WHERE id = '${safeSessionId}'
  `;

  const taskPrisma = getTaskPrisma();
  const preferred = taskPrisma ?? prisma;

  const run = async (client: typeof prisma) => {
    await client.$executeRawUnsafe(sql);
  };

  try {
    await run(preferred);
  } catch (error) {
    if (!taskPrisma) throw error;
    await run(prisma);
  }
}


export async function addCouncilMembers(
  sessionId: string,
  members: Array<{ agentId: string; role?: string | null; weight?: number; stance?: string | null }>,
): Promise<void> {
  if (members.length === 0) return;

  const safeSessionId = escapeLiteral(sessionId);
  const values = members
    .map((member) => {
      const agentId = `'${escapeLiteral(member.agentId)}'`;
      const role = member.role ? `'${escapeLiteral(member.role)}'` : "NULL";
      const weight = typeof member.weight === "number" ? member.weight : 1;
      const stance = member.stance ? `'${escapeLiteral(member.stance)}'` : "NULL";
      return `('${safeSessionId}', ${agentId}, ${role}, ${weight}, ${stance})`;
    })
    .join(",\n");

  const sql = `
    INSERT INTO mc_council_members (session_id, agent_id, role, weight, stance)
    VALUES ${values}
  `;

  const taskPrisma = getTaskPrisma();
  const preferred = taskPrisma ?? prisma;

  const run = async (client: typeof prisma) => {
    await client.$executeRawUnsafe(sql);
  };

  try {
    await run(preferred);
  } catch (error) {
    if (!taskPrisma) throw error;
    await run(prisma);
  }
}

export async function appendCouncilMessage(data: {
  sessionId: string;
  turnNo: number;
  speakerId: string;
  messageType: string;
  content: string;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  const safeSessionId = escapeLiteral(data.sessionId);
  const safeSpeaker = escapeLiteral(data.speakerId);
  const safeType = escapeLiteral(data.messageType);
  const safeContent = escapeLiteral(data.content);
  const metadata = data.metadata
    ? `'${JSON.stringify(data.metadata).replaceAll("'", "''")}'::jsonb`
    : "NULL";

  const sql = `
    INSERT INTO mc_council_messages (session_id, turn_no, speaker_id, message_type, content, metadata)
    VALUES ('${safeSessionId}', ${data.turnNo}, '${safeSpeaker}', '${safeType}', '${safeContent}', ${metadata})
  `;

  const taskPrisma = getTaskPrisma();
  const preferred = taskPrisma ?? prisma;

  const run = async (client: typeof prisma) => {
    await client.$executeRawUnsafe(sql);
  };

  try {
    await run(preferred);
  } catch (error) {
    if (!taskPrisma) throw error;
    await run(prisma);
  }
}
