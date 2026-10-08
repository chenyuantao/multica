// Package fileshare serves one directory on the machine that runs
// multica-file. The server never stores the files. It asks the machine for
// the listing, the one note being opened, or the one write being saved.
package fileshare

import (
	"strings"
	"unicode"
)

const (
	// SystemRoot is the knowledge path of the deployment's existing vault.
	SystemRoot = "system"

	VisibilityPrivate   = "private"
	VisibilityWorkspace = "workspace"
)

// Cut splits a knowledge path into its first segment and the remainder.
// An empty path has an empty root. Paths stay slash-separated and are not
// cleaned with path.Clean, which would rewrite ".." into a parent reference
// the caller still has to reject.
func Cut(path string) (root, rest string) {
	path = strings.Trim(path, "/")
	if path == "" || path == "." {
		return "", ""
	}
	if i := strings.IndexByte(path, '/'); i >= 0 {
		return path[:i], path[i+1:]
	}
	return path, ""
}

// Join builds a knowledge path. An empty rest is the root itself.
func Join(root, rest string) string {
	rest = strings.Trim(rest, "/")
	if rest == "" {
		return root
	}
	if root == "" {
		return rest
	}
	return root + "/" + rest
}

// SanitizeMachine checks the name used as the path prefix. It has to be one
// path segment, and it cannot take the system vault's name.
func SanitizeMachine(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", errBadMachine
	}
	if name == SystemRoot || strings.EqualFold(name, SystemRoot) {
		return "", errBadMachine
	}
	if strings.ContainsAny(name, `/\`) || strings.Contains(name, "..") {
		return "", errBadMachine
	}
	for _, r := range name {
		if r < 32 || r == 127 || unicode.IsControl(r) {
			return "", errBadMachine
		}
	}
	return name, nil
}

// NormalizeVisibility accepts the two published modes. Anything else is private
// only when the caller asked for the default; an explicit unknown value errors.
func NormalizeVisibility(value string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", VisibilityPrivate:
		return VisibilityPrivate, nil
	case VisibilityWorkspace:
		return VisibilityWorkspace, nil
	default:
		return "", errBadVisibility
	}
}
