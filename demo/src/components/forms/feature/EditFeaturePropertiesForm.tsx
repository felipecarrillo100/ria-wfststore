import { useRef, useState } from 'react'
import Form from '@rjsf/mui'
import validator from '@rjsf/validator-ajv8'
import type { IChangeEvent } from '@rjsf/core'
import type { RJSFSchema } from '@rjsf/utils'
import Button from '@mui/material/Button'
import Box from '@mui/material/Box'
import { useFormContainer } from 'react-dockable-desktop'
import { xsdToJsonMap, type WFSFeatureDescription } from 'ria-wfststore'

// Fallback only, used when the server's own schema isn't available: guesses each field's type
// from whatever value the feature currently happens to have. Can't know which fields the server
// actually requires, so it never sets `required` - every field renders as optional.
function inferSchemaFromValues(properties: Record<string, unknown>): RJSFSchema {
  const props: Record<string, { type: string }> = {}
  for (const [key, value] of Object.entries(properties)) {
    if (value === null || value === undefined || typeof value === 'object') continue
    const t = typeof value
    if (t === 'number') props[key] = { type: 'number' }
    else if (t === 'boolean') props[key] = { type: 'boolean' }
    else props[key] = { type: 'string' }
  }
  return { type: 'object', properties: props as any }
}

// The real thing: built from the server's own DescribeFeatureType schema, so field types come
// from what the server actually declares (not a guess from the current value), and - the point
// of this function - `required` is populated from each property's `minOccurs` (XSD convention:
// absent or >=1 means required, "0" means optional), which is what makes react-jsonschema-form
// actually mark mandatory fields (asterisk + validation) instead of showing every field as optional.
function schemaFromFeatureTemplate(featureTemplate: WFSFeatureDescription): RJSFSchema {
  const props: Record<string, { type: string }> = {}
  const required: string[] = []
  for (const element of featureTemplate.properties) {
    if (!element.name) continue
    const jsonType = element.type ? xsdToJsonMap[element.type] : undefined
    props[element.name] = { type: jsonType ?? 'string' }
    if (element.minOccurs === undefined || element.minOccurs >= 1) {
      required.push(element.name)
    }
  }
  return { type: 'object', properties: props as any, required }
}

interface Props {
  feature: any
  featureTemplate?: WFSFeatureDescription | null
  onSave: (properties: Record<string, unknown>) => void
}

export function EditFeaturePropertiesForm({ feature, featureTemplate, onSave }: Props) {
  const container = useFormContainer()
  const submitRef = useRef<HTMLButtonElement>(null)
  const [formData, setFormData] = useState<Record<string, unknown>>(feature.properties ?? {})
  const schema = featureTemplate
    ? schemaFromFeatureTemplate(featureTemplate)
    : inferSchemaFromValues(feature.properties ?? {})

  return (
    <Box sx={{ p: 2 }}>
      <Form
        schema={schema}
        validator={validator}
        formData={formData}
        onChange={(e: IChangeEvent) => setFormData(e.formData)}
        onSubmit={({ formData: fd }) => {
          onSave(fd)
          container.requestClose()
        }}
        idPrefix="edit-props"
      >
        <button ref={submitRef} type="submit" style={{ display: 'none' }} />
      </Form>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1 }}>
        <Button onClick={() => container.requestClose()}>Cancel</Button>
        <Button variant="contained" onClick={() => submitRef.current?.click()}>Save</Button>
      </Box>
    </Box>
  )
}
