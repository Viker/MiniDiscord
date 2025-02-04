FROM node:18-alpine

WORKDIR /app

# Install build dependencies for mediasoup
RUN apk add --no-cache python3 make g++ linux-headers

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application files
COPY . .

# Expose the application port
EXPOSE 15000

# Start the application
CMD ["npm", "start"]
