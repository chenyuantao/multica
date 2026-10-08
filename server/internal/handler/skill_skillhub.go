package handler

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// skillHubAPIBase is the download API. Tests point it at a local server.
var skillHubAPIBase = "https://api.skillhub.cn"

// parseSkillHubParts reads https://skillhub.cn/skills/{owner}/{slug}.
func parseSkillHubParts(raw string) (owner, slug string, err error) {
	parsed, err := url.Parse(raw)
	if err != nil {
		return "", "", fmt.Errorf("invalid URL: %w", err)
	}
	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if len(parts) != 3 || parts[0] != "skills" || !skillHubSegment(parts[1]) || !skillHubSegment(parts[2]) {
		return "", "", fmt.Errorf("skillhub URL must look like https://skillhub.cn/skills/{owner}/{slug}")
	}
	return parts[1], parts[2], nil
}

func skillHubSegment(value string) bool {
	if value == "" || value == "." || value == ".." {
		return false
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			continue
		}
		return false
	}
	return true
}

func skillHubDownloadHost(host, apiHost string) bool {
	host = strings.ToLower(host)
	if host == "" {
		return false
	}
	if host == strings.ToLower(apiHost) {
		return true
	}
	switch host {
	case "skillhub.cn", "www.skillhub.cn", "api.skillhub.cn":
		return true
	}
	return strings.HasSuffix(host, ".myqcloud.com")
}

func skillHubClient(base *http.Client) *http.Client {
	apiHost := ""
	if parsed, err := url.Parse(skillHubAPIBase); err == nil {
		apiHost = parsed.Hostname()
	}
	clone := *base
	clone.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return fmt.Errorf("skillhub download redirected too many times")
		}
		if !skillHubDownloadHost(req.URL.Hostname(), apiHost) {
			return fmt.Errorf("skillhub download redirected to %s", req.URL.Hostname())
		}
		return nil
	}
	return &clone
}

// fetchFromSkillHub downloads the skill zip SkillHub publishes for a page URL
// and reads it with the same archive importer as an uploaded .zip.
func fetchFromSkillHub(ctx context.Context, httpClient *http.Client, rawURL string) (*importedSkill, error) {
	owner, slug, err := parseSkillHubParts(rawURL)
	if err != nil {
		return nil, err
	}
	downloadURL := strings.TrimRight(skillHubAPIBase, "/") + "/api/v1/download?slug=" + url.QueryEscape("@"+owner+"/"+slug)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, downloadURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := skillHubClient(httpClient).Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to reach SkillHub: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("skill not found on SkillHub: @%s/%s", owner, slug)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("SkillHub returned status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxImportArchiveUploadSize+1))
	if err != nil {
		return nil, fmt.Errorf("failed to download SkillHub archive: %w", err)
	}
	if len(data) > maxImportArchiveUploadSize {
		return nil, fmt.Errorf("%w: SkillHub archive exceeds %d bytes", errImportCapExceeded, maxImportArchiveUploadSize)
	}
	if len(data) < 4 || string(data[:2]) != "PK" {
		return nil, fmt.Errorf("SkillHub did not return a skill archive for @%s/%s", owner, slug)
	}
	imported, err := parseSkillArchive(data, slug+".zip")
	if err != nil {
		return nil, fmt.Errorf("SkillHub archive: %w", err)
	}
	parsed, _ := url.Parse(rawURL)
	page := "https://skillhub.cn/skills/" + url.PathEscape(owner) + "/" + url.PathEscape(slug)
	if parsed != nil && parsed.Scheme == "http" {
		page = "http://skillhub.cn/skills/" + url.PathEscape(owner) + "/" + url.PathEscape(slug)
	}
	imported.origin = map[string]any{
		"type":       "skillhub",
		"source_url": page,
		"owner":      owner,
		"slug":       slug,
	}
	return imported, nil
}
