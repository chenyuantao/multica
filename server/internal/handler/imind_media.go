package handler

import (
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"hash/fnv"
	"io"
	"net/http"
	"path"
	"strings"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/multica-ai/multica/server/internal/fileshare"
)

const imindMediaTransferChunk = 512 << 10

var imindMediaLocks [64]sync.Mutex

func lockIMindMedia(machine, id, name string) func() {
	hash := fnv.New32a()
	_, _ = hash.Write([]byte(machine + "\x00" + id + "\x00" + name))
	mu := &imindMediaLocks[hash.Sum32()%uint32(len(imindMediaLocks))]
	mu.Lock()
	return mu.Unlock
}

const (
	imindImageLimit = 16 << 20
	imindAudioLimit = 64 << 20
)

type imindMediaRequest struct {
	ShareMachine string `json:"share_machine"`
	ID           string `json:"id"`
	Name         string `json:"name"`
	ContentType  string `json:"content_type"`
}

// PostIMindMedia stores an image or the original WAV recording alongside its note.
func (h *Handler) PostIMindMedia(w http.ResponseWriter, r *http.Request) {
	var req imindMediaRequest
	req.ShareMachine = r.URL.Query().Get("share_machine")
	req.ID = r.URL.Query().Get("id")
	req.Name = r.URL.Query().Get("name")
	req.ContentType = r.Header.Get("Content-Type")
	if req.ContentType == "application/json" || req.ContentType == "" {
		writeErrorCode(w, http.StatusBadRequest, "imind_invalid_media", "binary media request is required")
		return
	}
	peer, ok := h.iMindPeer(w, r, req.ShareMachine)
	if !ok {
		return
	}
	if _, _, ok := h.readIMindNote(w, r, peer, req.ID); !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, imindAudioLimit)
	data, err := io.ReadAll(r.Body)
	if err != nil || len(data) == 0 {
		writeErrorCode(w, http.StatusBadRequest, "imind_invalid_media", "invalid media data")
		return
	}
	limit := imindImageLimit
	if req.Name == "audio.wav" {
		limit = imindAudioLimit
		if req.ContentType != "audio/wav" || !validIMindWAV(data) {
			writeErrorCode(w, http.StatusBadRequest, "imind_invalid_media", "audio must be a WAV file")
			return
		}
	} else {
		if req.ContentType != "image/jpeg" && req.ContentType != "image/png" && req.ContentType != "image/webp" {
			writeErrorCode(w, http.StatusBadRequest, "imind_invalid_media", "unsupported image type")
			return
		}
		if !strings.HasPrefix(http.DetectContentType(data), req.ContentType) {
			writeErrorCode(w, http.StatusBadRequest, "imind_invalid_media", "image content does not match its type")
			return
		}
	}
	if len(data) > limit {
		writeErrorCode(w, http.StatusRequestEntityTooLarge, "imind_media_too_large", "media file is too large")
		return
	}
	if !safeIMindMediaName(req.Name, req.ContentType) {
		writeErrorCode(w, http.StatusBadRequest, "imind_invalid_media", "invalid media filename")
		return
	}
	unlock := lockIMindMedia(req.ShareMachine, req.ID, req.Name)
	defer unlock()
	uploadIDBytes := make([]byte, 16)
	if _, err := rand.Read(uploadIDBytes); err != nil {
		writeErrorCode(w, http.StatusInternalServerError, "imind_media_failed", "media upload could not start")
		return
	}
	uploadID := hex.EncodeToString(uploadIDBytes)
	ctx, cancel := h.shareContext(r)
	defer cancel()
	mediaPath := path.Join(iMindDir, "media", req.ID, req.Name)
	for offset := 0; offset < len(data); {
		end := offset + imindMediaTransferChunk
		if end > len(data) {
			end = len(data)
		}
		chunk := data[offset:end]
		if err := peer.Call(ctx, fileshare.OpIMindMediaWrite, map[string]any{"scope": fileshare.IMindScope, "path": mediaPath, "offset": offset, "content": chunk, "complete": end == len(data), "upload_id": uploadID}, nil); err != nil {
			writeShareError(w, r, err)
			return
		}
		offset = end
	}
	writeJSON(w, http.StatusCreated, map[string]any{"path": mediaPath, "size": len(data), "content_type": req.ContentType})
}

// GetIMindMedia returns media only after proving that the caller can read its owning note.
func (h *Handler) GetIMindMedia(w http.ResponseWriter, r *http.Request) {
	machine := r.URL.Query().Get("share_machine")
	id := chi.URLParam(r, "id")
	name := chi.URLParam(r, "name")
	peer, ok := h.iMindPeer(w, r, machine)
	if !ok {
		return
	}
	if _, _, ok := h.readIMindNote(w, r, peer, id); !ok {
		return
	}
	if !safeIMindMediaName(name, "") {
		writeErrorCode(w, http.StatusBadRequest, "imind_invalid_media", "invalid media filename")
		return
	}
	unlock := lockIMindMedia(machine, id, name)
	defer unlock()
	ctx, cancel := h.shareContext(r)
	defer cancel()
	var result struct {
		Path     string `json:"path"`
		Content  []byte `json:"content"`
		Size     int64  `json:"size"`
		Complete bool   `json:"complete"`
	}
	mediaPath := path.Join(iMindDir, "media", id, name)
	var content []byte
	for offset := int64(0); ; {
		if err := peer.Call(ctx, fileshare.OpIMindMediaRead, map[string]any{"scope": fileshare.IMindScope, "path": mediaPath, "offset": offset, "chunk_size": imindMediaTransferChunk}, &result); err != nil {
			writeShareError(w, r, err)
			return
		}
		if result.Size < 0 || result.Size > imindAudioLimit || int64(len(content))+int64(len(result.Content)) > result.Size {
			writeErrorCode(w, http.StatusBadGateway, "imind_media_invalid_response", "shared media response is invalid")
			return
		}
		content = append(content, result.Content...)
		offset += int64(len(result.Content))
		if result.Complete {
			break
		}
		if len(result.Content) == 0 || offset >= result.Size {
			writeErrorCode(w, http.StatusBadGateway, "imind_media_invalid_response", "shared media response ended early")
			return
		}
	}
	contentType := "audio/wav"
	if name != "audio.wav" {
		contentType = "image/" + strings.TrimPrefix(path.Ext(name), ".")
		if contentType == "image/jpg" {
			contentType = "image/jpeg"
		}
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(content)
}

func safeIMindMediaName(name, contentType string) bool {
	if name == "audio.wav" {
		return contentType == "" || contentType == "audio/wav"
	}
	if name == "" || path.Base(name) != name || strings.HasPrefix(name, ".") {
		return false
	}
	ext := strings.ToLower(path.Ext(name))
	want := map[string]string{".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}[ext]
	if want == "" || contentType != "" && contentType != want {
		return false
	}
	stem := strings.TrimSuffix(name, path.Ext(name))
	if len(stem) < 16 {
		return false
	}
	for _, r := range stem {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-') {
			return false
		}
	}
	return true
}

// Persist only the PCM format the native recorder and ASR session produce.
func validIMindWAV(data []byte) bool {
	if len(data) < 44 || string(data[:4]) != "RIFF" || string(data[8:12]) != "WAVE" || uint64(binary.LittleEndian.Uint32(data[4:8]))+8 != uint64(len(data)) {
		return false
	}
	formatOK, dataOK := false, false
	for offset := 12; offset < len(data); {
		if len(data)-offset < 8 {
			return false
		}
		kind := string(data[offset : offset+4])
		size := uint64(binary.LittleEndian.Uint32(data[offset+4 : offset+8]))
		offset += 8
		if size > uint64(len(data)-offset) {
			return false
		}
		chunk := data[offset : offset+int(size)]
		switch kind {
		case "fmt ":
			if formatOK || len(chunk) < 16 {
				return false
			}
			formatOK = binary.LittleEndian.Uint16(chunk) == 1 && binary.LittleEndian.Uint16(chunk[2:]) == 1 && binary.LittleEndian.Uint32(chunk[4:]) == 16000 && binary.LittleEndian.Uint32(chunk[8:]) == 32000 && binary.LittleEndian.Uint16(chunk[12:]) == 2 && binary.LittleEndian.Uint16(chunk[14:]) == 16
			if !formatOK {
				return false
			}
		case "data":
			if !formatOK || dataOK || len(chunk) == 0 || len(chunk)%2 != 0 {
				return false
			}
			dataOK = true
		}
		offset += int(size) + (int(size) % 2)
		if offset > len(data) {
			return false
		}
	}
	return formatOK && dataOK
}
