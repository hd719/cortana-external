package whoop

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

const whoopAPIBase = "https://api.prod.whoop.com/developer"

type WhoopData struct {
	Profile         map[string]any   `json:"profile"`
	BodyMeasurement map[string]any   `json:"body_measurement"`
	Cycles          []map[string]any `json:"cycles"`
	Recovery        []map[string]any `json:"recovery"`
	Sleep           []map[string]any `json:"sleep"`
	Workouts        []map[string]any `json:"workouts"`
}

type collectionResponse struct {
	Records   []map[string]any `json:"records"`
	NextToken string           `json:"next_token"`
}

func (s *Service) fetchAllWhoopData(ctx context.Context, accessToken string) (*WhoopData, error) {
	data := &WhoopData{}

	profile, err := s.fetchWhoopObject(ctx, accessToken, "/v2/user/profile/basic")
	if err != nil {
		return nil, fmt.Errorf("profile fetch: %w", err)
	}
	data.Profile = profile

	body, err := s.fetchWhoopObject(ctx, accessToken, "/v2/user/measurement/body")
	if err != nil {
		return nil, fmt.Errorf("body measurement fetch: %w", err)
	}
	data.BodyMeasurement = body

	cycles, err := s.fetchWhoopCollection(ctx, accessToken, "/v2/cycle")
	if err != nil {
		return nil, fmt.Errorf("cycles fetch: %w", err)
	}
	data.Cycles = cycles

	recovery, err := s.fetchWhoopCollection(ctx, accessToken, "/v2/recovery")
	if err != nil {
		return nil, fmt.Errorf("recovery fetch: %w", err)
	}
	data.Recovery = recovery

	sleep, err := s.fetchWhoopCollection(ctx, accessToken, "/v2/activity/sleep")
	if err != nil {
		return nil, fmt.Errorf("sleep fetch: %w", err)
	}
	data.Sleep = sleep

	workouts, err := s.fetchWhoopCollection(ctx, accessToken, "/v2/activity/workout")
	if err != nil {
		return nil, fmt.Errorf("workouts fetch: %w", err)
	}
	data.Workouts = workouts

	return data, nil
}

func (s *Service) fetchWhoopObject(ctx context.Context, accessToken, path string) (map[string]any, error) {
	body, err := s.fetchWhoop(ctx, accessToken, path, url.Values{})
	if err != nil {
		return nil, err
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	return payload, nil
}

func (s *Service) fetchWhoopCollection(ctx context.Context, accessToken, path string) ([]map[string]any, error) {
	const pageLimit = 25
	const maxPages = 5

	var allRecords []map[string]any
	nextToken := ""

	for page := 0; page < maxPages; page++ {
		params := url.Values{}
		params.Set("limit", strconv.Itoa(pageLimit))
		if nextToken != "" {
			params.Set("next_token", nextToken)
		}

		body, err := s.fetchWhoop(ctx, accessToken, path, params)
		if err != nil {
			return nil, err
		}

		var payload collectionResponse
		if err := json.Unmarshal(body, &payload); err != nil {
			return nil, err
		}

		allRecords = append(allRecords, payload.Records...)

		if payload.NextToken == "" {
			break
		}
		nextToken = payload.NextToken
	}

	return allRecords, nil
}

func (s *Service) fetchWhoop(ctx context.Context, accessToken, path string, params url.Values) ([]byte, error) {
	const maxAttempts = 3
	backoffs := []time.Duration{1 * time.Second, 2 * time.Second, 4 * time.Second}

	endpoint := fmt.Sprintf("%s%s", whoopAPIBase, path)
	if len(params) > 0 {
		endpoint = endpoint + "?" + params.Encode()
	}

	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		req, err := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+accessToken)
		req.Header.Set("Accept", "application/json")

		resp, err := s.HTTPClient.Do(req)
		if err != nil {
			lastErr = err
		} else {
			payload, reqErr := readWhoopResponse(resp)
			if reqErr == nil {
				return payload, nil
			}
			lastErr = reqErr
		}

		if !isWhoopRetriableError(lastErr) {
			return nil, lastErr
		}

		if attempt == maxAttempts {
			break
		}

		if s.Logger != nil {
			s.Logger.Printf("retrying Whoop API call %s (attempt %d/%d) after error: %v", path, attempt+1, maxAttempts, lastErr)
		}

		select {
		case <-time.After(backoffs[attempt-1]):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}

	return nil, lastErr
}

func readWhoopResponse(resp *http.Response) ([]byte, error) {
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return nil, errors.New("whoop unauthorized")
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("whoop api error: %d", resp.StatusCode)
	}

	payload, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	return payload, nil
}

func isWhoopRetriableError(err error) bool {
	if err == nil {
		return false
	}

	status := 0
	if _, scanErr := fmt.Sscanf(err.Error(), "whoop api error: %d", &status); scanErr == nil {
		switch status {
		case http.StatusTooManyRequests, http.StatusInternalServerError, http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
			return true
		default:
			return false
		}
	}

	return false
}
