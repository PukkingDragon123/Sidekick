// Microsoft Teams for Education through Microsoft Graph, read-only:
//   GET /education/me/classes                         (class names)
//   GET /education/me/assignments?$expand=submissions (the student's work + their own submission)
// falling back to
//   GET /education/classes/{classId}/assignments/{id}/submissions
// for assignments whose submissions did not come back expanded.
import { guessKind } from '../../../shared/src/index.ts';
import { STALE_AFTER_MS, cleanText, htmlToText, safeHttpUrl, type ImportedTask } from './importer.ts';
import { ProviderError, mapPool, type ApiSession } from './oauth.ts';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const MAX_PAGES = 25;
/** How many per-assignment submission lookups one sync may spend on the fallback path. */
const MAX_SUBMISSION_LOOKUPS = 40;
// Without this header Graph reports the newer states (reassigned, excused) as unknownFutureValue.
const HEADERS = { Prefer: 'include-unknown-enum-members' };

interface EduSubmission {
  status?: string;
  recipient?: { userId?: string };
}

export interface EduAssignment {
  id?: string;
  classId?: string;
  displayName?: string;
  instructions?: { content?: string; contentType?: string };
  dueDateTime?: string;
  assignedDateTime?: string;
  createdDateTime?: string;
  status?: string;
  webUrl?: string;
  grading?: { '@odata.type'?: string; maxPoints?: number };
  submissions?: EduSubmission[] | null;
}

interface EduClass {
  id?: string;
  displayName?: string;
}

/** Follow @odata.nextLink, but never off Graph: the link is data from the response. */
async function listAll<T>(session: ApiSession, firstUrl: string): Promise<T[]> {
  const out: T[] = [];
  let url: string | undefined = firstUrl;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const body: Record<string, unknown> = await session.json(url, HEADERS);
    if (Array.isArray(body.value)) out.push(...(body.value as T[]));
    const next: unknown = body['@odata.nextLink'];
    url = typeof next === 'string' && next.startsWith('https://graph.microsoft.com/') ? next : undefined;
  }
  return out;
}

// working -> submitted -> returned; "reassigned" means handed back for another go.
const DONE_STATES = new Set(['submitted', 'returned', 'released', 'excused']);

/** The student's own submission: the only one a student is given, or the one addressed to them. */
function ownSubmission(submissions: EduSubmission[], userId: string | undefined): EduSubmission | undefined {
  if (userId) {
    const mine = submissions.find((s) => s.recipient?.userId === userId);
    if (mine) return mine;
  }
  return submissions.length === 1 ? submissions[0] : undefined;
}

export function mapAssignment(a: EduAssignment, className: string | undefined, submission: EduSubmission | undefined): ImportedTask | null {
  if (!a.id || !a.classId) return null;
  const title = cleanText(a.displayName, 300);
  if (!title) return null;
  const body = a.instructions?.content;
  const description = cleanText(body && a.instructions?.contentType?.toLowerCase() === 'html' ? htmlToText(body) : body, 2000);
  const due = a.dueDateTime ? Date.parse(a.dueDateTime) : NaN;
  const externalId = `${a.classId}:${a.id}`;
  const task: ImportedTask = {
    id: `microsoft:${externalId}`,
    source: 'microsoft',
    externalId,
    title,
    due: Number.isFinite(due) ? due : null,
    kind: guessKind({ title, description }),
    doneAtSource: submission?.status != null && DONE_STATES.has(submission.status),
  };
  const course = cleanText(className, 200);
  if (course) task.course = course;
  if (description) task.description = description;
  const url = safeHttpUrl(a.webUrl);
  if (url) task.url = url;
  const points = a.grading?.maxPoints;
  if (typeof points === 'number' && points > 0) task.points = points;
  const created = Date.parse(a.assignedDateTime ?? a.createdDateTime ?? '');
  if (Number.isFinite(created)) task.sourceCreatedAt = created;
  return task;
}

export async function pullMicrosoft(session: ApiSession, now: number): Promise<{ items: ImportedTask[]; warnings: string[] }> {
  const warnings: string[] = [];

  // Class names are a nicety: without roster consent the tasks still import, just unlabelled.
  const classNames = new Map<string, string>();
  try {
    for (const c of await listAll<EduClass>(session, `${GRAPH}/education/me/classes?$select=id,displayName`)) {
      if (c.id && c.displayName) classNames.set(c.id, c.displayName);
    }
  } catch (err) {
    if (err instanceof ProviderError && err.reconnect) throw err;
  }

  const assignments = (await listAll<EduAssignment>(session, `${GRAPH}/education/me/assignments?$expand=submissions&$top=50`)).filter(
    (a) => a.id && a.classId && (!a.status || a.status === 'assigned' || a.status === 'published'),
  );

  // Assignments that came back without their submissions: ask for them one by one, most
  // relevant first, within a budget.
  const missing = assignments
    .filter((a) => !Array.isArray(a.submissions))
    .filter((a) => {
      const due = a.dueDateTime ? Date.parse(a.dueDateTime) : NaN;
      return !Number.isFinite(due) || due >= now - STALE_AFTER_MS;
    })
    .slice(0, MAX_SUBMISSION_LOOKUPS);
  let lookupsFailed = 0;
  await mapPool(missing, 4, async (a) => {
    const url = `${GRAPH}/education/classes/${encodeURIComponent(a.classId as string)}/assignments/${encodeURIComponent(a.id as string)}/submissions`;
    try {
      a.submissions = await listAll<EduSubmission>(session, url);
    } catch (err) {
      if (err instanceof ProviderError && err.reconnect) throw err;
      lookupsFailed += 1;
    }
  });
  if (lookupsFailed) warnings.push('Some Teams assignments could not be checked for hand-in status.');

  const items = assignments
    .map((a) => mapAssignment(a, classNames.get(a.classId as string), ownSubmission(a.submissions ?? [], session.userId)))
    .filter((t): t is ImportedTask => t != null);
  return { items, warnings };
}
