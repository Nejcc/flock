package main

import (
	"net/url"
	"strings"
)

// link is a flock:// link the app handles, as in the other apps (FlockKit's InstallLink,
// SecureLink and UpdateLink):
//
//	flock://install/<service>[/<line>]  e.g. flock://install/mysql/8.4, /php/8.5, /node/24
//	flock://secure/<site>               from the page served for a site that isn't secured
//	flock://update                      from `flock update`
//
// Any web page can open such a link, so it never changes anything by itself: the Settings pane it
// opens asks first.
type link struct {
	Kind    string `json:"kind"` // "install", "secure" or "update"
	Service string `json:"service,omitempty"`
	Line    string `json:"line,omitempty"`
	Site    string `json:"site,omitempty"`
}

// pane is the Settings pane that asks about the link.
func (l link) pane() string {
	switch {
	case l.Kind == "secure":
		return "sites"
	case l.Kind == "update":
		return "general"
	case l.Service == "php" || l.Service == "node":
		return l.Service
	}
	return "services"
}

// parseLink returns the link in a command-line argument, or false when it isn't a valid one.
func parseLink(text string) (link, bool) {
	if text == "" || len(text) > 200 {
		return link{}, false
	}
	u, err := url.Parse(text)
	if err != nil || !strings.EqualFold(u.Scheme, "flock") {
		return link{}, false
	}
	var parts []string
	for _, p := range strings.Split(u.Path, "/") {
		if p != "" {
			parts = append(parts, p)
		}
	}
	switch strings.ToLower(u.Host) {
	case "install":
		if len(parts) < 1 || len(parts) > 2 || !safe(parts[0], 32) || (len(parts) == 2 && !safe(parts[1], 16)) {
			return link{}, false
		}
		l := link{Kind: "install", Service: strings.ToLower(parts[0])}
		if len(parts) == 2 {
			l.Line = parts[1]
		}
		return l, true
	case "secure":
		if len(parts) != 1 || !safe(parts[0], 63) {
			return link{}, false
		}
		return link{Kind: "secure", Site: strings.ToLower(parts[0])}, true
	case "update":
		return link{Kind: "update"}, len(parts) == 0
	}
	return link{}, false
}

// safe: letters, digits, dots and dashes only, so nothing odd ends up in a dialog or a request.
func safe(part string, max int) bool {
	if part == "" || len(part) > max {
		return false
	}
	for _, c := range part {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '.' || c == '-') {
			return false
		}
	}
	return true
}
