package main

type IndexSchema struct {
	Version    string           `json:"version"`
	Components []ComponentIndex `json:"components"`
}

type ComponentIndex struct {
	Name       string   `json:"name"`
	Stability  string   `json:"stability"`
	Community  bool     `json:"community"`
	ImportPath string   `json:"importPath"`
	Inputs     []string `json:"inputs,omitempty"`
	Outputs    []string `json:"outputs,omitempty"`
}

type ComponentSchema struct {
	Name       string     `json:"name"`
	ImportPath string     `json:"importPath"`
	Stability  string     `json:"stability"`
	Community  bool       `json:"community"`
	Arguments  BodySchema `json:"arguments"`
	Exports    BodySchema `json:"exports"`
}

type BodySchema struct {
	Attributes []AttributeSchema `json:"attributes,omitempty"`
	Blocks     []BlockSchema     `json:"blocks,omitempty"`
	Labels     []LabelSchema     `json:"labels,omitempty"`
}

type AttributeSchema struct {
	Name     string     `json:"name"`
	Required bool       `json:"required"`
	Default  any        `json:"default,omitempty"`
	Type     TypeSchema `json:"type"`
}

type BlockSchema struct {
	Name     string     `json:"name"`
	Required bool       `json:"required"`
	Multiple bool       `json:"multiple,omitempty"`
	Enum     bool       `json:"enum,omitempty"`
	Body     BodySchema `json:"body"`
}

type LabelSchema struct {
	Name string     `json:"name,omitempty"`
	Type TypeSchema `json:"type"`
}

type TypeSchema struct {
	Kind    string      `json:"kind"`
	Value   *TypeSchema `json:"value,omitempty"`
	Elem    *TypeSchema `json:"elem,omitempty"`
	Capsule string      `json:"capsule,omitempty"`
	GoType  string      `json:"goType,omitempty"`
}
