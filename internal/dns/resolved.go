package dns

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// ResolvedDir is where systemd-resolved reads drop-in configuration (resolved.conf(5)). Tests move it.
var ResolvedDir = "/etc/systemd/resolved.conf.d"

// ResolvedRuntimeDir exists while systemd-resolved runs. Tests move it.
var ResolvedRuntimeDir = "/run/systemd/resolve"

// ResolvedFile is the drop-in `flock install` writes on Linux to send tld to Flock.
func ResolvedFile(tld string) string { return filepath.Join(ResolvedDir, "flock-"+tld+".conf") }

// ResolvedContent is what ResolvedFile holds when it sends tld lookups to Flock's DNS server on
// port. ~tld routes those lookups to Flock alone. A global DNS server also gets asked for every
// other name, which Flock refuses and the network's DNS servers answer.
func ResolvedContent(tld string, port int) string {
	return fmt.Sprintf("# Managed by Flock\n[Resolve]\nDNS=127.0.0.1:%d\nDomains=~%s\n", port, tld)
}

// ResolvedRunning reports whether systemd-resolved runs on this machine.
func ResolvedRunning() bool {
	_, err := os.Stat(ResolvedRuntimeDir)
	return err == nil
}

// ResolvedProblem explains why systemd-resolved does not send tld lookups to Flock's DNS server on
// port, or returns "" when its drop-in does.
func ResolvedProblem(tld string, port int) string {
	if !ResolvedRunning() {
		return fmt.Sprintf("systemd-resolved isn't running, so Linux doesn't send .%s lookups to Flock — "+
			"have your DNS resolver (dnsmasq, NetworkManager, ...) forward .%s to 127.0.0.1 port %d", tld, tld, port)
	}
	path := ResolvedFile(tld)
	data, err := os.ReadFile(path)
	switch {
	case errors.Is(err, os.ErrNotExist):
		return fmt.Sprintf("%s is missing, so systemd-resolved doesn't send .%s lookups to Flock — run `flock install`", path, tld)
	case err != nil:
		return fmt.Sprintf("can't read %s (%v) — run `flock install`", path, err)
	case string(data) != ResolvedContent(tld, port):
		return fmt.Sprintf("%s doesn't point at Flock's DNS server on port %d — run `flock install`", path, port)
	}
	return ""
}
