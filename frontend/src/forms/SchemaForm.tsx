import { useState } from 'react'
import type { IRBlockInstance, IRBody, IRValue } from '../ir/types'
import type { ComponentSchema, SchemaAttribute, SchemaBlock, SchemaBody, SchemaType } from '../schema/types'
import { addBlock, makeInitialBody, moveBlock, removeBlock, replaceBlock, updateAttr } from '../graph/irGraph'
import { inputToValue, valueToInput } from './value'

interface SchemaFormProps {
  schema: ComponentSchema
  body: IRBody
  onChange: (body: IRBody) => void
}

export function SchemaForm({ schema, body, onChange }: SchemaFormProps) {
  return (
    <div className="schema-form">
      <BodyForm schemaBody={schema.arguments} body={body} path={[]} onChange={onChange} />
    </div>
  )
}

interface BodyFormProps {
  schemaBody: SchemaBody
  body: IRBody
  path: string[]
  onChange: (body: IRBody) => void
}

function BodyForm({ schemaBody, body, path, onChange }: BodyFormProps) {
  return (
    <>
      {(schemaBody.attributes ?? []).map((attribute) => (
        <AttributeField
          key={attribute.name}
          attribute={attribute}
          value={bodyAtPath(body, path).attrs[attribute.name]}
          path={path}
          onChange={(value) => onChange(updateAttr(body, [...path, attribute.name], value))}
        />
      ))}
      {(schemaBody.blocks ?? []).map((block) => (
        <BlockField key={block.name} block={block} body={body} path={path} onChange={onChange} />
      ))}
    </>
  )
}

function AttributeField({
  attribute,
  value,
  path,
  onChange,
}: {
  attribute: SchemaAttribute
  value: IRValue | undefined
  path: string[]
  onChange: (value: IRValue | undefined) => void
}) {
  const missing = attribute.required && !value
  const id = `field-${[...path, attribute.name].join('-')}`
  const durationError = attribute.type.kind === 'duration' && value?.t === 'string' && !isDuration(value.v)
  return (
    <label className={`form-field${missing || durationError ? ' is-invalid' : ''}`} htmlFor={id}>
      <span>
        {attribute.name}
        {attribute.required ? <strong> required</strong> : null}
      </span>
      <FieldInput id={id} type={attribute.type} value={value} onChange={onChange} />
      {missing ? <small>Required value is not set.</small> : null}
      {durationError ? <small>Use an Alloy duration such as 30s or 2m.</small> : null}
    </label>
  )
}

function FieldInput({
  id,
  type,
  value,
  onChange,
}: {
  id: string
  type: SchemaType
  value: IRValue | undefined
  onChange: (value: IRValue | undefined) => void
}) {
  if (type.kind === 'capsule') {
    return <div className="readonly-field">Managed by graph connections: {type.capsule}</div>
  }
  if (type.kind === 'bool') {
    return (
      <input
        id={id}
        type="checkbox"
        checked={value?.t === 'bool' ? value.v : false}
        onChange={(event) => onChange(event.currentTarget.checked ? { t: 'bool', v: true } : undefined)}
      />
    )
  }
  if (type.kind === 'list') {
    return <ListInput type={type.elem} value={value} onChange={onChange} />
  }
  if (type.kind === 'map') {
    return <MapInput type={type.value ?? { kind: 'string' }} value={value} onChange={onChange} />
  }
  if (type.kind === 'raw') {
    return (
      <>
        <span className="field-hint">River expression</span>
        <textarea
          id={id}
          className="raw-input"
          rows={3}
          value={valueToInput(value, type)}
          onChange={(event) => onChange(inputToValue(event.currentTarget.value, type))}
        />
      </>
    )
  }
  if (type.kind === 'enum' && type.values?.length) {
    return (
      <select
        id={id}
        value={valueToInput(value, type)}
        onChange={(event) => onChange(inputToValue(event.currentTarget.value, type))}
      >
        <option value="" />
        {type.values.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    )
  }
  if (type.kind === 'duration') {
    return (
      <>
        <input
          id={id}
          type="text"
          placeholder="30s, 2m"
          value={valueToInput(value, type)}
          onChange={(event) => onChange(inputToValue(event.currentTarget.value, type))}
        />
        <span className="field-hint">Duration, for example 30s or 2m.</span>
      </>
    )
  }
  if (type.kind === 'secret' || type.kind === 'optional_secret') {
    return <SecretInput id={id} type={type} value={value} onChange={onChange} />
  }
  return (
    <input
      id={id}
      type={type.kind === 'number' ? 'number' : 'text'}
      value={valueToInput(value, type)}
      onChange={(event) => onChange(inputToValue(event.currentTarget.value, type))}
    />
  )
}

function BlockField({ block, body, path, onChange }: { block: SchemaBlock; body: IRBody; path: string[]; onChange: (body: IRBody) => void }) {
  if (block.enum) {
    return <EnumBlockField block={block} body={body} path={path} onChange={onChange} />
  }
  const parent = bodyAtPath(body, path)
  const instances = parent.blocks
    .map((instance, index) => ({ instance, index }))
    .filter((entry) => entry.instance.name === block.name)

  return (
    <details className="block-field" open>
      <summary>
        {block.name}
        {block.required ? <strong> required</strong> : null}
      </summary>
      {instances.map(({ index }, ordinal) => (
        <div className="block-instance" key={`${block.name}-${index}`}>
          {block.multiple ? (
            <div className="block-instance-header">
              <span>#{ordinal + 1}</span>
              <div className="block-actions">
                <button type="button" disabled={index === 0} onClick={() => onChange(moveBlock(body, path, index, -1))}>
                  Up
                </button>
                <button
                  type="button"
                  disabled={index === parent.blocks.length - 1}
                  onClick={() => onChange(moveBlock(body, path, index, 1))}
                >
                  Down
                </button>
                <button type="button" onClick={() => onChange(removeBlock(body, path, index))}>
                  Remove
                </button>
              </div>
            </div>
          ) : null}
          <BodyForm schemaBody={block.body} body={body} path={[...path, block.name, String(ordinal)]} onChange={onChange} />
        </div>
      ))}
      {(block.multiple || instances.length === 0) && !block.required ? (
        <button type="button" onClick={() => onChange(addBlock(body, path, block.name, makeInitialBody(block.body)))}>
          Add {block.name}
        </button>
      ) : null}
      {block.required && instances.length === 0 ? (
        <button type="button" onClick={() => onChange(addBlock(body, path, block.name, makeInitialBody(block.body)))}>
          Add required {block.name}
        </button>
      ) : null}
    </details>
  )
}

function EnumBlockField({ block, body, path, onChange }: { block: SchemaBlock; body: IRBody; path: string[]; onChange: (body: IRBody) => void }) {
  const parent = bodyAtPath(body, path)
  const variants = block.body.blocks ?? []
  const [variantToAdd, setVariantToAdd] = useState(variants[0]?.name ?? '')
  const instances = parent.blocks
    .map((instance, index) => ({ instance, index }))
    .filter((entry) => entry.instance.name === block.name)

  function makeEnumInstance(variantName: string): IRBlockInstance | undefined {
    const variant = variants.find((candidate) => candidate.name === variantName)
    return variant ? { name: block.name, body: { attrs: {}, blocks: [{ name: variant.name, body: makeInitialBody(variant.body) }] } } : undefined
  }

  return (
    <details className="block-field enum-block-field" open>
      <summary>
        {block.name}
        {block.required ? <strong> required</strong> : null}
      </summary>
      {instances.map(({ instance, index }, ordinal) => {
        const variant = instance.body.blocks[0]
        const variantSchema = variants.find((candidate) => candidate.name === variant?.name)
        return (
          <div className="block-instance" key={`${block.name}-${index}`}>
            <div className="block-instance-header">
              <span>#{ordinal + 1}</span>
              <div className="block-actions">
                <button type="button" disabled={index === 0} onClick={() => onChange(moveBlock(body, path, index, -1))}>
                  Up
                </button>
                <button
                  type="button"
                  disabled={index === parent.blocks.length - 1}
                  onClick={() => onChange(moveBlock(body, path, index, 1))}
                >
                  Down
                </button>
                <button type="button" onClick={() => onChange(removeBlock(body, path, index))}>
                  Remove
                </button>
              </div>
            </div>
            <label className="form-field">
              <span>variant</span>
              <select
                value={variant?.name ?? ''}
                onChange={(event) => {
                  const next = makeEnumInstance(event.currentTarget.value)
                  if (next) {
                    onChange(replaceBlock(body, path, index, next))
                  }
                }}
              >
                <option value="" />
                {variants.map((candidate) => (
                  <option key={candidate.name} value={candidate.name}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </label>
            {variant && variantSchema ? (
              <BodyForm schemaBody={variantSchema.body} body={body} path={[...path, block.name, String(ordinal), variant.name, '0']} onChange={onChange} />
            ) : null}
          </div>
        )
      })}
      {(block.multiple || instances.length === 0) && variants.length > 0 ? (
        <div className="add-block-row">
          <select value={variantToAdd} onChange={(event) => setVariantToAdd(event.currentTarget.value)}>
            {variants.map((variant) => (
              <option key={variant.name} value={variant.name}>
                {variant.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              const instance = makeEnumInstance(variantToAdd)
              if (instance) {
                onChange(addBlock(body, path, instance.name, instance.body))
              }
            }}
          >
            Add {block.name}
          </button>
        </div>
      ) : null}
    </details>
  )
}

function SecretInput({ id, type, value, onChange }: { id: string; type: SchemaType; value: IRValue | undefined; onChange: (value: IRValue | undefined) => void }) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="secret-input">
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        value={valueToInput(value, type)}
        onChange={(event) => onChange(inputToValue(event.currentTarget.value, type))}
      />
      <button type="button" onClick={() => setVisible((current) => !current)}>
        {visible ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}

function ListInput({ type, value, onChange }: { type: SchemaType; value: IRValue | undefined; onChange: (value: IRValue | undefined) => void }) {
  const items = value?.t === 'list' ? value.v : []
  const updateItems = (nextItems: IRValue[]) => onChange(nextItems.length > 0 ? { t: 'list', v: nextItems } : undefined)
  return (
    <div className="row-editor">
      {items.map((item, index) => (
        <div className="row-editor-row" key={index}>
          <input
            value={valueToInput(item, type)}
            onChange={(event) => {
              const nextValue = inputToValue(event.currentTarget.value, type)
              updateItems(items.map((current, itemIndex) => (itemIndex === index ? nextValue : current)).filter((entry): entry is IRValue => Boolean(entry)))
            }}
          />
          <button type="button" onClick={() => updateItems(items.filter((_, itemIndex) => itemIndex !== index))}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={() => updateItems([...items, defaultValue(type)])}>
        Add item
      </button>
    </div>
  )
}

function MapInput({ type, value, onChange }: { type: SchemaType; value: IRValue | undefined; onChange: (value: IRValue | undefined) => void }) {
  const entries = value?.t === 'map' ? Object.entries(value.v) : []
  const updateEntries = (nextEntries: [string, IRValue][]) => {
    const complete = nextEntries.filter(([key]) => key.trim() !== '')
    onChange(complete.length > 0 ? { t: 'map', v: Object.fromEntries(complete) } : undefined)
  }
  return (
    <div className="row-editor">
      {entries.map(([key, item], index) => (
        <div className="row-editor-row map-row" key={index}>
          <input
            aria-label="map key"
            placeholder="key"
            value={key}
            onChange={(event) => updateEntries(entries.map((entry, entryIndex) => (entryIndex === index ? [event.currentTarget.value, entry[1]] : entry)))}
          />
          <input
            aria-label="map value"
            placeholder="value"
            value={valueToInput(item, type)}
            onChange={(event) => {
              const nextValue = inputToValue(event.currentTarget.value, type)
              updateEntries(entries.map((entry, entryIndex) => (entryIndex === index ? [entry[0], nextValue ?? defaultValue(type)] : entry)))
            }}
          />
          <button type="button" onClick={() => updateEntries(entries.filter((_, entryIndex) => entryIndex !== index))}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={() => updateEntries([...entries, [nextMapKey(entries), defaultValue(type)]])}>
        Add entry
      </button>
    </div>
  )
}

function nextMapKey(entries: [string, IRValue][]): string {
  const keys = new Set(entries.map(([key]) => key))
  if (!keys.has('key')) {
    return 'key'
  }
  for (let index = 2; ; index += 1) {
    const candidate = `key_${index}`
    if (!keys.has(candidate)) {
      return candidate
    }
  }
}

function defaultValue(type: SchemaType): IRValue {
  if (type.kind === 'number') {
    return { t: 'number', v: 0 }
  }
  if (type.kind === 'bool') {
    return { t: 'bool', v: false }
  }
  if (type.kind === 'list') {
    return { t: 'list', v: [] }
  }
  if (type.kind === 'map') {
    return { t: 'map', v: {} }
  }
  if (type.kind === 'raw') {
    return { t: 'raw', v: '' }
  }
  return { t: 'string', v: '' }
}

function isDuration(value: string): boolean {
  return /^(\d+(?:\.\d+)?(?:ns|us|µs|ms|s|m|h))+$/.test(value)
}

function bodyAtPath(body: IRBody, path: string[]): IRBody {
  let current = body
  for (let index = 0; index < path.length; index += 2) {
    const blockName = path[index]
    const ordinal = Number(path[index + 1] ?? '0')
    if (!blockName) {
      break
    }
    const next = current.blocks.filter((block: IRBlockInstance) => block.name === blockName)[ordinal]
    if (!next) {
      return { attrs: {}, blocks: [] }
    }
    current = next.body
  }
  return current
}
