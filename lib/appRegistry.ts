export type AppDefinition = {
  id: string
  title: string
  description: string
  source: string
}

type AppSourceMode = "github" | "local"

const GITHUB_OWNER = process.env.NEXT_PUBLIC_GITHUB_OWNER ?? "zeropoet"
const SOURCE_MODE: AppSourceMode = (process.env.NEXT_PUBLIC_APP_SOURCE_MODE as AppSourceMode) ?? "github"

function resolveSource(repo: string, localFallback: string, localOverride?: string) {
  const localSource = localOverride ?? localFallback
  const githubSource = `https://${GITHUB_OWNER}.github.io/${repo}/`
  return SOURCE_MODE === "local" ? localSource : githubSource
}

const ASTRAEA_SOURCE = resolveSource(
  "astraea-grid",
  "http://localhost:3101",
  process.env.NEXT_PUBLIC_ASTRAEA_URL
)
const OVEL_SOURCE = resolveSource("ovel-core", "http://localhost:3102", process.env.NEXT_PUBLIC_OVEL_URL)
const HELIOS_SOURCE = resolveSource(
  "helios-lattice",
  "http://localhost:3103",
  process.env.NEXT_PUBLIC_HELIOS_LATTICE_URL
)
const OVEL_FIELD_SOURCE = resolveSource(
  "ovel-field",
  "http://localhost:3104",
  process.env.NEXT_PUBLIC_OVEL_FIELD_URL
)

export const APP_REGISTRY: AppDefinition[] = [
  {
    id: "astraea-grid",
    title: "Astraea Grid",
    description: "Framed app",
    source: ASTRAEA_SOURCE
  },
  {
    id: "ovel-core",
    title: "Ovel Core",
    description: "Framed app",
    source: OVEL_SOURCE
  },
  {
    id: "helios-lattice",
    title: "Helios Lattice",
    description: "Framed app",
    source: HELIOS_SOURCE
  },
  {
    id: "ovel-field",
    title: "Ovel Field",
    description: "Framed app",
    source: OVEL_FIELD_SOURCE
  }
]
