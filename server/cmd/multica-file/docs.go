package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/multica-ai/multica/server/internal/cli"
	"github.com/multica-ai/multica/server/internal/obsidianvault"
)

const docsPathHelp = `Paths are knowledge paths: the machine name, then the path inside that machine's shared directory (for example mbp/notes/a.md). Run "multica-file ls" to list the machines you can use. Only Markdown (.md) files are visible.`

func newLsCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "ls [knowledge-path]",
		Short: "List a knowledge directory",
		Long:  "Lists one directory level. Without an argument, lists every shared machine you can use.\n\n" + docsPathHelp,
		Args:  cobra.MaximumNArgs(1),
		RunE:  runLs,
	}
	cmd.Flags().Bool("json", false, "Print the result as JSON")
	return cmd
}

func newSearchCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "search <query>",
		Short: "Search knowledge notes by title or body",
		Long:  "Searches every shared machine you can use.\n\n" + docsPathHelp,
		Args:  cobra.ExactArgs(1),
		RunE:  runSearch,
	}
	cmd.Flags().Bool("json", false, "Print the result as JSON")
	return cmd
}

func newReadCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "read <knowledge-path>",
		Short: "Print a knowledge note",
		Long:  "Prints the note body. With --json, prints the note with its revision, which \"write --base-revision\" accepts.\n\n" + docsPathHelp,
		Args:  cobra.ExactArgs(1),
		RunE:  runRead,
	}
	cmd.Flags().Bool("json", false, "Print the note and its revision as JSON")
	return cmd
}

func newWriteCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "write <knowledge-path> (--content <text> | --file <local-path> | --stdin)",
		Short: "Create, overwrite, or append to a knowledge note",
		Long: `Writes a Markdown note on the machine that shares it. A missing note is created; its parent directory must already exist.

By default the whole note is replaced. --append and --prepend add the content instead (prepend goes after YAML frontmatter). Pass --base-revision from "read --json" to refuse the overwrite when someone changed the note after you read it.

` + docsPathHelp,
		Args: cobra.ExactArgs(1),
		RunE: runWrite,
	}
	cmd.Flags().String("content", "", "Note content")
	cmd.Flags().String("file", "", "Read the note content from this local file")
	cmd.Flags().Bool("stdin", false, "Read the note content from stdin")
	cmd.Flags().Bool("append", false, "Add the content at the end of the note")
	cmd.Flags().Bool("prepend", false, "Add the content at the start of the note")
	cmd.Flags().String("base-revision", "", "Overwrite only if the note is still at this revision")
	cmd.Flags().Bool("json", false, "Print the written note as JSON")
	cmd.MarkFlagsMutuallyExclusive("content", "file", "stdin")
	cmd.MarkFlagsMutuallyExclusive("append", "prepend", "base-revision")
	return cmd
}

func newMvCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "mv <knowledge-path> <dest-dir>",
		Short: "Move a note or directory into another directory",
		Long:  "Moves the entry into dest-dir, keeping its name. Both must be on the same machine; dest-dir must exist.\n\n" + docsPathHelp,
		Args:  cobra.ExactArgs(2),
		RunE:  runMv,
	}
	cmd.Flags().Bool("json", false, "Print the result as JSON")
	return cmd
}

func runLs(cmd *cobra.Command, args []string) error {
	cmd.SilenceUsage = true
	path := ""
	if len(args) == 1 {
		path = args[0]
	}
	var result obsidianvault.ChildrenResult
	if err := docsCall(cmd, http.MethodPost, "/api/docs/children", map[string]string{"path": path}, &result); err != nil {
		return err
	}
	if asJSON(cmd) {
		return printJSON(result)
	}
	for _, node := range result.Nodes {
		fmt.Fprintln(os.Stdout, nodeLine(node))
	}
	return nil
}

func runSearch(cmd *cobra.Command, args []string) error {
	cmd.SilenceUsage = true
	var result obsidianvault.SearchResult
	if err := docsCall(cmd, http.MethodPost, "/api/docs/search", map[string]string{"q": args[0]}, &result); err != nil {
		return err
	}
	if asJSON(cmd) {
		return printJSON(result)
	}
	for _, node := range searchFiles(result.Nodes) {
		if node.Snippet != "" {
			fmt.Fprintf(os.Stdout, "%s\t%s\n", node.Path, strings.Join(strings.Fields(node.Snippet), " "))
		} else {
			fmt.Fprintln(os.Stdout, node.Path)
		}
	}
	if result.Truncated {
		fmt.Fprintln(os.Stderr, "results truncated; narrow the query")
	}
	return nil
}

func runRead(cmd *cobra.Command, args []string) error {
	cmd.SilenceUsage = true
	var file obsidianvault.FileContent
	if err := docsCall(cmd, http.MethodPost, "/api/docs/files/content", map[string]string{"path": args[0]}, &file); err != nil {
		return err
	}
	if asJSON(cmd) {
		return printJSON(file)
	}
	_, err := io.WriteString(os.Stdout, file.Content)
	return err
}

func runWrite(cmd *cobra.Command, args []string) error {
	cmd.SilenceUsage = true
	path := args[0]
	content, err := writeContent(cmd)
	if err != nil {
		return err
	}
	appendFlag, _ := cmd.Flags().GetBool("append")
	prependFlag, _ := cmd.Flags().GetBool("prepend")
	baseRevision, _ := cmd.Flags().GetString("base-revision")

	var file obsidianvault.FileContent
	switch {
	case appendFlag || prependFlag:
		op := "append"
		if prependFlag {
			op = "prepend"
		}
		err = docsCall(cmd, http.MethodPatch, "/api/docs/files/content", obsidianvault.EditRequest{Path: path, Op: op, Content: content}, &file)
		if docsErrorCode(err) == "docs_not_found" {
			err = docsCall(cmd, http.MethodPost, "/api/docs/files", map[string]string{"path": path, "content": content}, &file)
		}
	case baseRevision != "":
		err = docsCall(cmd, http.MethodPatch, "/api/docs/files/content", obsidianvault.EditRequest{Path: path, Op: "overwrite", Content: content, BaseRevision: baseRevision}, &file)
	default:
		var current obsidianvault.FileContent
		err = docsCall(cmd, http.MethodPost, "/api/docs/files/content", map[string]string{"path": path}, &current)
		switch {
		case docsErrorCode(err) == "docs_not_found":
			err = docsCall(cmd, http.MethodPost, "/api/docs/files", map[string]string{"path": path, "content": content}, &file)
		case err == nil:
			err = docsCall(cmd, http.MethodPatch, "/api/docs/files/content", obsidianvault.EditRequest{Path: path, Op: "overwrite", Content: content, BaseRevision: current.Revision}, &file)
		}
	}
	if err != nil {
		return err
	}
	if asJSON(cmd) {
		return printJSON(writeReport{Path: file.Path, Name: file.Name, ModifiedAt: file.ModifiedAt, Revision: file.Revision})
	}
	fmt.Fprintf(os.Stdout, "wrote %s (revision %s)\n", file.Path, file.Revision)
	return nil
}

type writeReport struct {
	Path       string `json:"path"`
	Name       string `json:"name"`
	ModifiedAt string `json:"modified_at"`
	Revision   string `json:"revision"`
}

func runMv(cmd *cobra.Command, args []string) error {
	cmd.SilenceUsage = true
	var result obsidianvault.MoveResult
	if err := docsCall(cmd, http.MethodPost, "/api/docs/move", map[string]string{"path": args[0], "dest": args[1]}, &result); err != nil {
		return err
	}
	if asJSON(cmd) {
		return printJSON(result)
	}
	fmt.Fprintf(os.Stdout, "moved %s to %s\n", result.From, result.Path)
	return nil
}

func writeContent(cmd *cobra.Command) (string, error) {
	if path, _ := cmd.Flags().GetString("file"); path != "" {
		data, err := os.ReadFile(path)
		return string(data), err
	}
	if fromStdin, _ := cmd.Flags().GetBool("stdin"); fromStdin {
		data, err := io.ReadAll(cmd.InOrStdin())
		return string(data), err
	}
	if cmd.Flags().Changed("content") {
		content, _ := cmd.Flags().GetString("content")
		return content, nil
	}
	return "", errors.New("pass the note content with --content, --file, or --stdin")
}

func asJSON(cmd *cobra.Command) bool {
	v, _ := cmd.Flags().GetBool("json")
	return v
}

func nodeLine(node obsidianvault.Node) string {
	if node.Type == obsidianvault.TypeDir {
		return node.Path + "/"
	}
	return node.Path
}

// searchFiles flattens a search tree to its matching notes.
func searchFiles(nodes []obsidianvault.Node) []obsidianvault.Node {
	var out []obsidianvault.Node
	for _, node := range nodes {
		if node.Type == obsidianvault.TypeDir {
			out = append(out, searchFiles(node.Children)...)
			continue
		}
		out = append(out, node)
	}
	return out
}

func docsCall(cmd *cobra.Command, method, endpoint string, body, out any) error {
	client, err := knowledgeClient(profileOf(cmd))
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(cmd.Context(), 60*time.Second)
	defer cancel()
	if method == http.MethodPatch {
		err = client.PatchJSON(ctx, endpoint, body, out)
	} else {
		err = client.PostJSON(ctx, endpoint, body, out)
	}
	return docsError(err)
}

// docsAPIError keeps the server's error code so callers can branch on it.
type docsAPIError struct {
	Status  int
	Code    string
	Message string
	err     error
}

func (e *docsAPIError) Error() string {
	msg := e.Message
	switch e.Code {
	case "docs_not_found":
		msg += "; check the path with `multica-file ls`, and that the share is visible to you and its parent directory exists"
	case "docs_conflict", "docs_merge_conflict":
		msg += "; read the note again and retry with the new revision"
	}
	if e.Code != "" {
		return fmt.Sprintf("%s (%s)", msg, e.Code)
	}
	return fmt.Sprintf("%s (HTTP %d)", msg, e.Status)
}

func (e *docsAPIError) Unwrap() error { return e.err }

func docsError(err error) error {
	var httpErr *cli.HTTPError
	if !errors.As(err, &httpErr) {
		return err
	}
	var body struct {
		Error string `json:"error"`
		Code  string `json:"code"`
	}
	_ = json.Unmarshal([]byte(httpErr.Body), &body)
	if body.Error == "" {
		body.Error = http.StatusText(httpErr.StatusCode)
	}
	return &docsAPIError{Status: httpErr.StatusCode, Code: body.Code, Message: body.Error, err: err}
}

func docsErrorCode(err error) string {
	var apiErr *docsAPIError
	if errors.As(err, &apiErr) {
		return apiErr.Code
	}
	return ""
}
