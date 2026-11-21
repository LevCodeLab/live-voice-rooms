import express from 'express';
import {
  createChannel,
  joinChannel,
  leaveChannel,
  getStationInfo,
  getChannelStatus,
  listLiveRooms,
} from '../controllers/liveController.js';

const router = express.Router();

router.get('/rooms', listLiveRooms);
router.post('/create', createChannel);
router.post('/join', joinChannel);
router.post('/leave', leaveChannel);
router.get('/station/:frequency', getStationInfo);
router.get('/status/:channelId', getChannelStatus);

export default router;
