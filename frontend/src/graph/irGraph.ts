import type { Edge, Node } from '@xyflow/react'
import type { IRBlockInstance, IRBody, IRComponent, IRConfig, IRValue } from '../ir/types'
import type { ComponentSchema, SchemaBody } from '../schema/types'
import { canConnect } from '../schema/capsules'
import type { LayoutMap, SchemaRegistry } from './types'

export interface BuilderNodeData extends Record<string, unknown> {
  component: IRComponent
  registry?: SchemaRegistry[string]
  pendingSourceHandle?: string
  onSourceEndpoint?: (componentId: string, handle: string) => void
  onTargetEndpoint?: (componentId: string, handle: string) => void
}

export function emptyConfig(alloyVersion = 'v1.17.1'): IRConfig {
  return { formatVersion: 1, alloyVersion, components: [], rawSnippets: [] }
}

export function makeComponent(schema: ComponentSchema, label: string): IRComponent {
  return {
    id: `${schema.name}-${crypto.randomUUID()}`,
    type: schema.name,
    label,
    body: makeInitialBody(schema.arguments),
  }
}

export function nextLabel(config: IRConfig, componentType: string): string {
  const labels = new Set(
    config.components.filter((component) => component.type === componentType).map((component) => component.label),
  )
  if (!labels.has('default')) {
    return 'default'
  }
  for (let index = 2; ; index += 1) {
    const candidate = `default_${index}`
    if (!labels.has(candidate)) {
      return candidate
    }
  }
}

export function makeInitialBody(schemaBody: SchemaBody): IRBody {
  return {
    attrs: {},
    blocks: (schemaBody.blocks ?? [])
      .filter((block) => block.required)
      .map((block) => ({ name: block.name, body: makeInitialBody(block.body) })),
  }
}

export function toFlowNodes(config: IRConfig, layout: LayoutMap, registry: SchemaRegistry): Node<BuilderNodeData>[] {
  return config.components.map((component, index) => ({
    id: component.id,
    type: 'builder',
    position: layout[component.id] ?? { x: 220 + index * 40, y: 120 + index * 60 },
    width: 230,
    height: 130,
    initialWidth: 230,
    initialHeight: 130,
    measured: { width: 230, height: 130 },
    data: { component, registry: registry[component.type] },
  }))
}

export function toFlowEdges(config: IRConfig, registry: SchemaRegistry): Edge[] {
  const edges: Edge[] = []
  for (const component of config.components) {
    collectBodyEdges(config, registry, component, component.body, edges, [])
  }
  return edges
}

export function addConnectionRef(
  config: IRConfig,
  registry: SchemaRegistry,
  sourceComponentId: string,
  sourceHandle: string,
  targetComponentId: string,
  targetHandle: string,
): IRConfig {
  const source = config.components.find((component) => component.id === sourceComponentId)
  const target = config.components.find((component) => component.id === targetComponentId)
  if (!source || !target) {
    return config
  }

  const sourceEndpoint = parseSourceHandle(sourceHandle)
  const targetEndpoint = parseTargetHandle(targetHandle)
  if (!sourceEndpoint || !targetEndpoint) {
    return config
  }

  const outputCapsule = registry[source.type]?.outputs[sourceEndpoint.attribute]
  const input = registry[target.type]?.inputs[targetEndpoint.path.join('.')]
  if (!outputCapsule || !input || !canConnect(outputCapsule, input.capsule)) {
    return config
  }

  const ref: Extract<IRValue, { t: 'ref' }> = {
    t: 'ref',
    target: `${source.type}.${source.label}.${sourceEndpoint.attribute}`,
  }
  return updateComponent(config, target.id, (component) => {
    const body = cloneBody(component.body)
    setRefAtPath(body, input.path, input.multiple, ref)
    return { ...component, body }
  })
}

export function removeConnectionRef(config: IRConfig, edge: Pick<Edge, 'source' | 'sourceHandle' | 'target'>): IRConfig {
  const source = config.components.find((component) => component.id === edge.source)
  if (!source || !edge.sourceHandle) {
    return config
  }
  const sourceEndpoint = parseSourceHandle(edge.sourceHandle)
  if (!sourceEndpoint) {
    return config
  }
  const refTarget = `${source.type}.${source.label}.${sourceEndpoint.attribute}`

  return updateComponent(config, edge.target, (component) => ({
    ...component,
    body: removeRefFromBody(component.body, refTarget),
  }))
}

export function removeComponent(config: IRConfig, componentId: string): IRConfig {
  const removed = config.components.find((component) => component.id === componentId)
  if (!removed) {
    return config
  }
  const removedRefPrefix = `${removed.type}.${removed.label}.`
  return {
    ...config,
    components: config.components
      .filter((component) => component.id !== componentId)
      .map((component) => ({
        ...component,
        body: removeRefsByPrefix(component.body, removedRefPrefix),
      })),
  }
}

export function isConnectionAllowed(
  registry: SchemaRegistry,
  sourceType: string,
  sourceHandle: string | null | undefined,
  targetType: string,
  targetHandle: string | null | undefined,
): boolean {
  if (!sourceHandle || !targetHandle) {
    return false
  }
  const sourceEndpoint = parseSourceHandle(sourceHandle)
  const targetEndpoint = parseTargetHandle(targetHandle)
  if (!sourceEndpoint || !targetEndpoint) {
    return false
  }
  const outputCapsule = registry[sourceType]?.outputs[sourceEndpoint.attribute]
  const inputCapsule = registry[targetType]?.inputs[targetEndpoint.path.join('.')]?.capsule
  return Boolean(outputCapsule && inputCapsule && canConnect(outputCapsule, inputCapsule))
}

export function updateAttr(body: IRBody, path: string[], value: IRValue | undefined): IRBody {
  const next = cloneBody(body)
  setValueAtPath(next, path, value)
  return next
}

export function addBlock(body: IRBody, path: string[], blockName: string, blockBody: IRBody): IRBody {
  const next = cloneBody(body)
  const parent = bodyAtPath(next, path)
  parent.blocks.push({ name: blockName, body: blockBody })
  return next
}

export function removeBlock(body: IRBody, path: string[], blockIndex: number): IRBody {
  const next = cloneBody(body)
  const parent = bodyAtPath(next, path)
  const indexes = indexesByName(parent.blocks, parent.blocks[blockIndex]?.name)
  parent.blocks = parent.blocks.filter((_, index) => !indexes.includes(blockIndex) || index !== blockIndex)
  return next
}

function collectBodyEdges(
  config: IRConfig,
  registry: SchemaRegistry,
  component: IRComponent,
  body: IRBody,
  edges: Edge[],
  path: string[],
): void {
  for (const [name, value] of Object.entries(body.attrs)) {
    collectValueEdges(config, registry, component, value, edges, [...path, name])
  }
  body.blocks.forEach((block, index) =>
    collectBodyEdges(config, registry, component, block.body, edges, [...path, block.name, String(index)]),
  )
}

function collectValueEdges(
  config: IRConfig,
  registry: SchemaRegistry,
  component: IRComponent,
  value: IRValue,
  edges: Edge[],
  path: string[],
): void {
  if (value.t === 'ref') {
    const source = refToSource(value.target)
    const sourceComponent = source
      ? config.components.find((candidate) => candidate.type === source.type && candidate.label === source.label)
      : undefined
    if (source && sourceComponent) {
      const targetPath = path.filter((part) => !/^\d+$/u.test(part))
      const sourceCapsule = registry[sourceComponent.type]?.outputs[source.attribute] ?? ''
      const targetCapsule = registry[component.type]?.inputs[targetPath.join('.')]?.capsule ?? ''
      edges.push({
        id: `${source.type}.${source.label}.${source.attribute}->${component.id}:${path.join('.')}`,
        source: sourceComponent.id,
        sourceHandle: makeSourceHandle(source.attribute, sourceCapsule),
        target: component.id,
        targetHandle: makeTargetHandle(targetPath, targetCapsule),
      })
    }
    return
  }
  if (value.t === 'list') {
    value.v.forEach((item, index) =>
      collectValueEdges(config, registry, component, item, edges, [...path, String(index)]),
    )
    return
  }
  if (value.t === 'map') {
    for (const [name, item] of Object.entries(value.v)) {
      collectValueEdges(config, registry, component, item, edges, [...path, name])
    }
  }
}

function refToSource(target: string):
  | { type: string; label: string; attribute: string }
  | undefined {
  const pieces = target.split('.')
  if (pieces.length < 3) {
    return undefined
  }
  const attribute = pieces.at(-1)
  const label = pieces.at(-2)
  if (!attribute || !label) {
    return undefined
  }
  const type = pieces.slice(0, -2).join('.')
  return { type, label, attribute }
}

export function makeSourceHandle(attribute: string, capsule: string): string {
  return `out:${attribute}:${capsule}`
}

export function makeTargetHandle(path: string[], capsule: string): string {
  return `in:${path.join('.')}:${capsule}`
}

export function parseSourceHandle(handle: string): { attribute: string; capsule: string } | undefined {
  const [, attribute, capsule] = handle.split(':')
  return attribute ? { attribute, capsule: capsule ?? '' } : undefined
}

export function parseTargetHandle(handle: string): { path: string[]; capsule: string } | undefined {
  const [, path, capsule] = handle.split(':')
  return path ? { path: path.split('.'), capsule: capsule ?? '' } : undefined
}

function setRefAtPath(body: IRBody, path: string[], multiple: boolean, ref: Extract<IRValue, { t: 'ref' }>): void {
  const attr = path.at(-1)
  if (!attr) {
    return
  }
  const targetBody = bodyAtPath(body, path.slice(0, -1))
  if (multiple) {
    const current = targetBody.attrs[attr]
    if (current?.t === 'list') {
      if (!current.v.some((item) => item.t === 'ref' && item.target === ref.target)) {
        current.v.push(ref)
      }
      return
    }
    targetBody.attrs[attr] = { t: 'list', v: [ref] }
    return
  }
  targetBody.attrs[attr] = ref
}

function setValueAtPath(body: IRBody, path: string[], value: IRValue | undefined): void {
  const attr = path.at(-1)
  if (!attr) {
    return
  }
  const targetBody = bodyAtPath(body, path.slice(0, -1))
  if (value) {
    targetBody.attrs[attr] = value
  } else {
    delete targetBody.attrs[attr]
  }
}

function bodyAtPath(body: IRBody, path: string[]): IRBody {
  let current = body
  for (let index = 0; index < path.length; index += 2) {
    const blockName = path[index]
    const blockIndex = Number(path[index + 1] ?? '0')
    if (!blockName) {
      break
    }
    const matches = current.blocks.filter((block) => block.name === blockName)
    let block = matches[blockIndex]
    if (!block) {
      block = { name: blockName, body: { attrs: {}, blocks: [] } }
      current.blocks.push(block)
    }
    current = block.body
  }
  return current
}

function removeRefFromBody(body: IRBody, refTarget: string): IRBody {
  return mapBodyValues(body, (value) => removeRefFromValue(value, refTarget))
}

function removeRefsByPrefix(body: IRBody, refPrefix: string): IRBody {
  return mapBodyValues(body, (value) => removeRefsWithPrefix(value, refPrefix))
}

function mapBodyValues(body: IRBody, mapper: (value: IRValue) => IRValue | undefined): IRBody {
  const attrs: Record<string, IRValue> = {}
  for (const [name, value] of Object.entries(body.attrs)) {
    const mapped = mapper(value)
    if (mapped) {
      attrs[name] = mapped
    }
  }
  return {
    attrs,
    blocks: body.blocks.map((block) => ({ ...block, body: mapBodyValues(block.body, mapper) })),
  }
}

function removeRefFromValue(value: IRValue, refTarget: string): IRValue | undefined {
  if (value.t === 'ref') {
    return value.target === refTarget ? undefined : value
  }
  if (value.t === 'list') {
    const items = value.v.map((item) => removeRefFromValue(item, refTarget)).filter((item): item is IRValue => Boolean(item))
    return items.length > 0 ? { ...value, v: items } : undefined
  }
  return value
}

function removeRefsWithPrefix(value: IRValue, refPrefix: string): IRValue | undefined {
  if (value.t === 'ref') {
    return value.target.startsWith(refPrefix) ? undefined : value
  }
  if (value.t === 'list') {
    const items = value.v.map((item) => removeRefsWithPrefix(item, refPrefix)).filter((item): item is IRValue => Boolean(item))
    return items.length > 0 ? { ...value, v: items } : undefined
  }
  if (value.t === 'map') {
    const entries = Object.entries(value.v)
      .map(([key, item]) => [key, removeRefsWithPrefix(item, refPrefix)] as const)
      .filter((entry): entry is readonly [string, IRValue] => Boolean(entry[1]))
    return entries.length > 0 ? { ...value, v: Object.fromEntries(entries) } : undefined
  }
  return value
}

function updateComponent(config: IRConfig, componentId: string, update: (component: IRComponent) => IRComponent): IRConfig {
  return {
    ...config,
    components: config.components.map((component) => (component.id === componentId ? update(component) : component)),
  }
}

export function cloneBody(body: IRBody): IRBody {
  return {
    attrs: { ...body.attrs },
    blocks: body.blocks.map((block) => ({ ...block, body: cloneBody(block.body) })),
  }
}

function indexesByName(blocks: IRBlockInstance[], name: string | undefined): number[] {
  return blocks.flatMap((block, index) => (block.name === name ? [index] : []))
}
