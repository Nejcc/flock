package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// A fake flock-php on PATH: conflicts lists one program, install prints a line and fails.
func TestSetupRoutes(t *testing.T) {
	dir := t.TempDir()
	script := "#!/bin/sh\ncase \"$1\" in\n" +
		"conflicts) echo '{\"conflicts\":[{\"port\":80,\"service\":\"HTTP\",\"holder\":\"nginx\",\"app\":\"nginx\"}]}' ;;\n" +
		"install) [ -t 0 ] && exit 9; echo 'administrator permission was declined'; exit 1 ;;\nesac\n"
	if err := os.WriteFile(filepath.Join(dir, "flock-php"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+":"+os.Getenv("PATH"))

	mux := http.NewServeMux()
	(&flockApp{root: t.TempDir()}).setupRoutes(mux)
	call := func(method, path string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest(method, path, nil))
		return w
	}

	var c struct{ Conflicts []map[string]any }
	if err := json.Unmarshal(call("POST", "/app/setup/conflicts").Body.Bytes(), &c); err != nil || len(c.Conflicts) != 1 {
		t.Fatalf("conflicts = %+v, %v", c, err)
	}

	if w := call("POST", "/app/setup/install"); w.Code != http.StatusOK {
		t.Fatalf("install: %d %s", w.Code, w.Body)
	}
	var st struct {
		Running, Done, OK bool
		Output            string
	}
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); time.Sleep(20 * time.Millisecond) {
		_ = json.Unmarshal(call("GET", "/app/setup").Body.Bytes(), &st)
		if st.Done {
			break
		}
	}
	if !st.Done || st.OK || st.Output != "administrator permission was declined\n" {
		t.Fatalf("setup state = %+v", st)
	}
}
