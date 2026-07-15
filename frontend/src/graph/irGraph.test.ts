import { describe, expect, it } from 'vitest'
import type { IRConfig } from '../ir/types'
import {
  addConnectionRef,
  isConnectionAllowed,
  removeComponent,
  removeConnectionRef,
  toFlowEdges,
} from './irGraph'
import type { SchemaRegistry } from './types'

const registry: SchemaRegistry = {
  'discovery.kubernetes': {
    outputs: { targets: 'discovery.Targets' },
    inputs: {},
  },
  'prometheus.scrape': {
    outputs: {},
    inputs: {
      targets: { capsule: 'discovery.Targets', path: ['targets'], multiple: false },
      forward_to: { capsule: 'prometheus.Appendable', path: ['forward_to'], multiple: true },
    },
  },
  'prometheus.remote_write': {
    outputs: { receiver: 'prometheus.Appendable' },
    inputs: {},
  },
  'loki.write': {
    outputs: { receiver: 'loki.LogsReceiver' },
    inputs: {},
  },
  'otelcol.exporter.otlphttp': {
    outputs: { input: 'otelcol.Consumer' },
    inputs: {},
  },
  'otelcol.processor.batch': {
    outputs: { input: 'otelcol.Consumer' },
    inputs: {
      'output.0.traces': {
        capsule: 'otelcol.Consumer.traces',
        path: ['output', '0', 'traces'],
        multiple: true,
      },
    },
  },
}

const config = (): IRConfig => ({
  formatVersion: 1,
  alloyVersion: 'v1.17.1',
  rawSnippets: [],
  components: [
    {
      id: 'kube',
      type: 'discovery.kubernetes',
      label: 'default',
      body: { attrs: {}, blocks: [] },
    },
    {
      id: 'scrape',
      type: 'prometheus.scrape',
      label: 'default',
      body: { attrs: {}, blocks: [] },
    },
    {
      id: 'remote',
      type: 'prometheus.remote_write',
      label: 'default',
      body: { attrs: {}, blocks: [] },
    },
  ],
})

describe('irGraph', () => {
  it('writes refs for single and list capsule inputs and derives edges', () => {
    let next = addConnectionRef(config(), registry, 'kube', 'out:targets:discovery.Targets', 'scrape', 'in:targets:discovery.Targets')
    next = addConnectionRef(next, registry, 'remote', 'out:receiver:prometheus.Appendable', 'scrape', 'in:forward_to:prometheus.Appendable')

    expect(next.components[1]?.body.attrs.targets).toEqual({
      t: 'ref',
      target: 'discovery.kubernetes.default.targets',
    })
    expect(next.components[1]?.body.attrs.forward_to).toEqual({
      t: 'list',
      v: [{ t: 'ref', target: 'prometheus.remote_write.default.receiver' }],
    })
    expect(toFlowEdges(next, registry)).toHaveLength(2)
  })

  it('rejects mismatched capsule connections', () => {
    expect(
      isConnectionAllowed(
        registry,
        'prometheus.remote_write',
        'out:receiver:prometheus.Appendable',
        'prometheus.scrape',
        'in:targets:discovery.Targets',
      ),
    ).toBe(false)
  })

  it('allows generic otelcol consumer outputs to connect to signal-specific inputs', () => {
    expect(
      isConnectionAllowed(
        registry,
        'otelcol.exporter.otlphttp',
        'out:input:otelcol.Consumer',
        'otelcol.processor.batch',
        'in:output.0.traces:otelcol.Consumer.traces',
      ),
    ).toBe(true)
  })

  it('removes refs on edge and node deletion', () => {
    const wired = addConnectionRef(config(), registry, 'kube', 'out:targets:discovery.Targets', 'scrape', 'in:targets:discovery.Targets')
    const edge = toFlowEdges(wired, registry)[0]
    expect(edge).toBeDefined()
    const disconnected = removeConnectionRef(wired, edge!)
    expect(disconnected.components[1]?.body.attrs.targets).toBeUndefined()

    const rewired = addConnectionRef(config(), registry, 'kube', 'out:targets:discovery.Targets', 'scrape', 'in:targets:discovery.Targets')
    const removed = removeComponent(rewired, 'kube')
    expect(removed.components.find((component) => component.id === 'scrape')?.body.attrs.targets).toBeUndefined()
  })
})
