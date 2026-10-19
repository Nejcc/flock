package dns

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolvedProblem(t *testing.T) {
	oldUnit, oldRuntime := UnitDir, ResolvedRuntimeDir
	UnitDir, ResolvedRuntimeDir = t.TempDir(), filepath.Join(t.TempDir(), "missing")
	t.Cleanup(func() { UnitDir, ResolvedRuntimeDir = oldUnit, oldRuntime })

	if p := ResolvedProblem("test", 53535); !strings.Contains(p, "systemd-resolved isn't running") || !strings.Contains(p, "port 53535") {
		t.Fatalf("without systemd-resolved: %q", p)
	}

	ResolvedRuntimeDir = t.TempDir()
	if p := ResolvedProblem("test", 53535); !strings.Contains(p, "missing") || !strings.Contains(p, "flock-php install") {
		t.Fatalf("missing unit: %q", p)
	}

	if err := os.WriteFile(ResolvedFile(), []byte(ResolvedContent("test", 53535)), 0o644); err != nil {
		t.Fatal(err)
	}
	if p := ResolvedProblem("test", 53535); p != "" {
		t.Fatalf("current unit: %q", p)
	}
	if p := ResolvedProblem("test", 5300); !strings.Contains(p, "port 5300") || !strings.Contains(p, "flock-php install") {
		t.Fatalf("other port: %q", p)
	}
	if got := ResolvedFile(); got != filepath.Join(UnitDir, "flock-dns.service") {
		t.Fatalf("file: %q", got)
	}
}

// The TLD goes to Flock through a link of its own, never through resolved's global servers.
func TestResolvedContentRoutesTheTLDThroughFlocksLink(t *testing.T) {
	unit := ResolvedContent("test", 53535)
	for _, want := range []string{
		"ExecStart=ip link add flock0 type dummy",
		"ExecStart=ip address add 198.18.53.53/32 dev flock0",
		`resolvectl dns flock0 127.0.0.1:53535 && resolvectl domain flock0 "~test"`,
		"ExecStop=ip link delete flock0",
		"WantedBy=multi-user.target",
	} {
		if !strings.Contains(unit, want) {
			t.Errorf("missing %q in:\n%s", want, unit)
		}
	}
	// A literal % would be a systemd specifier.
	if strings.Contains(unit, "%") || strings.Contains(unit, "[Resolve]") {
		t.Errorf("unit:\n%s", unit)
	}
	if got := LegacyDropIn("test"); got != filepath.Join(ResolvedDir, "flock-test.conf") {
		t.Errorf("legacy drop-in: %q", got)
	}
}
