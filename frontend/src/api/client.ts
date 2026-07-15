export interface VersionInfo {
  version: string
  goVersion: string
  buildImageTag: string
}

export interface VersionsResponse {
  versions: VersionInfo[]
}

export interface ComponentSummary {
  name: string
  stability: string
  community: boolean
  importPath: string
  inputs?: string[]
  outputs?: string[]
}

export interface ComponentsResponse {
  version: string
  components: ComponentSummary[]
}

export interface BuildTarget {
  os: string
  arch: string
}

export interface CreateBuildRequest {
  version: string
  components: string[]
  targets: BuildTarget[]
  output: 'binary' | 'image'
  strategy: 'docker' | 'host'
}

export interface CreateBuildResponse {
  id: string
}

export type BuildStatus = 'queued' | 'cloning' | 'generating' | 'building' | 'done' | 'error'

export interface BuildArtifact {
  name: string
  size: number
  kind?: 'binary' | 'image' | 'oci'
}

export interface BuildSnapshot {
  id: string
  status: BuildStatus
  error?: string
  artifacts: BuildArtifact[]
}

const apiBase = '/api/v1'

export async function getVersions(): Promise<VersionsResponse> {
  return getJSON<VersionsResponse>('/versions')
}

export async function getComponents(version: string): Promise<ComponentsResponse> {
  return getJSON<ComponentsResponse>(`/versions/${encodeURIComponent(version)}/components`)
}

export async function createBuild(request: CreateBuildRequest): Promise<CreateBuildResponse> {
  const response = await fetch(`${apiBase}/builds`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!response.ok) {
    throw new Error(await errorMessage(response))
  }
  return (await response.json()) as CreateBuildResponse
}

export async function getBuild(id: string): Promise<BuildSnapshot> {
  return getJSON<BuildSnapshot>(`/builds/${encodeURIComponent(id)}`)
}

export function logsUrl(id: string): string {
  return `${apiBase}/builds/${encodeURIComponent(id)}/logs`
}

export function artifactUrl(id: string, name: string): string {
  return `${apiBase}/builds/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(name)}`
}

async function getJSON<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBase}${path}`)
  if (!response.ok) {
    throw new Error(await errorMessage(response))
  }
  return (await response.json()) as T
}

async function errorMessage(response: Response): Promise<string> {
  const text = await response.text()
  return text.trim() || `Request failed with ${response.status}`
}
