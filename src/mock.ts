/**
 * Answers "Test Request" in the API reference inside the browser. There is no
 * OneProof instance yet, so every call to the documented server gets the
 * example from openapi.yaml — the same one shown next to the operation. Only
 * query parameters are checked, so a missing or unversioned profile still
 * fails the way the real API would.
 */
import { parse } from 'yaml'

const SERVER = 'https://api.oneproof.example/v1'

/** A parameter of an operation: only what the mock reads. */
interface Parameter {
  name: string
  in: string
  required?: boolean
  example?: unknown
  schema?: { pattern?: string }
}

/** A `$ref` to a parameter in `components`. */
interface ParameterVerweis {
  $ref: string
}

interface Operation {
  parameters?: (Parameter | ParameterVerweis)[]
  /** By status code. */
  responses: Record<string, { content: Record<string, { example?: unknown }> }>
}

/** The parts of `openapi.yaml` that the mock reads. */
interface Spec {
  /** By path template, then by HTTP method in lower case. */
  paths: Record<string, Record<string, Operation | undefined>>
}

let spec: Spec | undefined

export async function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init)
  if (!request.url.startsWith(`${SERVER}/`)) return fetch(input, init)

  // `openapi.yaml` is served with the page; the type describes what the mock reads of it.
  spec ??= parse(await (await fetch('/openapi.yaml')).text()) as Spec
  const url = new URL(request.url)
  const path = url.pathname.slice(new URL(SERVER).pathname.length)

  for (const [template, item] of Object.entries(spec.paths)) {
    const operation = item[request.method.toLowerCase()]
    if (!operation || !matches(template, path)) continue

    const invalid = (operation.parameters ?? [])
      .map(resolve)
      .filter((parameter) => parameter.in === 'query' && parameter.required)
      .find((parameter) => {
        const value = url.searchParams.get(parameter.name)
        const pattern = parameter.schema?.pattern
        return value === null || (pattern && !new RegExp(pattern).test(value))
      })
    if (invalid) {
      return respond(request, 422, 'application/problem+json', {
        type: 'about:blank',
        title: 'Die Anfrage wurde nicht ausgeführt.',
        status: 422,
        detail: `Der Parameter „${invalid.name}“ fehlt oder hat nicht das erwartete Format, zum Beispiel ${invalid.example}.`,
      })
    }

    const success = Object.entries(operation.responses).find(([code]) => code.startsWith('2'))
    if (!success) throw new Error(`${request.method} ${template} has no successful response in openapi.yaml.`)
    const [status, response] = success
    const first = Object.entries(response.content)[0]
    if (!first) throw new Error(`The successful response of ${request.method} ${template} has no content in openapi.yaml.`)
    const [type, content] = first
    return respond(request, Number(status), type, content.example)
  }

  return fetch(input, init)
}

const matches = (template: string, path: string): boolean =>
  new RegExp(`^${template.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(path)

const istVerweis = (node: Parameter | ParameterVerweis): node is ParameterVerweis => '$ref' in node && Boolean(node.$ref)

const resolve = (node: Parameter | ParameterVerweis): Parameter => {
  if (!istVerweis(node)) return node
  const ziel = node.$ref
    .slice(2)
    .split('/')
    .reduce<unknown>((parent, key) => {
      if (typeof parent !== 'object' || parent === null) throw new Error(`The reference ${node.$ref} does not resolve in openapi.yaml.`)
      return Reflect.get(parent, key)
    }, spec)
  // `$ref` of a parameter points at one in `components.parameters`.
  return ziel as Parameter
}

function respond(request: Request, status: number, type: string, body: unknown): Response {
  const response = new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': type },
  })
  // Scalar reads response.url, which a constructed Response leaves empty.
  Object.defineProperty(response, 'url', { value: request.url })
  return response
}
