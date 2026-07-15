import { describe, expect, it } from "vitest"
import { collectRefs } from "./refs"
import type { IRConfig } from "./types"
import { serialize } from "../river/serialize"

const emptyConfig = (): IRConfig => ({
  formatVersion: 1,
  alloyVersion: "v1.17.1",
  components: [],
  rawSnippets: [],
})

describe("serialize", () => {
  it("encodes scalar, list, map, ref, and raw values", () => {
    const config = emptyConfig()
    config.components.push({
      id: "example",
      type: "example.component",
      label: "default",
      body: {
        attrs: {
          string_value: { t: "string", v: "hello\nworld" },
          number_value: { t: "number", v: 42 },
          bool_value: { t: "bool", v: true },
          list_value: { t: "list", v: [{ t: "string", v: "a" }, { t: "number", v: 1 }] },
          map_value: { t: "map", v: { key: { t: "bool", v: false } } },
          ref_value: { t: "ref", target: "other.component.default.receiver" },
          raw_value: { t: "raw", v: "env(\"TOKEN\")" },
        },
        blocks: [],
      },
    })

    expect(serialize(config)).toBe(
      'example.component "default" {\n' +
        '\tstring_value = "hello\\nworld"\n' +
        "\tnumber_value = 42\n" +
        "\tbool_value = true\n" +
        '\tlist_value = ["a", 1]\n' +
        '\tmap_value = {"key" = false}\n' +
        "\tref_value = other.component.default.receiver\n" +
        '\traw_value = env("TOKEN")\n' +
        "}\n",
    )
  })

  it("preserves nested block order and labels", () => {
    const config = emptyConfig()
    config.components.push({
      id: "remote",
      type: "prometheus.remote_write",
      label: "default",
      body: {
        attrs: {},
        blocks: [
          {
            name: "endpoint",
            label: "primary",
            body: {
              attrs: { url: { t: "string", v: "https://example.test/api/v1/write" } },
              blocks: [
                {
                  name: "basic_auth",
                  body: {
                    attrs: {
                      username: { t: "string", v: "user" },
                      password: { t: "string", v: "pass" },
                    },
                    blocks: [],
                  },
                },
              ],
            },
          },
        ],
      },
    })

    expect(serialize(config)).toBe(
      'prometheus.remote_write "default" {\n' +
        '\tendpoint "primary" {\n' +
        '\t\turl = "https://example.test/api/v1/write"\n' +
        "\t\tbasic_auth {\n" +
        '\t\t\tusername = "user"\n' +
        '\t\t\tpassword = "pass"\n' +
        "\t\t}\n" +
        "\t}\n" +
        "}\n",
    )
  })

  it("serializes schema enum blocks with Alloy dotted syntax", () => {
    const config = emptyConfig()
    config.components.push({
      id: "process",
      type: "loki.process",
      label: "default",
      body: {
        attrs: {},
        blocks: [
          {
            name: "stage",
            body: {
              attrs: {},
              blocks: [
                {
                  name: "json",
                  body: {
                    attrs: { expressions: { t: "map", v: { level: { t: "string", v: "level" } } } },
                    blocks: [],
                  },
                },
              ],
            },
          },
        ],
      },
    })

    expect(
      serialize(config, {
        "loki.process": {
          name: "loki.process",
          importPath: "",
          stability: "generally-available",
          community: false,
          arguments: {
            blocks: [
              {
                name: "stage",
                required: false,
                multiple: true,
                enum: true,
                body: {
                  blocks: [{ name: "json", required: false, body: { attributes: [{ name: "expressions", required: false, type: { kind: "map", value: { kind: "string" } } }] } }],
                },
              },
            ],
          },
        },
      }),
    ).toBe(
      'loki.process "default" {\n' +
        "\tstage.json {\n" +
        '\t\texpressions = {"level" = "level"}\n' +
        "\t}\n" +
        "}\n",
    )
  })

  it("appends raw snippets after components", () => {
    const config = emptyConfig()
    config.components.push({
      id: "self",
      type: "prometheus.exporter.self",
      label: "default",
      body: { attrs: {}, blocks: [] },
    })
    config.rawSnippets.push('logging {\n\tlevel = "info"\n}\n')

    expect(serialize(config)).toBe(
      'prometheus.exporter.self "default" {\n}\n\nlogging {\n\tlevel = "info"\n}\n',
    )
  })

  it("is deterministic for the same IR object", () => {
    const config = emptyConfig()
    config.components.push({
      id: "self",
      type: "prometheus.exporter.self",
      label: "default",
      body: { attrs: {}, blocks: [] },
    })

    expect(serialize(config)).toBe(serialize(config))
  })
})

describe("collectRefs", () => {
  it("walks refs through attrs, lists, maps, and nested blocks", () => {
    const config = emptyConfig()
    config.components.push({
      id: "scrape",
      type: "prometheus.scrape",
      label: "default",
      body: {
        attrs: {
          targets: { t: "ref", target: "prometheus.exporter.self.default.targets" },
          forward_to: {
            t: "list",
            v: [{ t: "ref", target: "prometheus.remote_write.default.receiver" }],
          },
          headers: {
            t: "map",
            v: { receiver: { t: "ref", target: "example.receiver" } },
          },
        },
        blocks: [
          {
            name: "nested",
            body: {
              attrs: { auth: { t: "ref", target: "auth.handler" } },
              blocks: [],
            },
          },
        ],
      },
    })

    expect(collectRefs(config)).toEqual([
      { from: "scrape", target: "prometheus.exporter.self.default.targets" },
      { from: "scrape", target: "prometheus.remote_write.default.receiver" },
      { from: "scrape", target: "example.receiver" },
      { from: "scrape", target: "auth.handler" },
    ])
  })
})
