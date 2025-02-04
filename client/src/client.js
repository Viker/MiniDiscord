import * as mediasoupClient from 'mediasoup-client';
import { io } from 'socket.io-client';

// Constants and state
const SERVER_URL = window.location.hostname === 'localhost' ? 
    `http://${window.location.hostname}:15000` : 
    'https://voicechat.ibnsina.cc';
let currentRoom = null;
let device = null;
let producerTransport = null;
let audioProducer = null;
let consumerTransports = new Map();
let audioConsumers = new Map();
let isConnected = false;
let isMuted = false;
let username = '';

// DOM Elements
const nameInputContainer = document.querySelector('.name-input-container');
const usernameInput = document.getElementById('username-input');
const startButton = document.getElementById('start-btn');

// Socket request helper function
const createSocketRequest = (socket) => {
    return function(type, data = null) {
        return new Promise((resolve, reject) => {
            socket.emit(type, data, (response) => {
                if (response?.error) {
                    reject(response.error);
                } else {
                    resolve(response);
                }
            });
        });
    };
};

// Socket.IO setup
function setupSocket() {
    return io(SERVER_URL, {
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        secure: true,
        rejectUnauthorized: false,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        query: { username }
    });
}

let socket;

// DOM Elements
const roomsList = document.querySelector('.room-list');
const currentRoomDiv = document.querySelector('.current-room');
const roomNameSpan = document.getElementById('room-name');
const participantsList = document.getElementById('participants-list');
const muteButton = document.getElementById('mute-btn');
const leaveButton = document.getElementById('leave-btn');
const statusMessage = document.getElementById('status-message');

// UI Helper Functions
function showStatus(message, duration = 3000) {
    statusMessage.textContent = message;
    statusMessage.classList.add('show');
    setTimeout(() => {
        statusMessage.classList.remove('show');
    }, duration);
}

function updateParticipantsList(participants) {
    participantsList.innerHTML = '';
    participants.forEach(participant => {
        const div = document.createElement('div');
        div.className = 'participant';
        div.id = `participant-${participant.id}`;
        div.innerHTML = `
            <span class="participant-name">${participant.username}</span>
            ${participant.isMuted ? '🔇' : '🎤'}
        `;
        if (participant.isSpeaking) {
            div.classList.add('speaking');
        }
        participantsList.appendChild(div);
    });
}

// MediaSoup and WebRTC Functions
async function initializeMediaSoup() {
    try {
        device = new mediasoupClient.Device();
        
        const routerRtpCapabilities = await socket.request('get-rtp-capabilities');
        await device.load({ routerRtpCapabilities });
        
        return true;
    } catch (error) {
        console.error('Failed to initialize MediaSoup:', error);
        showStatus('Failed to initialize audio system 😢');
        return false;
    }
}

async function createSendTransport() {
    try {
        const transportInfo = await socket.request('create-transport');
        
        producerTransport = device.createSendTransport(transportInfo);

        producerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            try {
                await socket.request('connect-transport', {
                    transportId: producerTransport.id,
                    dtlsParameters
                });
                callback();
            } catch (error) {
                errback(error);
            }
        });

        producerTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
            try {
                const { producerId } = await socket.request('produce', {
                    transportId: producerTransport.id,
                    kind,
                    rtpParameters
                });
                callback({ id: producerId });
            } catch (error) {
                errback(error);
            }
        });

        return true;
    } catch (error) {
        console.error('Failed to create send transport:', error);
        showStatus('Failed to create audio connection 😢');
        return false;
    }
}

async function createReceiveTransport(producerId, participantId) {
    try {
        const transportInfo = await socket.request('create-transport');
        const consumerTransport = device.createRecvTransport(transportInfo);

        consumerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            try {
                await socket.request('connect-transport', {
                    transportId: consumerTransport.id,
                    dtlsParameters
                });
                callback();
            } catch (error) {
                errback(error);
            }
        });

        const { consumerInfo } = await socket.request('consume', {
            transportId: consumerTransport.id,
            producerId
        });

        const consumer = await consumerTransport.consume(consumerInfo);
        const stream = new MediaStream([consumer.track]);
        
        const audio = new Audio();
        audio.srcObject = stream;
        audio.play();

        consumerTransports.set(participantId, consumerTransport);
        audioConsumers.set(participantId, consumer);

        consumer.on('trackended', () => {
            audio.pause();
        });

        return consumer;
    } catch (error) {
        console.error('Failed to create receive transport:', error);
        showStatus('Failed to connect to participant 😢');
        return null;
    }
}

// Audio Functions
async function initializeAudio() {
    try {
        // First check if we have permission
        const permissionResult = await navigator.permissions.query({ name: 'microphone' });
        if (permissionResult.state === 'denied') {
            throw new Error('Microphone permission denied. Please enable it in your browser settings.');
        }

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const track = stream.getAudioTracks()[0];
        
        if (!track.enabled) {
            throw new Error('Microphone is disabled or not working properly.');
        }

        audioProducer = await producerTransport.produce({ track });
        
        // Setup audio level detection
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.1;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        let speakingDetectionInterval;

        speakingDetectionInterval = setInterval(() => {
            if (isMuted) return;
            
            analyser.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
            const isSpeaking = average > 30; // Adjust threshold as needed

            socket.emit('speaking-change', isSpeaking);
        }, 100);

        showStatus('Microphone connected successfully! 🎤');
        return true;
    } catch (error) {
        console.error('Failed to initialize audio:', error);
        let errorMessage = 'Failed to access microphone 😢';
        
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            errorMessage = 'Please allow microphone access to use voice chat 🎤';
        } else if (error.name === 'NotFoundError') {
            errorMessage = 'No microphone found. Please connect one to use voice chat 🎤';
        }
        
        showStatus(errorMessage, 5000);
        return false;
    }
}

// Room Functions
async function joinRoom(roomId) {
    try {
        const { success, participants } = await socket.request('join-room', roomId);
        if (success) {
            currentRoom = roomId;
            roomNameSpan.textContent = roomId;
            document.querySelector('.rooms-container').classList.add('hidden');
            currentRoomDiv.classList.remove('hidden');
            updateParticipantsList(participants);
            showStatus('Joined room successfully! 🎉');
        }
    } catch (error) {
        console.error('Failed to join room:', error);
        showStatus('Failed to join room 😢');
    }
}

function leaveRoom() {
    if (currentRoom) {
        socket.emit('leave-room', currentRoom);
        currentRoom = null;
        roomNameSpan.textContent = 'Not Connected';
        document.querySelector('.rooms-container').classList.remove('hidden');
        currentRoomDiv.classList.add('hidden');
        showStatus('Left room 👋');
    }
}

// Event Listeners
roomsList.addEventListener('click', async (event) => {
    const roomBubble = event.target.closest('.room-bubble');
    if (roomBubble) {
        const roomId = roomBubble.dataset.room;
        await joinRoom(roomId);
    }
});

muteButton.addEventListener('click', () => {
    isMuted = !isMuted;
    if (audioProducer) {
        audioProducer.pause();
        socket.emit('toggle-mute', isMuted);
        muteButton.classList.toggle('muted');
        muteButton.querySelector('.btn-text').textContent = isMuted ? 'Unmute' : 'Mute';
        muteButton.querySelector('.mic-icon').textContent = isMuted ? '🔇' : '🎤';
    }
});

leaveButton.addEventListener('click', leaveRoom);

// Setup socket event handlers
function setupSocketHandlers(socket) {
    socket.on('participant-joined', async ({ participantId, username }) => {
        showStatus(`${username} joined! 👋`);
        const participants = await socket.request('get-participants', currentRoom);
        updateParticipantsList(participants);
    });

    socket.on('participant-left', ({ participantId }) => {
        const participantElement = document.getElementById(`participant-${participantId}`);
        const username = participantElement?.querySelector('.participant-name')?.textContent || 'Someone';
        if (participantElement) {
            participantElement.remove();
        }
        showStatus(`${username} left the room 👋`);
    });

    socket.on('participant-muted', ({ participantId, isMuted }) => {
        const participantElement = document.getElementById(`participant-${participantId}`);
        if (participantElement) {
            participantElement.classList.toggle('muted', isMuted);
        }
    });

    socket.on('participant-speaking', ({ participantId, isSpeaking }) => {
        const participantElement = document.getElementById(`participant-${participantId}`);
        if (participantElement) {
            participantElement.classList.toggle('speaking', isSpeaking);
        }
    });
}

// Initialize everything when the page loads
window.addEventListener('load', () => {
    // Start with name input
    nameInputContainer.classList.remove('hidden');
    usernameInput.focus();

    startButton.addEventListener('click', async () => {
        username = usernameInput.value.trim();
        if (username.length < 1) {
            showStatus('Please enter your name! 😊');
            return;
        }

        // Hide name input, show rooms
        nameInputContainer.classList.add('hidden');
        document.querySelector('.rooms-container').classList.remove('hidden');

        // Initialize socket with username and setup handlers
        socket = setupSocket();
        socket.request = createSocketRequest(socket);
        setupSocketHandlers(socket);

        try {
            if (await initializeMediaSoup() && await createSendTransport() && await initializeAudio()) {
                isConnected = true;
                showStatus('Ready to chat! 🎉');
            }
        } catch (error) {
            console.error('Failed to initialize:', error);
            showStatus('Failed to start 😢');
        }
    });

    // Handle enter key in name input
    usernameInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            startButton.click();
        }
    });
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (currentRoom) {
        leaveRoom();
    }
});
