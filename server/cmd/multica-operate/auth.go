package main

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/multica-ai/multica/server/internal/cli"
)

func newLoginCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "login",
		Short: "Check the shared Multica login, or save a token into it",
		Long:  "Reuses the login saved by \"multica login\". Pass --token to store a personal access token in that same config.",
		RunE:  runLogin,
	}
	cmd.Flags().String("token", "", "Personal access token to save into the shared multica config")
	cmd.Flags().String("server-url", "", "Server URL used when saving a token and no config exists yet")
	return cmd
}

func runLogin(cmd *cobra.Command, _ []string) error {
	if err := refuseTaskContext("login"); err != nil {
		return err
	}
	profile := profileOf(cmd)
	token, _ := cmd.Flags().GetString("token")
	serverURL, _ := cmd.Flags().GetString("server-url")
	cfg, err := cli.LoadCLIConfigForProfile(profile)
	if err != nil {
		cfg = cli.CLIConfig{}
	}
	if strings.TrimSpace(token) != "" {
		if strings.TrimSpace(serverURL) != "" {
			cfg.ServerURL = strings.TrimRight(strings.TrimSpace(serverURL), "/")
		}
		if cfg.ServerURL == "" {
			return fmt.Errorf("server URL is missing; pass --server-url or run multica login first")
		}
		cfg.Token = strings.TrimSpace(token)
		if err := cli.SaveCLIConfigForProfile(cfg, profile); err != nil {
			return err
		}
	}
	checked, me, err := requireLogin(profile)
	if err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "logged in as %s (%s)\n", displayName(me), checked.ServerURL)
	if checked.WorkspaceID != "" {
		fmt.Fprintf(os.Stderr, "workspace %s\n", checked.WorkspaceID)
	}
	return nil
}

type meResponse struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Name  string `json:"name"`
}

func displayName(me meResponse) string {
	if me.Name != "" {
		return me.Name
	}
	if me.Email != "" {
		return me.Email
	}
	return me.ID
}

func requireLogin(profile string) (cli.CLIConfig, meResponse, error) {
	cfg, err := cli.LoadCLIConfigForProfile(profile)
	if err != nil {
		return cli.CLIConfig{}, meResponse{}, fmt.Errorf("not logged in; run `multica login` (%w)", err)
	}
	if strings.TrimSpace(cfg.Token) == "" || strings.TrimSpace(cfg.ServerURL) == "" {
		return cfg, meResponse{}, fmt.Errorf("not logged in; run `multica login`")
	}
	client := cli.NewAPIClient(strings.TrimRight(cfg.ServerURL, "/"), cfg.WorkspaceID, cfg.Token)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	var me meResponse
	if err := client.GetJSON(ctx, "/api/me", &me); err != nil {
		return cfg, meResponse{}, fmt.Errorf("login was rejected: %w", err)
	}
	if me.ID == "" {
		return cfg, me, fmt.Errorf("login was rejected")
	}
	return cfg, me, nil
}

func shareSocketURL(serverURL string) (string, error) {
	parsed, err := url.Parse(strings.TrimRight(strings.TrimSpace(serverURL), "/"))
	if err != nil {
		return "", err
	}
	switch parsed.Scheme {
	case "https":
		parsed.Scheme = "wss"
	case "http":
		parsed.Scheme = "ws"
	case "wss", "ws":
	default:
		return "", fmt.Errorf("server URL %q is not an http(s) URL", serverURL)
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/") + "/api/file-shares/connect"
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}
