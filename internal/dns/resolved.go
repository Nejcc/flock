package dns

import (
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
)

// systemd-resolved sends a domain's lookups to the DNS servers of the link that claims it as a
// routing domain (~test). Flock gets a link of its own for that: Link, a dummy interface a oneshot
// system unit sets up at boot. A resolved.conf drop-in would put Flock among the global DNS
// servers instead, and when there are others (DNS= in resolved.conf), resolved switches to one of
// them after Flock refuses a name outside the TLD, and the TLD stops resolving.

// UnitDir is where `flock install` writes the unit. Tests move it.
var UnitDir = "/etc/systemd/system"

// ResolvedDir is where systemd-resolved reads drop-ins, where installs before Link kept one. Tests move it.
var ResolvedDir = "/etc/systemd/resolved.conf.d"

// ResolvedRuntimeDir exists while systemd-resolved runs. Tests move it.
var ResolvedRuntimeDir = "/run/systemd/resolve"

// NMConfDir is where NetworkManager reads drop-ins. `flock install` writes one even before
// NetworkManager is installed, so Link stays out of its hands. Tests move it.
var NMConfDir = "/etc/NetworkManager/conf.d"

const (
	// Unit is the system unit that sets up Link.
	Unit = "flock-dns.service"
	// Link is the dummy interface whose DNS settings route the TLD to Flock.
	Link = "flock0"
	// linkAddress is there because resolved ignores links without a routable address. 198.18.0.0/15
	// is set aside for benchmarks, so no network uses it.
	linkAddress = "198.18.53.53/32"
)

// ResolvedFile is the unit `flock install` writes on Linux to send the TLD to Flock.
func ResolvedFile() string { return filepath.Join(UnitDir, Unit) }

// NMFile is the NetworkManager drop-in that keeps it off Link.
func NMFile() string { return filepath.Join(NMConfDir, "90-flock.conf") }

// NMContent makes Link unmanaged. NetworkManager otherwise adopts it as an external device and
// flushes its address when networking goes down (nmcli networking off, suspend), after which
// systemd-resolved drops the link's scope and the TLD stops resolving. += adds to the devices
// other drop-ins leave unmanaged instead of replacing them.
const NMContent = "# Managed by Flock\n[keyfile]\nunmanaged-devices+=interface-name:" + Link + "\n"

// LegacyDropIn is the resolved.conf drop-in installs before Link wrote for tld.
func LegacyDropIn(tld string) string { return filepath.Join(ResolvedDir, "flock-"+tld+".conf") }

// ResolvedContent is the unit that sends tld lookups to Flock's DNS server on port. A link with
// only a routing domain and no explicit default route gets no other lookups. resolved learns of
// the new link through netlink, a moment after ip created it, hence the retries.
func ResolvedContent(tld string, port int) string {
	return fmt.Sprintf(`# Managed by Flock
[Unit]
Description=Flock: send *.%[1]s lookups to Flock's DNS server
Wants=systemd-resolved.service
After=systemd-resolved.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStartPre=-ip link delete %[3]s
ExecStart=ip link add %[3]s type dummy
ExecStart=ip address add %[4]s dev %[3]s
ExecStart=ip link set %[3]s up
ExecStart=sh -c 'for i in 1 2 3 4 5 6 7 8 9 10; do resolvectl dns %[3]s 127.0.0.1:%[2]d && resolvectl domain %[3]s "~%[1]s" && exit 0; sleep 0.5; done; exit 1'
ExecStop=ip link delete %[3]s

[Install]
WantedBy=multi-user.target
`, tld, port, Link, linkAddress)
}

// ResolvedRunning reports whether systemd-resolved runs on this machine.
func ResolvedRunning() bool {
	_, err := os.Stat(ResolvedRuntimeDir)
	return err == nil
}

// linkUp reports whether Link exists with its address. Tests replace it.
var linkUp = func() bool {
	iface, err := net.InterfaceByName(Link)
	if err != nil {
		return false
	}
	addrs, _ := iface.Addrs()
	for _, a := range addrs {
		if a.String() == linkAddress {
			return true
		}
	}
	return false
}

// ResolvedProblem explains why systemd-resolved does not send tld lookups to Flock's DNS server on
// port, or returns "" when the unit, the NetworkManager drop-in and Link are in place.
func ResolvedProblem(tld string, port int) string {
	if !ResolvedRunning() {
		return fmt.Sprintf("systemd-resolved isn't running, so Linux doesn't send .%s lookups to Flock — "+
			"have your DNS resolver (dnsmasq, NetworkManager, ...) forward .%s to 127.0.0.1 port %d", tld, tld, port)
	}
	path := ResolvedFile()
	data, err := os.ReadFile(path)
	switch {
	case errors.Is(err, os.ErrNotExist):
		return fmt.Sprintf("%s is missing, so systemd-resolved doesn't send .%s lookups to Flock — run `flock-php install`", path, tld)
	case err != nil:
		return fmt.Sprintf("can't read %s (%v) — run `flock-php install`", path, err)
	case string(data) != ResolvedContent(tld, port):
		return fmt.Sprintf("%s doesn't send .%s lookups to Flock's DNS server on port %d — run `flock-php install`", path, tld, port)
	}
	if data, _ := os.ReadFile(NMFile()); string(data) != NMContent {
		return fmt.Sprintf("%s is missing, so NetworkManager may take %s's address — run `flock-php install`", NMFile(), Link)
	}
	if !linkUp() {
		return fmt.Sprintf("%s is down or lost its address, so systemd-resolved doesn't send .%s lookups to Flock — run `sudo systemctl restart %s`", Link, tld, Unit)
	}
	return ""
}
