// Google Classroom, read-only: the student's active courses, their coursework and the
// student's own submission state.
//   GET /v1/courses?studentId=me&courseStates=ACTIVE
//   GET /v1/courses/{courseId}/courseWork
//   GET /v1/courses/{courseId}/courseWork/-/studentSubmissions?userId=me
import { guessKind } from '../../../shared/src/index.ts';
import { cleanText, safeHttpUrl, type ImportedTask } from './importer.ts';
import { ProviderError, mapPool, type ApiSession } from './oauth.ts';

const API = 'https://classroom.googleapis.com/v1';
const MAX_PAGES = 25;

interface Course {
  id?: string;
  name?: string;
  section?: string;
  courseState?: string;
}

interface ClassroomDate {
  year?: number;
  month?: number;
  day?: number;
}

interface ClassroomTime {
  hours?: number;
  minutes?: number;
  seconds?: number;
}

export interface CourseWork {
  courseId?: string;
  id?: string;
  title?: string;
  description?: string;
  state?: string;
  alternateLink?: string;
  creationTime?: string;
  dueDate?: ClassroomDate;
  dueTime?: ClassroomTime;
  maxPoints?: number;
  workType?: string;
}

interface StudentSubmission {
  courseWorkId?: string;
  state?: string;
}

/** Every page of a Classroom list call. `key` is the array field of the response. */
async function listAll<T>(session: ApiSession, url: string, key: string): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const next = new URL(url);
    if (pageToken) next.searchParams.set('pageToken', pageToken);
    const body = await session.json(next.toString());
    const items = body[key];
    if (Array.isArray(items)) out.push(...(items as T[]));
    pageToken = typeof body.nextPageToken === 'string' && body.nextPageToken ? body.nextPageToken : undefined;
    if (!pageToken) break;
  }
  return out;
}

/**
 * dueDate + dueTime are in UTC. Zero-valued fields are omitted from the JSON, so a
 * missing hour means 00, and a deadline with a date but no time means the end of that day.
 */
export function classroomDue(date: ClassroomDate | undefined, time: ClassroomTime | undefined): number | null {
  if (!date?.year || !date.month || !date.day) return null;
  if (!time) return Date.UTC(date.year, date.month - 1, date.day, 23, 59, 0);
  return Date.UTC(date.year, date.month - 1, date.day, time.hours ?? 0, time.minutes ?? 0, time.seconds ?? 0);
}

const DONE_STATES = new Set(['TURNED_IN', 'RETURNED']);

export function mapCourseWork(course: Course, work: CourseWork, submissionState: string | undefined): ImportedTask | null {
  if (!course.id || !work.id) return null;
  const title = cleanText(work.title, 300);
  if (!title) return null;
  const description = cleanText(work.description, 2000);
  const externalId = `${course.id}:${work.id}`;
  const task: ImportedTask = {
    id: `google:${externalId}`,
    source: 'google',
    externalId,
    title,
    due: classroomDue(work.dueDate, work.dueTime),
    kind: guessKind({ title, description }),
    doneAtSource: submissionState != null && DONE_STATES.has(submissionState),
  };
  const courseName = cleanText(course.name, 200);
  if (courseName) task.course = courseName;
  if (description) task.description = description;
  const url = safeHttpUrl(work.alternateLink);
  if (url) task.url = url;
  if (typeof work.maxPoints === 'number' && work.maxPoints > 0) task.points = work.maxPoints;
  const created = work.creationTime ? Date.parse(work.creationTime) : NaN;
  if (Number.isFinite(created)) task.sourceCreatedAt = created;
  return task;
}

export async function pullGoogle(session: ApiSession): Promise<{ items: ImportedTask[]; warnings: string[] }> {
  const courses = (await listAll<Course>(session, `${API}/courses?studentId=me&courseStates=ACTIVE&pageSize=100`, 'courses')).filter(
    (c) => c.id && (!c.courseState || c.courseState === 'ACTIVE'),
  );

  let failed = 0;
  const perCourse = await mapPool(courses, 4, async (course) => {
    const base = `${API}/courses/${encodeURIComponent(course.id as string)}/courseWork`;
    try {
      const [work, submissions] = await Promise.all([
        listAll<CourseWork>(session, `${base}?pageSize=100`, 'courseWork'),
        listAll<StudentSubmission>(session, `${base}/-/studentSubmissions?userId=me&pageSize=100`, 'studentSubmissions'),
      ]);
      const stateOf = new Map<string, string>();
      for (const s of submissions) if (s.courseWorkId && s.state) stateOf.set(s.courseWorkId, s.state);
      return work
        .filter((w) => !w.state || w.state === 'PUBLISHED')
        .map((w) => mapCourseWork(course, w, w.id ? stateOf.get(w.id) : undefined))
        .filter((t): t is ImportedTask => t != null);
    } catch (err) {
      // an expired grant is the whole account's problem; one unreadable class is not
      if (err instanceof ProviderError && err.reconnect) throw err;
      failed += 1;
      return [];
    }
  });

  const warnings = failed ? [`${failed} Google Classroom class${failed > 1 ? 'es' : ''} could not be read this time.`] : [];
  return { items: perCourse.flat(), warnings };
}
