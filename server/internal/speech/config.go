package speech

import (
	"net/url"
	"os"
	"strings"
)

const (
	defaultModel = "qwen3-asr-flash-realtime"
	defaultURL   = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
)

// Config is the server-side DashScope realtime ASR target. The API key never
// leaves this process; mobile only streams PCM to Multica.
type Config struct {
	APIKey string
	Model  string
	URL    string
}

func ConfigFromEnv() Config {
	cfg := Config{
		APIKey: strings.TrimSpace(os.Getenv("DASHSCOPE_API_KEY")),
		Model:  strings.TrimSpace(os.Getenv("DASHSCOPE_ASR_MODEL")),
		URL:    strings.TrimSpace(os.Getenv("DASHSCOPE_ASR_REALTIME_URL")),
	}
	if cfg.Model == "" {
		cfg.Model = defaultModel
	}
	if cfg.URL == "" {
		cfg.URL = defaultURL
	}
	return cfg
}

func (c Config) endpoint() string {
	base := strings.TrimRight(c.URL, "/")
	sep := "?"
	if strings.Contains(base, "?") {
		sep = "&"
	}
	return base + sep + "model=" + url.QueryEscape(c.Model)
}
