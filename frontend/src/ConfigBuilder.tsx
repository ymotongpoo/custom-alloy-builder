import {
  Background,
  Controls,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type FinalConnectionState,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IRBody, IRComponent, IRConfig } from './ir/types'
import { serialize } from './river/serialize'
import { SchemaForm } from './forms/SchemaForm'
import { inputEndpoints, outputEndpoints } from './schema/capsules'
import { loadComponentSchema, loadSchemaIndex } from './schema/loader'
import type { ComponentSchema, SchemaIndex, SchemaIndexComponent } from './schema/types'
import {
  addConnectionRef,
  describeInvalidConnection,
  emptyConfig,
  isConnectionAllowed,
  makeComponent,
  nextLabel,
  removeComponent,
  removeConnectionRef,
  starterSample,
  toFlowEdges,
  toFlowNodes,
} from './graph/irGraph'
import { BuilderNode } from './graph/BuilderNode'
import { ConnectionLine } from './graph/ConnectionLine'
import type { BuilderDocument, LayoutMap, SchemaRegistry } from './graph/types'

const nodeTypes = { builder: BuilderNode }

interface ConfigBuilderProps {
  onComponentsChange?: (components: string[]) => void
}

export function ConfigBuilder({ onComponentsChange }: ConfigBuilderProps) {
  return (
    <ReactFlowProvider>
      <ConfigBuilderInner onComponentsChange={onComponentsChange} />
    </ReactFlowProvider>
  )
}

function ConfigBuilderInner({ onComponentsChange }: ConfigBuilderProps) {
  const [schemaIndex, setSchemaIndex] = useState<SchemaIndex | undefined>()
  const [schemaError, setSchemaError] = useState<string | undefined>()
  const [schemas, setSchemas] = useState<Record<string, ComponentSchema>>({})
  const [config, setConfig] = useState<IRConfig>(() => emptyConfig())
  const [layout, setLayout] = useState<LayoutMap>({})
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [selectedNodeIds, setSelectedNodeIds] = useState<ReadonlySet<string>>(new Set())
  const [pendingSource, setPendingSource] = useState<{ componentId: string; handle: string } | undefined>()
  const [connectionAlert, setConnectionAlert] = useState<string | undefined>()
  const [query, setQuery] = useState('')
  const [exportText, setExportText] = useState<string | undefined>()
  const fileInput = useRef<HTMLInputElement>(null)
  const starterState = useRef<'pending' | 'applied' | 'suppressed'>('pending')
  const flow = useReactFlow()

  useEffect(() => {
    loadSchemaIndex()
      .then(setSchemaIndex)
      .catch((error: unknown) => setSchemaError(error instanceof Error ? error.message : String(error)))
  }, [])

  useEffect(() => {
    onComponentsChange?.(Array.from(new Set(config.components.map((component) => component.type))).sort())
  }, [config.components, onComponentsChange])

  const registry = useMemo(() => buildRegistry(schemas), [schemas])
  const onSourceEndpoint = useCallback((componentId: string, handle: string) => {
    setPendingSource({ componentId, handle })
  }, [])
  const onTargetEndpoint = useCallback(
    (componentId: string, handle: string) => {
      if (!pendingSource) {
        return
      }
      setConfig((current) => addConnectionRef(current, registry, pendingSource.componentId, pendingSource.handle, componentId, handle))
      setPendingSource(undefined)
    },
    [pendingSource, registry],
  )
  const nodes = useMemo(
    () =>
      toFlowNodes(config, layout, registry).map((node) => ({
        ...node,
        selected: selectedNodeIds.has(node.id),
        data: {
          ...node.data,
          pendingSourceHandle: pendingSource?.componentId === node.id ? pendingSource.handle : undefined,
          onSourceEndpoint,
          onTargetEndpoint,
        },
      })),
    [config, layout, onSourceEndpoint, onTargetEndpoint, pendingSource, registry, selectedNodeIds],
  )
  const edges = useMemo(() => toFlowEdges(config, registry), [config, registry])
  const selected = config.components.find((component) => component.id === selectedId)
  const selectedSchema = selected ? schemas[selected.type] : undefined
  const issues = useMemo(() => collectIssues(config, schemas), [config, schemas])

  useEffect(() => {
    const starterTypes = ['discovery.kubernetes', 'prometheus.scrape', 'prometheus.remote_write']
    if (!schemaIndex || starterState.current !== 'pending' || config.components.length > 0) {
      return
    }
    void Promise.all(starterTypes.map((type) => loadAndStoreSchema(type, setSchemas)))
      .then((starterSchemas) => {
        if (starterState.current !== 'pending') {
          return
        }
        const registryWithStarter = buildRegistry(Object.fromEntries(starterSchemas.map((schema) => [schema.name, schema])))
        const sample = starterSample(registryWithStarter)
        setConfig(sample.config)
        setLayout(sample.layout)
        setSelectedId(sample.config.components[0]?.id)
        starterState.current = 'applied'
        window.setTimeout(() => flow.fitView({ padding: 0.2, duration: 200 }), 0)
      })
      .catch((error: unknown) => setSchemaError(error instanceof Error ? error.message : String(error)))
  }, [config.components.length, flow, schemaIndex])

  const addComponent = useCallback(
    async (summary: SchemaIndexComponent, position?: { x: number; y: number }) => {
      starterState.current = 'suppressed'
      const schema = await loadAndStoreSchema(summary.name, setSchemas)
      const component = makeComponent(schema, nextLabel(config, schema.name))
      const index = config.components.length
      setConfig((current) => ({ ...current, components: [...current.components, component] }))
      setLayout((current) => ({
        ...current,
        [component.id]: position ?? { x: 60 + (index % 3) * 220, y: 120 + Math.floor(index / 3) * 220 },
      }))
      setSelectedId(component.id)
      window.setTimeout(() => flow.fitView({ padding: 0.2, duration: 200 }), 0)
    },
    [config, flow],
  )

  const onCanvasDrop = useCallback(
    (event: React.DragEvent) => {
      const name = event.dataTransfer.getData('application/x-alloy-component')
      const summary = schemaIndex?.components.find((component) => component.name === name)
      if (!summary) {
        return
      }
      event.preventDefault()
      starterState.current = 'suppressed'
      const position = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      void addComponent(summary, position)
    },
    [addComponent, flow, schemaIndex],
  )

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const removedIds = changes.filter((change) => change.type === 'remove').map((change) => change.id)
      if (removedIds.length > 0) {
        starterState.current = 'suppressed'
        setConfig((current) => removedIds.reduce((next, id) => removeComponent(next, id), current))
        setSelectedId((current) => (current && removedIds.includes(current) ? undefined : current))
      }
      const selectionChanges = changes.filter((change) => change.type === 'select')
      if (selectionChanges.length > 0 || removedIds.length > 0) {
        setSelectedNodeIds((current) => {
          const next = new Set(current)
          for (const id of removedIds) {
            next.delete(id)
          }
          for (const change of selectionChanges) {
            if (change.type === 'select' && change.selected) {
              next.add(change.id)
            } else if (change.type === 'select') {
              next.delete(change.id)
            }
          }
          return next
        })
      }
      const positionChanges = changes.filter(isPositionChangeWithPosition)
      if (positionChanges.length > 0) {
        starterState.current = 'suppressed'
        setLayout((current) => ({
          ...current,
          ...Object.fromEntries(positionChanges.map((change) => [change.id, change.position])),
        }))
      }
    },
    [],
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) {
        return
      }
      setConnectionAlert(undefined)
      starterState.current = 'suppressed'
      setConfig((current) =>
        addConnectionRef(current, registry, connection.source, connection.sourceHandle!, connection.target, connection.targetHandle!),
      )
    },
    [registry],
  )

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      if (connectionState.isValid === true) {
        return
      }
      const domTarget = endpointFromEvent(event)
      const targetNodeId = connectionState.toNode?.id ?? domTarget?.nodeId
      const targetHandleId = connectionState.toHandle?.id ?? domTarget?.handleId
      if (!connectionState.fromNode || !connectionState.fromHandle?.id || !targetNodeId || !targetHandleId) {
        return
      }
      const message = describeInvalidConnection(
        config,
        registry,
        connectionState.fromNode.id,
        connectionState.fromHandle.id,
        targetNodeId,
        targetHandleId,
      )
      if (message) {
        setConnectionAlert(message)
      }
    },
    [config, registry],
  )

  useEffect(() => {
    if (!connectionAlert) {
      return
    }
    const timeout = window.setTimeout(() => setConnectionAlert(undefined), 4000)
    return () => window.clearTimeout(timeout)
  }, [connectionAlert])

  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    if (deleted.length > 0) {
      starterState.current = 'suppressed'
    }
    setConfig((current) => deleted.reduce((next, edge) => removeConnectionRef(next, edge), current))
  }, [])

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      const source = config.components.find((component) => component.id === connection.source)
      const target = config.components.find((component) => component.id === connection.target)
      return Boolean(
        source &&
          target &&
          isConnectionAllowed(registry, source.type, connection.sourceHandle, target.type, connection.targetHandle),
      )
    },
    [config.components, registry],
  )

  const updateSelectedBody = useCallback(
    (body: IRBody) => {
      if (!selected) {
        return
      }
      starterState.current = 'suppressed'
      setConfig((current) => ({
        ...current,
        components: current.components.map((component) =>
          component.id === selected.id ? { ...component, body } : component,
        ),
      }))
    },
    [selected],
  )

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (schemaIndex?.components ?? []).filter((component) => component.name.toLowerCase().includes(needle))
  }, [query, schemaIndex])

  async function loadDocument(file: File) {
    starterState.current = 'suppressed'
    const text = await file.text()
    const document = JSON.parse(text) as BuilderDocument
    if (document.formatVersion !== 1) {
      throw new Error('Unsupported builder document format.')
    }
    const types = Array.from(new Set(document.ir.components.map((component) => component.type)))
    await Promise.all(types.map((type) => loadAndStoreSchema(type, setSchemas)))
    setConfig(document.ir)
    setLayout(document.layout)
    setSelectedId(document.ir.components[0]?.id)
    window.setTimeout(() => flow.fitView(), 0)
  }

  function clearCanvas() {
    if (!window.confirm('Clear the canvas?')) {
      return
    }
    starterState.current = 'suppressed'
    setConfig(emptyConfig())
    setLayout({})
    setSelectedId(undefined)
    setSelectedNodeIds(new Set())
    setPendingSource(undefined)
    setConnectionAlert(undefined)
    setExportText(undefined)
  }

  return (
    <section className="builder-shell" aria-label="Config Builder">
      <aside className="palette" aria-label="Component palette">
        <input
          aria-label="Search components"
          placeholder="Search components"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        {schemaError ? <div role="alert">{schemaError}</div> : null}
        <p className="palette-hint">Click a component, or drag it onto the canvas, to add it. Drag handles to connect.</p>
        <div className="palette-list">
          {filtered.map((component) => (
            <button
              key={component.name}
              type="button"
              draggable
              title={`Add ${component.name} to the canvas`}
              onDragStart={(event) => event.dataTransfer.setData('application/x-alloy-component', component.name)}
              onClick={() => void addComponent(component)}
            >
              <span>
                <span className="palette-add" aria-hidden="true">
                  +
                </span>
                {component.name}
              </span>
              <small>{component.stability}</small>
            </button>
          ))}
        </div>
      </aside>
      <div className="graph-panel">
        <div className="builder-toolbar">
          <button type="button" onClick={() => setExportText(serialize(config, schemas))}>
            Export
          </button>
          <button
            type="button"
            className={issues.length > 0 ? 'issues-button has-issues' : 'issues-button'}
            onClick={() => {
              const firstIssue = issues[0]
              if (firstIssue) {
                setSelectedId(firstIssue.componentId)
                setSelectedNodeIds(new Set([firstIssue.componentId]))
              }
            }}
          >
            {issues.length} issues
          </button>
          <button type="button" onClick={() => downloadJson('custom-alloy-builder.json', { formatVersion: 1, ir: config, layout })}>
            Save
          </button>
          <button type="button" onClick={() => fileInput.current?.click()}>
            Load
          </button>
          <button type="button" onClick={clearCanvas}>
            Clear
          </button>
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              if (file) {
                void loadDocument(file)
              }
              event.currentTarget.value = ''
            }}
          />
        </div>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          onEdgesDelete={onEdgesDelete}
          isValidConnection={isValidConnection}
          connectionLineComponent={ConnectionLine}
          connectionRadius={24}
          deleteKeyCode={['Backspace', 'Delete']}
          onNodeClick={(_, node) => setSelectedId(node.id)}
          onDragOver={(event) => {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
          }}
          onDrop={onCanvasDrop}
          fitView
        >
          <Background />
          <Controls />
          {config.components.length === 0 ? (
            <Panel position="top-center" className="canvas-empty-hint">
              The canvas is empty. Click a component in the left palette, or drag one here, to add it.
            </Panel>
          ) : null}
          {connectionAlert ? (
            <Panel position="top-center" className="connection-alert" role="alert">
              <span>{connectionAlert}</span>
              <button type="button" aria-label="Dismiss connection warning" onClick={() => setConnectionAlert(undefined)}>
                x
              </button>
            </Panel>
          ) : null}
        </ReactFlow>
      </div>
      <aside className="inspector" aria-label="Selected component">
        {selected && selectedSchema ? (
          <>
            <div className="inspector-header">
              <h2>{selected.type}</h2>
              <a href={referenceUrl(selected.type)} target="_blank" rel="noreferrer">
                Reference
              </a>
            </div>
            <label className="form-field">
              <span>label</span>
              <input
                value={selected.label}
                onChange={(event) => {
                  starterState.current = 'suppressed'
                  updateSelectedLabel(selected, event.currentTarget.value, setConfig)
                }}
              />
            </label>
            <SchemaForm schema={selectedSchema} body={selected.body} onChange={updateSelectedBody} />
            <button
              type="button"
              className="remove-component"
              onClick={() => {
                starterState.current = 'suppressed'
                setConfig((current) => removeComponent(current, selected.id))
                setSelectedNodeIds((current) => {
                  const next = new Set(current)
                  next.delete(selected.id)
                  return next
                })
                setSelectedId(undefined)
              }}
            >
              Remove component
            </button>
          </>
        ) : (
          <div>Select a component to edit its arguments.</div>
        )}
      </aside>
      {exportText !== undefined ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Exported config">
          <div className="export-modal">
            <div className="modal-header">
              <h2>Exported config</h2>
              <button type="button" onClick={() => setExportText(undefined)}>
                Close
              </button>
            </div>
            <textarea readOnly value={exportText} rows={18} aria-label="Exported config text" />
            <div className="modal-actions">
              <button type="button" onClick={() => void navigator.clipboard.writeText(exportText)}>
                Copy
              </button>
              <button type="button" onClick={() => downloadText('config.alloy', exportText)}>
                Download config.alloy
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

async function loadAndStoreSchema(
  name: string,
  setSchemas: React.Dispatch<React.SetStateAction<Record<string, ComponentSchema>>>,
): Promise<ComponentSchema> {
  const schema = await loadComponentSchema(name)
  setSchemas((current) => (current[name] ? current : { ...current, [name]: schema }))
  return schema
}

interface ConfigIssue {
  componentId: string
}

function collectIssues(config: IRConfig, schemas: Record<string, ComponentSchema>): ConfigIssue[] {
  return config.components.flatMap((component) => {
    const schema = schemas[component.type]
    return schema ? collectBodyIssues(component.id, schema.arguments, component.body) : []
  })
}

function collectBodyIssues(componentId: string, schemaBody: ComponentSchema['arguments'], body: IRBody): ConfigIssue[] {
  const issues: ConfigIssue[] = []
  for (const attribute of schemaBody.attributes ?? []) {
    if (attribute.required && !body.attrs[attribute.name]) {
      issues.push({ componentId })
    }
  }
  for (const block of schemaBody.blocks ?? []) {
    const instances = body.blocks.filter((instance) => instance.name === block.name)
    if (block.required && instances.length === 0) {
      issues.push({ componentId })
    }
    for (const instance of instances) {
      issues.push(...collectBodyIssues(componentId, block.body, instance.body))
    }
  }
  return issues
}

function referenceUrl(componentType: string): string {
  const family = componentType.split('.')[0] ?? componentType
  return `https://grafana.com/docs/alloy/latest/reference/components/${family}/${componentType}/`
}

function buildRegistry(schemas: Record<string, ComponentSchema>): SchemaRegistry {
  return Object.fromEntries(
    Object.values(schemas).map((schema) => [
      schema.name,
      {
        outputs: Object.fromEntries(outputEndpoints(schema).map((endpoint) => [endpoint.name, endpoint.capsule])),
        inputs: Object.fromEntries(
          inputEndpoints(schema).map((endpoint) => [
            endpoint.path.join('.'),
            { capsule: endpoint.capsule, path: endpoint.path, multiple: endpoint.multiple },
          ]),
        ),
      },
    ]),
  )
}

function updateSelectedLabel(
  selected: IRComponent,
  label: string,
  setConfig: React.Dispatch<React.SetStateAction<IRConfig>>,
): void {
  setConfig((current) => ({
    ...current,
    components: current.components.map((component) => (component.id === selected.id ? { ...component, label } : component)),
  }))
}

function isPositionChangeWithPosition(
  change: NodeChange,
): change is Extract<NodeChange, { type: 'position' }> & { position: { x: number; y: number } } {
  return change.type === 'position' && Boolean(change.position)
}

function endpointFromEvent(event: MouseEvent | TouchEvent): { nodeId: string; handleId: string } | undefined {
  const targetHandle = event.target instanceof Element ? event.target.closest('.react-flow__handle') : null
  const pointTarget = 'clientX' in event ? document.elementFromPoint(event.clientX, event.clientY) : null
  const handle = targetHandle ?? pointTarget?.closest('.react-flow__handle')
  const nodeId = handle?.getAttribute('data-nodeid')
  const handleId = handle?.getAttribute('data-handleid')
  return nodeId && handleId ? { nodeId, handleId } : undefined
}

function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  downloadUrl(filename, url)
}

function downloadJson(filename: string, value: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  downloadUrl(filename, url)
}

function downloadUrl(filename: string, url: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
