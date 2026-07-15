import type { IRBlockInstance, IRBody, IRValue } from '../ir/types'
import type { ComponentSchema, SchemaAttribute, SchemaBlock, SchemaBody, SchemaType } from '../schema/types'
import { addBlock, makeInitialBody, removeBlock, updateAttr } from '../graph/irGraph'
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
  onChange,
}: {
  attribute: SchemaAttribute
  value: IRValue | undefined
  onChange: (value: IRValue | undefined) => void
}) {
  const missing = attribute.required && !value
  const id = `field-${attribute.name}`
  return (
    <label className={`form-field${missing ? ' is-invalid' : ''}`} htmlFor={id}>
      <span>
        {attribute.name}
        {attribute.required ? <strong> required</strong> : null}
      </span>
      <FieldInput id={id} type={attribute.type} value={value} onChange={onChange} />
      {missing ? <small>Required value is not set.</small> : null}
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
  if (type.kind === 'list' || type.kind === 'map' || type.kind === 'raw') {
    return (
      <>
        {type.kind === 'raw' ? <span className="field-hint">River expression</span> : null}
        <textarea
          id={id}
          rows={type.kind === 'raw' ? 3 : 4}
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
  return (
    <input
      id={id}
      type={type.kind === 'number' ? 'number' : type.kind === 'secret' || type.kind === 'optional_secret' ? 'password' : 'text'}
      value={valueToInput(value, type)}
      onChange={(event) => onChange(inputToValue(event.currentTarget.value, type))}
    />
  )
}

function BlockField({ block, body, path, onChange }: { block: SchemaBlock; body: IRBody; path: string[]; onChange: (body: IRBody) => void }) {
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
              <button type="button" onClick={() => onChange(removeBlock(body, path, index))}>
                Remove
              </button>
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
