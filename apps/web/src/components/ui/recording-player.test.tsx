import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { InlineRecordingPlayer } from './recording-player';
import { apiFetch } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

describe('InlineRecordingPlayer component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders — when no recording ID or completed recordings are present', () => {
    render(<InlineRecordingPlayer workspaceId="ws-1" recordings={[]} />);
    expect(screen.getByText('—')).toBeDefined();
  });

  it('renders Play button when completed recording is available', () => {
    render(
      <InlineRecordingPlayer
        workspaceId="ws-1"
        recordings={[{ id: 'rec-1', status: 'COMPLETED' }]}
      />
    );
    const playBtn = screen.getByRole('button', { name: /Play recording/i });
    expect(playBtn).toBeDefined();
  });

  it('clicking Play invokes apiFetch with workspace and recording ID', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({
      url: 'https://storage.provider.com/audio/rec-1.mp3',
    });

    render(
      <InlineRecordingPlayer
        workspaceId="ws-1"
        recordingId="rec-1"
      />
    );

    const playBtn = screen.getByRole('button', { name: /Play recording/i });
    fireEvent.click(playBtn);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/workspaces/ws-1/recordings/rec-1/download'
      );
    });

    await waitFor(() => {
      const audio = screen.getByLabelText('Call recording audio player');
      expect(audio).toBeDefined();
      expect(audio.getAttribute('src')).toBe('https://storage.provider.com/audio/rec-1.mp3');
    });
  });

  it('falls back to callWorkspaceId if active workspaceId is undefined', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({
      url: 'https://storage.provider.com/audio/rec-fallback.mp3',
    });

    render(
      <InlineRecordingPlayer
        workspaceId={null}
        callWorkspaceId="ws-fallback"
        recordingId="rec-fallback"
      />
    );

    const playBtn = screen.getByRole('button', { name: /Play recording/i });
    fireEvent.click(playBtn);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/workspaces/ws-fallback/recordings/rec-fallback/download'
      );
    });
  });

  it('does NOT fire /workspaces/null/ request when neither workspaceId nor callWorkspaceId is present', async () => {
    render(
      <InlineRecordingPlayer
        workspaceId={null}
        callWorkspaceId={null}
        recordingId="rec-no-ws"
      />
    );

    const playBtn = screen.getByRole('button', { name: /Play recording/i });
    expect(playBtn.hasAttribute('disabled')).toBe(true);
    fireEvent.click(playBtn);

    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('handles 403 Forbidden gracefully and shows Denied badge', async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(
      new Error('API error (403): Access denied to recording')
    );

    render(
      <InlineRecordingPlayer
        workspaceId="ws-1"
        recordingId="rec-forbidden"
      />
    );

    const playBtn = screen.getByRole('button', { name: /Play recording/i });
    fireEvent.click(playBtn);

    await waitFor(() => {
      expect(screen.getByText('Denied')).toBeDefined();
    });
  });

  it('resets player state when recordingId changes (e.g. pagination or filter update)', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({
      url: 'https://storage.provider.com/audio/rec-page1.mp3',
    });

    const { rerender } = render(
      <InlineRecordingPlayer
        workspaceId="ws-1"
        recordingId="rec-page1"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Play recording/i }));

    await waitFor(() => {
      expect(screen.getByLabelText('Call recording audio player')).toBeDefined();
    });

    // Re-render with new recording ID (simulating row change / page navigation)
    rerender(
      <InlineRecordingPlayer
        workspaceId="ws-1"
        recordingId="rec-page2"
      />
    );

    // Audio element should be unmounted and fresh Play button displayed
    expect(screen.queryByLabelText('Call recording audio player')).toBeNull();
    expect(screen.getByRole('button', { name: /Play recording/i })).toBeDefined();
  });
});
