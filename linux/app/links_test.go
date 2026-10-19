package main

import "testing"

func TestParseLink(t *testing.T) {
	valid := map[string]link{
		"flock://install/mysql/8.4":   {Kind: "install", Service: "mysql", Line: "8.4"},
		"flock://install/postgres/18": {Kind: "install", Service: "postgres", Line: "18"},
		"flock://install/meilisearch": {Kind: "install", Service: "meilisearch"},
		"FLOCK://Install/MySQL/8.4":   {Kind: "install", Service: "mysql", Line: "8.4"},
		"flock://install/php/8.5":     {Kind: "install", Service: "php", Line: "8.5"},
		"flock://install/node/24":     {Kind: "install", Service: "node", Line: "24"},
		"flock://secure/watchtower":   {Kind: "secure", Site: "watchtower"},
		"flock://update":              {Kind: "update"},
		"flock://update/":             {Kind: "update"},
	}
	for text, want := range valid {
		if got, ok := parseLink(text); !ok || got != want {
			t.Errorf("parseLink(%q) = %+v, %v; want %+v", text, got, ok, want)
		}
	}

	for _, text := range []string{
		"", "--background", "settings", "https://install/mysql/8.4", "flock://uninstall/mysql",
		"flock://install", "flock://install/mysql/8.4/extra", "flock://install/my%20sql",
		"flock://install/mysql/8.4%0A", "flock://install/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		"flock://secure", "flock://secure/watchtower/extra", "flock://secure/watch%20tower",
		"flock://secure/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		"flock://update/now",
	} {
		if got, ok := parseLink(text); ok {
			t.Errorf("parseLink(%q) = %+v; want invalid", text, got)
		}
	}

	panes := map[string]string{
		"flock://install/mysql": "services", "flock://install/php/8.5": "php", "flock://install/node": "node",
		"flock://secure/app": "sites", "flock://update": "general",
	}
	for text, want := range panes {
		if l, _ := parseLink(text); l.pane() != want {
			t.Errorf("%q opens %q; want %q", text, l.pane(), want)
		}
	}
}
