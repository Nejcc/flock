package main

// The setup wizard's side (setup.html): which other programs hold Flock's ports, and
// `flock-php install` run without a terminal, so its root steps ask through pkexec's password
// dialog instead of sudo.

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
)

// setupRun is the last `flock-php install` the wizard started, and its output so far.
type setupRun struct {
	mu      sync.Mutex
	out     bytes.Buffer
	running bool
	done    bool
	ok      bool
}

func (s *setupRun) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.out.Write(p)
}

// installer is the CLI that sets Flock up: flock-php on PATH (the AUR package), else the one next
// to this app (the release archive), else the copy an earlier setup put in Flock's folder.
func (f *flockApp) installer() string {
	if p, err := exec.LookPath("flock-php"); err == nil {
		return p
	}
	candidates := []string{f.flock()}
	if self, err := os.Executable(); err == nil {
		candidates = append([]string{filepath.Join(filepath.Dir(self), "flock-php")}, candidates...)
	}
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

func (f *flockApp) setupRoutes(mux *http.ServeMux) {
	run := &setupRun{}

	mux.HandleFunc("GET /app/setup", func(w http.ResponseWriter, _ *http.Request) {
		run.mu.Lock()
		defer run.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"cli": f.installer(), "running": run.running, "done": run.done, "ok": run.ok, "output": run.out.String(),
		})
	})
	// The programs to quit first, as `flock-php conflicts --json` lists them. An empty list when the
	// check itself fails: install checks again and says why.
	mux.HandleFunc("POST /app/setup/conflicts", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		out, err := exec.Command(f.installer(), "conflicts", "--json").Output()
		if err != nil || !json.Valid(out) {
			out = []byte(`{"conflicts":[]}`)
		}
		_, _ = w.Write(out)
	})
	mux.HandleFunc("POST /app/setup/install", func(w http.ResponseWriter, _ *http.Request) {
		cli := f.installer()
		if cli == "" {
			http.Error(w, "flock-php isn't installed", http.StatusNotFound)
			return
		}
		run.mu.Lock()
		defer run.mu.Unlock()
		if run.running {
			http.Error(w, "setup is already running", http.StatusConflict)
			return
		}
		run.out.Reset()
		run.running, run.done, run.ok = true, false, false
		// No stdin: without a terminal, install asks for root through pkexec.
		cmd := exec.Command(cli, "install")
		cmd.Stdout, cmd.Stderr = run, run
		go func() {
			err := cmd.Run()
			run.mu.Lock()
			run.running, run.done, run.ok = false, true, err == nil
			run.mu.Unlock()
		}()
	})
}
