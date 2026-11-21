import {
  getActiveRoomsSummary,
  registerHttpRoom,
  endHttpRoom,
} from '../services/signalingServer.js';

const channelStore = new Map();
let nextChannelId = 1;

/**
 * Create a new live voice channel (host).
 * Body: { frequency, hostUserId, title?, maxGuests? }
 */
export async function createChannel(req, res) {
  try {
    const { frequency, hostUserId, title, maxGuests = 100 } = req.body || {};
    if (!frequency || !hostUserId) {
      return res.status(400).json({ error: 'frequency and hostUserId are required' });
    }

    const id = String(nextChannelId++);
    const channel = {
      id,
      frequency,
      hostUserId,
      title: title || `Voice Room ${frequency}`,
      maxGuests: Number(maxGuests) || 100,
      currentGuests: 0,
      guests: new Set(),
      isLive: true,
      createdAt: Date.now(),
    };
    channelStore.set(id, channel);

    registerHttpRoom({
      frequency,
      hostId: hostUserId,
      hostName: hostUserId,
      title: channel.title,
    });

    return res.status(201).json({ channelId: channel.id, message: 'Channel created and live' });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Join an existing live voice channel (listener).
 * Body: { channelId, userId }
 */
export async function joinChannel(req, res) {
  try {
    const { channelId, userId } = req.body || {};
    if (!channelId || !userId) {
      return res.status(400).json({ error: 'channelId and userId are required' });
    }

    const channel = channelStore.get(String(channelId));
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    if (channel.currentGuests >= channel.maxGuests && !channel.guests.has(userId)) {
      return res.status(429).json({ error: 'Channel guest limit reached' });
    }

    if (!channel.guests.has(userId)) {
      channel.guests.add(userId);
      channel.currentGuests = channel.guests.size;
    }

    return res.status(200).json({ message: 'Joined channel', channelId: channel.id, currentGuests: channel.currentGuests });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Leave a live voice channel.
 * Body: { channelId, userId }
 */
export async function leaveChannel(req, res) {
  try {
    const { channelId, userId } = req.body || {};
    if (!channelId || !userId) {
      return res.status(400).json({ error: 'channelId and userId are required' });
    }

    const channel = channelStore.get(String(channelId));
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    if (channel.guests.has(userId)) {
      channel.guests.delete(userId);
      channel.currentGuests = channel.guests.size;
    }

    if (userId === channel.hostUserId) {
      channel.isLive = false;
      endHttpRoom(channel.frequency);
    }

    return res.status(200).json({ message: 'Left channel', channelId: channel.id });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Get active room metadata for a given frequency.
 * Route: GET /api/live/station/:frequency
 */
export async function getStationInfo(req, res) {
  try {
    const { frequency } = req.params;
    if (!frequency) {
      return res.status(400).json({ error: 'frequency is required' });
    }
    const active = getActiveRoomsSummary().find((r) => r.frequency === frequency);
    if (!active) {
      return res.status(200).json({
        frequency,
        isLive: false,
        listenersCount: 0,
      });
    }
    return res.status(200).json(active);
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Get live channel status by ID.
 * Route: GET /api/live/status/:channelId
 */
export async function getChannelStatus(req, res) {
  try {
    const { channelId } = req.params;
    const channel = channelStore.get(String(channelId));
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    return res.status(200).json({
      channelId: channel.id,
      frequency: channel.frequency,
      title: channel.title,
      isLive: channel.isLive,
      currentGuests: channel.currentGuests,
      maxGuests: channel.maxGuests,
      hostUserId: channel.hostUserId,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export function listLiveRooms(_req, res) {
  return res.status(200).json({ rooms: getActiveRoomsSummary() });
}

export function resetChannelStore() {
  channelStore.clear();
  nextChannelId = 1;
}
