import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import type { BuilderNodeData } from './irGraph'
import { makeSourceHandle, makeTargetHandle } from './irGraph'

export function BuilderNode({ data, selected }: NodeProps) {
  const nodeData = data as BuilderNodeData
  const outputs = Object.entries(nodeData.registry?.outputs ?? {})
  const inputs = Object.entries(nodeData.registry?.inputs ?? {})

  return (
    <div className={`builder-node${selected ? ' is-selected' : ''}`}>
      <div className="builder-node-title">{nodeData.component.type}</div>
      <div className="builder-node-label">{nodeData.component.label}</div>
      <div className="node-handles">
        <div>
          {inputs.map(([path, input], index) => (
            <Handle
              key={path}
              id={makeTargetHandle(input.path, input.capsule)}
              type="target"
              position={Position.Left}
              title={input.capsule}
              style={{ top: 44 + index * 24 }}
              className="node-handle node-handle-target"
            />
          ))}
        </div>
        <div>
          {outputs.map(([name, capsule], index) => (
            <Handle
              key={name}
              id={makeSourceHandle(name, capsule)}
              type="source"
              position={Position.Right}
              title={capsule}
              style={{ top: 44 + index * 24 }}
              className="node-handle node-handle-source"
            />
          ))}
        </div>
      </div>
      <div className="node-endpoints">
        <div>
          {inputs.map(([path, input]) => (
            <button
              key={path}
              type="button"
              className="endpoint-button"
              title={input.capsule}
              onClick={() => nodeData.onTargetEndpoint?.(nodeData.component.id, makeTargetHandle(input.path, input.capsule))}
            >
              in {path}
            </button>
          ))}
        </div>
        <div>
          {outputs.map(([name, capsule]) => (
            <button
              key={name}
              type="button"
              className={`endpoint-button${nodeData.pendingSourceHandle === makeSourceHandle(name, capsule) ? ' is-pending' : ''}`}
              title={capsule}
              onClick={() => nodeData.onSourceEndpoint?.(nodeData.component.id, makeSourceHandle(name, capsule))}
            >
              out {name}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
