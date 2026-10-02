package groupchat

import "strings"

const (
	focusNoteNameMax = 200
	focusNotePathMax = 1024
)

// FocusNote is the knowledge note open beside the chat when a message was sent.
type FocusNote struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

// Normalized trims a client-supplied note and drops one that has no name or
// path. Name and path are capped so a message cannot carry an unbounded note.
func (n *FocusNote) Normalized() (FocusNote, bool) {
	if n == nil {
		return FocusNote{}, false
	}
	name := strings.TrimSpace(strings.ReplaceAll(n.Name, "\x00", ""))
	path := strings.TrimSpace(strings.ReplaceAll(n.Path, "\x00", ""))
	if name == "" || path == "" {
		return FocusNote{}, false
	}
	name, _ = truncateRunes(name, focusNoteNameMax)
	path, _ = truncateRunes(path, focusNotePathMax)
	return FocusNote{Name: name, Path: path}, true
}
