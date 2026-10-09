/**
 * Keyword-based topic categories for skills. Almost no skills declare a category in their
 * frontmatter, so we infer one: each keyword hit in the skill's name scores 5, in its
 * description 1, and the highest-scoring category wins (ties go to the earlier entry).
 */

export const CATEGORIES = [
  'Frontend & UI',
  'Mobile',
  'Backend & APIs',
  'Languages & Frameworks',
  'Testing & QA',
  'Code Review & Quality',
  'DevOps & Infrastructure',
  'Data & Databases',
  'AI & Agents',
  'Security & Compliance',
  'Marketing & Social',
  'Video & Media',
  'Docs & Writing',
  'Browser & Web Automation',
  'Planning & Workflow',
  'Business & Operations',
  'Other',
] as const

export type Category = (typeof CATEGORIES)[number]

// Each entry is a regex fragment matched at a word start; add `\b` for short words that
// would otherwise match inside longer ones (e.g. `ui\b`, `pr\b`).
const KEYWORDS: Record<Exclude<Category, 'Other'>, string[]> = {
  'Frontend & UI': [
    'frontend', 'front-end', 'ui\\b', 'ux\\b', 'react\\b', 'vue', 'angular', 'svelte', 'nuxt', 'next\\.?js', 'css', 'tailwind',
    'component', 'design system', 'landing page', 'hero', 'motion', 'animation', 'figma', 'html', 'web design', 'a11y',
    'accessib', 'typography', 'user interface', 'layout', 'taste', 'visual design', 'liquid glass', 'scroll',
  ],
  Mobile: ['(?<!cisco )ios\\b', 'android', 'swiftui', 'react native', 'mobile', 'app store', 'xcode', 'simulator', 'harmonyos', 'compose multiplatform'],
  'Backend & APIs': [
    'backend', 'back-end', 'api\\b', 'apis\\b', 'server', 'django', 'laravel', 'spring', 'fastapi', 'nestjs', 'express', 'rails',
    'quarkus', 'ktor', 'microservice', 'graphql', 'rest\\b', 'endpoint', 'webhook', 'hexagonal', 'celery',
    'sdk\\b', 'geospatial', 'geocod', 'maps?\\b', 'location',
  ],
  'Languages & Frameworks': [
    'python', 'golang', 'go (?:build|review|test|module)', 'rust', 'kotlin', 'swift\\b', 'java\\b', 'c\\+\\+', 'cpp', 'dart', 'flutter', 'typescript',
    'perl', 'php', 'c#', 'csharp', 'f#', 'fsharp', '\\.net', 'dotnet', 'bun\\b', 'gradle', 'jpa', 'coroutine', 'idiom',
  ],
  'Testing & QA': [
    'test', 'tdd\\b', 'qa\\b', 'e2e', 'playwright', 'coverage', 'verification', 'verify', 'regression', 'benchmark', 'canary', 'bug',
  ],
  'Code Review & Quality': [
    'review', 'refactor', 'lint', 'code quality', 'dead code', 'simplif', 'clean', 'coding standard', 'code health', 'debug',
    'investigat', 'build error', 'build fail', 'fix\\b',
  ],
  'DevOps & Infrastructure': [
    'deploy', 'docker', 'kubernetes', 'k8s', 'ci\\b', 'ci/cd', 'pipeline', 'infra', 'cloud', 'aws', 'terraform', 'ship\\b',
    'release', 'git\\b', 'github', 'pr\\b', 'pull request', 'monitor', 'homelab', 'network', 'cisco', 'router', 'vpn', 'dns', 'pm2', 'ssh',
  ],
  'Data & Databases': [
    'database', 'sql', 'postgres', 'mysql', 'redis', 'clickhouse', 'prisma', 'migration', 'data\\b', 'dataset', 'analytics', 'etl\\b',
    'dashboard', 'chart', 'visuali[sz]', 'forecast', 'spreadsheet', 'xlsx', 'pubmed', 'snowflake', 'bigquery',
    'databricks', 'warehouse',
  ],
  'AI & Agents': [
    'agent', 'llm', 'prompt', 'claude', 'mcp\\b', 'rag\\b', 'model', 'eval', 'harness', 'autonomous', 'loop', 'orchestrat',
    'subagent', 'pytorch', 'ml\\b', 'machine learning', 'inference', 'skill', 'hook', 'token', 'context window', 'memory',
  ],
  'Security & Compliance': [
    'security', 'secure', 'vulnerab', 'owasp', 'secret', 'auth', 'hipaa', 'compliance', 'pentest', 'cso\\b', 'phi\\b', 'security audit',
    'guard', 'safety', 'careful', 'destructive',
  ],
  'Marketing & Social': [
    'seo', 'marketing', 'yt\\b', 'ig\\b', 'li\\b', 'linkedin', 'twitter', 'x post', 'tweet', 'instagram', 'youtube', 'tiktok', 'social', 'campaign',
    'brand', 'outreach', 'lead', 'viral', 'ads?\\b', 'growth', 'audience', 'caption', 'carousel', 'reel', 'thread', 'post',
    'influencer', 'launch', 'brag', 'citation',
  ],
  'Video & Media': [
    'video', 'remotion', 'audio', 'image', 'media', 'hyperframes', 'render', 'motion graphic', 'podcast', 'stickman', 'manim',
    'shot', 'clip', 'caption', 'music', 'voice', 'subtitle', 'gif', 'icon', 'diagram', 'blender',
  ],
  'Docs & Writing': [
    'doc\\b', 'docs\\b', 'documentation', 'readme', 'writ', 'article', 'pdf', 'docx', 'pptx', 'slide', 'report', 'copy',
    'changelog', 'codemap', 'translat', 'summar', 'notes',
  ],
  'Browser & Web Automation': [
    'browser', 'chrome', 'scrap', 'crawl', 'web page', 'webpage', 'website', 'screenshot', 'cdp\\b', 'headless', 'click',
    'cookies', 'pinchtab', 'stealth',
  ],
  'Planning & Workflow': [
    'plan', 'brainstorm', 'spec\\b', 'prd\\b', 'workflow', 'session', 'checkpoint', 'todo', 'project', 'retro', 'roadmap',
    'decompos', 'epic', 'task', 'office hours', 'context', 'learn', 'onboard', 'feature',
  ],
  'Business & Operations': [
    'financ', 'billing', 'invoice', 'logistic', 'procurement', 'investor', 'sales', 'crm\\b', 'jira', 'email', 'customer',
    'legal', 'healthcare', 'inventory', 'trade', 'customs', 'pricing', 'money', 'payment', 'business', 'startup', 'founder',
    'visa', 'energy', 'carrier', 'scheduling', 'stripe', 'paypal', 'commerce', 'shopify',
  ],
}

const PATTERNS = Object.entries(KEYWORDS).map(([category, words]) => ({
  category: category as Category,
  re: new RegExp(`(?:^|[^a-z0-9])(?:${words.join('|')})`, 'gi'),
}))

function count(re: RegExp, text: string) {
  re.lastIndex = 0
  return text.match(re)?.length ?? 0
}

/** Map a frontmatter `category:` value (e.g. "frontend") onto one of ours, if it clearly fits. */
function fromDeclared(declared: string): Category | null {
  const d = declared.toLowerCase()
  const exact = CATEGORIES.find((c) => c.toLowerCase() === d)
  if (exact) return exact
  for (const { category, re } of PATTERNS) if (count(re, d) > 0) return category
  return null
}

export function categorize(name: string, description: string, declared?: string): Category {
  if (declared) {
    const hit = fromDeclared(declared)
    if (hit) return hit
  }
  // Plugin skills are named `plugin:skill`; the plugin prefix says little about the topic.
  const bare = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name
  const nameText = bare.replace(/[-_]/g, ' ')
  let best: Category = 'Other'
  let bestScore = 0
  for (const { category, re } of PATTERNS) {
    const score = count(re, nameText) * 5 + count(re, description)
    if (score > bestScore) {
      best = category
      bestScore = score
    }
  }
  return best
}

// Nearly every marketplace description mentions Claude/MCP/agents/skills, so in a plugin's
// description those words say nothing about its topic. Its name still counts in full.
const PLUGIN_BOILERPLATE =
  /\b(?:claude(?: code)?|anthropic|mcp(?: servers?)?|model context protocol|ai(?: agents?| assistants?| coding)?|agents?|agentic|skills?|plugins?|llms?|tools?)\b/gi

export function categorizePlugin(name: string, description: string, declared?: string): Category {
  return categorize(name, description.replace(PLUGIN_BOILERPLATE, ' '), declared)
}
