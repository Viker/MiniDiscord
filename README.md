# MiniDiscord Voice Chat

A simple, child-friendly voice chat application that supports multiple rooms and real-time voice communication.

## Features

- 🎮 Child-friendly interface with fun emojis and colors
- 🎤 Real-time voice chat using WebRTC and Opus codec
- 🏠 Multiple chat rooms
- 🔇 Mute/unmute functionality
- 💬 Speaking indicators
- 🔒 Secure WebSocket communication
- 📱 Responsive design for all devices

## Prerequisites

- Docker and Docker Compose installed
- SSL certificate for your domain (for HTTPS)
- Node.js 18+ (for development)

## Configuration

1. Set up your environment variables:
   Create a `.env` file in the project root:
   ```env
   SERVER_PUBLIC_IP=your_server_ip
   ```

2. Configure your Nginx reverse proxy on the host machine:
   ```nginx
   map $http_upgrade $connection_upgrade {
       default upgrade;
       ''      close;
   }

   server {
       listen 443 ssl;
       server_name voicechat.ibnsina.cc;

       # SSL configuration
       ssl_certificate /path/to/your/fullchain.pem;
       ssl_certificate_key /path/to/your/privkey.pem;

       # Client static files
       location / {
           proxy_pass http://client;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }

       # WebSocket and Socket.IO
       location /socket.io/ {
           proxy_pass http://server:15000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection $connection_upgrade;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;

           proxy_buffers 8 32k;
           proxy_buffer_size 64k;
           proxy_read_timeout 86400s;
           proxy_send_timeout 86400s;
       }

       # WebRTC media
       location /webrtc/ {
           proxy_pass http://server:15000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection $connection_upgrade;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;

           proxy_read_timeout 86400s;
           proxy_send_timeout 86400s;
           proxy_connect_timeout 7d;
           proxy_buffering off;
           proxy_set_header X-NginX-Proxy true;
       }
   }
   ```

## Deployment

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd minidiscord
   ```

2. Build and start the containers:
   ```bash
   docker-compose up -d
   ```

3. Monitor the logs:
   ```bash
   docker-compose logs -f
   ```

## Development

1. Install server dependencies:
   ```bash
   cd server
   npm install
   ```

2. Start the server in development mode:
   ```bash
   npm run dev
   ```

3. Open the client in a web browser:
   ```
   http://localhost:15000
   ```

## Security Considerations

- The application runs behind HTTPS
- WebRTC connections are encrypted
- CORS is properly configured
- Security headers are set in Nginx
- Input validation is implemented
- Rate limiting should be configured in your reverse proxy

## Troubleshooting

1. Check the logs:
   ```bash
   docker-compose logs -f
   ```

2. Common issues:
   - Port 15000 must be accessible
   - WebRTC requires proper STUN/TURN configuration in production
   - Ensure your SSL certificates are valid
   - Check firewall settings for WebRTC ports

## License

MIT License

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request
