// ============================================================
// SETUP:
//   npx create-next-app@latest skill-matrix --typescript --tailwind --app --no-src-dir
//   cd skill-matrix
//   Replace the files below, then: npm run dev
// ============================================================


// ============================================================
// app/globals.css
// ============================================================
/*
@tailwind base;
@tailwind components;
@tailwind utilities;
*/


// ============================================================
// app/layout.tsx
// ============================================================
/*
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Team Skill Matrix',
  description: 'Track skills and training gaps across your team',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  )
}
*/


// ============================================================
// app/page.tsx  —  replace entirely with this file
// ============================================================

'use client'

import Image from 'next/image'
import { Suspense, useState, useEffect, useSyncExternalStore, useRef, useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'matrix' | 'gaps' | 'members' | 'projects' | 'manage'
type Proficiency = 0 | 1 | 2 | 3
type ProjectAssignments = Record<string, { skills: string[]; members: string[] }>

const TAB_TO_PATH: Record<Tab, string> = {
  matrix: '/skill-matrix',
  gaps: '/gap-analysis',
  members: '/members',
  projects: '/project',
  manage: '/manage',
}

const PATH_TO_TAB: Record<string, Tab> = {
  '/': 'matrix',
  '/skill-matrix': 'matrix',
  '/gap-analysis': 'gaps',
  '/members': 'members',
  '/project': 'projects',
  '/manage': 'manage',
}

interface AppState {
  skills: string[]
  members: string[]
  projects: string[]
  projectAssignments: ProjectAssignments
  matrix: Record<string, Proficiency>
  locations: string[]
  memberLocations: Record<string, string>
}

interface SkillMatrixExport {
  format: 'skill-matrix-autosave'
  version: number
  exportedAt: string
  data: AppState
}

interface DataIoResult {
  ok: boolean
  message: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LEVELS = ['None', 'Learning', 'Good', 'Expert'] as const

const LEVEL_ICON_SRC: Record<Proficiency, string> = {
  0: '/levels/none.png',
  1: '/levels/learning.png',
  2: '/levels/good.png',
  3: '/levels/expert.png',
}

const LEVEL_CELL: Record<number, string> = {
  0: 'text-gray-300 hover:bg-gray-100 border-transparent',
  1: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
  2: 'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100',
  3: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100',
}

const LEVEL_BADGE: Record<number, string> = {
  0: 'bg-gray-100 text-gray-400',
  1: 'bg-amber-100 text-amber-700',
  2: 'bg-sky-100 text-sky-700',
  3: 'bg-green-100 text-green-800',
}

const REQUIRED_SKILL_BADGE: Record<Proficiency, string> = {
  0: 'bg-red-50 text-red-700 border-red-200',
  1: 'bg-amber-50 text-amber-700 border-amber-200',
  2: 'bg-sky-50 text-sky-700 border-sky-200',
  3: 'bg-green-50 text-green-700 border-green-200',
}

const MEMBER_EXPERTISE_BADGE: Record<Proficiency, string> = {
  0: 'bg-gray-100 text-gray-600 border-gray-200',
  1: 'bg-amber-50 text-amber-700 border-amber-200',
  2: 'bg-sky-50 text-sky-700 border-sky-200',
  3: 'bg-green-50 text-green-700 border-green-200',
}

const AVATAR_COLORS = [
  'bg-blue-100 text-blue-800', 'bg-purple-100 text-purple-800',
  'bg-rose-100 text-rose-800',  'bg-teal-100 text-teal-800',
  'bg-amber-100 text-amber-800','bg-indigo-100 text-indigo-800',
  'bg-pink-100 text-pink-800',  'bg-cyan-100 text-cyan-800',
]

const STORAGE_KEY = 'skill-matrix-v1'
const AUTOSAVE_FORMAT = 'skill-matrix-autosave'
const EXPORT_VERSION = 1
const AUTOSAVE_INTERVAL_MS = 60_000
const DEFAULT_PROJECT_CAPACITY = 1
const TECH_DESIGN_PROJECT_CAPACITY = 2
const mk = (m: string, s: string) => `${m}||${s}`
const EMPTY: AppState = { skills: [], members: [], projects: [], projectAssignments: {}, matrix: {}, locations: [], memberLocations: {} }
const IMPORTED_SKILL_LEVEL: Proficiency = 2
const loadedTeamSession = {
  name: null as string | null,
  snapshot: null as string | null,
}

function isTechDesignSkill(skill: string) {
  return /^tech designs?$/i.test(skill.trim())
}

function LevelIcon({ level, size = 14 }: {
  level: Proficiency
  size?: number
}) {
  return (
    <Image
      src={LEVEL_ICON_SRC[level]}
      alt={LEVELS[level]}
      width={size}
      height={size}
      className="inline-block"
    />
  )
}

// ─── Persistence ─────────────────────────────────────────────────────────────

function loadState(): AppState {
  if (typeof window === 'undefined') return EMPTY
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY
    return normalizeAppState(JSON.parse(raw))
  } catch { return EMPTY }
}

function saveState(s: AppState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch {}
}

function parseNewEntries(input: string, existing: string[]) {
  const seen = new Set(existing)
  return input
    .split(',')
    .map(v => v.trim())
    .filter(Boolean)
    .filter(v => {
      if (seen.has(v)) return false
      seen.add(v)
      return true
    })
}

function parseCsvLine(line: string) {
  const out: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i += 1
        continue
      }
      inQuotes = !inQuotes
      continue
    }

    if (char === ',' && !inQuotes) {
      out.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  out.push(current.trim())
  return out
}

function normalizeProjectAssignments(value: unknown): ProjectAssignments {
  if (!value || typeof value !== 'object') return {}
  const out: ProjectAssignments = {}
  Object.entries(value as Record<string, unknown>).forEach(([project, config]) => {
    if (!config || typeof config !== 'object') return
    const data = config as { skills?: unknown; members?: unknown }
    const skills = Array.isArray(data.skills) ? data.skills.filter(v => typeof v === 'string') : []
    const members = Array.isArray(data.members) ? data.members.filter(v => typeof v === 'string') : []
    out[project] = {
      skills: [...new Set(skills)],
      members: [...new Set(members)],
    }
  })
  return out
}

function normalizeMatrix(value: unknown, members: string[], skills: string[]): Record<string, Proficiency> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, Proficiency> = {}
  const memberSet = new Set(members)
  const skillSet = new Set(skills)

  Object.entries(value as Record<string, unknown>).forEach(([key, rawLevel]) => {
    const [member, skill] = key.split('||')
    if (!member || !skill) return
    if (!memberSet.has(member) || !skillSet.has(skill)) return
    if (typeof rawLevel !== 'number' || !Number.isInteger(rawLevel)) return
    if (rawLevel < 0 || rawLevel > 3) return
    out[key] = rawLevel as Proficiency
  })

  return out
}

function normalizeAppState(value: unknown): AppState {
  if (!value || typeof value !== 'object') return EMPTY
  const parsed = value as Partial<AppState>
  const skills = Array.isArray(parsed.skills) ? [...new Set(parsed.skills.filter(v => typeof v === 'string'))] : []
  const members = Array.isArray(parsed.members) ? [...new Set(parsed.members.filter(v => typeof v === 'string'))] : []
  const projects = Array.isArray(parsed.projects) ? [...new Set(parsed.projects.filter(v => typeof v === 'string'))] : []
  const locations = Array.isArray(parsed.locations) ? [...new Set(parsed.locations.filter(v => typeof v === 'string'))] : []

  const skillSet = new Set(skills)
  const memberSet = new Set(members)
  const locationSet = new Set(locations)
  const rawAssignments = normalizeProjectAssignments(parsed.projectAssignments)
  const projectAssignments: ProjectAssignments = {}

  projects.forEach(project => {
    const config = rawAssignments[project] ?? { skills: [], members: [] }
    projectAssignments[project] = {
      skills: config.skills.filter(skill => skillSet.has(skill)),
      members: config.members.filter(member => memberSet.has(member)),
    }
  })

  const memberLocations: Record<string, string> = {}
  if (parsed.memberLocations && typeof parsed.memberLocations === 'object') {
    Object.entries(parsed.memberLocations as Record<string, unknown>).forEach(([member, loc]) => {
      if (!memberSet.has(member)) return
      if (typeof loc !== 'string' || !locationSet.has(loc)) return
      memberLocations[member] = loc
    })
  }

  return {
    skills,
    members,
    projects,
    projectAssignments,
    matrix: normalizeMatrix(parsed.matrix, members, skills),
    locations,
    memberLocations,
  }
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <HomeContent />
    </Suspense>
  )
}

function HomeContent() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [state, setState] = useState<AppState>(() => loadState())
  const [focusProject, setFocusProject] = useState<string | null>(null)
  const autosaveStateRef = useRef<AppState>(state)
  const lastAutosaveRef = useRef<string>('')
  const hasUnsavedTeamChangesRef = useRef(false)
  const isHydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )

  useEffect(() => { saveState(state) }, [state])
  useEffect(() => { autosaveStateRef.current = state }, [state])

  const teamParam = (searchParams.get('team') ?? '').trim().toLowerCase()

  useEffect(() => {
    if (!teamParam) {
      loadedTeamSession.name = null
      loadedTeamSession.snapshot = null
      hasUnsavedTeamChangesRef.current = false
      return
    }
    const safeTeam = teamParam.replace(/[^a-z0-9_-]/g, '')
    if (!safeTeam || loadedTeamSession.name === safeTeam) return

    let active = true
    const loadTeamSnapshot = async () => {
      try {
        const response = await fetch(`/teams/${encodeURIComponent(safeTeam)}.json`, { cache: 'no-store' })
        if (!active || !response.ok) return
        const parsed = await response.json() as Partial<SkillMatrixExport> | Partial<AppState>
        const nextState = parsed && typeof parsed === 'object' && 'format' in parsed
          ? (parsed as Partial<SkillMatrixExport>).data
          : parsed
        if (!active) return
        const normalizedState = normalizeAppState(nextState)
        setState(normalizedState)
        loadedTeamSession.name = safeTeam
        loadedTeamSession.snapshot = JSON.stringify(normalizedState)
        hasUnsavedTeamChangesRef.current = false
      } catch {
        // Keep existing state when the requested team file is unavailable.
      }
    }

    void loadTeamSnapshot()
    return () => { active = false }
  }, [teamParam])

  useEffect(() => {
    if (!teamParam || !loadedTeamSession.snapshot) {
      hasUnsavedTeamChangesRef.current = false
      return
    }
    const currentSnapshot = JSON.stringify(normalizeAppState(state))
    hasUnsavedTeamChangesRef.current = currentSnapshot !== loadedTeamSession.snapshot
  }, [state, teamParam])

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!teamParam || !hasUnsavedTeamChangesRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [teamParam])

  useEffect(() => {
    let active = true

    const writeSnapshot = async () => {
      const normalized = normalizeAppState(autosaveStateRef.current)
      const serialized = JSON.stringify(normalized)
      if (serialized === lastAutosaveRef.current) return

      try {
        const response = await fetch('/api/state-snapshot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: normalized }),
          keepalive: true,
        })
        if (!active || !response.ok) return
        lastAutosaveRef.current = serialized
      } catch {
        // Keep UI responsive if autosave endpoint is unavailable.
      }
    }

    void writeSnapshot()
    const intervalId = window.setInterval(() => { void writeSnapshot() }, AUTOSAVE_INTERVAL_MS)

    return () => {
      active = false
      window.clearInterval(intervalId)
    }
  }, [])

  const skills = Array.isArray(state.skills) ? state.skills : []
  const members = Array.isArray(state.members) ? state.members : []
  const projects = Array.isArray(state.projects) ? state.projects : []
  const locations = Array.isArray(state.locations) ? state.locations : []
  const memberLocations = state.memberLocations && typeof state.memberLocations === 'object' ? state.memberLocations : {}
  const projectAssignments = normalizeProjectAssignments(state.projectAssignments)
  const matrix = state.matrix && typeof state.matrix === 'object' ? state.matrix : {}

  const getLevel = (m: string, s: string): Proficiency =>
    (matrix[mk(m, s)] ?? 0) as Proficiency

  const cycleLevel = (m: string, s: string) =>
    setState(prev => ({
      ...prev,
      matrix: { ...prev.matrix, [mk(m, s)]: ((getLevel(m, s) + 1) % 4) as Proficiency },
    }))

  const addSkill = (name: string) => {
    setState(prev => {
      const toAdd = parseNewEntries(name, prev.skills)
      if (!toAdd.length) return prev
      return { ...prev, skills: [...prev.skills, ...toAdd] }
    })
  }

  const removeSkill = (name: string) =>
    setState(prev => {
      const m2 = { ...prev.matrix }
      prev.members.forEach(m => delete m2[mk(m, name)])
      const prevAssignments = normalizeProjectAssignments(prev.projectAssignments)
      const nextAssignments: ProjectAssignments = {}
      Object.entries(prevAssignments).forEach(([project, config]) => {
        nextAssignments[project] = {
          ...config,
          skills: config.skills.filter(s => s !== name),
        }
      })
      return {
        ...prev,
        skills: prev.skills.filter(s => s !== name),
        projectAssignments: nextAssignments,
        matrix: m2,
      }
    })

  const addMember = (name: string) => {
    setState(prev => {
      const toAdd = parseNewEntries(name, prev.members)
      if (!toAdd.length) return prev
      return { ...prev, members: [...prev.members, ...toAdd] }
    })
  }

  const addProject = (name: string) => {
    setState(prev => {
      const existingProjects = Array.isArray(prev.projects) ? prev.projects : []
      const toAdd = parseNewEntries(name, existingProjects)
      if (!toAdd.length) return prev
      return { ...prev, projects: [...existingProjects, ...toAdd] }
    })
  }

  const importMembersWithSkills = (input: string) => {
    setState(prev => {
      const lines = input
        .split(/\r?\n/)
        .map(v => v.trim())
        .filter(Boolean)

      if (!lines.length) return prev

      const membersToAdd: string[] = []
      const skillsToAdd: string[] = []
      const memberSeen = new Set(prev.members)
      const skillSeen = new Set(prev.skills)
      const matrixPatch: Record<string, Proficiency> = {}

      lines.forEach(line => {
        const cols = parseCsvLine(line).filter(Boolean)
        if (cols.length < 2) return

        const [member, ...skillsForMember] = cols
        if (!member) return

        if (!memberSeen.has(member)) {
          memberSeen.add(member)
          membersToAdd.push(member)
        }

        skillsForMember.forEach(skill => {
          if (!skill) return
          if (!skillSeen.has(skill)) {
            skillSeen.add(skill)
            skillsToAdd.push(skill)
          }

          const key = mk(member, skill)
          const existing = prev.matrix[key] ?? 0
          if (existing < IMPORTED_SKILL_LEVEL) {
            matrixPatch[key] = IMPORTED_SKILL_LEVEL
          }
        })
      })

      if (!membersToAdd.length && !skillsToAdd.length && !Object.keys(matrixPatch).length) {
        return prev
      }

      return {
        ...prev,
        members: [...prev.members, ...membersToAdd],
        skills: [...prev.skills, ...skillsToAdd],
        matrix: { ...prev.matrix, ...matrixPatch },
      }
    })
  }

  const importData = (input: string): DataIoResult => {
    const trimmed = input.trim()
    if (!trimmed) return { ok: false, message: 'Nothing to import.' }

    try {
      const parsed = JSON.parse(trimmed) as Partial<SkillMatrixExport> | Partial<AppState>
      if (parsed && typeof parsed === 'object' && 'format' in parsed) {
        if (parsed.format !== AUTOSAVE_FORMAT) {
          return { ok: false, message: 'Unsupported snapshot format.' }
        }
        if (typeof parsed.version !== 'number') {
          return { ok: false, message: 'Missing snapshot version.' }
        }
        if (!('data' in parsed)) {
          return { ok: false, message: 'Missing snapshot data.' }
        }
        setState(normalizeAppState(parsed.data))
        return { ok: true, message: `Imported autosave v${parsed.version}.` }
      }

      setState(normalizeAppState(parsed))
      return { ok: true, message: 'Imported JSON app data.' }
    } catch {
      importMembersWithSkills(trimmed)
      return { ok: true, message: 'Imported CSV members and skills.' }
    }
  }

  const exportData = (): DataIoResult => {
    if (typeof window === 'undefined') return { ok: false, message: 'Export unavailable on server.' }
    const payload: SkillMatrixExport = {
      format: AUTOSAVE_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      data: normalizeAppState(state),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `skill-matrix-autosave-v${EXPORT_VERSION}-${stamp}.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    return { ok: true, message: `Exported autosave v${EXPORT_VERSION} backup.` }
  }

  const removeMember = (name: string) =>
    setState(prev => {
      const m2 = { ...prev.matrix }
      prev.skills.forEach(s => delete m2[mk(name, s)])
      const prevAssignments = normalizeProjectAssignments(prev.projectAssignments)
      const nextAssignments: ProjectAssignments = {}
      Object.entries(prevAssignments).forEach(([project, config]) => {
        nextAssignments[project] = {
          ...config,
          members: config.members.filter(m => m !== name),
        }
      })
      const nextMemberLocations = { ...(prev.memberLocations ?? {}) }
      delete nextMemberLocations[name]
      return {
        ...prev,
        members: prev.members.filter(m => m !== name),
        projectAssignments: nextAssignments,
        matrix: m2,
        memberLocations: nextMemberLocations,
      }
    })

  const addLocation = (name: string) => {
    setState(prev => {
      const existing = Array.isArray(prev.locations) ? prev.locations : []
      const toAdd = parseNewEntries(name, existing)
      if (!toAdd.length) return prev
      return { ...prev, locations: [...existing, ...toAdd] }
    })
  }

  const removeLocation = (name: string) =>
    setState(prev => {
      const existing = Array.isArray(prev.locations) ? prev.locations : []
      const nextMemberLocations: Record<string, string> = {}
      Object.entries(prev.memberLocations ?? {}).forEach(([member, loc]) => {
        if (loc !== name) nextMemberLocations[member] = loc
      })
      return {
        ...prev,
        locations: existing.filter(l => l !== name),
        memberLocations: nextMemberLocations,
      }
    })

  const setMemberLocation = (member: string, location: string) =>
    setState(prev => {
      const next = { ...(prev.memberLocations ?? {}) }
      if (!location) delete next[member]
      else next[member] = location
      return { ...prev, memberLocations: next }
    })

  const removeProject = (name: string) =>
    setState(prev => {
      const existingProjects = Array.isArray(prev.projects) ? prev.projects : []
      const nextAssignments = { ...normalizeProjectAssignments(prev.projectAssignments) }
      delete nextAssignments[name]
      return {
        ...prev,
        projects: existingProjects.filter(p => p !== name),
        projectAssignments: nextAssignments,
      }
    })

  const reorderProject = (fromProject: string, toProject: string) =>
    setState(prev => {
      const currentProjects = Array.isArray(prev.projects) ? prev.projects : []
      const fromIndex = currentProjects.indexOf(fromProject)
      const toIndex = currentProjects.indexOf(toProject)
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return prev

      const nextProjects = [...currentProjects]
      const [moved] = nextProjects.splice(fromIndex, 1)
      nextProjects.splice(toIndex, 0, moved)
      return { ...prev, projects: nextProjects }
    })

  const toggleProjectSkill = (project: string, skill: string) =>
    setState(prev => {
      const prevAssignments = normalizeProjectAssignments(prev.projectAssignments)
      const current = prevAssignments[project] ?? { skills: [], members: [] }
      const hasSkill = current.skills.includes(skill)
      const nextProject = {
        ...current,
        skills: hasSkill ? current.skills.filter(s => s !== skill) : [...current.skills, skill],
      }
      return {
        ...prev,
        projectAssignments: { ...prevAssignments, [project]: nextProject },
      }
    })

  const toggleProjectMember = (project: string, member: string) =>
    setState(prev => {
      const prevAssignments = normalizeProjectAssignments(prev.projectAssignments)
      const current = prevAssignments[project] ?? { skills: [], members: [] }
      const hasMember = current.members.includes(member)
      const nextProject = {
        ...current,
        members: hasMember ? current.members.filter(m => m !== member) : [...current.members, member],
      }
      return {
        ...prev,
        projectAssignments: { ...prevAssignments, [project]: nextProject },
      }
    })

  const resetAll = () =>
    setState({ skills: [], members: [], projects: [], projectAssignments: {}, matrix: {}, locations: [], memberLocations: {} })

  const uncovered = skills.filter(s => !members.some(m => getLevel(m, s) > 0)).length

  const TABS: { id: Tab; label: string }[] = [
    { id: 'matrix',  label: 'Skill matrix' },
    { id: 'gaps',    label: 'Gap analysis' },
    { id: 'members', label: 'Members' },
    { id: 'projects', label: 'Projects' },
    { id: 'manage',  label: 'Manage' },
  ]

  const tab = PATH_TO_TAB[pathname] ?? 'matrix'

  const navigateToTab = (nextTab: Tab) => {
    const nextPath = TAB_TO_PATH[nextTab]
    const query = searchParams.toString()
    const target = query ? `${nextPath}?${query}` : nextPath
    if (target === `${pathname}${query ? `?${query}` : ''}`) return
    router.push(target, { scroll: false })
  }

  const clearFocusProject = useCallback(() => setFocusProject(null), [])

  const focusProjectInProjectsTab = (project: string) => {
    setFocusProject(project)
    navigateToTab('projects')
  }

  if (!isHydrated) return <div className="min-h-screen bg-gray-50" />

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-gray-900">Team skill matrix</h1>
          <p className="text-sm text-gray-500 mt-1">
            Track skills across your team, people, and projects to identify training gaps
          </p>
        </div>

        {/* Summary cards */}
        {(members.length > 0 || skills.length > 0 || projects.length > 0) && (
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            {[
              { label: 'Team members',    value: members.length, warn: false },
              { label: 'Skills tracked',  value: skills.length,  warn: false },
              { label: 'Projects',        value: projects.length, warn: false },
              { label: 'Uncovered skills',value: uncovered,      warn: uncovered > 0 },
            ].map(({ label, value, warn }) => (
              <div key={label} className="bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-xs text-gray-500 mb-1">{label}</p>
                <p className={`text-2xl font-semibold ${warn ? 'text-amber-600' : 'text-gray-900'}`}>
                  {value}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Tab shell */}
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="flex border-b border-gray-100 overflow-x-auto">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => navigateToTab(t.id)}
                className={`px-5 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                  tab === t.id
                    ? 'text-gray-900 border-b-2 border-gray-900 -mb-px'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="p-6">
            {tab === 'matrix'  && (
              <MatrixTab
                skills={skills}
                members={members}
                getLevel={getLevel}
                cycleLevel={cycleLevel}
                addSkill={addSkill}
                onGoToMembers={() => navigateToTab('members')}
              />
            )}
            {tab === 'gaps'    && (
              <GapsTab
                skills={skills}
                members={members}
                projects={projects}
                projectAssignments={projectAssignments}
                getLevel={getLevel}
                onGoToMembers={() => navigateToTab('members')}
                onGoToManage={() => navigateToTab('manage')}
              />
            )}
            {tab === 'members' && (
              <MembersTab
                skills={skills}
                members={members}
                projects={projects}
                projectAssignments={projectAssignments}
                getLevel={getLevel}
                cycleLevel={cycleLevel}
                addMember={addMember}
                removeMember={removeMember}
                onProjectClick={focusProjectInProjectsTab}
                locations={locations}
                memberLocations={memberLocations}
                setMemberLocation={setMemberLocation}
                onGoToManage={() => navigateToTab('manage')}
                onGoToProjects={() => navigateToTab('projects')}
              />
            )}
            {tab === 'projects' && (
              <ProjectsTab
                projects={projects}
                skills={skills}
                members={members}
                projectAssignments={projectAssignments}
                getLevel={getLevel}
                toggleProjectSkill={toggleProjectSkill}
                toggleProjectMember={toggleProjectMember}
                addProject={addProject}
                removeProject={removeProject}
                reorderProject={reorderProject}
                focusProject={focusProject}
                onFocusHandled={clearFocusProject}
                memberLocations={memberLocations}
                onGoToManage={() => navigateToTab('manage')}
              />
            )}
            {tab === 'manage'  && (
              <ManageTab
                skills={skills}   members={members} projects={projects}
                locations={locations}
                memberLocations={memberLocations}
                addSkill={addSkill}     removeSkill={removeSkill}
                addMember={addMember}   removeMember={removeMember}
                addProject={addProject} removeProject={removeProject}
                addLocation={addLocation} removeLocation={removeLocation}
                importData={importData}
                exportData={exportData}
                resetAll={resetAll}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Matrix Tab ───────────────────────────────────────────────────────────────

function MatrixTab({ skills, members, getLevel, cycleLevel, addSkill, onGoToMembers }: {
  skills: string[]
  members: string[]
  getLevel: (m: string, s: string) => Proficiency
  cycleLevel: (m: string, s: string) => void
  addSkill: (name: string) => void
  onGoToMembers: () => void
}) {
  const [skillInput, setSkillInput] = useState('')
  const submitSkill = () => {
    addSkill(skillInput)
    setSkillInput('')
  }
  const canRenderMatrix = members.length > 0 && skills.length > 0
  const sortedMembers = [...members].sort((a, b) => a.localeCompare(b))

  return (
    <div className="space-y-4">
      {canRenderMatrix ? (
        <>
          {/* Legend */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {LEVELS.map((l, i) => (
              <span key={l} className={`text-xs px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 ${LEVEL_BADGE[i]}`}>
                <LevelIcon level={i as Proficiency} size={12} />
                {l}
              </span>
            ))}
            <span className="text-xs text-gray-400 ml-1">— click a cell to cycle levels</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  <th className="text-left font-medium text-gray-500 pb-2 pr-4 min-w-[140px]">
                    Member
                  </th>
                  {skills.map(s => (
                    <th key={s} className="font-medium text-gray-500 pb-2 px-1 text-center min-w-[80px]">
                      <span className="block text-xs truncate max-w-[80px]" title={s}>{s}</span>
                    </th>
                  ))}
                  <th className="font-medium text-gray-500 pb-2 px-2 text-center text-xs min-w-[70px]">
                    Coverage
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sortedMembers.map(m => {
                  const count = skills.filter(s => getLevel(m, s) > 0).length
                  const pct   = skills.length ? Math.round((count / skills.length) * 100) : 0
                  return (
                    <tr key={m} className="hover:bg-gray-50/50">
                      <td className="py-1.5 pr-4 font-medium text-gray-900">{m}</td>
                      {skills.map(s => {
                        const lv = getLevel(m, s)
                        return (
                          <td key={s} className="py-1 px-1 text-center">
                            <button
                              onClick={() => cycleLevel(m, s)}
                              title={`${m} · ${s}: ${LEVELS[lv]} — click to change`}
                              className={`w-full rounded border text-xs py-1 transition-colors ${LEVEL_CELL[lv]}`}
                            >
                              <span className="flex items-center justify-center">
                                <LevelIcon level={lv} />
                              </span>
                            </button>
                          </td>
                        )
                      })}
                      <td className="py-1.5 px-2 text-center">
                        <span className={`text-xs font-semibold ${
                          pct === 100 ? 'text-green-600' : pct >= 50 ? 'text-sky-600' : 'text-gray-400'
                        }`}>
                          {pct}%
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="border-t-2 border-gray-100">
                <tr>
                  <td className="pt-2 pr-4 text-xs font-medium text-gray-500">Coverage</td>
                  {skills.map(s => {
                    const count = members.filter(m => getLevel(m, s) > 0).length
                    const pct   = members.length ? Math.round((count / members.length) * 100) : 0
                    return (
                      <td key={s} className="pt-2 px-1 text-center">
                        <span className={`text-xs font-semibold ${
                          pct === 100 ? 'text-green-600' : pct > 0 ? 'text-sky-600' : 'text-red-400'
                        }`}>
                          {pct}%
                        </span>
                      </td>
                    )
                  })}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      ) : (
        <p className="text-sm text-gray-400 py-4">
          Add{' '}
          <button
            type="button"
            onClick={onGoToMembers}
            className="text-gray-600 underline underline-offset-2 hover:text-gray-900 transition-colors"
          >
            team members
          </button>
          {' '}and skills to get started.
        </p>
      )}

      <div className="pt-4 border-t border-gray-100">
        <p className="text-xs font-medium text-gray-600 mb-2">Quick add skill</p>
        <InputRow
          value={skillInput}
          placeholder="e.g. TypeScript"
          onChange={setSkillInput}
          onSubmit={submitSkill}
          label="Add skill"
        />
      </div>
    </div>
  )
}

// ─── Gap Analysis Tab ─────────────────────────────────────────────────────────

function GapsTab({ skills, members, projects, projectAssignments, getLevel, onGoToMembers, onGoToManage }: {
  skills: string[]
  members: string[]
  projects: string[]
  projectAssignments: ProjectAssignments
  getLevel: (m: string, s: string) => Proficiency
  onGoToMembers: () => void
  onGoToManage: () => void
}) {
  const [sortBy, setSortBy] = useState<'skill' | 'gap' | 'coverage' | 'demand'>('gap')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')

  const toggleSort = (column: 'skill' | 'gap' | 'coverage' | 'demand') => {
    if (sortBy === column) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortBy(column)
    setSortDirection(column === 'skill' ? 'asc' : 'desc')
  }

  const sortArrow = (column: 'skill' | 'gap' | 'coverage' | 'demand') => {
    if (sortBy !== column) return '↕'
    return sortDirection === 'asc' ? '↑' : '↓'
  }

  if (!members.length || !skills.length)
    return (
      <p className="text-sm text-gray-400 py-4">
        Add{' '}
        <button
          type="button"
          onClick={onGoToMembers}
          className="text-gray-600 underline underline-offset-2 hover:text-gray-900 transition-colors"
        >
          team members
        </button>
        {' '}and{' '}
        <button
          type="button"
          onClick={onGoToManage}
          className="text-gray-600 underline underline-offset-2 hover:text-gray-900 transition-colors"
        >
          skills
        </button>
        {' '}to populate the gap analysis
      </p>
    )

  const skillRows = skills.map(s => {
    const rows = members.map(m => ({ m, lv: getLevel(m, s) }))
    const covered = rows.filter(r => r.lv >= 2)
    const learners = rows.filter(r => r.lv === 1)
    const pct = members.length ? Math.round((covered.length / members.length) * 100) : 0
    const requiredByProjects = projects.filter(project => {
      const requiredSkills = projectAssignments[project]?.skills ?? []
      return requiredSkills.includes(s)
    })
    const demand = requiredByProjects.length
    const demandPerCovered = demand === 0 ? 0 : demand / Math.max(covered.length, 1)
    const uncoveredProjectLoad = Math.max(0, demand - covered.length)
    // Higher score means higher risk under current project demand.
    const gapScore = Math.round((demandPerCovered * 100) + (uncoveredProjectLoad * 50))

    return {
      s,
      covered,
      learners,
      pct,
      demand,
      requiredByProjects,
      gapScore,
    }
  })

  const sortedSkillRows = [...skillRows].sort((a, b) => {
    if (sortBy === 'skill') {
      const comparison = a.s.localeCompare(b.s)
      return sortDirection === 'asc' ? comparison : -comparison
    }
    if (sortBy === 'coverage') {
      const comparison = a.pct - b.pct
      return sortDirection === 'asc' ? comparison : -comparison
    }
    if (sortBy === 'demand') {
      const comparison = a.demand - b.demand
      return sortDirection === 'asc' ? comparison : -comparison
    }
    const comparison = a.gapScore - b.gapScore
    return sortDirection === 'asc' ? comparison : -comparison
  })

  return (
    <div className="space-y-10">
      {/* By skill */}
      <section>
        <h2 className="text-sm font-medium text-gray-700 mb-3">Skills by project-weighted gap risk</h2>
        <p className="text-xs text-gray-500 mb-3">
          Gap score considers project demand per skill and available competent owners (Good/Expert).
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="font-medium text-gray-500 py-2 text-left pr-4">
                  <button
                    type="button"
                    onClick={() => toggleSort('skill')}
                    className="inline-flex items-center gap-1 hover:text-gray-700 transition-colors"
                    aria-label={`Sort by skill ${sortBy === 'skill' && sortDirection === 'asc' ? 'descending' : 'ascending'}`}
                  >
                    Skill
                    <span className="text-xs text-gray-400">{sortArrow('skill')}</span>
                  </button>
                </th>
                <th className="font-medium text-gray-500 py-2 text-center px-3">
                  <button
                    type="button"
                    onClick={() => toggleSort('gap')}
                    className="inline-flex items-center gap-1 hover:text-gray-700 transition-colors"
                    aria-label={`Sort by gap score ${sortBy === 'gap' && sortDirection === 'asc' ? 'descending' : 'ascending'}`}
                  >
                    Gap score
                    <span className="text-xs text-gray-400">{sortArrow('gap')}</span>
                  </button>
                </th>
                <th className="font-medium text-gray-500 py-2 text-center px-3">
                  <button
                    type="button"
                    onClick={() => toggleSort('demand')}
                    className="inline-flex items-center gap-1 hover:text-gray-700 transition-colors"
                    aria-label={`Sort by demand ${sortBy === 'demand' && sortDirection === 'asc' ? 'descending' : 'ascending'}`}
                  >
                    Project demand
                    <span className="text-xs text-gray-400">{sortArrow('demand')}</span>
                  </button>
                </th>
                <th className="font-medium text-gray-500 py-2 text-center px-3">
                  <button
                    type="button"
                    onClick={() => toggleSort('coverage')}
                    className="inline-flex items-center gap-1 hover:text-gray-700 transition-colors"
                    aria-label={`Sort by coverage ${sortBy === 'coverage' && sortDirection === 'asc' ? 'descending' : 'ascending'}`}
                  >
                    Coverage
                    <span className="text-xs text-gray-400">{sortArrow('coverage')}</span>
                  </button>
                </th>
                <th className="font-medium text-gray-500 py-2 text-left pr-4">Who has it</th>
                <th className="font-medium text-gray-500 py-2 text-left pr-4">Who wants it</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sortedSkillRows.map(({ s, covered, learners, pct, demand, requiredByProjects, gapScore }) => (
                <tr key={s} className="hover:bg-gray-50/50">
                  <td className="py-2.5 pr-4 font-medium text-gray-900">{s}</td>
                  <td className="py-2.5 px-3 text-center">
                    <span className={`text-sm font-semibold ${
                      gapScore >= 150 ? 'text-red-600' : gapScore >= 100 ? 'text-amber-600' : 'text-gray-500'
                    }`}>{gapScore}</span>
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <span className={`text-sm font-semibold ${demand > 0 ? 'text-gray-700' : 'text-gray-400'}`}>
                      {demand}
                    </span>
                    {requiredByProjects.length > 0 && (
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {requiredByProjects.join(', ')}
                      </p>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <span className={`text-sm font-semibold ${
                      pct === 0 ? 'text-red-500' : pct < 50 ? 'text-amber-600' : 'text-green-600'
                    }`}>{pct}%</span>
                  </td>
                  <td className="py-2.5 pr-4 text-xs text-gray-500">
                    {covered.length
                      ? covered.map(({ m, lv }) => (
                          <span key={m} className="inline-flex items-center gap-1 mr-2">
                            {m}
                            <span className={`rounded-full px-1.5 text-[10px] ${LEVEL_BADGE[lv]}`}>
                              <LevelIcon level={lv} size={12} />
                            </span>
                          </span>
                        ))
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="py-2.5 text-xs">
                    {learners.length
                      ? <span className="text-amber-600">{learners.map(r => r.m).join(', ')}</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  )
}

// ─── Members Tab ──────────────────────────────────────────────────────────────

function MembersTab({ members, skills, projects, projectAssignments, getLevel, cycleLevel, addMember, removeMember, onProjectClick, locations, memberLocations, setMemberLocation, onGoToManage, onGoToProjects }: {
  members: string[]
  skills: string[]
  projects: string[]
  projectAssignments: ProjectAssignments
  getLevel: (m: string, s: string) => Proficiency
  cycleLevel: (m: string, s: string) => void
  addMember: (name: string) => void
  removeMember: (name: string) => void
  onProjectClick: (project: string) => void
  locations: string[]
  memberLocations: Record<string, string>
  setMemberLocation: (member: string, location: string) => void
  onGoToManage: () => void
  onGoToProjects: () => void
}) {
  const [memberInput, setMemberInput] = useState('')
  const submitMember = () => {
    addMember(memberInput)
    setMemberInput('')
  }
  const handleRemoveMember = (member: string) => {
    if (!window.confirm(`Delete team member "${member}"? This also removes their skill levels and project assignments.`)) return
    removeMember(member)
  }
  const hasMembers = members.length > 0
  const sortedMembers = [...members].sort((a, b) => a.localeCompare(b))
  const sortedSkills = [...skills].sort((a, b) => a.localeCompare(b))
  const sortedLocations = [...locations].sort((a, b) => a.localeCompare(b))

  return (
    <div className="space-y-4">
      {hasMembers ? (
        <>
          {skills.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {LEVELS.map((l, i) => (
                <span key={l} className={`text-xs px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 ${LEVEL_BADGE[i]}`}>
                  <LevelIcon level={i as Proficiency} size={12} />
                  {l}
                </span>
              ))}
              <span className="text-xs text-gray-400 ml-1">— click a cell to cycle levels</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedMembers.map((m, i) => {
              const initials    = m.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
              const color       = AVATAR_COLORS[i % AVATAR_COLORS.length]
              const skillLevels = sortedSkills.map(s => ({ s, lv: getLevel(m, s) }))
              const covered     = skillLevels.filter(x => x.lv > 0).length
              const pct         = skills.length ? Math.round((covered / skills.length) * 100) : 0
              const assignedProjects = projects.filter(project => {
                const assignedMembers = projectAssignments[project]?.members ?? []
                return assignedMembers.includes(m)
              })

              return (
                <div key={m} className="bg-white rounded-xl border border-gray-100 p-4">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0 ${color}`}>
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 text-sm truncate">{m}</p>
                        <p className="text-xs text-gray-400">
                          {covered} of {skills.length} skills{skills.length > 0 && ` · ${pct}%`}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveMember(m)}
                      className="px-2.5 py-1 text-xs text-red-700 border border-red-200 rounded-md bg-white hover:bg-red-50 transition-colors flex-shrink-0"
                    >
                      Delete
                    </button>
                  </div>
                  <div className="mb-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 mb-1">
                      Location
                    </p>
                    {sortedLocations.length > 0 ? (
                      <select
                        value={memberLocations[m] ?? ''}
                        onChange={e => setMemberLocation(m, e.target.value)}
                        className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-gray-300"
                      >
                        <option value="">— No location —</option>
                        {sortedLocations.map(loc => (
                          <option key={loc} value={loc}>{loc}</option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-xs text-gray-400">
                        Add locations in the{' '}
                        <button
                          type="button"
                          onClick={onGoToManage}
                          className="text-gray-600 underline underline-offset-2 hover:text-gray-900 transition-colors"
                        >
                          Manage tab
                        </button>.
                      </p>
                    )}
                  </div>
                  <div className="mb-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 mb-1">
                      Projects
                    </p>
                    {assignedProjects.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {assignedProjects.map(project => (
                          <button
                            key={project}
                            type="button"
                            onClick={() => onProjectClick(project)}
                            title={`View ${project} in Projects tab`}
                            className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 hover:underline transition-colors cursor-pointer"
                          >
                            {project}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400">
                        No{' '}
                        <button
                          type="button"
                          onClick={onGoToProjects}
                          className="text-gray-600 underline underline-offset-2 hover:text-gray-900 transition-colors"
                        >
                          projects
                        </button>
                        {' '}assigned.
                      </p>
                    )}
                  </div>
                  {skills.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {skillLevels.map(({ s, lv }) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => cycleLevel(m, s)}
                          title={`${m} · ${s}: ${LEVELS[lv]} — click to change`}
                          className={`text-xs px-2 py-0.5 rounded-full ${LEVEL_BADGE[lv]}`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      ) : (
        <Empty text="Add a team member to start using this view." />
      )}

      <div className="pt-4 border-t border-gray-100">
        <p className="text-xs font-medium text-gray-600 mb-2">Quick add team member</p>
        <InputRow
          value={memberInput}
          placeholder="e.g. Alex Chen"
          onChange={setMemberInput}
          onSubmit={submitMember}
          label="Add member"
        />
      </div>
    </div>
  )
}

// ─── Projects Tab ─────────────────────────────────────────────────────────────

function ProjectsTab({
  projects,
  skills,
  members,
  projectAssignments,
  getLevel,
  toggleProjectSkill,
  toggleProjectMember,
  addProject,
  removeProject,
  reorderProject,
  focusProject,
  onFocusHandled,
  memberLocations,
  onGoToManage,
}: {
  projects: string[]
  skills: string[]
  members: string[]
  projectAssignments: ProjectAssignments
  getLevel: (m: string, s: string) => Proficiency
  toggleProjectSkill: (project: string, skill: string) => void
  toggleProjectMember: (project: string, member: string) => void
  addProject: (name: string) => void
  removeProject: (name: string) => void
  reorderProject: (fromProject: string, toProject: string) => void
  focusProject: string | null
  onFocusHandled: () => void
  memberLocations: Record<string, string>
  onGoToManage: () => void
}) {
  const [projectInput, setProjectInput] = useState('')
  const [draggingProject, setDraggingProject] = useState<string | null>(null)
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({})

  useEffect(() => {
    if (!focusProject) return
    const el = sectionRefs.current[focusProject]
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    onFocusHandled()
  }, [focusProject, onFocusHandled])
  const submitProject = () => {
    addProject(projectInput)
    setProjectInput('')
  }
  const handleRemoveProject = (project: string) => {
    if (!window.confirm(`Delete project "${project}"? This also removes its skill and member assignments.`)) return
    removeProject(project)
  }
  const hasProjects = projects.length > 0
  const sortedSkills = [...skills].sort((a, b) => a.localeCompare(b))
  const sortedMembers = [...members].sort((a, b) => a.localeCompare(b))

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-100 bg-white px-3 py-2">
        <p className="text-xs font-medium text-gray-600 mb-2">Skill coverage</p>
        <p className="text-xs text-gray-600">
          <span className="inline-flex items-center mr-2 rounded-full bg-gray-100 px-2 py-1 text-gray-700">
            None
          </span>
          <span className="inline-flex items-center mr-2 rounded-full bg-sky-50 px-2 py-1 text-sky-700">
            OK: ⚆
          </span>
          <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-1 text-green-700">
            Good: ✓
          </span>
        </p>
      </div>
      {hasProjects ? projects.map(project => {
        const config = projectAssignments[project] ?? { skills: [], members: [] }
        const uncoveredSkills = config.skills.filter(skill => {
          const assignedLevels = config.members.map(member => getLevel(member, skill))
          const expertCount = assignedLevels.filter(level => level === 3).length
          const competentCount = assignedLevels.filter(level => level >= 2).length
          return expertCount === 0 && competentCount < 2
        })

        const skilledAvailableMembers = sortedMembers
          .filter(member => {
            if (config.members.includes(member)) return false
            const assignedProjectCount = projects.reduce((count, otherProject) => {
              if (otherProject === project) return count
              const otherMembers = projectAssignments[otherProject]?.members ?? []
              return otherMembers.includes(member) ? count + 1 : count
            }, 0)
            const hasUncoveredTechDesign = uncoveredSkills.some(isTechDesignSkill)
            const canCoverTechDesign = skills.some(
              skill => isTechDesignSkill(skill) && getLevel(member, skill) > 0
            )
            const maxProjectCapacity = hasUncoveredTechDesign && canCoverTechDesign
              ? TECH_DESIGN_PROJECT_CAPACITY
              : DEFAULT_PROJECT_CAPACITY
            if (assignedProjectCount >= maxProjectCapacity) return false

            return uncoveredSkills.some(skill => getLevel(member, skill) > 0)
          })
          .map(member => {
            const maxLevel = uncoveredSkills.reduce<Proficiency>((max, skill) => {
              const lv = getLevel(member, skill)
              return lv > max ? lv : max
            }, 0)
            return { member, maxLevel }
          })
          .sort((a, b) => (b.maxLevel - a.maxLevel) || a.member.localeCompare(b.member))

        return (
          <section
            key={project}
            ref={el => { sectionRefs.current[project] = el }}
            draggable
            onDragStart={() => setDraggingProject(project)}
            onDragEnd={() => setDraggingProject(null)}
            onDragOver={event => event.preventDefault()}
            onDrop={event => {
              event.preventDefault()
              if (!draggingProject || draggingProject === project) return
              reorderProject(draggingProject, project)
              setDraggingProject(null)
            }}
            className={`rounded-xl border p-4 bg-white transition-colors cursor-move ${
              draggingProject === project ? 'border-gray-300 opacity-80' : 'border-gray-100'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">{project}</h3>
                <p className="text-xs text-gray-500">
                  {config.skills.length} required skill{config.skills.length === 1 ? '' : 's'} ·{' '}
                  {config.members.length} team member{config.members.length === 1 ? '' : 's'}
                </p>
              </div>
              <button
                type="button"
                onClick={event => {
                  event.stopPropagation()
                  handleRemoveProject(project)
                }}
                className="px-2.5 py-1 text-xs text-red-700 border border-red-200 rounded-md bg-white hover:bg-red-50 transition-colors"
              >
                Delete project
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div>
                <p className="text-xs font-medium text-gray-600 mb-2">Required skills</p>
                {skills.length === 0 ? (
                  <p className="text-xs text-gray-400">
                    No skills yet. Add skills in the{' '}
                    <button
                      type="button"
                      onClick={onGoToManage}
                      className="text-gray-600 underline underline-offset-2 hover:text-gray-900 transition-colors"
                    >
                      Manage tab
                    </button>.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {sortedSkills.map(skill => {
                      const selected = config.skills.includes(skill)
                      const assignedMembersWithSkill = config.members.filter(member => getLevel(member, skill) > 0)
                      const assignedLevels = config.members.map(member => getLevel(member, skill))
                      const maxAssignedLevel = assignedLevels.reduce<Proficiency>((max, level) => {
                        return level > max ? level : max
                      }, 0)
                      const expertCount = assignedLevels.filter(level => level === 3).length
                      const competentCount = assignedLevels.filter(level => level >= 2).length
                      const coverageLevel: Proficiency = (expertCount > 0 || competentCount >= 2) ? 3 : maxAssignedLevel
                      const coverageLabel = expertCount > 0
                        ? 'Expert'
                        : competentCount >= 2
                          ? 'Good'
                          : LEVELS[maxAssignedLevel]
                      const tooltip = selected
                        ? `${skill}: ${coverageLabel} coverage\nOn this project: ${
                            assignedMembersWithSkill.length ? assignedMembersWithSkill.join(', ') : 'None'
                          }`
                        : skill
                      return (
                        <button
                          key={skill}
                          type="button"
                          onClick={() => toggleProjectSkill(project, skill)}
                          title={tooltip}
                          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                            selected
                              ? REQUIRED_SKILL_BADGE[coverageLevel]
                              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          {selected ? '✓ ' : ''}
                          {skill}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              <div>
                <p className="text-xs font-medium text-gray-600 mb-2">Associated team members</p>
                {members.length === 0 ? (
                  <p className="text-xs text-gray-400">
                    No team members yet. Add members in the{' '}
                    <button
                      type="button"
                      onClick={onGoToManage}
                      className="text-gray-600 underline underline-offset-2 hover:text-gray-900 transition-colors"
                    >
                      Manage tab
                    </button>.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {sortedMembers.map(member => {
                      const selected = config.members.includes(member)
                      const location = memberLocations[member]
                      return (
                        <button
                          key={member}
                          type="button"
                          onClick={() => toggleProjectMember(project, member)}
                          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                            selected
                              ? 'bg-green-50 text-green-700 border-green-200'
                              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          {selected ? '✓ ' : ''}
                          {member}
                          {location && <span className="text-gray-500"> · {location}</span>}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              <div>
                <p className="text-xs font-medium text-gray-600 mb-1">Additional skilled team members</p>
                <p className="text-[11px] text-gray-400 mb-2">Click to add to this project.</p>
                {!config.skills.length ? (
                  <p className="text-xs text-gray-400">Select required skills to see matching available members.</p>
                ) : !uncoveredSkills.length ? (
                  <p className="text-xs text-gray-400">
                    All required skills are already covered by assigned experts or competent members.
                  </p>
                ) : skilledAvailableMembers.length === 0 ? (
                  <p className="text-xs text-gray-400">
                    No available members have capacity and the required uncovered skills.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {skilledAvailableMembers.map(({ member, maxLevel }) => {
                      const location = memberLocations[member]
                      return (
                        <button
                          key={member}
                          type="button"
                          onClick={() => toggleProjectMember(project, member)}
                          title={`${member}: ${LEVELS[maxLevel]} across required skills`}
                          className={`text-xs px-2.5 py-1 rounded-full border transition-colors hover:brightness-95 ${MEMBER_EXPERTISE_BADGE[maxLevel]}`}
                        >
                          + {member}
                          {location && <span className="text-gray-500"> · {location}</span>}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </section>
        )
      }) : (
        <Empty text="Add a project to start assigning skills and team members." />
      )}

      <div className="pt-4 border-t border-gray-100">
        <p className="text-xs font-medium text-gray-600 mb-2">Quick add project</p>
        <InputRow
          value={projectInput}
          placeholder="e.g. Curriculum refresh"
          onChange={setProjectInput}
          onSubmit={submitProject}
          label="Add project"
        />
      </div>
    </div>
  )
}

// ─── Manage Tab ───────────────────────────────────────────────────────────────

function ManageTab({
  skills,
  members,
  projects,
  locations,
  memberLocations,
  addSkill,
  removeSkill,
  addMember,
  removeMember,
  addProject,
  removeProject,
  addLocation,
  removeLocation,
  importData,
  exportData,
  resetAll,
}: {
  skills: string[]
  members: string[]
  projects: string[]
  locations: string[]
  memberLocations: Record<string, string>
  addSkill: (n: string) => void
  removeSkill: (n: string) => void
  addMember: (n: string) => void
  removeMember: (n: string) => void
  addProject: (n: string) => void
  removeProject: (n: string) => void
  addLocation: (n: string) => void
  removeLocation: (n: string) => void
  importData: (input: string) => DataIoResult
  exportData: () => DataIoResult
  resetAll: () => void
}) {
  const [si, setSi] = useState('')
  const [mi, setMi] = useState('')
  const [pi, setPi] = useState('')
  const [li, setLi] = useState('')
  const [bulkImport, setBulkImport] = useState('')
  const [ioMessage, setIoMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const submitSkill = () => { addSkill(si); setSi('') }
  const submitMember = () => { addMember(mi); setMi('') }
  const submitProject = () => { addProject(pi); setPi('') }
  const submitLocation = () => { addLocation(li); setLi('') }
  const submitImport = () => {
    if (!bulkImport.trim()) {
      fileInputRef.current?.click()
      return
    }
    const result = importData(bulkImport)
    setIoMessage({ tone: result.ok ? 'ok' : 'error', text: result.message })
    if (result.ok) setBulkImport('')
  }
  const hasAnyData = skills.length > 0 || members.length > 0 || projects.length > 0 || locations.length > 0
  const sortedSkills = [...skills].sort((a, b) => a.localeCompare(b))
  const sortedProjects = [...projects].sort((a, b) => a.localeCompare(b))
  const sortedLocations = [...locations].sort((a, b) => a.localeCompare(b))
  const locationCounts: Record<string, number> = {}
  locations.forEach(loc => { locationCounts[loc] = 0 })
  Object.values(memberLocations).forEach(loc => {
    if (loc in locationCounts) locationCounts[loc] += 1
  })
  const handleRemoveProject = (project: string) => {
    if (!window.confirm(`Delete project "${project}"? This also removes its skill and member assignments.`)) return
    removeProject(project)
  }
  const handleResetAll = () => {
    if (!hasAnyData) return
    if (!window.confirm('Reset all data? This will delete all team members, skills, projects, locations, and skill levels.')) {
      return
    }
    resetAll()
    setSi('')
    setMi('')
    setPi('')
    setLi('')
    setBulkImport('')
  }
  const importFromFile = async (file: File) => {
    const content = await file.text()
    const result = importData(content)
    setIoMessage({ tone: result.ok ? 'ok' : 'error', text: result.message })
  }
  const handleExport = () => {
    const result = exportData()
    setIoMessage({ tone: result.ok ? 'ok' : 'error', text: result.message })
  }

  return (
    <div className="space-y-8 max-w-xl">
      <Section title="Skills needed on this team">
        <InputRow
          value={si} placeholder="e.g. Python, Agile, SQL…"
          onChange={setSi} onSubmit={submitSkill} label="Add skill"
        />
        <TagList
          items={sortedSkills} onRemove={removeSkill}
          empty="No skills added yet."
        />
      </Section>

      <Section title="Team members">
        <InputRow
          value={mi} placeholder="e.g. Alex Chen"
          onChange={setMi} onSubmit={submitMember} label="Add member"
        />
        <TagList
          items={members} onRemove={removeMember}
          empty="No members added yet."
        />
      </Section>

      <Section title="Projects">
        <InputRow
          value={pi} placeholder="e.g. Google Classroom Add-On"
          onChange={setPi} onSubmit={submitProject} label="Add project"
        />
        <TagList
          items={sortedProjects}
          onRemove={handleRemoveProject}
          empty="No projects added yet."
        />
      </Section>

      <Section title="Locations">
        <InputRow
          value={li} placeholder="e.g. NYC, Remote, Berlin"
          onChange={setLi} onSubmit={submitLocation} label="Add location"
        />
        <TagList
          items={sortedLocations} onRemove={removeLocation}
          counts={locationCounts}
          empty="No locations added yet."
        />
      </Section>

      <Section title="Import / export data">
        <p className="text-xs text-gray-500 mb-2">
          Import a full versioned JSON backup (recommended), or legacy CSV rows as:
          Member, Skill 1, Skill 2.
        </p>
        <textarea
          value={bulkImport}
          onChange={e => setBulkImport(e.target.value)}
          placeholder={'{\n  "format": "skill-matrix-autosave",\n  "version": 1,\n  "exportedAt": "2026-01-01T00:00:00.000Z",\n  "data": { ... }\n}\n\nor\nRoss, TypeScript, Go\nSam, Python, SQL'}
          className="w-full h-32 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-300"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            onClick={submitImport}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-700 transition-colors"
          >
            Import data
          </button>
          <button
            onClick={handleExport}
            className="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition-colors"
          >
            Export data (v1)
          </button>
        </div>
        {ioMessage && (
          <p className={`mt-2 text-xs ${ioMessage.tone === 'ok' ? 'text-green-700' : 'text-red-600'}`}>
            {ioMessage.text}
          </p>
        )}
        <label className="mt-3 block text-xs text-gray-500">
          Or import from file (.json or .csv)
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json,.csv,text/csv"
            className="mt-1 block text-sm"
            onChange={async e => {
              const input = e.currentTarget
              const file = e.target.files?.[0]
              if (!file) return
              await importFromFile(file)
              input.value = ''
            }}
          />
        </label>
      </Section>

      <Section title="Danger zone">
        <button
          onClick={handleResetAll}
          disabled={!hasAnyData}
          className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 transition-colors disabled:bg-red-300 disabled:cursor-not-allowed"
        >
          Reset all members, skills, and projects
        </button>
        <p className="mt-2 text-xs text-gray-500">
          Clears all members, skills, projects, and saved skill levels.
        </p>
      </Section>
    </div>
  )
}

// ─── Shared UI helpers ────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-medium text-gray-700 mb-3">{title}</h2>
      {children}
    </section>
  )
}

function InputRow({ value, placeholder, onChange, onSubmit, label }: {
  value: string
  placeholder: string
  onChange: (v: string) => void
  onSubmit: () => void
  label: string
}) {
  return (
    <div className="flex gap-2 mb-3">
      <input
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && onSubmit()}
        className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
      />
      <button
        onClick={onSubmit}
        className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-700 transition-colors"
      >
        {label}
      </button>
    </div>
  )
}

function TagList({ items, onRemove, empty, counts }: {
  items: string[]
  onRemove: (item: string) => void
  empty: string
  counts?: Record<string, number>
}) {
  if (!items.length) return <p className="text-sm text-gray-400">{empty}</p>
  return (
    <div className="flex flex-wrap gap-2">
      {items.map(item => {
        const count = counts?.[item]
        return (
          <span
            key={item}
            className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full px-3 py-1 text-sm text-gray-700"
          >
            {item}
            {count !== undefined && (
              <span className="text-xs text-gray-500">· {count}</span>
            )}
            <button
              onClick={() => onRemove(item)}
              className="text-gray-400 hover:text-red-500 transition-colors leading-none"
            >
              ×
            </button>
          </span>
        )
      })}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-gray-400 py-4">{text}</p>
}