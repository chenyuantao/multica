// Package imind maps iMind notes to one portable Markdown file per note.
package imind

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"gopkg.in/yaml.v3"
)

const (
	Version = 1

	contentStart    = "<!-- imind:content:start -->"
	contentEnd      = "<!-- imind:content:end -->"
	transcriptStart = "<!-- imind:transcript:start -->"
	transcriptEnd   = "<!-- imind:transcript:end -->"
)

var (
	ErrInvalidNote = errors.New("invalid iMind note")
	ErrWrongID     = errors.New("iMind note id does not match")
)

type Audio struct {
	DurationMS   int    `yaml:"duration_ms" json:"duration_ms"`
	Format       string `yaml:"format" json:"format"`
	SampleRateHz int    `yaml:"sample_rate_hz" json:"sample_rate_hz"`
}

type Note struct {
	ID         string    `yaml:"id" json:"id"`
	Type       string    `yaml:"type" json:"type"`
	Title      string    `yaml:"title" json:"title"`
	CreatedAt  time.Time `yaml:"created_at" json:"created_at"`
	UpdatedAt  time.Time `yaml:"updated_at" json:"updated_at"`
	Tags       []string  `yaml:"tags" json:"tags"`
	SourceURL  *string   `yaml:"source_url" json:"source_url"`
	Audio      *Audio    `yaml:"audio" json:"audio"`
	Content    string    `yaml:"-" json:"content"`
	Transcript string    `yaml:"-" json:"transcript"`
}

type frontmatter struct {
	Version   int       `yaml:"imind_version"`
	ID        string    `yaml:"id"`
	Type      string    `yaml:"type"`
	Title     string    `yaml:"title"`
	CreatedAt time.Time `yaml:"created_at"`
	UpdatedAt time.Time `yaml:"updated_at"`
	Tags      []string  `yaml:"tags"`
	SourceURL *string   `yaml:"source_url"`
	Audio     *Audio    `yaml:"audio"`
}

func New(noteType, title string, now time.Time) (Note, error) {
	note := Note{
		ID:        uuid.NewString(),
		Type:      strings.TrimSpace(noteType),
		Title:     strings.TrimSpace(title),
		CreatedAt: now.UTC(),
		UpdatedAt: now.UTC(),
		Tags:      []string{},
	}
	return note, note.Validate()
}

func (n Note) Validate() error {
	if _, err := uuid.Parse(n.ID); err != nil {
		return fmt.Errorf("%w: id", ErrInvalidNote)
	}
	switch n.Type {
	case "note", "recording", "clip":
	default:
		return fmt.Errorf("%w: type", ErrInvalidNote)
	}
	if strings.TrimSpace(n.Title) == "" || strings.ContainsRune(n.Title, '\x00') {
		return fmt.Errorf("%w: title", ErrInvalidNote)
	}
	if n.CreatedAt.IsZero() || n.UpdatedAt.IsZero() {
		return fmt.Errorf("%w: timestamps", ErrInvalidNote)
	}
	if n.SourceURL != nil && strings.ContainsRune(*n.SourceURL, '\x00') {
		return fmt.Errorf("%w: source_url", ErrInvalidNote)
	}
	for _, tag := range n.Tags {
		if strings.TrimSpace(tag) == "" || strings.ContainsRune(tag, '\x00') {
			return fmt.Errorf("%w: tags", ErrInvalidNote)
		}
	}
	return nil
}

func (n Note) Markdown() (string, error) {
	if err := n.Validate(); err != nil {
		return "", err
	}
	fm, err := yaml.Marshal(frontmatter{
		Version: Version, ID: n.ID, Type: n.Type, Title: n.Title,
		CreatedAt: n.CreatedAt.UTC(), UpdatedAt: n.UpdatedAt.UTC(),
		Tags: n.Tags, SourceURL: n.SourceURL, Audio: n.Audio,
	})
	if err != nil {
		return "", err
	}
	return "---\n" + string(fm) + "---\n\n" +
		contentStart + "\n" + strings.TrimSpace(n.Content) + "\n" + contentEnd + "\n\n" +
		transcriptStart + "\n" + strings.TrimSpace(n.Transcript) + "\n" + transcriptEnd + "\n", nil
}

func Parse(markdown string) (Note, error) {
	if !strings.HasPrefix(markdown, "---\n") {
		return Note{}, fmt.Errorf("%w: frontmatter", ErrInvalidNote)
	}
	end := strings.Index(markdown[len("---\n"):], "\n---\n")
	if end < 0 {
		return Note{}, fmt.Errorf("%w: frontmatter end", ErrInvalidNote)
	}
	end += len("---\n")
	var fm frontmatter
	if err := yaml.Unmarshal([]byte(markdown[len("---\n"):end]), &fm); err != nil {
		return Note{}, fmt.Errorf("%w: frontmatter: %v", ErrInvalidNote, err)
	}
	if fm.Version != Version {
		return Note{}, fmt.Errorf("%w: version", ErrInvalidNote)
	}
	body := markdown[end+len("\n---\n"):]
	content, remaining, ok := section(body, contentStart, contentEnd)
	if !ok {
		return Note{}, fmt.Errorf("%w: content delimiter", ErrInvalidNote)
	}
	transcript, _, ok := section(remaining, transcriptStart, transcriptEnd)
	if !ok {
		return Note{}, fmt.Errorf("%w: transcript delimiter", ErrInvalidNote)
	}
	note := Note{
		ID: fm.ID, Type: fm.Type, Title: fm.Title, CreatedAt: fm.CreatedAt, UpdatedAt: fm.UpdatedAt,
		Tags: nonNil(fm.Tags), SourceURL: fm.SourceURL, Audio: fm.Audio,
		Content: strings.TrimSpace(content), Transcript: strings.TrimSpace(transcript),
	}
	return note, note.Validate()
}

func section(source, start, end string) (value, rest string, ok bool) {
	startAt := strings.Index(source, start)
	if startAt < 0 {
		return "", "", false
	}
	afterStart := source[startAt+len(start):]
	endAt := strings.Index(afterStart, end)
	if endAt < 0 {
		return "", "", false
	}
	return strings.TrimPrefix(afterStart[:endAt], "\n"), afterStart[endAt+len(end):], true
}

func nonNil(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}
