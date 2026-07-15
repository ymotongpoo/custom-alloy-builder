import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  artifactUrl,
  createBuild,
  getBuild,
  getComponents,
  getVersions,
  logsUrl,
  type BuildArtifact,
  type BuildStatus,
  type BuildTarget,
  type ComponentSummary,
  type VersionInfo,
} from '../api/client'

interface BinaryBuilderProps {
  currentConfigComponents: string[]
}

type Strategy = 'docker' | 'host'
type Output = 'binary' | 'image'

const dockerTargets: BuildTarget[] = [
  { os: 'linux', arch: 'amd64' },
  { os: 'linux', arch: 'arm64' },
]

export function BinaryBuilder({ currentConfigComponents }: BinaryBuilderProps) {
  const [probe, setProbe] = useState<'loading' | 'ok' | 'offline'>('loading')
  const [versions, setVersions] = useState<VersionInfo[]>([])
  const [version, setVersion] = useState('')
  const [components, setComponents] = useState<ComponentSummary[]>([])
  const [componentError, setComponentError] = useState<string | undefined>()
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [query, setQuery] = useState('')
  const [strategy, setStrategy] = useState<Strategy>('docker')
  const [output, setOutput] = useState<Output>('binary')
  const [targets, setTargets] = useState<ReadonlySet<string>>(new Set(['linux/amd64']))
  const [jobID, setJobID] = useState<string | undefined>()
  const [status, setStatus] = useState<BuildStatus | undefined>()
  const [buildError, setBuildError] = useState<string | undefined>()
  const [artifacts, setArtifacts] = useState<BuildArtifact[]>([])
  const [logs, setLogs] = useState<string[]>([])
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    getVersions()
      .then((response) => {
        setVersions(response.versions)
        setVersion((current) => current || response.versions[0]?.version || '')
        setProbe('ok')
      })
      .catch(() => setProbe('offline'))
  }, [])

  useEffect(() => {
    if (!version || probe !== 'ok') {
      return
    }
    setComponentError(undefined)
    getComponents(version)
      .then((response) => setComponents(response.components))
      .catch((error: unknown) => setComponentError(error instanceof Error ? error.message : String(error)))
  }, [probe, version])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [logs])

  useEffect(() => {
    if (strategy === 'host' && output === 'image') {
      setOutput('binary')
    }
  }, [output, strategy])

  useEffect(() => {
    if (!jobID) {
      return
    }
    const controller = new AbortController()
    void readLogStream(jobID, controller.signal, (line) => setLogs((current) => [...current, line]), refreshBuild)
    return () => controller.abort()
  }, [jobID])

  async function refreshBuild(id: string) {
    const snapshot = await getBuild(id)
    setStatus(snapshot.status)
    setBuildError(snapshot.error)
    setArtifacts(snapshot.artifacts ?? [])
  }

  const filteredGroups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const entries = components
      .map(describeComponent)
      .filter((entry) => entry.searchText.includes(needle))
    const groups = new Map<string, ComponentEntry[]>()
    for (const entry of entries) {
      groups.set(entry.group, [...(groups.get(entry.group) ?? []), entry])
    }
    return Array.from(groups.entries()).sort(
      ([left], [right]) => groupOrder(left) - groupOrder(right) || left.localeCompare(right),
    )
  }, [components, query])

  const selectedTargets = strategy === 'docker' ? Array.from(targets).map(parseTarget) : [hostTarget()]
  const canBuild =
    version !== '' && selected.size > 0 && selectedTargets.length > 0 && !(strategy === 'host' && output === 'image') && !isRunning(status)

  async function startBuild() {
    setBuildError(undefined)
    setArtifacts([])
    setLogs([])
    setStatus('queued')
    try {
      const response = await createBuild({
        version,
        components: Array.from(selected).sort(),
        targets: selectedTargets,
        output,
        strategy,
      })
      setJobID(response.id)
      await refreshBuild(response.id)
    } catch (error) {
      setStatus('error')
      setBuildError(error instanceof Error ? error.message : String(error))
    }
  }

  if (probe === 'loading') {
    return (
      <section className="binary-builder" aria-label="Binary Builder">
        <div className="builder-message">Checking local backend...</div>
      </section>
    )
  }

  if (probe === 'offline') {
    return (
      <section className="binary-builder" aria-label="Binary Builder">
        <div className="local-run-panel" role="status">
          <h2>Local backend required</h2>
          <p>Binary builds run on your machine through the Go backend and Docker or the host toolchain.</p>
          <pre>{'make frontend-build && make backend-build\n./backend/bin/custom-alloy-builder'}</pre>
          <pre>{'go run ./backend/cmd/custom-alloy-builder'}</pre>
        </div>
      </section>
    )
  }

  return (
    <section className="binary-builder" aria-label="Binary Builder">
      <div className="binary-controls">
        <div className="control-row">
          <label className="form-field compact-field">
            <span>Version</span>
            <select value={version} onChange={(event) => setVersion(event.currentTarget.value)}>
              {versions.map((info) => (
                <option key={info.version} value={info.version}>
                  {info.version}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => selectCurrentConfig(components, currentConfigComponents, setSelected)}>
            Select from current config
          </button>
          <div className="selected-count">{selected.size} selected</div>
        </div>

        <div className="strategy-panel">
          <fieldset>
            <legend>Strategy</legend>
            <label>
              <input
                type="radio"
                name="strategy"
                checked={strategy === 'docker'}
                onChange={() => setStrategy('docker')}
              />
              Docker
            </label>
            <label>
              <input type="radio" name="strategy" checked={strategy === 'host'} onChange={() => setStrategy('host')} />
              Host
            </label>
          </fieldset>
          <fieldset>
            <legend>Output</legend>
            <label>
              <input
                type="radio"
                name="output"
                checked={output === 'binary'}
                onChange={() => setOutput('binary')}
              />
              Binary
            </label>
            <label>
              <input
                type="radio"
                name="output"
                checked={output === 'image'}
                disabled={strategy === 'host'}
                onChange={() => setOutput('image')}
              />
              Image
            </label>
          </fieldset>
          <fieldset>
            <legend>Targets</legend>
            {strategy === 'docker' ? (
              dockerTargets.map((target) => {
                const key = targetKey(target)
                return (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={targets.has(key)}
                      onChange={() => toggleTarget(key, setTargets)}
                    />
                    {key}
                  </label>
                )
              })
            ) : (
              <label>
                <input type="checkbox" checked readOnly />
                This machine ({targetKey(hostTarget())})
              </label>
            )}
          </fieldset>
          <button type="button" className="primary-action" disabled={!canBuild} onClick={() => void startBuild()}>
            Build
          </button>
        </div>
      </div>

      <div className="component-browser">
        <input
          aria-label="Search build components"
          placeholder="Search components"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        {componentError ? <div role="alert">{componentError}</div> : null}
        <div className="component-groups">
          {filteredGroups.map(([group, entries]) => (
            <section key={group} className="component-group" aria-label={`${group} components`}>
              <h2>{group}</h2>
              {entries.map((entry) => (
                <label key={entry.component.name} className="component-check">
                  <input
                    type="checkbox"
                    checked={selected.has(entry.component.name)}
                    onChange={() => toggleSelected(entry.component.name, setSelected)}
                  />
                  <span className="component-name">
                    {entry.title}
                    {entry.subtitle ? <span className="component-alias">{entry.subtitle}</span> : null}
                  </span>
                  <small>{entry.component.stability}</small>
                </label>
              ))}
            </section>
          ))}
        </div>
      </div>

      <aside className="build-output" aria-label="Build output">
        <div className="status-line">
          <span>Status</span>
          <strong>{status ?? 'idle'}</strong>
        </div>
        {buildError ? <div role="alert">{buildError}</div> : null}
        <pre ref={logRef} className="log-view" aria-label="Build logs">
          {logs.join('\n')}
        </pre>
        {artifacts.length > 0 ? (
          <div className="artifact-list">
            <h2>Artifacts</h2>
            {artifacts.map((artifact) => (
              <ArtifactItem key={artifact.name} jobID={jobID ?? ''} artifact={artifact} />
            ))}
          </div>
        ) : null}
      </aside>
    </section>
  )
}

function ArtifactItem({ jobID, artifact }: { jobID: string; artifact: BuildArtifact }) {
  if (artifact.kind === 'image') {
    return (
      <div className="image-artifact">
        <span>{artifact.name}</span>
        <code>docker run --rm {artifact.name} --version</code>
      </div>
    )
  }
  return (
    <a href={artifactUrl(jobID, artifact.name)} download>
      {artifact.name} ({formatBytes(artifact.size)})
    </a>
  )
}

interface ComponentEntry {
  component: ComponentSummary
  group: string
  title: string
  subtitle?: string
  searchText: string
}

const otelKindGroups: Record<string, string> = {
  receiver: 'OpenTelemetry Collector / Receivers',
  processor: 'OpenTelemetry Collector / Processors',
  exporter: 'OpenTelemetry Collector / Exporters',
  connector: 'OpenTelemetry Collector / Connectors',
  auth: 'OpenTelemetry Collector / Extensions (auth)',
  extension: 'OpenTelemetry Collector / Extensions',
  storage: 'OpenTelemetry Collector / Extensions (storage)',
}

const groupRanks = [
  'OpenTelemetry Collector / Receivers',
  'OpenTelemetry Collector / Processors',
  'OpenTelemetry Collector / Exporters',
  'OpenTelemetry Collector / Connectors',
  'OpenTelemetry Collector / Extensions',
  'OpenTelemetry Collector / Extensions (auth)',
  'OpenTelemetry Collector / Extensions (storage)',
]

function describeComponent(component: ComponentSummary): ComponentEntry {
  const [family, kind, ...rest] = component.name.split('.')
  const otelGroup = family === 'otelcol' && kind ? otelKindGroups[kind] : undefined
  if (otelGroup && rest.length > 0) {
    const title = rest.join('.')
    return {
      component,
      group: otelGroup,
      title,
      subtitle: component.name,
      searchText: `${title} ${component.name} ${otelGroup}`.toLowerCase(),
    }
  }
  return {
    component,
    group: `Alloy / ${family || component.name}`,
    title: component.name,
    searchText: component.name.toLowerCase(),
  }
}

function groupOrder(group: string): number {
  const rank = groupRanks.indexOf(group)
  return rank === -1 ? groupRanks.length : rank
}

function toggleSelected(name: string, setSelected: Dispatch<SetStateAction<ReadonlySet<string>>>): void {
  setSelected((current) => {
    const next = new Set(current)
    if (next.has(name)) {
      next.delete(name)
    } else {
      next.add(name)
    }
    return next
  })
}

function toggleTarget(key: string, setTargets: Dispatch<SetStateAction<ReadonlySet<string>>>): void {
  setTargets((current) => {
    const next = new Set(current)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    return next
  })
}

function selectCurrentConfig(
  components: ComponentSummary[],
  currentConfigComponents: string[],
  setSelected: Dispatch<SetStateAction<ReadonlySet<string>>>,
): void {
  const available = new Set(components.map((component) => component.name))
  setSelected(new Set(currentConfigComponents.filter((name) => available.has(name))))
}

function parseTarget(value: string): BuildTarget {
  const [os, arch] = value.split('/')
  return { os: os ?? '', arch: arch ?? '' }
}

function targetKey(target: BuildTarget): string {
  return `${target.os}/${target.arch}`
}

function hostTarget(): BuildTarget {
  const platform = navigator.platform.toLowerCase()
  const os = platform.includes('mac') ? 'darwin' : platform.includes('win') ? 'windows' : 'linux'
  const arch = platform.includes('arm') || platform.includes('aarch') ? 'arm64' : 'amd64'
  return { os, arch }
}

function isRunning(status: BuildStatus | undefined): boolean {
  return status === 'queued' || status === 'cloning' || status === 'generating' || status === 'building'
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KiB`
  }
  return `${(size / 1024 / 1024).toFixed(1)} MiB`
}

async function readLogStream(
  jobID: string,
  signal: AbortSignal,
  onLog: (line: string) => void,
  onDone: (id: string) => Promise<void>,
): Promise<void> {
  try {
    const response = await fetch(logsUrl(jobID), { signal })
    if (!response.ok || !response.body) {
      await onDone(jobID)
      return
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split('\n\n')
      buffer = events.pop() ?? ''
      for (const eventText of events) {
        const event = parseSSE(eventText)
        if (event.event === 'log' && event.data) {
          onLog(event.data)
        }
        if (event.event === 'done') {
          await onDone(jobID)
        }
      }
    }
    if (!signal.aborted) {
      await onDone(jobID)
    }
  } catch {
    if (!signal.aborted) {
      await onDone(jobID)
    }
  }
}

function parseSSE(eventText: string): { event: string; data: string } {
  let event = 'message'
  const data: string[] = []
  for (const line of eventText.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim()
    }
    if (line.startsWith('data:')) {
      data.push(line.slice('data:'.length).trimStart())
    }
  }
  return { event, data: data.join('\n') }
}
