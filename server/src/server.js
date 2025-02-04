import express from 'express';
import { createServer } from 'https';
import { Server } from 'socket.io';
import fs from 'fs';
import path from 'path';
import * as mediasoup from 'mediasoup';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

let server;

// Create server based on environment
if (process.env.NODE_ENV === 'production') {
  try {
    const sslOptions = {
      key: fs.readFileSync('/app/certs/privkey.pem'),
      cert: fs.readFileSync('/app/certs/fullchain.pem')
    };
    server = createServer(sslOptions, app);
    console.log('Running in production mode with HTTPS');
  } catch (error) {
    console.error('Failed to load SSL certificates:', error);
    process.exit(1);
  }
} else {
  // Use HTTP for development
  server = require('http').createServer(app);
  console.log('Running in development mode with HTTP');
}
const PORT = process.env.PORT || 15000;

// CORS configuration
app.use(cors({
  origin: (origin, callback) => {
    const allowedOrigins = [
      process.env.CORS_ORIGIN || 'https://voicechat.ibnsina.cc',
      'http://localhost',
      'http://localhost:80'
    ];
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST'],
  credentials: true
}));

// Basic route for API status
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'MiniDiscord API is running' });
});

// Socket.IO setup with secure WebSocket support
const io = new Server(server, {
  path: '/socket.io',
  cors: {
    origin: (origin, callback) => {
      const allowedOrigins = [
        process.env.CORS_ORIGIN || 'https://voicechat.ibnsina.cc',
        'http://localhost',
        'http://localhost:80'
      ];
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
});

// MediaSoup setup
let worker;
let router;
const mediaCodecs = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2
  }
];

// Initialize MediaSoup
async function initializeMediaSoup() {
  worker = await mediasoup.createWorker({
    logLevel: 'warn',
    rtcMinPort: 40000,
    rtcMaxPort: 49999,
  });

  router = await worker.createRouter({ mediaCodecs });

  worker.on('died', () => {
    console.error('MediaSoup worker died, exiting in 2 seconds... [pid:%d]', worker.pid);
    setTimeout(() => process.exit(1), 2000);
  });
}

// Room management
const rooms = new Map();

class Room {
  constructor(roomId) {
    this.id = roomId;
    this.participants = new Map();
    this.transports = new Map();
    this.producers = new Map();
    this.consumers = new Map();
  }
}

// Socket.IO connection handling
io.on('connection', async (socket) => {
  console.log('Client connected:', socket.id);

  // Handle RTP Capabilities request
  socket.on('get-rtp-capabilities', (callback) => {
    callback(router.rtpCapabilities);
  });

  socket.on('join-room', async (roomId, callback) => {
    try {
      if (!rooms.has(roomId)) {
        rooms.set(roomId, new Room(roomId));
      }
      const room = rooms.get(roomId);
      
      socket.room = room;
      socket.roomId = roomId;
      await socket.join(roomId);

      const username = socket.handshake.query.username || `User ${socket.id.slice(0, 4)}`;
      room.participants.set(socket.id, {
        id: socket.id,
        username: username,
        isMuted: false,
        isSpeaking: false
      });

      // Notify others in the room
      socket.to(roomId).emit('participant-joined', { 
        participantId: socket.id,
        username: username
      });

      // Send list of current participants
      const participants = Array.from(room.participants.values());
      callback({ 
        success: true,
        participants 
      });

    } catch (error) {
      callback({ 
        success: false, 
        error: error.message 
      });
    }
  });

  // WebRTC Transport creation
  socket.on('create-transport', async (callback) => {
    try {
      const transport = await router.createWebRtcTransport({
        listenIps: [
          {
            ip: '0.0.0.0',
            announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP
          }
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        initialAvailableOutgoingBitrate: 1000000
      });

      socket.room.transports.set(transport.id, transport);

      callback({
        success: true,
        params: {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters
        }
      });
    } catch (error) {
      callback({ 
        success: false, 
        error: error.message 
      });
    }
  });

  // Connect Transport
  socket.on('connect-transport', async ({ transportId, dtlsParameters }, callback) => {
    try {
      const transport = socket.room.transports.get(transportId);
      await transport.connect({ dtlsParameters });
      callback({ success: true });
    } catch (error) {
      callback({ 
        success: false, 
        error: error.message 
      });
    }
  });

  // Produce audio
  socket.on('produce', async ({ transportId, kind, rtpParameters }, callback) => {
    try {
      const transport = socket.room.transports.get(transportId);
      const producer = await transport.produce({ kind, rtpParameters });
      
      socket.room.producers.set(producer.id, producer);

      producer.on('score', (score) => {
        // Monitor producer quality
      });

      callback({ 
        success: true,
        producerId: producer.id 
      });

    } catch (error) {
      callback({ 
        success: false, 
        error: error.message 
      });
    }
  });

  // Consume audio
  socket.on('consume', async ({ producerId }, callback) => {
    try {
      const producer = socket.room.producers.get(producerId);
      const transport = Array.from(socket.room.transports.values())
        .find(t => t.appData.consumerId === socket.id);

      const consumer = await transport.consume({
        producerId: producer.id,
        rtpCapabilities: router.rtpCapabilities,
        paused: true
      });

      socket.room.consumers.set(consumer.id, consumer);

      callback({
        success: true,
        params: {
          id: consumer.id,
          producerId: producer.id,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters
        }
      });

    } catch (error) {
      callback({ 
        success: false, 
        error: error.message 
      });
    }
  });

  // Handle mute/unmute
  socket.on('toggle-mute', (isMuted) => {
    if (socket.room && socket.room.participants.has(socket.id)) {
      const participant = socket.room.participants.get(socket.id);
      participant.isMuted = isMuted;
      io.to(socket.roomId).emit('participant-muted', {
        participantId: socket.id,
        isMuted
      });
    }
  });

  // Handle speaking status
  socket.on('speaking-change', (isSpeaking) => {
    if (socket.room && socket.room.participants.has(socket.id)) {
      const participant = socket.room.participants.get(socket.id);
      participant.isSpeaking = isSpeaking;
      io.to(socket.roomId).emit('participant-speaking', {
        participantId: socket.id,
        isSpeaking
      });
    }
  });

  // Cleanup on disconnect
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    if (socket.room) {
      socket.room.participants.delete(socket.id);
      io.to(socket.roomId).emit('participant-left', {
        participantId: socket.id
      });

      // Cleanup transports, producers, and consumers
      socket.room.transports.forEach(transport => {
        if (transport.appData.producerId === socket.id ||
            transport.appData.consumerId === socket.id) {
          transport.close();
          socket.room.transports.delete(transport.id);
        }
      });
    }
  });
});

// Start the server
async function start() {
  try {
    await initializeMediaSoup();
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
