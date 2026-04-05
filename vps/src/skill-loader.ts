import { readdirSync, watch } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { Skill, ToolDef } from './skills/types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SKILLS_DIR = join(__dirname, 'skills')

export interface SkillRegistry {
  skills: Skill[]
  allTools: ToolDef[]
  toolToSkill: Map<string, Skill>
}

/** Current registry — replaced atomically on reload */
let registry: SkillRegistry = { skills: [], allTools: [], toolToSkill: new Map() }

/** Build registry from an array of skills */
function buildRegistry(skills: Skill[]): SkillRegistry {
  const allTools = skills.flatMap((s) => s.tools)
  const toolToSkill = new Map<string, Skill>()
  for (const skill of skills) {
    for (const tool of skill.tools) {
      toolToSkill.set(tool.function.name, skill)
    }
  }
  return { skills, allTools, toolToSkill }
}

/** Scan skills/ directory and dynamically import all skill modules */
async function scanAndLoad(): Promise<SkillRegistry> {
  const files = readdirSync(SKILLS_DIR).filter(
    (f) => f.endsWith('.ts') && f !== 'types.ts'
  )

  const skills: Skill[] = []
  const now = Date.now()

  for (const file of files) {
    try {
      const mod = await import(`./skills/${file}?v=${now}`)
      const skill: Skill = mod.default
      if (skill?.name && Array.isArray(skill.tools) && typeof skill.execute === 'function') {
        skills.push(skill)
      } else {
        console.warn(`[skill-loader] ${file}: invalid skill (missing name/tools/execute)`)
      }
    } catch (err) {
      console.error(`[skill-loader] Failed to load ${file}:`, (err as Error).message)
    }
  }

  return buildRegistry(skills)
}

/** Debounce timer for fs.watch events (which fire multiple times per write) */
let reloadTimer: ReturnType<typeof setTimeout> | null = null

/** Initialize: load all skills once + start watching for changes */
export async function initSkills(): Promise<void> {
  registry = await scanAndLoad()
  console.log(`🧩 Loaded ${registry.skills.length} skills: ${registry.skills.map((s) => s.name).join(', ')}`)

  watch(SKILLS_DIR, (event, filename) => {
    if (!filename?.endsWith('.ts') || filename === 'types.ts') return

    // Debounce: wait 500ms after last event before reloading
    if (reloadTimer) clearTimeout(reloadTimer)
    reloadTimer = setTimeout(async () => {
      reloadTimer = null
      try {
        const next = await scanAndLoad()
        registry = next
        console.log(`🔄 Skills hot-reloaded (${event} ${filename}): ${next.skills.map((s) => s.name).join(', ')}`)
      } catch (err) {
        console.error(`[skill-loader] Hot-reload failed:`, (err as Error).message)
      }
    }, 500)
  })
}

/** Get current skill registry (always returns the latest loaded version) */
export function getSkills(): SkillRegistry {
  return registry
}
