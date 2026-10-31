// Package imind maps iMind notes to one portable Markdown file per note.
package imind

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"gopkg.in/yaml.v3"
)

const (
	Version      = 1
	MaxNoteBytes = 4 << 20

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
	File         string `yaml:"file,omitempty" json:"file,omitempty"`
}

type ClipMetadata struct {
	OriginalText string `yaml:"original_text" json:"original_text"`
	Prompt       string `yaml:"prompt" json:"prompt"`
}

// Metadata preserves additional YAML values while exposing JSON-compatible data.
type Metadata map[string]any

func (m Metadata) MarshalJSON() ([]byte, error) {
	return json.Marshal(metadataJSONValue(map[string]any(m)))
}

func metadataJSONValue(value any) any {
	switch value := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(value))
		for key, item := range value {
			out[key] = metadataJSONValue(item)
		}
		return out
	case map[any]any:
		out := make(map[string]any, len(value))
		for key, item := range value {
			out[fmt.Sprint(key)] = metadataJSONValue(item)
		}
		return out
	case []any:
		out := make([]any, len(value))
		for i, item := range value {
			out[i] = metadataJSONValue(item)
		}
		return out
	case float64:
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return fmt.Sprint(value)
		}
	}
	return value
}

type Note struct {
	Metadata   Metadata      `yaml:"-" json:"metadata,omitempty"`
	ID         string        `yaml:"id" json:"id"`
	Summary    string        `yaml:"summary,omitempty" json:"summary,omitempty"`
	Clip       *ClipMetadata `yaml:"clip,omitempty" json:"clip,omitempty"`
	Type       string        `yaml:"type" json:"type"`
	Title      string        `yaml:"title" json:"title"`
	CreatedAt  time.Time     `yaml:"created_at" json:"created_at"`
	UpdatedAt  time.Time     `yaml:"updated_at" json:"updated_at"`
	Tags       []string      `yaml:"tags" json:"tags"`
	SourceURL  *string       `yaml:"source_url" json:"source_url"`
	Audio      *Audio        `yaml:"audio" json:"audio"`
	Content    string        `yaml:"-" json:"content"`
	Transcript string        `yaml:"-" json:"transcript"`
}

type frontmatter struct {
	Metadata  Metadata      `yaml:",inline"`
	Summary   string        `yaml:"summary,omitempty"`
	Clip      *ClipMetadata `yaml:"clip,omitempty"`
	Version   int           `yaml:"imind_version"`
	ID        string        `yaml:"id"`
	Type      string        `yaml:"type"`
	CreatedAt time.Time     `yaml:"created_at"`
	UpdatedAt time.Time     `yaml:"updated_at"`
	Tags      []string      `yaml:"tags"`
	SourceURL *string       `yaml:"source_url"`
	Audio     *Audio        `yaml:"audio"`
}

func New(noteType, title string, now time.Time) (Note, error) {
	note := Note{
		ID:        uuid.NewString(),
		Type:      noteType,
		Title:     strings.TrimSpace(title),
		CreatedAt: now.UTC(),
		UpdatedAt: now.UTC(),
		Tags:      []string{},
	}
	return note, note.Validate()
}

func ValidID(id string) bool {
	u, err := uuid.Parse(id)
	return err == nil && u.Version() == 4 && u.Variant() == uuid.RFC4122 && u.String() == id
}

func (n Note) Validate() error {
	if !ValidID(n.ID) {
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
	values := append([]string{n.Title, n.Content, n.Transcript, n.Summary}, n.Tags...)
	if n.Clip != nil {
		if n.Type != "clip" {
			return fmt.Errorf("%w: clip metadata", ErrInvalidNote)
		}
		values = append(values, n.Clip.OriginalText, n.Clip.Prompt)
	}
	if n.SourceURL != nil {
		u, err := url.Parse(*n.SourceURL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil {
			return fmt.Errorf("%w: source_url", ErrInvalidNote)
		}
		values = append(values, *n.SourceURL)
	}
	for _, value := range values {
		if !utf8.ValidString(value) || strings.ContainsRune(value, '\x00') {
			return fmt.Errorf("%w: text encoding", ErrInvalidNote)
		}
		for _, marker := range []string{contentStart, contentEnd, transcriptStart, transcriptEnd} {
			if strings.Contains(value, marker) {
				return fmt.Errorf("%w: reserved delimiter", ErrInvalidNote)
			}
		}
	}
	if n.Type != "recording" && (strings.TrimSpace(n.Transcript) != "" || n.Audio != nil) {
		return fmt.Errorf("%w: recording fields", ErrInvalidNote)
	}
	if n.Audio != nil && (n.Audio.DurationMS < 0 || (n.Audio.Format != "pcm_s16le" && n.Audio.Format != "wav_pcm_s16le") || n.Audio.SampleRateHz != 16000 || (n.Audio.File != "" && (n.Audio.File != "audio.wav" || n.Audio.Format != "wav_pcm_s16le"))) {
		return fmt.Errorf("%w: audio", ErrInvalidNote)
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
		Version: Version, ID: n.ID, Type: n.Type, Summary: n.Summary, Clip: n.Clip, Metadata: n.Metadata,
		CreatedAt: n.CreatedAt.UTC(), UpdatedAt: n.UpdatedAt.UTC(),
		Tags: n.Tags, SourceURL: n.SourceURL, Audio: n.Audio,
	})
	if err != nil {
		return "", err
	}
	raw := "---\n" + string(fm) + "---\n\n" +
		contentStart + "\n" + strings.TrimSpace(n.Content) + "\n" + contentEnd + "\n\n" +
		transcriptStart + "\n" + strings.TrimSpace(n.Transcript) + "\n" + transcriptEnd + "\n"
	if len(raw) > MaxNoteBytes {
		return "", fmt.Errorf("%w: size", ErrInvalidNote)
	}
	return raw, nil
}

func Parse(markdown, title string) (Note, error) {
	if len(markdown) > MaxNoteBytes || !utf8.ValidString(markdown) || strings.ContainsRune(markdown, '\x00') {
		return Note{}, fmt.Errorf("%w: size or encoding", ErrInvalidNote)
	}
	for _, marker := range []string{contentStart, contentEnd, transcriptStart, transcriptEnd} {
		if strings.Count(markdown, marker) != 1 {
			return Note{}, fmt.Errorf("%w: unique delimiters", ErrInvalidNote)
		}
	}
	if !strings.HasPrefix(markdown, "---\n") {
		return Note{}, fmt.Errorf("%w: frontmatter", ErrInvalidNote)
	}
	end := strings.Index(markdown[len("---\n"):], "\n---\n")
	if end < 0 {
		return Note{}, fmt.Errorf("%w: frontmatter end", ErrInvalidNote)
	}
	end += len("---\n")
	header := markdown[len("---\n"):end]
	var fm frontmatter
	decoder := yaml.NewDecoder(strings.NewReader(header))
	if err := decoder.Decode(&fm); err != nil {
		return Note{}, fmt.Errorf("%w: frontmatter", ErrInvalidNote)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF || !validFrontmatterTypes(header) {
		return Note{}, fmt.Errorf("%w: frontmatter structure", ErrInvalidNote)
	}
	if fm.Version != Version {
		return Note{}, fmt.Errorf("%w: version", ErrInvalidNote)
	}
	body := markdown[end+len("\n---\n"):]
	content, remaining, ok := section(body, contentStart, contentEnd)
	if !ok {
		return Note{}, fmt.Errorf("%w: content delimiter", ErrInvalidNote)
	}
	transcript, trailing, ok := section(remaining, transcriptStart, transcriptEnd)
	if !ok || strings.TrimSpace(trailing) != "" {
		return Note{}, fmt.Errorf("%w: transcript delimiter", ErrInvalidNote)
	}
	note := Note{
		ID: fm.ID, Type: fm.Type, Title: title, Summary: fm.Summary, Clip: fm.Clip, CreatedAt: fm.CreatedAt, UpdatedAt: fm.UpdatedAt,
		Tags: nonNil(fm.Tags), SourceURL: fm.SourceURL, Audio: fm.Audio,
		Content: strings.TrimSpace(content), Transcript: strings.TrimSpace(transcript),
		Metadata: fm.Metadata,
	}
	return note, note.Validate()
}

func section(source, start, end string) (value, rest string, ok bool) {
	startAt := strings.Index(source, start)
	if startAt < 0 || strings.TrimSpace(source[:startAt]) != "" {
		return "", "", false
	}
	afterStart := source[startAt+len(start):]
	endAt := strings.Index(afterStart, end)
	if endAt < 0 || !strings.HasPrefix(afterStart, "\n") || endAt == 0 || afterStart[endAt-1] != '\n' ||
		(len(afterStart) > endAt+len(end) && afterStart[endAt+len(end)] != '\n') {
		return "", "", false
	}
	return strings.TrimPrefix(afterStart[:endAt], "\n"), afterStart[endAt+len(end):], true
}

func validFrontmatterTypes(header string) bool {
	var doc yaml.Node
	if yaml.Unmarshal([]byte(header), &doc) != nil || len(doc.Content) != 1 || doc.Content[0].Kind != yaml.MappingNode {
		return false
	}
	fields := doc.Content[0].Content
	for i := 0; i < len(fields); i += 2 {
		key, value := fields[i].Value, fields[i+1]
		switch key {
		case "id", "type", "summary":
			if value.Tag != "!!str" {
				return false
			}
		case "source_url":
			if value.Tag != "!!str" && value.Tag != "!!null" {
				return false
			}
		case "tags":
			if value.Tag == "!!null" {
				continue
			}
			if value.Kind != yaml.SequenceNode {
				return false
			}
			for _, tag := range value.Content {
				if tag.Tag != "!!str" {
					return false
				}
			}
		case "imind_version":
			if value.Tag != "!!int" {
				return false
			}
		case "created_at", "updated_at":
			if value.Tag != "!!str" && value.Tag != "!!timestamp" {
				return false
			}
		case "clip":
			if value.Tag == "!!null" {
				continue
			}
			if value.Kind != yaml.MappingNode {
				return false
			}
			for j := 0; j < len(value.Content); j += 2 {
				if (value.Content[j].Value != "original_text" && value.Content[j].Value != "prompt") || value.Content[j+1].Tag != "!!str" {
					return false
				}
			}
		case "audio":
			if value.Tag == "!!null" {
				continue
			}
			if value.Kind != yaml.MappingNode {
				return false
			}
			for j := 0; j < len(value.Content); j += 2 {
				tag := "!!int"
				if value.Content[j].Value == "format" || value.Content[j].Value == "file" {
					tag = "!!str"
				}
				if value.Content[j+1].Tag != tag {
					return false
				}
			}
		}
	}
	return true
}

func nonNil(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}
