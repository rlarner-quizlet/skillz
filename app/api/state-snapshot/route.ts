import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const runtime = 'nodejs'

type Proficiency = 0 | 1 | 2 | 3
type ProjectAssignments = Record<string, { skills: string[]; members: string[] }>

interface AppState {
  skills: string[]
  members: string[]
  projects: string[]
  projectAssignments: ProjectAssignments
  matrix: Record<string, Proficiency>
}

interface SnapshotPayload {
  state: AppState
}

interface SkillMatrixSnapshot {
  format: 'skill-matrix-export'
  version: 1
  exportedAt: string
  data: AppState
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function normalizeState(value: unknown): AppState | null {
  if (!isRecord(value)) return null

  const skills = isStringArray(value.skills) ? value.skills : []
  const members = isStringArray(value.members) ? value.members : []
  const projects = isStringArray(value.projects) ? value.projects : []

  const projectAssignmentsRaw = isRecord(value.projectAssignments) ? value.projectAssignments : {}
  const projectAssignments: ProjectAssignments = {}
  for (const [project, assignment] of Object.entries(projectAssignmentsRaw)) {
    if (!isRecord(assignment)) continue
    projectAssignments[project] = {
      skills: isStringArray(assignment.skills) ? assignment.skills : [],
      members: isStringArray(assignment.members) ? assignment.members : [],
    }
  }

  const matrixRaw = isRecord(value.matrix) ? value.matrix : {}
  const matrix: Record<string, Proficiency> = {}
  for (const [key, level] of Object.entries(matrixRaw)) {
    if (level === 0 || level === 1 || level === 2 || level === 3) {
      matrix[key] = level
    }
  }

  return {
    skills,
    members,
    projects,
    projectAssignments,
    matrix,
  }
}

export async function POST(request: Request) {
  let body: SnapshotPayload

  try {
    body = (await request.json()) as SnapshotPayload
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const normalized = normalizeState(body?.state)
  if (!normalized) {
    return Response.json({ ok: false, error: 'Missing or invalid state payload.' }, { status: 400 })
  }

  const outputDir = join(process.cwd(), 'test-data')
  const outputFile = join(outputDir, 'skill-matrix-autosave.json')
  const snapshot: SkillMatrixSnapshot = {
    format: 'skill-matrix-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: normalized,
  }

  try {
    await mkdir(outputDir, { recursive: true })
    await writeFile(outputFile, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
    return Response.json({ ok: true, path: 'test-data/skill-matrix-autosave.json', exportedAt: snapshot.exportedAt })
  } catch {
    return Response.json({ ok: false, error: 'Failed to write autosave file.' }, { status: 500 })
  }
}
