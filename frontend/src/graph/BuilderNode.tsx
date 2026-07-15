import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import type { IRBody, IRValue } from '../ir/types'
import type { BuilderNodeData } from './irGraph'
import { makeSourceHandle, makeTargetHandle } from './irGraph'

export function BuilderNode({ data, selected }: NodeProps) {
  const nodeData = data as BuilderNodeData
  const outputs = Object.entries(nodeData.registry?.outputs ?? {})
  const inputs = Object.entries(nodeData.registry?.inputs ?? {})
  const preview = previewValue(nodeData.component.body)

  return (
    <div className={`builder-node${selected ? ' is-selected' : ''}`}>
      <div className="builder-node-title">{nodeData.component.type}</div>
      <div className="builder-node-label">{nodeData.component.label}</div>
      {preview ? <div className="builder-node-preview">{preview}</div> : null}
      <div className="node-endpoints">
        <div>
          {inputs.map(([path, input]) => (
            <div key={path} className="endpoint-row endpoint-row-target">
              <Handle
                id={makeTargetHandle(input.path, input.capsule)}
                type="target"
                position={Position.Left}
                title={input.capsule}
                className="node-handle node-handle-target"
              />
              <button
                type="button"
                className="endpoint-button"
                title={input.capsule}
                onClick={() => nodeData.onTargetEndpoint?.(nodeData.component.id, makeTargetHandle(input.path, input.capsule))}
              >
                in {path}
              </button>
            </div>
          ))}
        </div>
        <div>
          {outputs.map(([name, capsule]) => (
            <div key={name} className="endpoint-row endpoint-row-source">
              <button
                type="button"
                className={`endpoint-button${nodeData.pendingSourceHandle === makeSourceHandle(name, capsule) ? ' is-pending' : ''}`}
                title={capsule}
                onClick={() => nodeData.onSourceEndpoint?.(nodeData.component.id, makeSourceHandle(name, capsule))}
              >
                out {name}
              </button>
              <Handle
                id={makeSourceHandle(name, capsule)}
                type="source"
                position={Position.Right}
                title={capsule}
                className="node-handle node-handle-source"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const previewAttributeNames = ['url', 'endpoint', 'job_name', 'role', 'action', 'scrape_interval', 'listen_port']

function previewValue(body: IRBody): string | undefined {
  for (const name of previewAttributeNames) {
    const found = findAttr(body, name)
    if (found) {
      return `${name}: ${formatPreviewValue(found)}`
    }
  }
  return undefined
}

function findAttr(body: IRBody, name: string): IRValue | undefined {
  if (body.attrs[name]) {
    return body.attrs[name]
  }
  for (const block of body.blocks) {
    const found = findAttr(block.body, name)
    if (found) {
      return found
    }
  }
  return undefined
}

function formatPreviewValue(value: IRValue): string {
  if (value.t === 'string' || value.t === 'raw') {
    return value.v
  }
  if (value.t === 'number' || value.t === 'bool') {
    return String(value.v)
  }
  if (value.t === 'ref') {
    return value.target
  }
  if (value.t === 'list') {
    return `${value.v.length} item${value.v.length === 1 ? '' : 's'}`
  }
  return `${Object.keys(value.v).length} entr${Object.keys(value.v).length === 1 ? 'y' : 'ies'}`
}
