package dns

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolvedProblem(t *testing.T) {
	oldDir, oldRuntime := ResolvedDir, ResolvedRuntimeDir
	ResolvedDir, ResolvedRuntimeDir = t.TempDir(), filepath.Join(t.TempDir(), "missing")
	t.Cleanup(func() { ResolvedDir, ResolvedRuntimeDir = oldDir, oldRuntime })

	if p := ResolvedProblem("test", 53535); !strings.Contains(p, "systemd-resolved isn't running") || !strings.Contains(p, "port 53535") {
		t.Fatalf("without systemd-resolved: %q", p)
	}

	ResolvedRuntimeDir = t.TempDir()
	if p := ResolvedProblem("test", 53535); !strings.Contains(p, "missing") || !strings.Contains(p, "flock install") {
		t.Fatalf("missing drop-in: %q", p)
	}

	if err := os.WriteFile(ResolvedFile("test"), []byte(ResolvedContent("test", 53535)), 0o644); err != nil {
		t.Fatal(err)
	}
	if p := ResolvedProblem("test", 53535); p != "" {
		t.Fatalf("current drop-in: %q", p)
	}
	if p := ResolvedProblem("test", 5300); !strings.Contains(p, "port 5300") || !strings.Contains(p, "flock install") {
		t.Fatalf("other port: %q", p)
	}
	if got := ResolvedFile("test"); got != filepath.Join(ResolvedDir, "flock-test.conf") {
		t.Fatalf("file: %q", got)
	}
	if got := ResolvedContent("test", 53535); got != "# Managed by Flock\n[Resolve]\nDNS=127.0.0.1:53535\nDomains=~test\n" {
		t.Fatalf("content changed (must match what flock install writes): %q", got)
	}
}
