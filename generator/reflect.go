package main

import (
	"fmt"
	"os"
	"reflect"
	"sort"
	"strings"
	"time"

	"github.com/grafana/alloy/syntax"
	"github.com/grafana/alloy/syntax/alloytypes"
)

var (
	durationType       = reflect.TypeOf(time.Duration(0))
	secretType         = reflect.TypeOf(alloytypes.Secret(""))
	optionalSecretType = reflect.TypeOf(alloytypes.OptionalSecret{})
	defaulterType      = reflect.TypeOf((*syntax.Defaulter)(nil)).Elem()
)

type tagInfo struct {
	name     string
	kind     string
	optional bool
	squash   bool
}

func bodyForType(t reflect.Type) BodySchema {
	return bodyForTypeWithDefault(t, defaultValue(t), map[reflect.Type]bool{})
}

func bodyForTypeWithDefault(t reflect.Type, defaults reflect.Value, visited map[reflect.Type]bool) BodySchema {
	t = indirectType(t)
	if t == nil || t.Kind() != reflect.Struct {
		return BodySchema{}
	}
	if visited[t] {
		warnf("cycle detected in %s; body truncated", goType(t))
		return BodySchema{}
	}
	visited[t] = true
	defer delete(visited, t)

	var body BodySchema
	for i := 0; i < t.NumField(); i++ {
		field := t.Field(i)
		if field.PkgPath != "" {
			continue
		}
		info, ok := parseAlloyTag(field)
		if !ok {
			continue
		}
		fieldDefault := fieldValue(defaults, i)
		switch {
		case info.squash:
			nested := bodyForTypeWithDefault(field.Type, fieldDefault, visited)
			body.Attributes = append(body.Attributes, nested.Attributes...)
			body.Blocks = append(body.Blocks, nested.Blocks...)
			body.Labels = append(body.Labels, nested.Labels...)
		case info.kind == "attr":
			body.Attributes = append(body.Attributes, attrForField(field, info, fieldDefault, visited))
		case info.kind == "block" || info.kind == "enum":
			body.Blocks = append(body.Blocks, blockForField(field, info, visited))
		case info.kind == "label":
			body.Labels = append(body.Labels, LabelSchema{
				Name: info.name,
				Type: safeTypeForField(field, visited),
			})
		}
	}
	return body
}

func attrForField(field reflect.StructField, info tagInfo, defaults reflect.Value, visited map[reflect.Type]bool) (attr AttributeSchema) {
	attr = AttributeSchema{Name: info.name, Required: !info.optional}
	defer func() {
		if r := recover(); r != nil {
			warnf("field %s.%s fell back to raw: %v", field.Type.PkgPath(), field.Name, r)
			attr.Type = rawType(field.Type)
		}
	}()
	attr.Type = typeForField(field, visited)
	if def, ok := scalarDefault(defaults); ok {
		attr.Default = def
	}
	return attr
}

func blockForField(field reflect.StructField, info tagInfo, visited map[reflect.Type]bool) (block BlockSchema) {
	block = BlockSchema{Name: info.name, Required: !info.optional, Enum: info.kind == "enum"}
	defer func() {
		if r := recover(); r != nil {
			warnf("block %s.%s fell back to empty raw body: %v", field.Type.PkgPath(), field.Name, r)
			block.Body = BodySchema{
				Attributes: []AttributeSchema{{
					Name:     "_raw",
					Required: false,
					Type:     rawType(field.Type),
				}},
			}
		}
	}()
	elem := field.Type
	for elem.Kind() == reflect.Pointer || elem.Kind() == reflect.Slice || elem.Kind() == reflect.Array {
		if elem.Kind() == reflect.Slice || elem.Kind() == reflect.Array {
			block.Multiple = true
		}
		elem = elem.Elem()
	}
	body := bodyForTypeWithDefault(elem, defaultValue(elem), visited)
	if len(body.Attributes) == 0 && len(body.Blocks) == 0 && len(body.Labels) == 0 && elem.Kind() != reflect.Struct {
		body.Attributes = []AttributeSchema{{
			Name:     "_raw",
			Required: false,
			Type:     rawType(field.Type),
		}}
	}
	block.Body = body
	return block
}

func safeTypeForField(field reflect.StructField, visited map[reflect.Type]bool) (schema TypeSchema) {
	defer func() {
		if r := recover(); r != nil {
			warnf("field %s.%s fell back to raw: %v", field.Type.PkgPath(), field.Name, r)
			schema = rawType(field.Type)
		}
	}()
	return typeForField(field, visited)
}

func typeForField(field reflect.StructField, visited map[reflect.Type]bool) TypeSchema {
	return typeFor(field.Type, strings.ToLower(field.Name), visited)
}

func typeFor(t reflect.Type, fieldName string, visited map[reflect.Type]bool) TypeSchema {
	if capsule, ok := capsuleFor(t, fieldName); ok {
		return TypeSchema{Kind: "capsule", Capsule: capsule, GoType: goType(t)}
	}
	if t == secretType {
		return TypeSchema{Kind: "secret"}
	}
	if t == optionalSecretType {
		return TypeSchema{Kind: "optional_secret"}
	}
	if t == durationType {
		return TypeSchema{Kind: "duration"}
	}
	switch t.Kind() {
	case reflect.Pointer:
		return typeFor(t.Elem(), fieldName, visited)
	case reflect.String:
		return TypeSchema{Kind: "string"}
	case reflect.Bool:
		return TypeSchema{Kind: "bool"}
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr,
		reflect.Float32, reflect.Float64:
		return TypeSchema{Kind: "number"}
	case reflect.Map:
		value := typeFor(t.Elem(), "", visited)
		return TypeSchema{Kind: "map", Value: &value}
	case reflect.Slice, reflect.Array:
		if capsule, ok := capsuleFor(t, fieldName); ok {
			return TypeSchema{Kind: "capsule", Capsule: capsule, GoType: goType(t)}
		}
		elem := typeFor(t.Elem(), fieldName, visited)
		return TypeSchema{Kind: "list", Elem: &elem}
	case reflect.Struct:
		if visited[t] {
			return rawType(t)
		}
		return TypeSchema{Kind: "raw", GoType: goType(t)}
	case reflect.Interface, reflect.Func, reflect.Chan, reflect.UnsafePointer, reflect.Complex64, reflect.Complex128:
		return rawType(t)
	default:
		return rawType(t)
	}
}

func capsuleFor(t reflect.Type, fieldName string) (string, bool) {
	if t == nil {
		return "", false
	}
	if t.Kind() == reflect.Slice && goType(t) == "[]discovery.Target" {
		return "discovery.Targets", true
	}
	base := indirectType(t)
	switch {
	case base == nil:
		return "", false
	case base.PkgPath() == "github.com/prometheus/prometheus/storage" && base.Name() == "Appendable":
		return "prometheus.Appendable", true
	case base.PkgPath() == "github.com/grafana/alloy/internal/component/common/loki" && base.Name() == "LogsReceiver":
		return "loki.LogsReceiver", true
	case base.PkgPath() == "github.com/grafana/alloy/internal/component/otelcol" && base.Name() == "Consumer":
		switch fieldName {
		case "metrics":
			return "otelcol.Consumer.metrics", true
		case "logs":
			return "otelcol.Consumer.logs", true
		case "traces":
			return "otelcol.Consumer.traces", true
		default:
			return "otelcol.Consumer", true
		}
	}
	return "", false
}

func parseAlloyTag(field reflect.StructField) (tagInfo, bool) {
	tag := field.Tag.Get("alloy")
	if tag == "" || tag == "-" {
		return tagInfo{}, false
	}
	parts := strings.Split(tag, ",")
	info := tagInfo{name: parts[0]}
	for _, part := range parts[1:] {
		switch part {
		case "attr", "block", "label", "enum":
			info.kind = part
		case "optional":
			info.optional = true
		case "squash":
			info.squash = true
		}
	}
	if info.squash {
		return info, true
	}
	if info.name == "" && info.kind != "label" {
		info.name = strings.ToLower(field.Name)
	}
	if info.kind == "" {
		return tagInfo{}, false
	}
	return info, true
}

func defaultValue(t reflect.Type) reflect.Value {
	t = indirectType(t)
	if t == nil {
		return reflect.Value{}
	}
	v := reflect.New(t)
	if v.Type().Implements(defaulterType) {
		func() {
			defer func() {
				if r := recover(); r != nil {
					warnf("defaulting %s failed: %v", goType(t), r)
				}
			}()
			v.Interface().(syntax.Defaulter).SetToDefault()
		}()
	}
	return v.Elem()
}

func fieldValue(v reflect.Value, index int) reflect.Value {
	if !v.IsValid() {
		return reflect.Value{}
	}
	for v.Kind() == reflect.Pointer {
		if v.IsNil() {
			return reflect.Value{}
		}
		v = v.Elem()
	}
	if v.Kind() != reflect.Struct || index >= v.NumField() {
		return reflect.Value{}
	}
	return v.Field(index)
}

func scalarDefault(v reflect.Value) (any, bool) {
	if !v.IsValid() {
		return nil, false
	}
	for v.Kind() == reflect.Pointer {
		if v.IsNil() {
			return nil, false
		}
		v = v.Elem()
	}
	if v.IsZero() {
		return nil, false
	}
	if v.Type() == durationType {
		return v.Interface().(time.Duration).String(), true
	}
	switch v.Kind() {
	case reflect.String:
		return v.String(), true
	case reflect.Bool:
		return v.Bool(), true
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return v.Int(), true
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		return v.Uint(), true
	case reflect.Float32, reflect.Float64:
		return v.Float(), true
	default:
		return nil, false
	}
}

func collectCapsules(body BodySchema, topLevelOnly bool) []string {
	seen := map[string]bool{}
	var walkType func(TypeSchema)
	walkType = func(t TypeSchema) {
		switch t.Kind {
		case "capsule":
			if t.Capsule == "otelcol.Consumer" {
				seen["otelcol.Consumer.traces"] = true
				seen["otelcol.Consumer.metrics"] = true
				seen["otelcol.Consumer.logs"] = true
			} else if t.Capsule != "" {
				seen[t.Capsule] = true
			}
		case "list":
			if t.Elem != nil {
				walkType(*t.Elem)
			}
		case "map":
			if t.Value != nil {
				walkType(*t.Value)
			}
		}
	}
	for _, attr := range body.Attributes {
		walkType(attr.Type)
	}
	if !topLevelOnly {
		var walkBody func(BodySchema)
		walkBody = func(b BodySchema) {
			for _, attr := range b.Attributes {
				walkType(attr.Type)
			}
			for _, block := range b.Blocks {
				walkBody(block.Body)
			}
		}
		for _, block := range body.Blocks {
			walkBody(block.Body)
		}
	}
	out := make([]string, 0, len(seen))
	for capsule := range seen {
		out = append(out, capsule)
	}
	sort.Strings(out)
	return out
}

func indirectType(t reflect.Type) reflect.Type {
	for t != nil && t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	return t
}

func rawType(t reflect.Type) TypeSchema {
	return TypeSchema{Kind: "raw", GoType: goType(t)}
}

func goType(t reflect.Type) string {
	if t == nil {
		return "<nil>"
	}
	return t.String()
}

func warnf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "warning: "+format+"\n", args...)
}
