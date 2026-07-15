package executor

import "testing"

func TestParseGoVersionSkipsCommandName(t *testing.T) {
	got, ok := parseGoVersion("go version go1.26.0 linux/amd64")
	if !ok {
		t.Fatal("parseGoVersion() ok = false")
	}
	want := []int{1, 26, 0}
	if compareVersion(got, want) != 0 {
		t.Fatalf("parseGoVersion() = %v, want %v", got, want)
	}
}
